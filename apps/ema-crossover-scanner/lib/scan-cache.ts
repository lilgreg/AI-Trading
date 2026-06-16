import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeScanResults } from "./chart-error-sanitize";
import { normalizeCachedResponse } from "./normalize-scan-result";
import type { CachedScanResponse, ScanCacheStatus, ScanResponse } from "./types";

export interface ScanSnapshot extends ScanResponse {
  /** ISO timestamp when scan finished writing to cache */
  completedAt: string;
  /** Hash of scan config — invalidates cache when env changes */
  configKey: string;
  /** False while a multi-invocation scan is still in progress */
  scanComplete?: boolean;
  /** ISO timestamp of the most recent partial or final write */
  lastSavedAt?: string;
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
  const minutes = Number(process.env.SCAN_STALE_MINUTES ?? 15);
  if (!Number.isFinite(minutes) || minutes < 5) return 15 * 60 * 1000;
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
    const { head } = await import("@vercel/blob");
    const meta = await head(pathname);
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function formatBlobError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("suspended")) {
    return "Blob storage suspended — scanning without persistent cache";
  }
  if (
    lower.includes("quota") ||
    lower.includes("limit") ||
    lower.includes("storage") ||
    lower.includes("exceeded")
  ) {
    return "Blob storage full — scanning without persistent cache";
  }
  return message;
}

async function writeBlobJson(pathname: string, data: unknown): Promise<void> {
  if (!hasBlobToken()) return;
  const { put } = await import("@vercel/blob");
  await put(pathname, JSON.stringify(data), {
    access: "public",
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
    memorySnapshot = await enrichSnapshot(fromBlob);
    return memorySnapshot;
  }

  const fromDisk = await readLocalJson<ScanSnapshot>(LOCAL_SNAPSHOT_PATH);
  if (fromDisk?.results) {
    memorySnapshot = await enrichSnapshot(fromDisk);
    return memorySnapshot;
  }

  return null;
}

async function enrichSnapshot(snapshot: ScanSnapshot): Promise<ScanSnapshot> {
  let updated = sanitizeSnapshotResults(snapshot);
  const { backfillSnapshotIndexes } = await import("./snapshot-enrich");
  updated = await backfillSnapshotIndexes(updated);

  const changed =
    updated.results !== snapshot.results ||
    updated.results.some(
      (row, index) =>
        row.error !== snapshot.results[index]?.error ||
        row.universeIndex !== snapshot.results[index]?.universeIndex,
    );

  if (changed) {
    void saveSnapshot(updated).catch(() => undefined);
  }

  return updated;
}

function sanitizeSnapshotResults(snapshot: ScanSnapshot): ScanSnapshot {
  const sanitizedResults = sanitizeScanResults(snapshot.results);
  const changed = sanitizedResults.some(
    (row, index) => row.error !== snapshot.results[index]?.error,
  );
  if (!changed) return snapshot;
  return { ...snapshot, results: sanitizedResults };
}

export async function saveSnapshot(snapshot: ScanSnapshot): Promise<void> {
  memorySnapshot = snapshot;
  lastError = null;

  if (hasBlobToken()) {
    try {
      await writeBlobJson(BLOB_PATHNAME, snapshot);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Blob snapshot write failed";
      setScanError(formatBlobError(message));
    }
    await writeLocalJson(LOCAL_SNAPSHOT_PATH, snapshot).catch(() => undefined);
    return;
  }

  await writeLocalJson(LOCAL_SNAPSHOT_PATH, snapshot);
}

interface ScanLock {
  startedAt: string;
  expiresAt: string;
}

const LOCK_TTL_MS = 15 * 60 * 1000;
/** Release lock when cache is still empty after this long (crashed scan). */
const EMPTY_CACHE_LOCK_GRACE_MS = 2 * 60 * 1000;

async function readScanLock(): Promise<ScanLock | null> {
  return (
    (await readBlobJson<ScanLock>(LOCK_BLOB_PATHNAME)) ??
    (await readLocalJson<ScanLock>(LOCAL_LOCK_PATH))
  );
}

function isLockActive(lock: ScanLock | null, now = Date.now()): boolean {
  return Boolean(lock && new Date(lock.expiresAt).getTime() > now);
}

/**
 * Clear orphan memory locks and blob locks held with no cached snapshot
 * (e.g. blob write failed during lock acquire or scan timed out on Vercel).
 */
export async function recoverStuckScanState(
  snapshot: ScanSnapshot | null,
): Promise<void> {
  const now = Date.now();
  const lock = await readScanLock();
  const persistedActive = isLockActive(lock, now);

  if (snapshot == null && persistedActive) {
    const startedMs = lock?.startedAt
      ? new Date(lock.startedAt).getTime()
      : 0;
    const lockAge = startedMs > 0 ? now - startedMs : LOCK_TTL_MS;
    if (lockAge >= EMPTY_CACHE_LOCK_GRACE_MS) {
      await releaseScanLock();
    }
  }
}

export async function tryAcquireScanLock(): Promise<boolean> {
  const now = Date.now();
  if (memoryLockUntil > now) {
    const lock = await readScanLock();
    if (!isLockActive(lock, now)) {
      memoryLockUntil = 0;
    } else {
      return false;
    }
  }

  const lock: ScanLock = {
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + LOCK_TTL_MS).toISOString(),
  };

  const existing = await readScanLock();
  if (isLockActive(existing, now)) {
    return false;
  }

  try {
    await Promise.all([
      writeBlobJson(LOCK_BLOB_PATHNAME, lock),
      writeLocalJson(LOCAL_LOCK_PATH, lock).catch(() => undefined),
    ]);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to acquire scan lock";
    setScanError(formatBlobError(message));
    if (!hasBlobToken()) {
      memoryLockUntil = 0;
      return false;
    }
    // Blob unavailable (quota/suspended) — in-memory lock only so scan can still run.
  }

  memoryLockUntil = now + LOCK_TTL_MS;
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
  const now = Date.now();
  const lock = await readScanLock();
  const persistedActive = isLockActive(lock, now);

  if (memoryLockUntil > now) {
    if (!persistedActive && hasBlobToken()) {
      // In-memory scan while blob lock/cache unavailable.
      return true;
    }
    if (!persistedActive) {
      memoryLockUntil = 0;
      return false;
    }
    return true;
  }

  return persistedActive;
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
  const lock = inProgress ? await readScanLock() : null;

  return {
    stale: isSnapshotStale(snapshot),
    scanInProgress: inProgress,
    cacheEmpty: snapshot == null,
    staleAfterMinutes,
    lastError: getScanError(),
    scanStartedAt:
      inProgress
        ? lock?.startedAt ??
          (memoryLockUntil > Date.now()
            ? new Date(memoryLockUntil - LOCK_TTL_MS).toISOString()
            : null)
        : null,
  };
}

export function toCachedResponse(
  snapshot: ScanSnapshot | null,
  status: ScanCacheStatus,
): CachedScanResponse {
  return normalizeCachedResponse({
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
  });
}
