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

export function getYahooCacheTtlMs(): number {
  const ms = Number(process.env.YAHOO_CACHE_TTL_MS ?? 900_000);
  if (!Number.isFinite(ms) || ms < 60_000) return 900_000;
  return ms;
}

function storageKey(kind: YahooCacheKind, id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 220);
  return `ema-scanner/yahoo-cache/${kind}/${safe}.json`;
}

function isFresh(entry: CacheEnvelope): boolean {
  return Date.now() - entry.fetchedAt < getYahooCacheTtlMs();
}

export async function getYahooCached<T>(
  kind: YahooCacheKind,
  id: string,
): Promise<T | null> {
  const key = storageKey(kind, id);
  const mem = memory.get(key);
  if (mem && isFresh(mem)) return mem.data as T;

  try {
    const fromStore = await getScanStorage().readJson<CacheEnvelope<T>>(key);
    if (fromStore && isFresh(fromStore)) {
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
