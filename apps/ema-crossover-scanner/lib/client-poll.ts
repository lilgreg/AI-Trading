/** Client-side backoff when the Workers edge returns 429 / CF 1027. */

const RATE_LIMIT_STATUSES = new Set([429, 502, 503]);
const LS_RATE_LIMIT_KEY = "ema-scanner:worker-rate-limit-until";

let backoffUntilMs = 0;
let currentBackoffMs = 10_000;
const MIN_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 90_000;
/** True only after a 429/503 — not restored from localStorage on hydrate. */
let rateLimitBlocking = false;

function persistRateLimitUntil(): void {
  if (typeof window === "undefined") return;
  try {
    if (backoffUntilMs > Date.now()) {
      localStorage.setItem(LS_RATE_LIMIT_KEY, String(backoffUntilMs));
    } else {
      localStorage.removeItem(LS_RATE_LIMIT_KEY);
    }
  } catch {
    // private browsing / quota
  }
}

/** Restore backoff from a prior tab session so mount does not hammer the worker. */
export function hydrateRateLimitFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(LS_RATE_LIMIT_KEY);
    if (!raw) return;
    const until = Number(raw);
    if (!Number.isFinite(until) || until <= Date.now()) {
      localStorage.removeItem(LS_RATE_LIMIT_KEY);
      return;
    }
    backoffUntilMs = until;
    // Do not set rateLimitBlocking — allow an immediate fetch to clear stale storage.
  } catch {
    // ignore
  }
}

function bodyLooksRateLimited(bodyText: string): boolean {
  const lower = bodyText.toLowerCase();
  return (
    lower.includes("1027") ||
    lower.includes("rate limited") ||
    lower.includes("too many requests") ||
    lower.includes("temporarily rate")
  );
}

export function isWorkerRateLimited(): boolean {
  if (Date.now() >= backoffUntilMs) {
    rateLimitBlocking = false;
    return false;
  }
  return rateLimitBlocking;
}

/** Show banner only when a request was actually blocked this session. */
export function shouldShowRateLimitBanner(): boolean {
  return rateLimitBlocking && Date.now() < backoffUntilMs;
}

export function noteWorkerRateLimit(status?: number, bodyText?: string): void {
  const limited =
    (status != null && RATE_LIMIT_STATUSES.has(status)) ||
    (bodyText != null && bodyLooksRateLimited(bodyText));
  if (!limited) return;

  rateLimitBlocking = true;
  backoffUntilMs = Date.now() + currentBackoffMs;
  currentBackoffMs = Math.min(currentBackoffMs * 2, MAX_BACKOFF_MS);
  persistRateLimitUntil();
}

export function noteWorkerSuccess(): void {
  currentBackoffMs = MIN_BACKOFF_MS;
  backoffUntilMs = 0;
  rateLimitBlocking = false;
  persistRateLimitUntil();
}

export function formatRateLimitError(): string {
  const sec = Math.max(0, Math.ceil((backoffUntilMs - Date.now()) / 1000));
  if (sec > 0) return `Rate limited — retrying in ~${sec}s…`;
  return "Rate limited — retrying…";
}

/** Fetch that pauses while backed off and records 429/503/1027. Returns null when skipped or rate-limited. */
export async function clientFetch(
  url: string,
  init?: RequestInit,
): Promise<Response | null> {
  if (isWorkerRateLimited()) return null;

  try {
    const res = await fetch(url, init);
    if (RATE_LIMIT_STATUSES.has(res.status)) {
      const text = await res.text().catch(() => "");
      noteWorkerRateLimit(res.status, text);
      return null;
    }
    const clone = res.clone();
    if (!res.ok) {
      const text = await clone.text().catch(() => "");
      if (bodyLooksRateLimited(text)) {
        noteWorkerRateLimit(res.status, text);
        return null;
      }
    }
    noteWorkerSuccess();
    return res;
  } catch {
    if (isWorkerRateLimited()) return null;
    throw new Error("Failed to fetch");
  }
}
