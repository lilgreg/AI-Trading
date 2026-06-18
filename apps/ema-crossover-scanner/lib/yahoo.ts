import YahooFinance from "yahoo-finance2";
import type { DailyChangeQuotePrices } from "./daily-change";
import { computeDailyChangeFromPrices } from "./daily-change";
import type { OhlcBar } from "./ema";
import type { ScanInterval } from "./intervals";
import {
  getUsMarketSession,
} from "./market-session";
import { retryWithBackoff, sleep, yahooLimiter } from "./request-limit";
import { resolveYahooChartSymbol } from "./stocks";
import {
  getYahooCached,
  setYahooCached,
} from "./yahoo-cache";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

function parseTimeoutMs(raw: string | undefined, fallback: number, min: number): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

export const YAHOO_TIMEOUT_MS = parseTimeoutMs(process.env.YAHOO_TIMEOUT_MS, 20_000, 20_000);
export const YAHOO_RETRY_TIMEOUT_MS = parseTimeoutMs(
  process.env.YAHOO_RETRY_TIMEOUT_MS,
  30_000,
  20_000,
);
/** Cap chart HTTP timeouts so Vercel YAHOO_TIMEOUT_MS=15000 does not block failover. */
export const YAHOO_CHART_TIMEOUT_MS = Math.min(YAHOO_TIMEOUT_MS, 5_000);

/** Yahoo v7 batch quote API — up to ~200 symbols per request. */
export const YAHOO_QUOTE_BATCH_SIZE = Number(
  process.env.YAHOO_QUOTE_BATCH_SIZE ?? 80,
);

type SerializedBar = Omit<OhlcBar, "date"> & { date: string };

function serializeBars(bars: OhlcBar[]): SerializedBar[] {
  return bars.map(({ date, ...rest }) => ({ ...rest, date: date.toISOString() }));
}

function deserializeBars(bars: SerializedBar[]): OhlcBar[] {
  return bars.map(({ date, ...rest }) => ({ ...rest, date: new Date(date) }));
}

const YAHOO_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (compatible; EMAScanner/1.0; +https://github.com/)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
];

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function daysToYahooRange(days: number): string {
  if (days <= 5) return "5d";
  if (days <= 30) return "1mo";
  if (days <= 90) return "3mo";
  if (days <= 180) return "6mo";
  if (days <= 365) return "1y";
  return "2y";
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

async function fetchYahooChartJson(
  url: URL,
  symbol: string,
  timeoutMs: number,
  label: string,
  userAgent: string,
): Promise<OhlcBar[]> {
  const body = await withTimeout(
    fetch(url, {
      headers: { "User-Agent": userAgent },
      cache: "no-store",
    }).then(async (res) => {
      if (!res.ok) throw new Error(`${label} HTTP ${res.status} for ${symbol}`);
      return res.json() as Promise<{
        chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: YahooChartQuote[] } }> };
      }>;
    }),
    timeoutMs,
    label,
  );

  const bars = parseYahooV8Chart(body);
  if (bars.length === 0) {
    throw new Error(`${label} returned no bars for ${symbol}`);
  }
  return bars;
}

/** Yahoo chart v8 with period1/period2 (query1 + query2). */
async function fetchYahooChartV8DirectUncached(
  symbol: string,
  days: number,
  timeoutMs = YAHOO_TIMEOUT_MS,
): Promise<OhlcBar[]> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - (days + 14) * 24 * 60 * 60;
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  let lastError: unknown;

  for (let i = 0; i < hosts.length; i += 1) {
    const host = hosts[i];
    const url = new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}`);
    url.searchParams.set("interval", "1h");
    url.searchParams.set("period1", String(start));
    url.searchParams.set("period2", String(end));
    url.searchParams.set("includePrePost", "false");

    try {
      return await fetchYahooChartJson(
        url,
        symbol,
        timeoutMs,
        `Yahoo v8 chart for ${symbol}`,
        YAHOO_USER_AGENTS[i % YAHOO_USER_AGENTS.length],
      );
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Yahoo v8 chart failed for ${symbol}`);
}

export async function fetchYahooChartV8Direct(
  symbol: string,
  days: number,
  timeoutMs = YAHOO_TIMEOUT_MS,
  options: { skipCache?: boolean } = {},
): Promise<OhlcBar[]> {
  const cacheId = `${symbol.toUpperCase()}:${days}`;
  if (!options.skipCache) {
    const cached = await getYahooCached<SerializedBar[]>("chart-v8", cacheId);
    if (cached) return deserializeBars(cached);
  }
  const bars = await fetchYahooChartV8DirectUncached(symbol, days, timeoutMs);
  await setYahooCached("chart-v8", cacheId, serializeBars(bars));
  return bars;
}

/** Yahoo chart v8 with range param — alternate endpoint rotation. */
async function fetchYahooChartV8RangeUncached(
  symbol: string,
  days: number,
  timeoutMs = YAHOO_TIMEOUT_MS,
): Promise<OhlcBar[]> {
  const range = daysToYahooRange(days + 14);
  const hosts = ["query2.finance.yahoo.com", "query1.finance.yahoo.com"];
  let lastError: unknown;

  for (let i = 0; i < hosts.length; i += 1) {
    const host = hosts[i];
    const url = new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}`);
    url.searchParams.set("interval", "1h");
    url.searchParams.set("range", range);
    url.searchParams.set("includePrePost", "false");

    try {
      return await fetchYahooChartJson(
        url,
        symbol,
        timeoutMs,
        `Yahoo v8 range chart for ${symbol}`,
        YAHOO_USER_AGENTS[(i + 1) % YAHOO_USER_AGENTS.length],
      );
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Yahoo v8 range chart failed for ${symbol}`);
}

export async function fetchYahooChartV8Range(
  symbol: string,
  days: number,
  timeoutMs = YAHOO_TIMEOUT_MS,
  options: { skipCache?: boolean } = {},
): Promise<OhlcBar[]> {
  const cacheId = `${symbol.toUpperCase()}:${days}`;
  if (!options.skipCache) {
    const cached = await getYahooCached<SerializedBar[]>("chart-v8-range", cacheId);
    if (cached) return deserializeBars(cached);
  }
  const bars = await fetchYahooChartV8RangeUncached(symbol, days, timeoutMs);
  await setYahooCached("chart-v8-range", cacheId, serializeBars(bars));
  return bars;
}

function parseYahooSpark(body: {
  spark?: {
    result?: Array<{
      response?: Array<{
        timestamp?: number[];
        indicators?: { quote?: YahooChartQuote[] };
      }>;
    }>;
  };
}): OhlcBar[] {
  const response = body.spark?.result?.[0]?.response?.[0];
  const timestamps = response?.timestamp ?? [];
  const quote = response?.indicators?.quote?.[0];
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

/** Lightweight Yahoo Spark API — keyless fallback when v8/library are throttled. */
async function fetchYahooSparkHourlyBarsUncached(
  symbol: string,
  days: number,
  timeoutMs = YAHOO_TIMEOUT_MS,
): Promise<OhlcBar[]> {
  const range = daysToYahooRange(days + 14);
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  let lastError: unknown;

  for (let i = 0; i < hosts.length; i += 1) {
    const host = hosts[i];
    const url = new URL(`https://${host}/v7/finance/spark`);
    url.searchParams.set("symbols", symbol.toUpperCase());
    url.searchParams.set("range", range);
    url.searchParams.set("interval", "1h");
    url.searchParams.set("includePrePost", "false");

    try {
      const body = await withTimeout(
        fetch(url, {
          headers: { "User-Agent": YAHOO_USER_AGENTS[i % YAHOO_USER_AGENTS.length] },
          cache: "no-store",
        }).then(async (res) => {
          if (!res.ok) {
            throw new Error(`Yahoo spark HTTP ${res.status} for ${symbol}`);
          }
          return res.json() as Promise<{
            spark?: {
              result?: Array<{
                response?: Array<{
                  timestamp?: number[];
                  indicators?: { quote?: YahooChartQuote[] };
                }>;
              }>;
            };
          }>;
        }),
        timeoutMs,
        `Yahoo spark for ${symbol}`,
      );

      const bars = parseYahooSpark(body);
      if (bars.length === 0) {
        throw new Error(`Yahoo spark returned no bars for ${symbol}`);
      }
      return bars;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Yahoo spark failed for ${symbol}`);
}

export async function fetchYahooSparkHourlyBars(
  symbol: string,
  days: number,
  timeoutMs = YAHOO_TIMEOUT_MS,
  options: { skipCache?: boolean } = {},
): Promise<OhlcBar[]> {
  const cacheId = `${symbol.toUpperCase()}:${days}`;
  if (!options.skipCache) {
    const cached = await getYahooCached<SerializedBar[]>("chart-spark", cacheId);
    if (cached) return deserializeBars(cached);
  }
  const bars = await fetchYahooSparkHourlyBarsUncached(symbol, days, timeoutMs);
  await setYahooCached("chart-spark", cacheId, serializeBars(bars));
  return bars;
}

/** yahoo-finance2 library chart — slower, often throttled after ~120 symbols. */
export async function fetchYahooFinance2HourlyBars(
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
    return await fetchYahooChartV8Direct(symbol, days, YAHOO_CHART_TIMEOUT_MS);
  } catch (v8Err) {
    if (!isRetryableYahooError(v8Err)) throw v8Err;
    await sleep(300);
    try {
      return await fetchYahooSparkHourlyBars(symbol, days, YAHOO_CHART_TIMEOUT_MS);
    } catch (sparkErr) {
      if (!isRetryableYahooError(sparkErr)) throw sparkErr;
      await sleep(400);
      return fetchYahooChartV8Range(symbol, days, YAHOO_CHART_TIMEOUT_MS);
    }
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

/** @deprecated Use fetchHourlyBars from ./chart-data for cache + backup providers. */
export async function fetchHourlyBars(symbol: string, days: number): Promise<OhlcBar[]> {
  const { fetchHourlyBars: fetchWithFallback } = await import("./chart-data");
  const result = await fetchWithFallback(symbol, days);
  return result.bars;
}

export async function fetchHistoricalBars(
  symbol: string,
  days: number,
  interval: ScanInterval,
): Promise<OhlcBar[]> {
  const { fetchHourlyBars: fetchWithFallback } = await import("./chart-data");
  const { bars: hourly } = await fetchWithFallback(symbol, days);
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

  const preFromPrices =
    preMarketPrice != null && previousClose != null
      ? percentChange(preMarketPrice, previousClose)
      : null;
  const preMarketChange =
    preFromPrices ?? num("preMarketChangePercent") ?? null;

  const regularFromPrices =
    regularMarketPrice != null && previousClose != null
      ? percentChange(regularMarketPrice, previousClose)
      : null;
  const regularMarketChange =
    regularFromPrices ?? num("regularMarketChangePercent") ?? null;

  const regularClose = regularMarketPrice ?? null;
  const postFromPrices =
    postMarketPrice != null && regularClose != null
      ? percentChange(postMarketPrice, regularClose)
      : null;
  const postMarketChange =
    postFromPrices ?? num("postMarketChangePercent") ?? null;

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

function bestAvailablePrice(prices: DailyChangeQuotePrices): number | null {
  return (
    prices.regularMarketPrice ??
    prices.preMarketPrice ??
    prices.postMarketPrice ??
    null
  );
}

function sessionAwarePrice(prices: DailyChangeQuotePrices): number | null {
  const session = getUsMarketSession();
  switch (session) {
    case "pre":
      return prices.preMarketPrice ?? prices.regularMarketPrice ?? bestAvailablePrice(prices);
    case "regular":
      return prices.regularMarketPrice ?? prices.preMarketPrice ?? bestAvailablePrice(prices);
    case "afterHours":
      return (
        prices.postMarketPrice ??
        prices.regularMarketPrice ??
        prices.preMarketPrice ??
        null
      );
    case "closed":
      return (
        prices.postMarketPrice ??
        prices.regularMarketPrice ??
        prices.preMarketPrice ??
        null
      );
  }
}

function parseQuoteMetaFromRecord(raw: Record<string, unknown>): {
  name: string | null;
  price: number | null;
  exchange: string | null;
  quoteExchange: string | null;
  dailyChange: number | null;
} & QuoteSessionChanges {
  const prices = quotePrices(raw);
  // Store raw session % — filter only at display time (market-session.ts).
  const sessionChanges = computeSessionChanges(raw);
  const dailyFromPrices = computeDailyChangeFromPrices(prices);
  const dailyFromQuote =
    typeof raw.regularMarketChangePercent === "number"
      ? raw.regularMarketChangePercent
      : null;

  const longName =
    typeof raw.longName === "string"
      ? raw.longName
      : typeof raw.shortName === "string"
        ? raw.shortName
        : null;

  return {
    name: longName,
    price: sessionAwarePrice(prices),
    exchange:
      (typeof raw.fullExchangeName === "string" ? raw.fullExchangeName : null) ??
      (typeof raw.exchange === "string" ? raw.exchange : null),
    quoteExchange: typeof raw.exchange === "string" ? raw.exchange : null,
    dailyChange: dailyFromPrices ?? dailyFromQuote,
    ...sessionChanges,
  };
}

/** Lightweight v8 chart meta — works when yahoo-finance2 quote is throttled. */
async function fetchQuoteMetaViaV8Chart(rawSymbol: string): Promise<
  | ({
      name: string | null;
      price: number | null;
      exchange: string | null;
      quoteExchange: string | null;
      dailyChange: number | null;
    } & QuoteSessionChanges)
  | null
> {
  const symbol = resolveYahooChartSymbol(rawSymbol);
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
  );
  url.searchParams.set("interval", "1d");
  url.searchParams.set("range", "1d");
  url.searchParams.set("includePrePost", "true");

  const body = await withTimeout(
    fetch(url, {
      headers: { "User-Agent": YAHOO_USER_AGENTS[0] },
      cache: "no-store",
    }).then(async (res) => {
      if (!res.ok) {
        throw new Error(`Yahoo v8 quote HTTP ${res.status} for ${symbol}`);
      }
      return res.json() as Promise<{
        chart?: {
          result?: Array<{
            meta?: Record<string, unknown>;
          }>;
        };
      }>;
    }),
    YAHOO_CHART_TIMEOUT_MS,
    `Yahoo v8 quote for ${symbol}`,
  );

  const meta = body.chart?.result?.[0]?.meta;
  if (!meta) return null;

  const numMeta = (key: string): number | undefined => {
    const value = meta[key];
    return typeof value === "number" ? value : undefined;
  };

  const previousClose =
    numMeta("chartPreviousClose") ??
    numMeta("previousClose") ??
    numMeta("regularMarketPreviousClose") ??
    null;
  const regularMarketPrice =
    numMeta("regularMarketPrice") ?? numMeta("currentPrice") ?? null;
  const preMarketPrice = numMeta("preMarketPrice") ?? null;
  const postMarketPrice = numMeta("postMarketPrice") ?? null;

  const raw: Record<string, unknown> = {
    ...meta,
    regularMarketPreviousClose: previousClose,
    regularMarketPrice,
    preMarketPrice,
    postMarketPrice,
    preMarketChangePercent:
      numMeta("preMarketChangePercent") ??
      (preMarketPrice != null && previousClose != null
        ? percentChange(preMarketPrice, previousClose)
        : undefined),
    regularMarketChangePercent:
      numMeta("regularMarketChangePercent") ??
      (regularMarketPrice != null && previousClose != null
        ? percentChange(regularMarketPrice, previousClose)
        : undefined),
    postMarketChangePercent:
      numMeta("postMarketChangePercent") ??
      (postMarketPrice != null && regularMarketPrice != null
        ? percentChange(postMarketPrice, regularMarketPrice)
        : undefined),
    longName: meta.longName ?? meta.shortName,
    fullExchangeName: meta.fullExchangeName ?? meta.exchangeName,
    exchange: meta.exchangeName ?? meta.exchange,
  };

  const parsed = parseQuoteMetaFromRecord(raw);
  if (
    parsed.price == null &&
    parsed.preMarketChange == null &&
    parsed.regularMarketChange == null &&
    parsed.postMarketChange == null
  ) {
    return null;
  }
  return parsed;
}

const EMPTY_QUOTE_META = {
  name: null,
  price: null,
  exchange: null,
  quoteExchange: null,
  dailyChange: null,
  preMarketChange: null,
  regularMarketChange: null,
  postMarketChange: null,
} as const;

export type QuoteMeta = {
  name: string | null;
  price: number | null;
  exchange: string | null;
  quoteExchange: string | null;
  dailyChange: number | null;
} & QuoteSessionChanges;

async function fetchV7QuoteBatchUncached(
  symbols: string[],
): Promise<Map<string, QuoteMeta>> {
  const resolved = symbols.map((s) => resolveYahooChartSymbol(s).toUpperCase());
  const unique = [...new Set(resolved)];
  const url = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
  url.searchParams.set("symbols", unique.join(","));

  const body = await withTimeout(
    fetch(url, {
      headers: { "User-Agent": YAHOO_USER_AGENTS[0] },
      cache: "no-store",
    }).then(async (res) => {
      if (!res.ok) {
        throw new Error(`Yahoo v7 quote HTTP ${res.status} for ${unique.length} symbols`);
      }
      return res.json() as Promise<{
        quoteResponse?: { result?: Array<Record<string, unknown>> };
      }>;
    }),
    YAHOO_CHART_TIMEOUT_MS,
    `Yahoo v7 batch quote (${unique.length} symbols)`,
  );

  const out = new Map<string, QuoteMeta>();
  for (const raw of body.quoteResponse?.result ?? []) {
    const sym =
      typeof raw.symbol === "string" ? raw.symbol.toUpperCase() : "";
    if (!sym) continue;
    out.set(sym, parseQuoteMetaFromRecord(raw));
  }
  return out;
}

/** Batch quote fetch — one Yahoo v7 request per up-to-80-symbol chunk. */
export async function fetchBatchQuoteMeta(
  symbols: string[],
): Promise<Map<string, QuoteMeta>> {
  const out = new Map<string, QuoteMeta>();
  const uncached: string[] = [];

  for (const sym of symbols) {
    const chartSym = resolveYahooChartSymbol(sym);
    const cached = await getYahooCached<QuoteMeta>("quote", chartSym);
    if (cached) {
      out.set(sym, cached);
    } else {
      uncached.push(sym);
    }
  }

  if (uncached.length === 0) return out;

  for (let i = 0; i < uncached.length; i += YAHOO_QUOTE_BATCH_SIZE) {
    const batch = uncached.slice(i, i + YAHOO_QUOTE_BATCH_SIZE);
    const batchMap = await yahooLimiter.run(() => fetchV7QuoteBatchUncached(batch));

    for (const sym of batch) {
      const chartSym = resolveYahooChartSymbol(sym);
      const upper = chartSym.toUpperCase();
      const meta =
        batchMap.get(upper) ??
        batchMap.get(chartSym) ??
        ({ ...EMPTY_QUOTE_META } satisfies QuoteMeta);
      await setYahooCached("quote", chartSym, meta);
      out.set(sym, meta);
    }
  }

  return out;
}

export async function fetchQuoteMeta(
  rawSymbol: string,
  options: { refreshSession?: boolean } = {},
): Promise<QuoteMeta> {
  const symbol = resolveYahooChartSymbol(rawSymbol);

  if (options.refreshSession) {
    await deleteYahooCached("quote", symbol);
    await deleteYahooCached("quote-v8", symbol);
    await deleteYahooCached("session-chart", symbol);
  }

  const batch = await fetchBatchQuoteMeta([rawSymbol]);
  let meta = batch.get(rawSymbol);

  const needsV8 =
    options.refreshSession ||
    !meta ||
    meta.price == null ||
    meta.regularMarketChange == null;

  if (needsV8) {
    const cachedV8 = options.refreshSession
      ? null
      : await getYahooCached<QuoteMeta>("quote-v8", symbol);
    const viaV8 =
      cachedV8 ??
      (await yahooLimiter.run(() => fetchQuoteMetaViaV8Chart(rawSymbol)));
    if (viaV8) {
      meta = {
        ...(meta ?? { ...EMPTY_QUOTE_META }),
        ...viaV8,
        name: viaV8.name ?? meta?.name ?? null,
        exchange: viaV8.exchange ?? meta?.exchange ?? null,
        quoteExchange: viaV8.quoteExchange ?? meta?.quoteExchange ?? null,
      };
      await setYahooCached("quote-v8", symbol, viaV8);
      await setYahooCached("quote", symbol, meta);
      return meta;
    }
  }

  if (meta && meta.price != null) return meta;

  const cachedV8 = await getYahooCached<QuoteMeta>("quote-v8", symbol);
  if (cachedV8) {
    await setYahooCached("quote", symbol, cachedV8);
    return cachedV8;
  }

  try {
    const viaV8 = await yahooLimiter.run(() =>
      fetchQuoteMetaViaV8Chart(rawSymbol),
    );
    if (viaV8) {
      await setYahooCached("quote-v8", symbol, viaV8);
      await setYahooCached("quote", symbol, viaV8);
      return viaV8;
    }
  } catch {
    // fall through
  }

  try {
    const quote = await yahooLimiter.run(() =>
      retryWithBackoff(
        () =>
          withTimeout(
            yahooFinance.quote(symbol),
            YAHOO_CHART_TIMEOUT_MS,
            `Yahoo quote for ${symbol}`,
          ),
        {
          attempts: 2,
          baseDelayMs: 600,
          label: `Yahoo quote for ${symbol}`,
          shouldRetry: isRetryableYahooError,
        },
      ),
    );
    const parsed = parseQuoteMetaFromRecord(quote as unknown as Record<string, unknown>);
    await setYahooCached("quote", symbol, parsed);
    return parsed;
  } catch {
    return meta ?? { ...EMPTY_QUOTE_META };
  }
}
