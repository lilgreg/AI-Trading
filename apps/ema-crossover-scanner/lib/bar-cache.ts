import type { OhlcBar } from "./ema";

interface BarCacheEntry {
  bars: OhlcBar[];
  source: string;
  fetchedAt: number;
}

const cache = new Map<string, BarCacheEntry>();

export function getBarCacheTtlMs(): number {
  const minutes = Number(process.env.SCAN_STALE_MINUTES ?? 15);
  if (!Number.isFinite(minutes) || minutes < 5) return 15 * 60_000;
  return minutes * 60_000;
}

function cacheKey(symbol: string, days: number): string {
  return `${symbol.toUpperCase()}:${days}`;
}

export function getCachedHourlyBars(
  symbol: string,
  days: number,
): { bars: OhlcBar[]; source: string } | null {
  const entry = cache.get(cacheKey(symbol, days));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > getBarCacheTtlMs()) {
    cache.delete(cacheKey(symbol, days));
    return null;
  }
  return { bars: entry.bars, source: entry.source };
}

export function setCachedHourlyBars(
  symbol: string,
  days: number,
  bars: OhlcBar[],
  source: string,
): void {
  cache.set(cacheKey(symbol, days), {
    bars,
    source,
    fetchedAt: Date.now(),
  });
}

export function clearBarCache(): void {
  cache.clear();
}

export function clearBarCacheForSymbol(symbol: string, days?: number): void {
  if (days != null) {
    cache.delete(cacheKey(symbol, days));
    return;
  }
  const prefix = `${symbol.toUpperCase()}:`;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
