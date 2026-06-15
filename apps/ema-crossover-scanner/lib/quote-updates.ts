import type { StockScanResult } from "./types";

export interface QuoteUpdate {
  symbol: string;
  price: number | null;
  dailyChange: number | null;
  preMarketChange: number | null;
  regularMarketChange: number | null;
  postMarketChange: number | null;
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
      // Always take session fields from live quotes — null means "not active today"
      // and must not fall back to stale scan-cache regular/after-hours values.
      preMarketChange: quote.preMarketChange,
      regularMarketChange: quote.regularMarketChange,
      postMarketChange: quote.postMarketChange,
    };
  });
}

/** Daily % by symbol from live quote poll. */
export function dailyChangeByQuoteUpdates(
  updates: QuoteUpdate[],
): Map<string, number | null> {
  return new Map(updates.map((u) => [u.symbol, u.dailyChange]));
}
