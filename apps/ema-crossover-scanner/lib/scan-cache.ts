import { sanitizeScanResults } from "./chart-error-sanitize";
import { normalizeCachedResponse } from "./normalize-scan-result";
import { isCloudflareWorkersRuntime } from "./runtime";
import { isExcludedSymbol } from "./stocks";
import {
  formatStorageError,
  getScanStorage,
  LOCK_KEY,
  META_KEY,
} from "./scan-storage";
import type {
  CachedScanResponse,
  ScanCacheStatus,
  ScanSnapshot,
} from "./types";

export type { ScanSnapshot, ScanCacheStatus, CachedScanResponse } from "./types";

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
  return isCompletedAtStale(snapshot.completedAt);
}

/** Lightweight snapshot header — avoids parsing full results on status polls. */
export interface ScanSnapshotMeta {
  scannedAt: string;
  completedAt: string;
  symbolCount: number;
  scanComplete?: boolean;
  sources: ScanSnapshot["sources"];
  tradingViewWatchlistName?: string;
}

function isCompletedAtStale(completedAt: string): boolean {
  const age = Date.now() - new Date(completedAt).getTime();
  return age > getStaleAfterMs();
}

function snapshotToMeta(snapshot: ScanSnapshot): ScanSnapshotMeta {
  return {
    scannedAt: snapshot.scannedAt,
    completedAt: snapshot.completedAt,
    symbolCount: snapshot.symbolCount,
    scanComplete: snapshot.scanComplete,
    sources: snapshot.sources,
    tradingViewWatchlistName: snapshot.tradingViewWatchlistName,
  };
}

export async function loadScanMeta(): Promise<ScanSnapshotMeta | null> {
  const storage = getScanStorage();
  const meta = await storage.readJson<ScanSnapshotMeta>(META_KEY);
  if (meta?.completedAt) return meta;

  const snapshot = await loadSnapshot({ enrich: false });
  if (!snapshot) return null;

  await saveScanMeta(snapshot);
  return snapshotToMeta(snapshot);
}

async function saveScanMeta(snapshot: ScanSnapshot): Promise<void> {
  await getScanStorage()
    .writeJson(META_KEY, snapshotToMeta(snapshot))
    .catch(() => undefined);
}

export async function buildStatusFromMeta(
  meta: ScanSnapshotMeta | null,
): Promise<
  ScanCacheStatus & {
    scannedAt: string | null;
    completedAt: string | null;
    symbolCount: number;
  }
> {
  const inProgress = await isScanInProgress();
  const lock = inProgress ? await readScanLock() : null;
  const staleAfterMinutes = getStaleAfterMs() / 60_000;

  return {
    scannedAt: meta?.scannedAt ?? null,
    completedAt: meta?.completedAt ?? null,
    symbolCount: meta?.symbolCount ?? 0,
    stale: meta ? isCompletedAtStale(meta.completedAt) : true,
    scanInProgress: inProgress,
    cacheEmpty: meta == null,
    staleAfterMinutes,
    lastError: getScanError(),
    scanStartedAt: inProgress
      ? lock?.startedAt ??
        (memoryLockUntil > Date.now()
          ? new Date(memoryLockUntil - LOCK_TTL_MS).toISOString()
          : null)
      : null,
  };
}

function hasPersistentStorage(): boolean {
  return getScanStorage().isPersistent();
}

export async function loadSnapshot(
  options: { enrich?: boolean } = {},
): Promise<ScanSnapshot | null> {
  const shouldEnrich =
    options.enrich ?? !isCloudflareWorkersRuntime();

  if (memorySnapshot) {
    if (!shouldEnrich) return memorySnapshot;
    memorySnapshot = await enrichSnapshot(memorySnapshot);
    return memorySnapshot;
  }

  const storage = getScanStorage();
  const fromStorage = await storage.getSnapshot();
  if (fromStorage?.results) {
    memorySnapshot = shouldEnrich
      ? await enrichSnapshot(fromStorage)
      : fromStorage;
    return memorySnapshot;
  }

  return null;
}

async function enrichSnapshot(snapshot: ScanSnapshot): Promise<ScanSnapshot> {
  let updated = pruneExcludedSymbols(snapshot);
  updated = sanitizeSnapshotResults(updated);
  const { backfillSnapshotIndexes } = await import("./snapshot-enrich");
  updated = await backfillSnapshotIndexes(updated);

  const changed =
    updated.results !== snapshot.results ||
    updated.symbolCount !== snapshot.symbolCount ||
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

function pruneExcludedSymbols(snapshot: ScanSnapshot): ScanSnapshot {
  const filtered = snapshot.results.filter((row) => !isExcludedSymbol(row.symbol));
  if (filtered.length === snapshot.results.length) return snapshot;
  return {
    ...snapshot,
    results: filtered,
    symbolCount: filtered.length,
  };
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

  const storage = getScanStorage();

  if (storage.isPersistent()) {
    try {
      await storage.saveSnapshot(snapshot);
      await saveScanMeta(snapshot);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Snapshot write failed";
      setScanError(formatStorageError(message));
    }
    return;
  }

  try {
    await storage.saveSnapshot(snapshot);
    await saveScanMeta(snapshot);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Local snapshot write failed";
    setScanError(message);
  }
}

interface ScanLock {
  startedAt: string;
  expiresAt: string;
}

const LOCK_TTL_MS = 15 * 60 * 1000;
/** Release lock when cache is still empty after this long (crashed scan). */
const EMPTY_CACHE_LOCK_GRACE_MS = 2 * 60 * 1000;
/** Release orphan locks after long scan timeout + buffer (Vercel 300s / CF scheduled up to 15m). */
const ORPHAN_SCAN_LOCK_MS = 6 * 60 * 1000;
/** Workers free tier HTTP ~30s — recover stuck locks sooner between chunk runs. */
const ORPHAN_SCAN_LOCK_MS_CF = 2 * 60 * 1000;

function getOrphanScanLockMs(): number {
  return isCloudflareWorkersRuntime()
    ? ORPHAN_SCAN_LOCK_MS_CF
    : ORPHAN_SCAN_LOCK_MS;
}

async function readScanLock(): Promise<ScanLock | null> {
  const storage = getScanStorage();
  return storage.readJson<ScanLock>(LOCK_KEY);
}

function isLockActive(lock: ScanLock | null, now = Date.now()): boolean {
  return Boolean(lock && new Date(lock.expiresAt).getTime() > now);
}

/**
 * Clear orphan memory locks and remote locks held with no cached snapshot
 * (e.g. storage write failed during lock acquire or scan timed out on Vercel).
 */
export async function recoverStuckScanState(
  snapshot: ScanSnapshot | null,
): Promise<void> {
  const now = Date.now();
  const lock = await readScanLock();
  if (!lock) return;

  const startedMs = lock.startedAt ? new Date(lock.startedAt).getTime() : 0;
  const lockAge = startedMs > 0 ? now - startedMs : LOCK_TTL_MS;
  const expired = !isLockActive(lock, now);

  if (expired) {
    await releaseScanLock();
    return;
  }

  if (snapshot == null && lockAge >= EMPTY_CACHE_LOCK_GRACE_MS) {
    await releaseScanLock();
    return;
  }

  // Serverless scan timed out without releasing lock in finally.
  if (lockAge >= getOrphanScanLockMs()) {
    await releaseScanLock();
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

  const storage = getScanStorage();

  try {
    await storage.writeJson(LOCK_KEY, lock);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to acquire scan lock";
    setScanError(formatStorageError(message));
    if (!hasPersistentStorage()) {
      memoryLockUntil = 0;
      return false;
    }
    // R2 unavailable — in-memory lock only so scan can still run.
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
  await getScanStorage()
    .writeJson(LOCK_KEY, expired)
    .catch(() => undefined);
}

export async function isScanInProgress(): Promise<boolean> {
  const now = Date.now();
  const lock = await readScanLock();
  const persistedActive = isLockActive(lock, now);

  if (memoryLockUntil > now) {
    if (!persistedActive && hasPersistentStorage()) {
      // In-memory scan while remote lock/cache unavailable.
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
  const results = snapshot?.results ?? [];
  const scanComplete =
    snapshot != null &&
    snapshot.scanComplete !== false &&
    !results.some((row) => row.error === "Not scanned yet");

  const payload = {
    scannedAt: snapshot?.scannedAt ?? new Date(0).toISOString(),
    symbolCount: snapshot?.symbolCount ?? 0,
    results,
    sources: snapshot?.sources ?? {
      blueChips: false,
      watchlist: false,
      custom: false,
      tradingViewWatchlist: false,
    },
    tradingViewWatchlistName: snapshot?.tradingViewWatchlistName,
    scanComplete,
    retryableCount: results.filter((row) => {
      if (row.ema20 != null && row.ema50 != null && !row.error) return false;
      if (row.error === "Not scanned yet") return true;
      if (!row.error) return row.ema20 == null || row.ema50 == null;
      return true;
    }).length,
    ...status,
  };

  // Client normalizes rows; skip per-row mapping on Workers to stay under CPU limits.
  if (isCloudflareWorkersRuntime()) {
    return payload as CachedScanResponse;
  }

  return normalizeCachedResponse(payload);
}
