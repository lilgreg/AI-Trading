import type { QuoteUpdate } from "./quote-updates";
import { isStaleSessionSnapshot } from "./quote-updates";
import { resolveSessionChanges } from "./session-snapshot";
import { resolveYahooChartSymbol } from "./stocks";
import type { StockScanResult } from "./types";
import { deleteYahooCached } from "./yahoo-cache";
import { fetchBatchQuoteMeta, fetchQuoteMeta } from "./yahoo";

export type { QuoteUpdate } from "./quote-updates";

const STALE_V8_REFRESH_LIMIT = 8;

/** Lightweight Yahoo quote fetch — price and session % only (no EMA/pattern rescan). */
export async function fetchQuoteUpdates(
  symbols: string[],
  options: {
    offset?: number;
    limit?: number;
    existingBySymbol?: Map<
      string,
      Pick<StockScanResult, "sessionSnapshotDate">
    >;
  } = {},
): Promise<QuoteUpdate[]> {
  const offset = Math.max(0, options.offset ?? 0);
  const slice =
    options.limit != null && options.limit > 0
      ? symbols.slice(offset, offset + options.limit)
      : symbols.slice(offset);

  if (slice.length === 0) return [];

  for (const symbol of slice) {
    const existingDate = options.existingBySymbol?.get(symbol)?.sessionSnapshotDate;
    if (!isStaleSessionSnapshot(existingDate ?? null)) continue;
    const chartSym = resolveYahooChartSymbol(symbol);
    await deleteYahooCached("quote", chartSym);
    await deleteYahooCached("quote-v8", chartSym);
    await deleteYahooCached("session-chart", chartSym);
  }

  const metaBySymbol = await fetchBatchQuoteMeta(slice);
  const updates: QuoteUpdate[] = [];
  let staleV8Refreshed = 0;

  for (const symbol of slice) {
    const existing = options.existingBySymbol?.get(symbol);
    const staleSession = isStaleSessionSnapshot(existing?.sessionSnapshotDate ?? null);
    const emptyMeta = {
      name: null,
      price: null,
      exchange: null,
      quoteExchange: null,
      dailyChange: null,
      preMarketChange: null,
      regularMarketChange: null,
      postMarketChange: null,
    };
    let meta = metaBySymbol.get(symbol) ?? emptyMeta;
    if (staleSession && staleV8Refreshed < STALE_V8_REFRESH_LIMIT) {
      meta = await fetchQuoteMeta(symbol, { refreshSession: true });
      staleV8Refreshed += 1;
    }
    const resolved = await resolveSessionChanges(
      {
        symbol,
        preMarketChange: meta.preMarketChange,
        regularMarketChange: meta.regularMarketChange,
        postMarketChange: meta.postMarketChange,
        sessionSnapshotDate: existing?.sessionSnapshotDate ?? null,
      },
      {
        preMarketChange: meta.preMarketChange,
        regularMarketChange: meta.regularMarketChange,
        postMarketChange: meta.postMarketChange,
      },
    );
    updates.push({
      symbol,
      price: meta.price,
      dailyChange: meta.dailyChange,
      preMarketChange: resolved.preMarketChange,
      regularMarketChange: resolved.regularMarketChange,
      postMarketChange: resolved.postMarketChange,
      sessionSnapshotDate: resolved.sessionSnapshotDate ?? null,
    });
  }

  return updates;
}
