import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isCloudflareWorkersRuntime } from "./runtime";
import type { ScanSnapshot } from "./types";

export interface ScanStorage {
  /** True when remote persistence (R2) is configured. */
  isPersistent(): boolean;
  getSnapshot(): Promise<ScanSnapshot | null>;
  saveSnapshot(snapshot: ScanSnapshot): Promise<void>;
  readJson<T>(key: string): Promise<T | null>;
  writeJson(key: string, data: unknown): Promise<void>;
}

const SNAPSHOT_KEY =
  process.env.SCAN_CACHE_OBJECT_KEY ?? "ema-scanner/snapshot.json";
const META_KEY =
  process.env.SCAN_META_OBJECT_KEY ?? "ema-scanner/snapshot-meta.json";
const LOCK_KEY =
  process.env.SCAN_LOCK_OBJECT_KEY ?? "ema-scanner/scan-lock.json";

export { SNAPSHOT_KEY, META_KEY, LOCK_KEY };

const LOCAL_CACHE_DIR =
  process.env.SCAN_CACHE_DIR ?? path.join(process.cwd(), ".cache");
const LOCAL_SNAPSHOT_PATH = path.join(LOCAL_CACHE_DIR, "scan-snapshot.json");
const LOCAL_LOCK_PATH = path.join(LOCAL_CACHE_DIR, "scan-lock.json");

function localPathForKey(key: string): string {
  if (key === SNAPSHOT_KEY) return LOCAL_SNAPSHOT_PATH;
  if (key === LOCK_KEY) return LOCAL_LOCK_PATH;
  if (key === META_KEY) {
    return path.join(LOCAL_CACHE_DIR, "scan-snapshot-meta.json");
  }
  const basename = key.replace(/\//g, "-");
  return path.join(LOCAL_CACHE_DIR, basename);
}

function hasR2Config(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME,
  );
}

/** Local `.cache/` is dev-only; Workers/Pages have no writable filesystem. */
function allowLocalDiskFallback(): boolean {
  return process.env.NODE_ENV !== "production";
}

function createR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID!;
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

export function formatStorageError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("suspended") || lower.includes("disabled")) {
    return "Object storage unavailable — scanning without persistent cache";
  }
  if (
    lower.includes("quota") ||
    lower.includes("limit") ||
    lower.includes("storage") ||
    lower.includes("exceeded")
  ) {
    return "Object storage full — scanning without persistent cache";
  }
  return message;
}

class LocalScanStorage implements ScanStorage {
  isPersistent(): boolean {
    return false;
  }

  async getSnapshot(): Promise<ScanSnapshot | null> {
    return this.readJson<ScanSnapshot>(SNAPSHOT_KEY);
  }

  async saveSnapshot(snapshot: ScanSnapshot): Promise<void> {
    await this.writeJson(SNAPSHOT_KEY, snapshot);
  }

  async readJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await readFile(localPathForKey(key), "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async writeJson(key: string, data: unknown): Promise<void> {
    const filePath = localPathForKey(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(data), "utf8");
  }
}

/** Native Workers R2 binding — much lower CPU than the S3-compatible API client. */
class R2BindingScanStorage implements ScanStorage {
  constructor(private bucket: R2Bucket) {}

  isPersistent(): boolean {
    return true;
  }

  async getSnapshot(): Promise<ScanSnapshot | null> {
    return this.readJson<ScanSnapshot>(SNAPSHOT_KEY);
  }

  async saveSnapshot(snapshot: ScanSnapshot): Promise<void> {
    await this.writeJson(SNAPSHOT_KEY, snapshot);
  }

  async readJson<T>(key: string): Promise<T | null> {
    try {
      const object = await this.bucket.get(key);
      if (!object) return null;
      return (await object.json()) as T;
    } catch {
      return null;
    }
  }

  async writeJson(key: string, data: unknown): Promise<void> {
    await this.bucket.put(key, JSON.stringify(data), {
      httpMetadata: { contentType: "application/json" },
    });
  }
}

function getR2BindingBucket(): R2Bucket | null {
  if (!isCloudflareWorkersRuntime()) return null;

  try {
    const { env } = getCloudflareContext();
    return (
      env as CloudflareEnv & { SCAN_CACHE_R2_BUCKET?: R2Bucket }
    ).SCAN_CACHE_R2_BUCKET ?? null;
  } catch {
    return null;
  }
}

class R2ScanStorage implements ScanStorage {
  private client: S3Client;
  private bucket: string;
  private local: LocalScanStorage;

  constructor() {
    this.client = createR2Client();
    this.bucket = process.env.R2_BUCKET_NAME!;
    this.local = new LocalScanStorage();
  }

  isPersistent(): boolean {
    return true;
  }

  async getSnapshot(): Promise<ScanSnapshot | null> {
    const fromR2 = await this.readJson<ScanSnapshot>(SNAPSHOT_KEY);
    if (fromR2?.results) return fromR2;

    if (!allowLocalDiskFallback()) return null;

    const fromDisk = await this.local.readJson<ScanSnapshot>(SNAPSHOT_KEY);
    return fromDisk?.results ? fromDisk : null;
  }

  async saveSnapshot(snapshot: ScanSnapshot): Promise<void> {
    await this.writeJson(SNAPSHOT_KEY, snapshot);
  }

  async readJson<T>(key: string): Promise<T | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = await response.Body?.transformToString();
      if (!body) {
        return allowLocalDiskFallback() ? this.local.readJson<T>(key) : null;
      }
      return JSON.parse(body) as T;
    } catch {
      return allowLocalDiskFallback() ? this.local.readJson<T>(key) : null;
    }
  }

  async writeJson(key: string, data: unknown): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(data),
        ContentType: "application/json",
      }),
    );
    if (allowLocalDiskFallback()) {
      await this.local.writeJson(key, data).catch(() => undefined);
    }
  }
}

let storageInstance: ScanStorage | null = null;

export function getScanStorage(): ScanStorage {
  if (!storageInstance) {
    const bindingBucket = getR2BindingBucket();
    if (bindingBucket) {
      storageInstance = new R2BindingScanStorage(bindingBucket);
    } else if (hasR2Config()) {
      storageInstance = new R2ScanStorage();
    } else {
      storageInstance = new LocalScanStorage();
    }
  }
  return storageInstance;
}

/** Reset cached storage instance (tests). */
export function resetScanStorageForTests(): void {
  storageInstance = null;
}
