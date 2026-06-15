const CACHE_TTL_MS = 5 * 60_000;
/** Ignore cached previews shorter than this — modal always re-fetches for full text. */
const MIN_USEFUL_PREVIEW_LEN = 120;

interface PreviewEntry {
  summary: string | null;
  fetchedAt: number;
}

const cache = new Map<string, PreviewEntry>();
const inflight = new Map<string, Promise<string | null>>();

function isFresh(entry: PreviewEntry): boolean {
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

async function requestPreview(url: string, signal?: AbortSignal): Promise<string | null> {
  const res = await fetch(`/api/news/preview?url=${encodeURIComponent(url)}`, {
    signal,
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { summary?: string | null };
  const summary = body.summary?.trim() || null;
  cache.set(url, { summary, fetchedAt: Date.now() });
  return summary;
}

export function getCachedNewsPreview(url: string): string | null {
  const entry = cache.get(url);
  if (!entry || !isFresh(entry)) return null;
  if (!entry.summary || entry.summary.length < MIN_USEFUL_PREVIEW_LEN) return null;
  return entry.summary;
}

/** Fire-and-forget preview fetch (e.g. on chip hover). */
export function prefetchNewsPreview(url: string): void {
  if (!url) return;
  const entry = cache.get(url);
  if (entry && isFresh(entry) && entry.summary && entry.summary.length >= MIN_USEFUL_PREVIEW_LEN) {
    return;
  }
  if (inflight.has(url)) return;

  const promise = requestPreview(url).catch(() => null);
  inflight.set(url, promise);
  void promise.finally(() => {
    inflight.delete(url);
  });
}

/** Fetch preview, reusing cache or in-flight request when available. */
export async function fetchNewsPreview(
  url: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const cached = getCachedNewsPreview(url);
  if (cached) return cached;

  const pending = inflight.get(url);
  if (pending) return pending;

  const promise = requestPreview(url, signal);
  inflight.set(url, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(url);
  }
}

/** Always hit the preview API — used by the modal to avoid stale short hover cache. */
export async function fetchNewsPreviewFresh(
  url: string,
  signal?: AbortSignal,
): Promise<string | null> {
  return requestPreview(url, signal);
}
