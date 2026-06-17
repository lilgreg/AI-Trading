import type { QuoteUpdate } from "./quote-updates";
import { resolveSessionChanges } from "./session-snapshot";
import { fetchBatchQuoteMeta } from "./yahoo";

export type { QuoteUpdate } from "./quote-updates";

/** Lightweight Yahoo quote fetch — price and session % only (no EMA/pattern rescan). */
export async function fetchQuoteUpdates(
  symbols: string[],
  options: { offset?: number; limit?: number } = {},
): Promise<QuoteUpdate[]> {
  const offset = Math.max(0, options.offset ?? 0);
  const slice =
    options.limit != null && options.limit > 0
      ? symbols.slice(offset, offset + options.limit)
      : symbols.slice(offset);

  if (slice.length === 0) return [];

  const metaBySymbol = await fetchBatchQuoteMeta(slice);
  const updates: QuoteUpdate[] = [];

  for (const symbol of slice) {
    const meta = metaBySymbol.get(symbol) ?? {
      name: null,
      price: null,
      exchange: null,
      quoteExchange: null,
      dailyChange: null,
      preMarketChange: null,
      regularMarketChange: null,
      postMarketChange: null,
    };
    const resolved = await resolveSessionChanges(
      {
        symbol,
        preMarketChange: meta.preMarketChange,
        regularMarketChange: meta.regularMarketChange,
        postMarketChange: meta.postMarketChange,
        sessionSnapshotDate: null,
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
