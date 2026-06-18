import {
  CACHED_SCAN_API_KEY,
} from "./scan-api-cache";
import { LOCK_KEY, META_KEY } from "./scan-storage";

const SCAN_READ_CACHE_MAX_AGE_SEC = 45;
const LOCK_TTL_MS = 15 * 60 * 1000;
const STALE_AFTER_MS = 15 * 60 * 1000;
/** Mirrors scan-cache EMPTY_CACHE_LOCK_GRACE_MS — release lock on empty cache. */
const EMPTY_CACHE_LOCK_GRACE_MS = 2 * 60 * 1000;
/** Mirrors scan-cache ORPHAN_SCAN_LOCK_MS_CF — Workers HTTP ~30s between chunks. */
const ORPHAN_SCAN_LOCK_MS_CF = 2 * 60 * 1000;

const EXPIRED_LOCK = {
  startedAt: new Date(0).toISOString(),
  expiresAt: new Date(0).toISOString(),
};

type ScanLock = { startedAt?: string; expiresAt?: string };

function isLockActive(lock: ScanLock | null, now: number): boolean {
  if (!lock?.expiresAt) return false;
  const expires = Date.parse(lock.expiresAt);
  return Number.isFinite(expires) && expires > now;
}

function shouldRecoverOrphanLock(
  lock: ScanLock | null,
  now: number,
  cacheEmpty: boolean,
): boolean {
  if (!lock?.expiresAt) return false;
  if (!isLockActive(lock, now)) return true;

  const startedMs = lock.startedAt ? Date.parse(lock.startedAt) : 0;
  const lockAge =
    startedMs > 0 && Number.isFinite(startedMs) ? now - startedMs : LOCK_TTL_MS;

  if (cacheEmpty && lockAge >= EMPTY_CACHE_LOCK_GRACE_MS) return true;
  if (lockAge >= ORPHAN_SCAN_LOCK_MS_CF) return true;
  return false;
}

async function releaseScanLockR2(bucket: R2Bucket): Promise<void> {
  await bucket.put(LOCK_KEY, JSON.stringify(EXPIRED_LOCK), {
    httpMetadata: { contentType: "application/json" },
  });
}

/** Inline recoverStuckScanState for R2 fast-path (no OpenNext / scan-cache import). */
async function recoverOrphanScanLockR2(
  bucket: R2Bucket,
  lock: ScanLock | null,
  cacheEmpty: boolean,
): Promise<ScanLock | null> {
  if (!shouldRecoverOrphanLock(lock, Date.now(), cacheEmpty)) return lock;
  await releaseScanLockR2(bucket);
  return null;
}

async function readLockAndRecover(
  bucket: R2Bucket,
  cacheEmpty: boolean,
): Promise<ScanLock | null> {
  const lockObj = await bucket.get(LOCK_KEY);
  const lock = lockObj
    ? ((await lockObj.json()) as ScanLock)
    : null;
  return recoverOrphanScanLockR2(bucket, lock, cacheEmpty);
}

async function buildStatusPayload(
  bucket: R2Bucket,
): Promise<Record<string, unknown>> {
  const metaObj = await bucket.get(META_KEY);

  const meta = metaObj
    ? ((await metaObj.json()) as {
        scannedAt?: string;
        completedAt?: string;
        symbolCount?: number;
      })
    : null;

  const now = Date.now();
  const scannedAt = meta?.scannedAt ?? null;
  const cacheEmpty = scannedAt == null;
  const lock = await readLockAndRecover(bucket, cacheEmpty);
  const scanInProgress = isLockActive(lock, now);
  const stale =
    scannedAt == null ||
    now - Date.parse(scannedAt) > STALE_AFTER_MS;

  return {
    scannedAt,
    completedAt: meta?.completedAt ?? null,
    symbolCount: meta?.symbolCount ?? 0,
    stale,
    scanInProgress,
    cacheEmpty,
    staleAfterMinutes: STALE_AFTER_MS / 60_000,
    lastError: null,
    scanStartedAt: scanInProgress ? (lock?.startedAt ?? null) : null,
  };
}

async function buildEmptyScanPayload(
  bucket: R2Bucket,
): Promise<Record<string, unknown>> {
  const status = await buildStatusPayload(bucket);
  return {
    scannedAt: status.scannedAt ?? new Date(0).toISOString(),
    symbolCount: (status.symbolCount as number) ?? 0,
    results: [],
    sources: {
      blueChips: false,
      watchlist: false,
      custom: false,
      tradingViewWatchlist: false,
    },
    scanComplete: false,
    retryableCount: 0,
    unscannedCount: 0,
    chartRefreshPendingCount: 0,
    cross4hGapCount: 0,
    ...status,
  };
}

/** Cached scan JSON embeds status at write time — overlay live lock/meta for polls. */
async function overlayLiveScanStatus(
  payload: Record<string, unknown>,
  bucket: R2Bucket,
): Promise<Record<string, unknown>> {
  const status = await buildStatusPayload(bucket);
  return {
    ...payload,
    scannedAt: status.scannedAt ?? payload.scannedAt,
    completedAt: status.completedAt ?? payload.completedAt,
    symbolCount: status.symbolCount ?? payload.symbolCount,
    stale: status.stale,
    scanInProgress: status.scanInProgress,
    cacheEmpty: status.cacheEmpty,
    scanStartedAt: status.scanStartedAt,
    staleAfterMinutes: status.staleAfterMinutes,
    lastError: status.lastError ?? payload.lastError,
  };
}

/** Serve scan API from R2 directly — bypasses OpenNext (free-tier 10ms CPU → 1102). */
async function tryServeScanApi(
  request: Request,
  env: CloudflareEnv,
): Promise<Response | null> {
  if (request.method !== "GET") return null;

  const url = new URL(request.url);
  if (url.pathname !== "/api/scan") return null;

  const heal =
    url.searchParams.get("heal") === "1" ||
    url.searchParams.get("heal") === "true";
  const force = url.searchParams.get("force") === "true";
  if (heal) return null;

  const bucket = env.SCAN_CACHE_R2_BUCKET;
  if (!bucket) return null;

  if (force) {
    const metaObj = await bucket.get(META_KEY);
    const meta = metaObj
      ? ((await metaObj.json()) as { scannedAt?: string })
      : null;
    await readLockAndRecover(bucket, meta?.scannedAt == null);
    return null;
  }

  const statusOnly = url.searchParams.get("status") === "true";
  if (statusOnly) {
    const payload = await buildStatusPayload(bucket);
    return Response.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const cached = await bucket.get(CACHED_SCAN_API_KEY);
  if (!cached) {
    const payload = await buildEmptyScanPayload(bucket);
    return Response.json(payload, {
      headers: {
        "Cache-Control": `private, max-age=${SCAN_READ_CACHE_MAX_AGE_SEC}`,
      },
    });
  }

  const payload = await overlayLiveScanStatus(
    (await cached.json()) as Record<string, unknown>,
    bucket,
  );
  return Response.json(payload, {
    headers: {
      "Cache-Control": `private, max-age=${SCAN_READ_CACHE_MAX_AGE_SEC}`,
    },
  });
}

export { tryServeScanApi };
