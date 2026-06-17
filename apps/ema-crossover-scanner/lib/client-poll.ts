/** Client-side backoff when the Workers edge returns 429 / CF 1027. */

const RATE_LIMIT_STATUSES = new Set([429, 502, 503]);

let backoffUntilMs = 0;
let currentBackoffMs = 30_000;
const MIN_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 300_000;

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
  return Date.now() < backoffUntilMs;
}

export function noteWorkerRateLimit(status?: number, bodyText?: string): void {
  const limited =
    (status != null && RATE_LIMIT_STATUSES.has(status)) ||
    (bodyText != null && bodyLooksRateLimited(bodyText));
  if (!limited) return;

  backoffUntilMs = Date.now() + currentBackoffMs;
  currentBackoffMs = Math.min(currentBackoffMs * 2, MAX_BACKOFF_MS);
}

export function noteWorkerSuccess(): void {
  currentBackoffMs = MIN_BACKOFF_MS;
  backoffUntilMs = 0;
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
