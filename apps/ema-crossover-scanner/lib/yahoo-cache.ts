import { getScanStorage } from "./scan-storage";

export type YahooCacheKind =
  | "quote"
  | "quote-v8"
  | "chart-v8"
  | "chart-spark"
  | "chart-v8-range"
  | "session-chart"
  | "news";

interface CacheEnvelope<T = unknown> {
  fetchedAt: number;
  data: T;
}

/** Per-isolate hot cache — avoids R2 read on repeat hits within one invocation. */
const memory = new Map<string, CacheEnvelope>();

const QUOTE_KINDS = new Set<YahooCacheKind>(["quote", "quote-v8"]);
const NEWS_KINDS = new Set<YahooCacheKind>(["news"]);

function parseTtlMs(raw: string | undefined, fallback: number): number {
  const ms = Number(raw ?? fallback);
  if (!Number.isFinite(ms) || ms < 60_000) return fallback;
  return ms;
}

export function getYahooCacheTtlMsForKind(kind: YahooCacheKind): number {
  if (QUOTE_KINDS.has(kind)) {
    return parseTtlMs(process.env.YAHOO_QUOTE_CACHE_TTL_MS, 120_000);
  }
  if (NEWS_KINDS.has(kind)) {
    return parseTtlMs(process.env.YAHOO_NEWS_CACHE_TTL_MS, 120_000);
  }
  const legacy = process.env.YAHOO_CACHE_TTL_MS;
  return parseTtlMs(
    process.env.YAHOO_CHART_CACHE_TTL_MS ?? legacy,
    900_000,
  );
}

/** @deprecated Use getYahooCacheTtlMsForKind — chart TTL for legacy callers. */
export function getYahooCacheTtlMs(): number {
  return getYahooCacheTtlMsForKind("chart-v8");
}

function storageKey(kind: YahooCacheKind, id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 220);
  return `ema-scanner/yahoo-cache/${kind}/${safe}.json`;
}

function isFresh(entry: CacheEnvelope, kind: YahooCacheKind): boolean {
  return Date.now() - entry.fetchedAt < getYahooCacheTtlMsForKind(kind);
}

export async function getYahooCached<T>(
  kind: YahooCacheKind,
  id: string,
): Promise<T | null> {
  const key = storageKey(kind, id);
  const mem = memory.get(key);
  if (mem && isFresh(mem, kind)) return mem.data as T;

  try {
    const fromStore = await getScanStorage().readJson<CacheEnvelope<T>>(key);
    if (fromStore && isFresh(fromStore, kind)) {
      memory.set(key, fromStore);
      return fromStore.data;
    }
  } catch {
    // best-effort
  }
  return null;
}

export async function setYahooCached<T>(
  kind: YahooCacheKind,
  id: string,
  data: T,
): Promise<void> {
  const key = storageKey(kind, id);
  const envelope: CacheEnvelope<T> = { fetchedAt: Date.now(), data };
  memory.set(key, envelope);
  try {
    await getScanStorage().writeJson(key, envelope);
  } catch {
    // best-effort R2 write
  }
}

/** Read-through cache: memory → R2 → fetchFn, then persist. */
export async function withYahooCache<T>(
  kind: YahooCacheKind,
  id: string,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const cached = await getYahooCached<T>(kind, id);
  if (cached != null) return cached;
  const data = await fetchFn();
  await setYahooCached(kind, id, data);
  return data;
}
