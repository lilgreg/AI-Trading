import YahooFinance from "yahoo-finance2";
import { computeDailyChange } from "./daily-change";
import { formatMsAgo } from "./ema";
import { filterSessionChangesForMarket } from "./market-session";
import { normalizeCrossover } from "./normalize-scan-result";
import { fetchQuoteUpdates } from "./quotes";
import type { StockScanResult } from "./types";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const NEWS_TIMEOUT_MS = 12_000;
const NEWS_PER_SYMBOL = 3;
const MAX_HEADLINES = 25;
const SYMBOL_CONCURRENCY = 6;

export interface NewsHeadline {
  symbol: string;
  displayTicker: string;
  /** Combined daily % change (pre + regular + post vs previous close). */
  dailyChange: number | null;
  headline: string;
  publisher: string;
  url: string;
  publishedAt: string;
  msAgo: number;
  timeAgo: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function hasRecentBullishCross(cross: StockScanResult["cross1h"]): boolean {
  const safe = normalizeCrossover(cross);
  return Boolean(safe.crossoverAt ?? safe.crossoverDate);
}

/** Symbols with 20>50 on 4h and a recent bullish cross on 1h and/or 4h. */
export function filterEmaCrossNewsSymbols(results: StockScanResult[]): StockScanResult[] {
  return results.filter((row) => {
    if (row.error || !row.ema20Above50) return false;
    return hasRecentBullishCross(row.cross1h) || hasRecentBullishCross(row.cross4h);
  });
}

function dailyChangeForRow(
  row: StockScanResult,
  quoteDailyChange?: number | null,
): number | null {
  if (quoteDailyChange != null) return quoteDailyChange;

  const filtered = filterSessionChangesForMarket({
    preMarketChange: row.preMarketChange,
    regularMarketChange: row.regularMarketChange,
    postMarketChange: row.postMarketChange,
  });

  return computeDailyChange(
    filtered.preMarketChange,
    filtered.regularMarketChange,
    filtered.postMarketChange,
  );
}

async function fetchSymbolNews(
  row: StockScanResult,
  dailyChange: number | null,
): Promise<Omit<NewsHeadline, "msAgo" | "timeAgo">[]> {
  const symbol = row.symbol;
  const displayTicker = row.displayTicker ?? symbol;

  try {
    const result = await withTimeout(
      yahooFinance.search(symbol, { quotesCount: 1, newsCount: NEWS_PER_SYMBOL }),
      NEWS_TIMEOUT_MS,
      `Yahoo news for ${symbol}`,
    );

    const now = Date.now();
    return (result.news ?? [])
      .filter((item) => item.title && item.link)
      .map((item) => {
        const published =
          item.providerPublishTime instanceof Date
            ? item.providerPublishTime
            : new Date(item.providerPublishTime as string | number);
        const publishedAt = Number.isNaN(published.getTime())
          ? new Date().toISOString()
          : published.toISOString();

        return {
          symbol,
          displayTicker,
          dailyChange,
          headline: item.title,
          publisher: item.publisher ?? "Yahoo Finance",
          url: item.link,
          publishedAt,
          msAgo: Math.max(0, now - new Date(publishedAt).getTime()),
        };
      });
  } catch {
    return [];
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R[]>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    for (const list of batchResults) results.push(...list);
  }
  return results;
}

/** Fetch recent headlines for EMA-cross symbols via yahoo-finance2 search API. */
export async function fetchEmaCrossNews(
  results: StockScanResult[],
): Promise<NewsHeadline[]> {
  const qualifying = filterEmaCrossNewsSymbols(results);
  if (qualifying.length === 0) return [];

  const quoteUpdates = await fetchQuoteUpdates(qualifying.map((row) => row.symbol));
  const dailyBySymbol = new Map(
    quoteUpdates.map((quote) => [quote.symbol, quote.dailyChange]),
  );

  const raw = await mapWithConcurrency(
    qualifying,
    SYMBOL_CONCURRENCY,
    (row) =>
      fetchSymbolNews(
        row,
        dailyChangeForRow(row, dailyBySymbol.get(row.symbol)),
      ),
  );

  const now = Date.now();
  const headlines: NewsHeadline[] = raw
    .map((item) => {
      const msAgo = Math.max(0, now - new Date(item.publishedAt).getTime());
      return {
        ...item,
        msAgo,
        timeAgo: formatMsAgo(msAgo),
      };
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, MAX_HEADLINES);

  return headlines;
}
