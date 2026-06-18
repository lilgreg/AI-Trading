import YahooFinance from "yahoo-finance2";
import { dailyChangeForScanRow } from "./daily-change";
import { formatMsAgo } from "./ema";
import { normalizeCrossover } from "./normalize-scan-result";
import type { StockScanResult } from "./types";
import { getYahooCached, setYahooCached } from "./yahoo-cache";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const NEWS_TIMEOUT_MS = 8_000;
const NEWS_PER_SYMBOL = 3;
const MAX_HEADLINES = 25;
const NEWS_MAX_SYMBOLS = 15;
const SYMBOL_CONCURRENCY = 3;
const MACRO_HEADLINE_TARGET = 3;

const FED_KEYWORD =
  /\b(fed|fomc|federal reserve|powell|rate decision|interest rate|treasury|yield curve)\b/i;

const MACRO_NEWS_QUERIES = [
  { query: "Federal Reserve FOMC", displayTicker: "FED" },
  { query: "Jerome Powell rate", displayTicker: "FED" },
  { query: "Treasury yields", displayTicker: "TLT" },
] as const;

export interface NewsHeadline {
  symbol: string;
  displayTicker: string;
  tradingViewUrl?: string;
  /** Combined daily % change (pre + regular + post vs previous close). */
  dailyChange: number | null;
  headline: string;
  /** Snippet from Yahoo when available; modal may fetch og:description as fallback. */
  summary?: string | null;
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

function isFedRelatedHeadline(title: string): boolean {
  return FED_KEYWORD.test(title);
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
  return dailyChangeForScanRow(row, quoteDailyChange);
}

type RawHeadline = Omit<NewsHeadline, "msAgo" | "timeAgo">;

function mapYahooNewsItems(
  items: Array<{
    title?: string;
    link?: string;
    publisher?: string;
    providerPublishTime?: Date | string | number;
    summary?: unknown;
  }>,
  meta: Pick<RawHeadline, "symbol" | "displayTicker" | "tradingViewUrl" | "dailyChange">,
): RawHeadline[] {
  const now = Date.now();

  return items
    .filter((item) => item.title && item.link)
    .map((item) => {
      const published =
        item.providerPublishTime instanceof Date
          ? item.providerPublishTime
          : new Date(item.providerPublishTime as string | number);
      const publishedAt = Number.isNaN(published.getTime())
        ? new Date().toISOString()
        : published.toISOString();

      const rawSummary = item.summary;
      const summary =
        typeof rawSummary === "string" ? rawSummary.trim() || null : null;

      return {
        symbol: meta.symbol,
        displayTicker: meta.displayTicker,
        tradingViewUrl: meta.tradingViewUrl,
        dailyChange: meta.dailyChange,
        headline: item.title!,
        summary,
        publisher: item.publisher ?? "Yahoo Finance",
        url: item.link!,
        publishedAt,
        msAgo: Math.max(0, now - new Date(publishedAt).getTime()),
      };
    });
}

async function fetchSymbolNews(
  row: StockScanResult,
  dailyChange: number | null,
): Promise<RawHeadline[]> {
  const symbol = row.symbol;
  const displayTicker = row.displayTicker ?? symbol;

  type CachedNews = RawHeadline[];
  const cached = await getYahooCached<CachedNews>("news", symbol);
  if (cached) {
    return cached.map((item) => ({ ...item, dailyChange }));
  }

  try {
    const result = await withTimeout(
      yahooFinance.search(symbol, { quotesCount: 1, newsCount: NEWS_PER_SYMBOL }),
      NEWS_TIMEOUT_MS,
      `Yahoo news for ${symbol}`,
    );

    const headlines = mapYahooNewsItems(result.news ?? [], {
      symbol,
      displayTicker,
      tradingViewUrl: row.tradingViewUrl,
      dailyChange,
    });

    await setYahooCached("news", symbol, headlines);
    return headlines;
  } catch {
    return [];
  }
}

async function fetchMacroNews(): Promise<RawHeadline[]> {
  type CachedMacro = RawHeadline[];
  const cached = await getYahooCached<CachedMacro>("news", "__macro__");
  if (cached) return cached;

  const headlines: RawHeadline[] = [];
  const seenUrls = new Set<string>();

  for (const { query, displayTicker } of MACRO_NEWS_QUERIES) {
    if (headlines.length >= MACRO_HEADLINE_TARGET) break;

    try {
      const result = await withTimeout(
        yahooFinance.search(query, { quotesCount: 0, newsCount: 2 }),
        NEWS_TIMEOUT_MS,
        `Yahoo macro news for ${query}`,
      );

      for (const item of mapYahooNewsItems(result.news ?? [], {
        symbol: displayTicker,
        displayTicker,
        dailyChange: null,
      })) {
        if (seenUrls.has(item.url)) continue;
        if (!isFedRelatedHeadline(item.headline)) continue;
        seenUrls.add(item.url);
        headlines.push(item);
        if (headlines.length >= MACRO_HEADLINE_TARGET) break;
      }
    } catch {
      // try next macro query
    }
  }

  if (headlines.length > 0) {
    await setYahooCached("news", "__macro__", headlines);
  }

  return headlines;
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

function finalizeHeadlines(raw: RawHeadline[]): NewsHeadline[] {
  const now = Date.now();
  return raw
    .map((item) => {
      const msAgo = Math.max(0, now - new Date(item.publishedAt).getTime());
      return {
        ...item,
        msAgo,
        timeAgo: formatMsAgo(msAgo),
      };
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/** Fetch recent headlines for EMA-cross symbols plus Fed/macro headlines. */
export async function fetchEmaCrossNews(
  results: StockScanResult[],
  options: { maxSymbols?: number } = {},
): Promise<NewsHeadline[]> {
  const qualifying = filterEmaCrossNewsSymbols(results);
  const capped = qualifying.slice(0, options.maxSymbols ?? NEWS_MAX_SYMBOLS);

  const [symbolRaw, macroRaw] = await Promise.all([
    mapWithConcurrency(capped, SYMBOL_CONCURRENCY, (row) =>
      fetchSymbolNews(row, dailyChangeForRow(row)),
    ),
    fetchMacroNews(),
  ]);

  const seenUrls = new Set<string>();
  const merged: RawHeadline[] = [];

  for (const item of [...macroRaw, ...symbolRaw.flat()]) {
    if (seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    merged.push(item);
  }

  return finalizeHeadlines(merged).slice(0, MAX_HEADLINES);
}
