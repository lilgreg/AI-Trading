import type { StockScanResult } from "./types";

/** Eastern date key (YYYY-MM-DD) for session snapshot staleness checks. */
export function nySessionDateKey(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function isStaleSessionSnapshot(
  sessionSnapshotDate: string | null | undefined,
  at: Date = new Date(),
): boolean {
  if (!sessionSnapshotDate) return true;
  return sessionSnapshotDate !== nySessionDateKey(at);
}

export interface QuoteUpdate {
  symbol: string;
  price: number | null;
  dailyChange: number | null;
  preMarketChange: number | null;
  regularMarketChange: number | null;
  postMarketChange: number | null;
  sessionSnapshotDate?: string | null;
}

/** Never replace a populated session % with null from a partial poll — unless snapshot is stale. */
function mergeSessionChange(
  incoming: number | null | undefined,
  existing: number | null | undefined,
  existingSnapshotDate?: string | null,
): number | null {
  if (incoming != null) return incoming;
  if (isStaleSessionSnapshot(existingSnapshotDate)) return null;
  if (existing != null) return existing;
  return null;
}

/** Quote poll: prefer live Yahoo; drop stale overnight snapshot when incoming is null. */
function mergeSessionOnQuotePoll(
  incoming: number | null | undefined,
  existing: number | null | undefined,
  existingSnapshotDate: string | null | undefined,
): number | null {
  return mergeSessionChange(incoming, existing, existingSnapshotDate);
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
  | "preMarketChange"
  | "regularMarketChange"
  | "postMarketChange"
  | "price"
  | "sessionSnapshotDate"
> {
  const stale = isStaleSessionSnapshot(existing.sessionSnapshotDate);
  const snapshotDate =
    incoming.sessionSnapshotDate ??
    (stale ? nySessionDateKey() : existing.sessionSnapshotDate) ??
    null;

  if (stale) {
    return {
      price: mergeNullableNumber(incoming.price, existing.price),
      preMarketChange: incoming.preMarketChange ?? null,
      regularMarketChange: incoming.regularMarketChange ?? null,
      postMarketChange: incoming.postMarketChange ?? null,
      sessionSnapshotDate: snapshotDate,
    };
  }

  return {
    price: mergeNullableNumber(incoming.price, existing.price),
    preMarketChange: mergeSessionChange(
      incoming.preMarketChange,
      existing.preMarketChange,
      existing.sessionSnapshotDate,
    ),
    regularMarketChange: mergeSessionChange(
      incoming.regularMarketChange,
      existing.regularMarketChange,
      existing.sessionSnapshotDate,
    ),
    postMarketChange: mergeSessionChange(
      incoming.postMarketChange,
      existing.postMarketChange,
      existing.sessionSnapshotDate,
    ),
    sessionSnapshotDate: snapshotDate,
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
    const sessionSnapshotDate =
      quote.sessionSnapshotDate ??
      (isStaleSessionSnapshot(row.sessionSnapshotDate)
        ? nySessionDateKey()
        : row.sessionSnapshotDate) ??
      null;

    return {
      ...row,
      price: mergeNullableNumber(quote.price, row.price),
      preMarketChange: mergeSessionOnQuotePoll(
        quote.preMarketChange,
        row.preMarketChange,
        sessionSnapshotDate,
      ),
      regularMarketChange: mergeSessionOnQuotePoll(
        quote.regularMarketChange,
        row.regularMarketChange,
        sessionSnapshotDate,
      ),
      postMarketChange: mergeSessionOnQuotePoll(
        quote.postMarketChange,
        row.postMarketChange,
        sessionSnapshotDate,
      ),
      sessionSnapshotDate,
    };
  });
}

/** Daily % by symbol from live quote poll. */
export function dailyChangeByQuoteUpdates(
  updates: QuoteUpdate[],
): Map<string, number | null> {
  return new Map(updates.map((u) => [u.symbol, u.dailyChange]));
}
