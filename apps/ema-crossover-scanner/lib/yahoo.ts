import YahooFinance from "yahoo-finance2";
import type { OhlcBar } from "./ema";
import type { ScanInterval } from "./intervals";

const yahooFinance = new YahooFinance();

const YAHOO_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
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

  // Binary search offset: ET is UTC-4 (EDT) or UTC-5 (EST)
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

export async function fetchHourlyBars(symbol: string, days: number): Promise<OhlcBar[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days - 14);

  const chart = await withTimeout(
    yahooFinance.chart(symbol, {
      period1: start,
      period2: end,
      interval: "1h",
    }),
    YAHOO_TIMEOUT_MS,
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

export async function fetchHistoricalBars(
  symbol: string,
  days: number,
  interval: ScanInterval,
): Promise<OhlcBar[]> {
  const hourly = await fetchHourlyBars(symbol, days);
  if (interval === "1h") return hourly;
  return aggregateHourlyTo4h(hourly);
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

export async function fetchQuoteMeta(symbol: string): Promise<{
  name: string | null;
  price: number | null;
  exchange: string | null;
  quoteExchange: string | null;
} & QuoteSessionChanges> {
  try {
    const quote = await withTimeout(
      yahooFinance.quote(symbol),
      YAHOO_TIMEOUT_MS,
      `Yahoo quote for ${symbol}`,
    );
    const sessionChanges = computeSessionChanges(
      quote as unknown as Record<string, unknown>,
    );
    return {
      name: quote.longName ?? quote.shortName ?? null,
      price: quote.regularMarketPrice ?? null,
      exchange: quote.fullExchangeName ?? quote.exchange ?? null,
      quoteExchange: quote.exchange ?? null,
      ...sessionChanges,
    };
  } catch {
    return {
      name: null,
      price: null,
      exchange: null,
      quoteExchange: null,
      preMarketChange: null,
      regularMarketChange: null,
      postMarketChange: null,
    };
  }
}
