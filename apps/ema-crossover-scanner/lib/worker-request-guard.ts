/** Per-isolate burst guard — returns 429 before Cloudflare kills the worker (1027). */

const WINDOW_MS = 60_000;
const MAX_API_RPM = 100;

let windowStartMs = 0;
let requestCount = 0;

function minuteBucketKey(now = Date.now()): string {
  return String(Math.floor(now / WINDOW_MS));
}

/** Best-effort cross-isolate counter via R2 (async, non-blocking). */
export async function recordGlobalRequest(env: CloudflareEnv): Promise<void> {
  try {
    const bucket = env.SCAN_CACHE_R2_BUCKET;
    if (!bucket) return;
    const key = `ema-scanner/request-guard/${minuteBucketKey()}.json`;
    const existing = await bucket.get(key);
    let count = 0;
    if (existing) {
      const body = (await existing.json()) as { count?: number };
      count = typeof body.count === "number" ? body.count : 0;
    }
    await bucket.put(key, JSON.stringify({ count: count + 1 }), {
      httpMetadata: { contentType: "application/json" },
    });
  } catch {
    // observability only
  }
}

export function guardWorkerRequest(
  requestUrl: string,
): { allowed: true } | { allowed: false; retryAfterSec: number } {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return { allowed: true };
  }

  const path = url.pathname;
  if (!path.startsWith("/api/")) {
    return { allowed: true };
  }

  // Lightweight status polls should not compete with scan/news burst budget.
  if (path === "/api/scan" && url.searchParams.get("status") === "true") {
    return { allowed: true };
  }

  // User-initiated preview fetches Yahoo — do not count against burst budget.
  if (path === "/api/news/preview") {
    return { allowed: true };
  }

  const now = Date.now();
  if (now - windowStartMs >= WINDOW_MS) {
    windowStartMs = now;
    requestCount = 0;
  }

  requestCount += 1;
  if (requestCount > MAX_API_RPM) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((windowStartMs + WINDOW_MS - now) / 1000),
    );
    return { allowed: false, retryAfterSec };
  }

  return { allowed: true };
}
