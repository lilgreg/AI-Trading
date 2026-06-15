import YahooFinance from "yahoo-finance2";
import type { DailyChangeQuotePrices } from "./daily-change";
import { computeDailyChangeFromPrices } from "./daily-change";
import type { OhlcBar } from "./ema";
import type { ScanInterval } from "./intervals";
import {
  filterSessionChangesForMarket,
  getUsMarketSession,
} from "./market-session";
import { retryWithBackoff, sleep, yahooLimiter } from "./request-limit";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const YAHOO_TIMEOUT_MS = Number(process.env.YAHOO_TIMEOUT_MS ?? 20_000);
const YAHOO_RETRY_TIMEOUT_MS = Number(process.env.YAHOO_RETRY_TIMEOUT_MS ?? 30_000);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function isRetryableYahooError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err);
  return (
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("429") ||
    message.includes("rate") ||
    message.includes("too many") ||
    message.includes("econnreset") ||
    message.includes("503") ||
    message.includes("502")
  );
}

interface YahooChartQuote {
  date?: number[];
  open?: (number | null)[];
  high?: (number | null)[];
  low?: (number | null)[];
  close?: (number | null)[];
}

function parseYahooV8Chart(body: {
  chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: YahooChartQuote[] } }> };
}): OhlcBar[] {
  const result = body.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  if (!quote || timestamps.length === 0) return [];

  const bars: OhlcBar[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const close = quote.close?.[i];
    if (close == null) continue;
    bars.push({
      date: new Date(timestamps[i] * 1000),
      open: quote.open?.[i] ?? undefined,
      high: quote.high?.[i] ?? undefined,
      low: quote.low?.[i] ?? undefined,
      close,
    });
  }
  return bars.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Alternate Yahoo chart v8 endpoint (sometimes succeeds when yahoo-finance2 is throttled). */
export async function fetchYahooChartV8Direct(
  symbol: string,
  days: number,
  timeoutMs = YAHOO_TIMEOUT_MS,
): Promise<OhlcBar[]> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - (days + 14) * 24 * 60 * 60;

  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  let lastError: unknown;

  for (const host of hosts) {
    const url = new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}`);
    url.searchParams.set("interval", "1h");
    url.searchParams.set("period1", String(start));
    url.searchParams.set("period2", String(end));
    url.searchParams.set("includePrePost", "false");

    try {
      const body = await withTimeout(
        fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; EMAScanner/1.0; +https://github.com/)",
          },
          cache: "no-store",
        }).then(async (res) => {
          if (!res.ok) throw new Error(`Yahoo v8 chart HTTP ${res.status} for ${symbol}`);
          return res.json() as Promise<{
            chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: YahooChartQuote[] } }> };
          }>;
        }),
        timeoutMs,
        `Yahoo v8 chart for ${symbol}`,
      );

      const bars = parseYahooV8Chart(body);
      if (bars.length === 0) {
        throw new Error(`Yahoo v8 chart returned no bars for ${symbol}`);
      }
      return bars;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Yahoo v8 chart failed for ${symbol}`);
}

async function fetchYahooLibraryChart(
  symbol: string,
  days: number,
  timeoutMs: number,
): Promise<OhlcBar[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days - 14);

  const chart = await withTimeout(
    yahooFinance.chart(symbol, {
      period1: start,
      period2: end,
      interval: "1h",
    }),
    timeoutMs,
    `Yahoo chart for ${symbol}`,
  );

  return (chart.quotes ?? [])
    .filter((row) => row.date && row.close != null)
    .map((row) => ({
      date: row.date as Date,
      open: row.open ?? undefined,
      high: row.high ?? undefined,
      low: row.low ?? undefined,
      close: row.close as number,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

async function fetchYahooHourlyBarsOnce(symbol: string, days: number): Promise<OhlcBar[]> {
  try {
    return await fetchYahooLibraryChart(symbol, days, YAHOO_TIMEOUT_MS);
  } catch (libErr) {
    if (!isRetryableYahooError(libErr)) throw libErr;
    await sleep(400);
    return fetchYahooChartV8Direct(symbol, days, YAHOO_RETRY_TIMEOUT_MS);
  }
}

/** Yahoo chart with retries, stagger, and v8 fallback between attempts. */
export async function fetchYahooHourlyBars(
  symbol: string,
  days: number,
): Promise<OhlcBar[]> {
  return yahooLimiter.run(() =>
    retryWithBackoff(() => fetchYahooHourlyBarsOnce(symbol, days), {
      attempts: 3,
      baseDelayMs: 1_000,
      label: `Yahoo chart for ${symbol}`,
      shouldRetry: isRetryableYahooError,
    }),
  );
}

/** @deprecated Use fetchHourlyBars from ./market-data for cache + backup providers. */
export async function fetchHourlyBars(symbol: string, days: number): Promise<OhlcBar[]> {
  return fetchYahooHourlyBars(symbol, days);
}

export async function fetchHistoricalBars(
  symbol: string,
  days: number,
  interval: ScanInterval,
): Promise<OhlcBar[]> {
  const hourly = await fetchHourlyBars(symbol, days);
  if (interval === "1h") return hourly;
  return aggregateHourlyTo4h(hourly);
}

/** Align bar timestamps to 4-hour buckets in America/New_York (TradingView-style). */
export function aggregateHourlyTo4h(bars: OhlcBar[]): OhlcBar[] {
  const buckets = new Map<number, OhlcBar>();

  for (const bar of bars) {
    const bucketStart = getNyFourHourBucketStart(bar.date.getTime());
    const high = bar.high ?? bar.close;
    const low = bar.low ?? bar.close;
    const open = bar.open ?? bar.close;
    const existing = buckets.get(bucketStart);

    if (!existing) {
      buckets.set(bucketStart, {
        date: new Date(bucketStart),
        open,
        high,
        low,
        close: bar.close,
      });
    } else {
      existing.high = Math.max(existing.high ?? existing.close, high);
      existing.low = Math.min(existing.low ?? existing.close, low);
      existing.close = bar.close;
    }
  }

  return [...buckets.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

function getNyFourHourBucketStart(utcMs: number): number {
  const date = new Date(utcMs);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = Number(get("hour"));
  const bucketHour = Math.floor(hour / 4) * 4;

  const etString = `${year}-${month}-${day} ${String(bucketHour).padStart(2, "0")}:00:00`;
  return parseEtToUtc(etString);
}

function parseEtToUtc(etDateTime: string): number {
  const [datePart, timePart] = etDateTime.split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm, ss] = timePart.split(":").map(Number);

  for (const offsetHours of [4, 5]) {
    const candidate = Date.UTC(y, m - 1, d, hh + offsetHours, mm, ss);
    const check = formatNyHour(candidate);
    if (
      check.year === y &&
      check.month === m &&
      check.day === d &&
      check.hour === hh
    ) {
      return candidate;
    }
  }

  return Date.UTC(y, m - 1, d, hh + 5, mm, ss);
}

function formatNyHour(utcMs: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
  };
}

export interface QuoteSessionChanges {
  preMarketChange: number | null;
  regularMarketChange: number | null;
  postMarketChange: number | null;
}

function percentChange(current: number, base: number): number | null {
  if (base === 0) return null;
  return ((current - base) / base) * 100;
}

function computeSessionChanges(quote: Record<string, unknown>): QuoteSessionChanges {
  const num = (key: string): number | undefined => {
    const value = quote[key];
    return typeof value === "number" ? value : undefined;
  };

  const previousClose = num("regularMarketPreviousClose") ?? null;
  const preMarketPrice = num("preMarketPrice");
  const regularMarketPrice = num("regularMarketPrice");
  const postMarketPrice = num("postMarketPrice");

  const preMarketChange =
    num("preMarketChangePercent") ??
    (preMarketPrice != null && previousClose != null
      ? percentChange(preMarketPrice, previousClose)
      : null);

  const regularMarketChange =
    num("regularMarketChangePercent") ??
    (regularMarketPrice != null && previousClose != null
      ? percentChange(regularMarketPrice, previousClose)
      : null);

  const regularClose = regularMarketPrice ?? null;
  const postMarketChange =
    num("postMarketChangePercent") ??
    (postMarketPrice != null && regularClose != null
      ? percentChange(postMarketPrice, regularClose)
      : null);

  return { preMarketChange, regularMarketChange, postMarketChange };
}

function quotePrices(quote: Record<string, unknown>): DailyChangeQuotePrices {
  const num = (key: string): number | undefined => {
    const value = quote[key];
    return typeof value === "number" ? value : undefined;
  };

  return {
    previousClose:
      num("regularMarketPreviousClose") ?? num("previousClose") ?? null,
    preMarketPrice: num("preMarketPrice") ?? null,
    regularMarketPrice: num("regularMarketPrice") ?? null,
    postMarketPrice: num("postMarketPrice") ?? null,
  };
}

function sessionAwarePrice(prices: DailyChangeQuotePrices): number | null {
  const session = getUsMarketSession();
  switch (session) {
    case "pre":
      return prices.preMarketPrice ?? null;
    case "regular":
      return prices.regularMarketPrice ?? null;
    case "afterHours":
      return prices.postMarketPrice ?? prices.regularMarketPrice ?? null;
    case "closed":
      return (
        prices.postMarketPrice ??
        prices.regularMarketPrice ??
        prices.preMarketPrice ??
        null
      );
  }
}

export async function fetchQuoteMeta(symbol: string): Promise<{
  name: string | null;
  price: number | null;
  exchange: string | null;
  quoteExchange: string | null;
  dailyChange: number | null;
} & QuoteSessionChanges> {
  try {
    const quote = await yahooLimiter.run(() =>
      retryWithBackoff(
        () =>
          withTimeout(
            yahooFinance.quote(symbol),
            YAHOO_TIMEOUT_MS,
            `Yahoo quote for ${symbol}`,
          ),
        {
          attempts: 3,
          baseDelayMs: 800,
          label: `Yahoo quote for ${symbol}`,
          shouldRetry: isRetryableYahooError,
        },
      ),
    );
    const raw = quote as unknown as Record<string, unknown>;
    const prices = quotePrices(raw);
    const sessionChanges = filterSessionChangesForMarket(
      computeSessionChanges(raw),
    );
    const dailyFromPrices = computeDailyChangeFromPrices(prices);
    const dailyFromQuote =
      typeof raw.regularMarketChangePercent === "number"
        ? raw.regularMarketChangePercent
        : null;

    return {
      name: quote.longName ?? quote.shortName ?? null,
      price: sessionAwarePrice(prices),
      exchange: quote.fullExchangeName ?? quote.exchange ?? null,
      quoteExchange: quote.exchange ?? null,
      dailyChange: dailyFromPrices ?? dailyFromQuote,
      ...sessionChanges,
    };
  } catch {
    return {
      name: null,
      price: null,
      exchange: null,
      quoteExchange: null,
      dailyChange: null,
      preMarketChange: null,
      regularMarketChange: null,
      postMarketChange: null,
    };
  }
}
