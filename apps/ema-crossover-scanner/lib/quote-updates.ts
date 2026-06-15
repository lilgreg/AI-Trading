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
