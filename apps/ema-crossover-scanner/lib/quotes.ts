import type { QuoteUpdate } from "./quote-updates";
import { sleep } from "./request-limit";
import { resolveSessionChanges } from "./session-snapshot";
import { fetchQuoteMeta } from "./yahoo";

export type { QuoteUpdate } from "./quote-updates";

const QUOTE_BATCH_SIZE = 12;
const QUOTE_BATCH_PAUSE_MS = 400;

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

  const updates: QuoteUpdate[] = [];

  for (let i = 0; i < slice.length; i += QUOTE_BATCH_SIZE) {
    if (i > 0) {
      await sleep(QUOTE_BATCH_PAUSE_MS);
    }

    const batch = slice.slice(i, i + QUOTE_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (symbol) => {
        const meta = await fetchQuoteMeta(symbol);
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
        return {
          symbol,
          price: meta.price,
          dailyChange: meta.dailyChange,
          preMarketChange: resolved.preMarketChange,
          regularMarketChange: resolved.regularMarketChange,
          postMarketChange: resolved.postMarketChange,
          sessionSnapshotDate: resolved.sessionSnapshotDate ?? null,
        };
      }),
    );
    updates.push(...batchResults);
  }

  return updates;
}
