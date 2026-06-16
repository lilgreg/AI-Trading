import type { StockScanResult } from "./types";

export interface QuoteUpdate {
  symbol: string;
  price: number | null;
  dailyChange: number | null;
  preMarketChange: number | null;
  regularMarketChange: number | null;
  postMarketChange: number | null;
}

/** Never replace a populated session % with null/undefined from a partial poll. */
function mergeSessionChange(
  incoming: number | null | undefined,
  existing: number | null | undefined,
): number | null {
  if (incoming != null) return incoming;
  if (existing != null) return existing;
  return null;
}

function mergeNullableNumber(
  incoming: number | null | undefined,
  existing: number | null | undefined,
): number | null {
  if (incoming != null) return incoming;
  if (existing != null) return existing;
  return null;
}

export function preserveSessionFields(
  incoming: StockScanResult,
  existing: StockScanResult,
): Pick<
  StockScanResult,
  "preMarketChange" | "regularMarketChange" | "postMarketChange" | "price"
> {
  return {
    price: mergeNullableNumber(incoming.price, existing.price),
    preMarketChange: mergeSessionChange(
      incoming.preMarketChange,
      existing.preMarketChange,
    ),
    regularMarketChange: mergeSessionChange(
      incoming.regularMarketChange,
      existing.regularMarketChange,
    ),
    postMarketChange: mergeSessionChange(
      incoming.postMarketChange,
      existing.postMarketChange,
    ),
  };
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
      ...preserveSessionFields(row, prev),
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

export function mergeScanResultIntoRows(
  results: StockScanResult[],
  incoming: StockScanResult,
): StockScanResult[] {
  const prevBySymbol = new Map(results.map((row) => [row.symbol, row]));
  const prev = prevBySymbol.get(incoming.symbol);

  const merged = prev
    ? mergeScanResultsPreservingQuotes([prev], [incoming])[0]
    : incoming;

  return results.map((row) =>
    row.symbol === incoming.symbol ? merged : row,
  );
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
      price: mergeNullableNumber(quote.price, row.price),
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
