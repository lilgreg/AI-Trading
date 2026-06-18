import {
  CACHED_SCAN_API_KEY,
} from "./lib/scan-api-cache";
import { LOCK_KEY, META_KEY } from "./lib/scan-storage";

const SCAN_READ_CACHE_MAX_AGE_SEC = 45;
const LOCK_TTL_MS = 15 * 60 * 1000;
const STALE_AFTER_MS = 15 * 60 * 1000;

function isLockActive(
  lock: { expiresAt?: string } | null,
  now: number,
): boolean {
  if (!lock?.expiresAt) return false;
  const expires = Date.parse(lock.expiresAt);
  return Number.isFinite(expires) && expires > now;
}

async function buildStatusPayload(
  bucket: R2Bucket,
): Promise<Record<string, unknown>> {
  const [metaObj, lockObj] = await Promise.all([
    bucket.get(META_KEY),
    bucket.get(LOCK_KEY),
  ]);

  const meta = metaObj
    ? ((await metaObj.json()) as {
        scannedAt?: string;
        completedAt?: string;
        symbolCount?: number;
      })
    : null;
  const lock = lockObj
    ? ((await lockObj.json()) as { startedAt?: string; expiresAt?: string })
    : null;

  const now = Date.now();
  const scanInProgress = isLockActive(lock, now);
  const scannedAt = meta?.scannedAt ?? null;
  const stale =
    scannedAt == null ||
    now - Date.parse(scannedAt) > STALE_AFTER_MS;

  return {
    scannedAt,
    completedAt: meta?.completedAt ?? null,
    symbolCount: meta?.symbolCount ?? 0,
    stale,
    scanInProgress,
    cacheEmpty: scannedAt == null,
    staleAfterMinutes: STALE_AFTER_MS / 60_000,
    lastError: null,
    scanStartedAt: scanInProgress ? (lock?.startedAt ?? null) : null,
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
  if (heal || force) return null;

  const bucket = env.SCAN_CACHE_R2_BUCKET;
  if (!bucket) return null;

  const statusOnly = url.searchParams.get("status") === "true";
  if (statusOnly) {
    const payload = await buildStatusPayload(bucket);
    return Response.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const cached = await bucket.get(CACHED_SCAN_API_KEY);
  if (!cached) return null;

  return new Response(cached.body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `private, max-age=${SCAN_READ_CACHE_MAX_AGE_SEC}`,
    },
  });
}

export { tryServeScanApi };
