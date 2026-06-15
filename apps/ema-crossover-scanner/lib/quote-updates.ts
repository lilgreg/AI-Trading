import type { StockScanResult } from "./types";

export interface QuoteUpdate {
  symbol: string;
  price: number | null;
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
      preMarketChange: quote.preMarketChange ?? row.preMarketChange,
      regularMarketChange: quote.regularMarketChange ?? row.regularMarketChange,
      postMarketChange: quote.postMarketChange ?? row.postMarketChange,
    };
  });
}
