import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CachedScanResponse, ScanCacheStatus, ScanResponse } from "./types";

export interface ScanSnapshot extends ScanResponse {
  /** ISO timestamp when scan finished writing to cache */
  completedAt: string;
  /** Hash of scan config — invalidates cache when env changes */
  configKey: string;
}

export type { ScanCacheStatus, CachedScanResponse } from "./types";

const BLOB_PATHNAME =
  process.env.SCAN_CACHE_BLOB_PATH ?? "ema-scanner/snapshot.json";
const LOCK_BLOB_PATHNAME =
  process.env.SCAN_LOCK_BLOB_PATH ?? "ema-scanner/scan-lock.json";
const LOCAL_CACHE_DIR =
  process.env.SCAN_CACHE_DIR ?? path.join(process.cwd(), ".cache");
const LOCAL_SNAPSHOT_PATH = path.join(LOCAL_CACHE_DIR, "scan-snapshot.json");
const LOCAL_LOCK_PATH = path.join(LOCAL_CACHE_DIR, "scan-lock.json");

/** In-process snapshot for warm lambda reads */
let memorySnapshot: ScanSnapshot | null = null;
let memoryLockUntil = 0;
let lastError: string | null = null;

export function getStaleAfterMs(): number {
  const minutes = Number(process.env.SCAN_STALE_MINUTES ?? 30);
  if (!Number.isFinite(minutes) || minutes < 5) return 30 * 60 * 1000;
  return minutes * 60 * 1000;
}

export function isSnapshotStale(snapshot: ScanSnapshot | null): boolean {
  if (!snapshot) return true;
  const age = Date.now() - new Date(snapshot.completedAt).getTime();
  return age > getStaleAfterMs();
}

function hasBlobToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readBlobJson<T>(pathname: string): Promise<T | null> {
  if (!hasBlobToken()) return null;
  try {
    const { get } = await import("@vercel/blob");
    const blob = await get(pathname, { access: "private" });
    if (!blob) return null;
    const res = await fetch(blob.url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function writeBlobJson(pathname: string, data: unknown): Promise<void> {
  if (!hasBlobToken()) return;
  const { put } = await import("@vercel/blob");
  await put(pathname, JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

async function readLocalJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeLocalJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data), "utf8");
}

export async function loadSnapshot(): Promise<ScanSnapshot | null> {
  if (memorySnapshot) return memorySnapshot;

  const fromBlob = await readBlobJson<ScanSnapshot>(BLOB_PATHNAME);
  if (fromBlob?.results) {
    memorySnapshot = fromBlob;
    return fromBlob;
  }

  const fromDisk = await readLocalJson<ScanSnapshot>(LOCAL_SNAPSHOT_PATH);
  if (fromDisk?.results) {
    memorySnapshot = fromDisk;
    return fromDisk;
  }

  return null;
}

export async function saveSnapshot(snapshot: ScanSnapshot): Promise<void> {
  memorySnapshot = snapshot;
  lastError = null;

  await Promise.all([
    writeBlobJson(BLOB_PATHNAME, snapshot),
    writeLocalJson(LOCAL_SNAPSHOT_PATH, snapshot),
  ]);
}

interface ScanLock {
  startedAt: string;
  expiresAt: string;
}

const LOCK_TTL_MS = 10 * 60 * 1000;

export async function tryAcquireScanLock(): Promise<boolean> {
  const now = Date.now();
  if (memoryLockUntil > now) return false;

  const lock: ScanLock = {
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + LOCK_TTL_MS).toISOString(),
  };

  const existing =
    (await readBlobJson<ScanLock>(LOCK_BLOB_PATHNAME)) ??
    (await readLocalJson<ScanLock>(LOCAL_LOCK_PATH));

  if (existing && new Date(existing.expiresAt).getTime() > now) {
    return false;
  }

  memoryLockUntil = now + LOCK_TTL_MS;
  await Promise.all([
    writeBlobJson(LOCK_BLOB_PATHNAME, lock),
    writeLocalJson(LOCAL_LOCK_PATH, lock),
  ]);
  return true;
}

export async function releaseScanLock(): Promise<void> {
  memoryLockUntil = 0;
  const expired: ScanLock = {
    startedAt: new Date(0).toISOString(),
    expiresAt: new Date(0).toISOString(),
  };
  await Promise.all([
    writeBlobJson(LOCK_BLOB_PATHNAME, expired).catch(() => undefined),
    writeLocalJson(LOCAL_LOCK_PATH, expired).catch(() => undefined),
  ]);
}

export async function isScanInProgress(): Promise<boolean> {
  if (memoryLockUntil > Date.now()) return true;

  const lock =
    (await readBlobJson<ScanLock>(LOCK_BLOB_PATHNAME)) ??
    (await readLocalJson<ScanLock>(LOCAL_LOCK_PATH));

  return Boolean(lock && new Date(lock.expiresAt).getTime() > Date.now());
}

export function setScanError(message: string | null): void {
  lastError = message;
}

export function getScanError(): string | null {
  return lastError;
}

export async function buildCacheStatus(
  snapshot: ScanSnapshot | null,
): Promise<ScanCacheStatus> {
  const inProgress = await isScanInProgress();
  const staleAfterMinutes = getStaleAfterMs() / 60_000;

  return {
    stale: isSnapshotStale(snapshot),
    scanInProgress: inProgress,
    cacheEmpty: snapshot == null,
    staleAfterMinutes,
    lastError: getScanError(),
    scanStartedAt: inProgress
      ? (
          (await readBlobJson<ScanLock>(LOCK_BLOB_PATHNAME)) ??
          (await readLocalJson<ScanLock>(LOCAL_LOCK_PATH))
        )?.startedAt ?? null
      : null,
  };
}

export function toCachedResponse(
  snapshot: ScanSnapshot | null,
  status: ScanCacheStatus,
): CachedScanResponse {
  return {
    scannedAt: snapshot?.scannedAt ?? new Date(0).toISOString(),
    symbolCount: snapshot?.symbolCount ?? 0,
    results: snapshot?.results ?? [],
    sources: snapshot?.sources ?? {
      blueChips: false,
      watchlist: false,
      custom: false,
      tradingViewWatchlist: false,
    },
    tradingViewWatchlistName: snapshot?.tradingViewWatchlistName,
    ...status,
  };
}
