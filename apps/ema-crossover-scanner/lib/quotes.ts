import type { QuoteUpdate } from "./quote-updates";
import { fetchQuoteMeta } from "./yahoo";

export type { QuoteUpdate } from "./quote-updates";

const QUOTE_BATCH_SIZE = 20;

/** Lightweight Yahoo quote fetch — price and session % only (no EMA/pattern rescan). */
export async function fetchQuoteUpdates(symbols: string[]): Promise<QuoteUpdate[]> {
  const updates: QuoteUpdate[] = [];

  for (let i = 0; i < symbols.length; i += QUOTE_BATCH_SIZE) {
    const batch = symbols.slice(i, i + QUOTE_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (symbol) => {
        const meta = await fetchQuoteMeta(symbol);
        return {
          symbol,
          price: meta.price,
          preMarketChange: meta.preMarketChange,
          regularMarketChange: meta.regularMarketChange,
          postMarketChange: meta.postMarketChange,
        };
      }),
    );
    updates.push(...batchResults);
  }

  return updates;
}
