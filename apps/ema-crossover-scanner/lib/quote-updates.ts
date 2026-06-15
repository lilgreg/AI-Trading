import type { StockScanResult } from "./types";

export interface QuoteUpdate {
  symbol: string;
  price: number | null;
  dailyChange: number | null;
  preMarketChange: number | null;
  regularMarketChange: number | null;
  postMarketChange: number | null;
}

function mergeSessionChange(
  incoming: number | null,
  existing: number | null,
): number | null {
  return incoming ?? existing;
}

function mergeNullableNumber(
  incoming: number | null | undefined,
  existing: number | null | undefined,
): number | null {
  return incoming ?? existing ?? null;
}

/** Keep live quote/session fields when a scan refresh returns nulls (throttle/partial). */
export function mergeScanResultsPreservingQuotes(
  previous: StockScanResult[],
  incoming: StockScanResult[],
): StockScanResult[] {
  const prevBySymbol = new Map(previous.map((row) => [row.symbol, row]));

  return incoming.map((row) => {
    const prev = prevBySymbol.get(row.symbol);
    if (!prev) return row;

    const merged: StockScanResult = {
      ...row,
      price: mergeNullableNumber(row.price, prev.price),
      preMarketChange: mergeSessionChange(row.preMarketChange, prev.preMarketChange),
      regularMarketChange: mergeSessionChange(
        row.regularMarketChange,
        prev.regularMarketChange,
      ),
      postMarketChange: mergeSessionChange(
        row.postMarketChange,
        prev.postMarketChange,
      ),
    };

    // Keep computed crosses/EMAs when a rescan fails but prior row was good.
    if (row.error && !row.ema20 && prev.ema20 != null) {
      merged.ema20 = prev.ema20;
      merged.ema50 = prev.ema50;
      merged.ema20Above50 = prev.ema20Above50;
      merged.cross1h = prev.cross1h;
      merged.cross4h = prev.cross4h;
      merged.patterns = prev.patterns;
      merged.dataSource = prev.dataSource ?? row.dataSource;
      merged.error = undefined;
    }

    return merged;
  });
}

export function applyQuoteUpdates(
  results: StockScanResult[],
  updates: QuoteUpdate[],
): StockScanResult[] {
  const bySymbol = new Map(updates.map((u) => [u.symbol, u]));
  return results.map((row) => {
    const quote = bySymbol.get(row.symbol);
    if (!quote) return row;
    return {
      ...row,
      price: quote.price ?? row.price,
      // Never wipe scan-cache session % when a quote poll returns null (throttle/error).
      preMarketChange: mergeSessionChange(
        quote.preMarketChange,
        row.preMarketChange,
      ),
      regularMarketChange: mergeSessionChange(
        quote.regularMarketChange,
        row.regularMarketChange,
      ),
      postMarketChange: mergeSessionChange(
        quote.postMarketChange,
        row.postMarketChange,
      ),
    };
  });
}

/** Daily % by symbol from live quote poll. */
export function dailyChangeByQuoteUpdates(
  updates: QuoteUpdate[],
): Map<string, number | null> {
  return new Map(updates.map((u) => [u.symbol, u.dailyChange]));
}
