import {
  fetchAlphaVantageHourlyBars,
  isAlphaVantageConfigured,
} from "./alpha-vantage";
import { getCachedHourlyBars, setCachedHourlyBars } from "./bar-cache";
import type { OhlcBar } from "./ema";
import {
  fetchFinnhubHourlyBars,
  isFinnhubConfigured,
} from "./finnhub";
import { fetchPolygonHourlyBars, isPolygonConfigured } from "./polygon";
import { fetchStooqHourlyBars } from "./stooq";
import {
  fetchTwelveDataHourlyBars,
  isTwelveDataConfigured,
} from "./twelve-data";
import { yahooLimiter } from "./request-limit";
import {
  fetchYahooChartV8Direct,
  fetchYahooChartV8Range,
  fetchYahooFinance2HourlyBars,
  fetchYahooSparkHourlyBars,
  YAHOO_RETRY_TIMEOUT_MS,
  YAHOO_TIMEOUT_MS,
} from "./yahoo";

export type Bar = OhlcBar;

export interface HourlyBarsResult {
  bars: OhlcBar[];
  source: string;
}

export interface FetchHourlyBarsOptions {
  /** Universe index — symbols >= tail threshold skip slow yahoo-finance2. */
  symbolIndex?: number;
}

/** Symbols at/after this index skip yahoo-finance2 (often throttled after ~120). */
export const CHART_TAIL_SYMBOL_INDEX = Number(
  process.env.CHART_TAIL_SYMBOL_INDEX ?? 120,
);

type ChartProvider = {
  name: string;
  enabled?: () => boolean;
  fetch: (symbol: string, days: number) => Promise<OhlcBar[]>;
};

function skipYahooProviders(): boolean {
  return process.env.CHART_SKIP_YAHOO === "1" || process.env.CHART_SKIP_YAHOO === "true";
}

function skipSlowYahooProviders(): boolean {
  return (
    process.env.CHART_SKIP_YAHOO_SLOW === "1" ||
    process.env.CHART_SKIP_YAHOO_SLOW === "true"
  );
}

function yahooProviders(options: FetchHourlyBarsOptions = {}): ChartProvider[] {
  if (skipYahooProviders()) return [];

  const tailSymbol =
    options.symbolIndex != null && options.symbolIndex >= CHART_TAIL_SYMBOL_INDEX;
  const skipSlow = skipSlowYahooProviders() || tailSymbol;

  const providers: ChartProvider[] = [
    {
      name: "yahoo-v8",
      fetch: (symbol, days) =>
        yahooLimiter.run(() => fetchYahooChartV8Direct(symbol, days, YAHOO_TIMEOUT_MS)),
    },
    {
      name: "yahoo-spark",
      fetch: (symbol, days) =>
        yahooLimiter.run(() => fetchYahooSparkHourlyBars(symbol, days, YAHOO_TIMEOUT_MS)),
    },
    {
      name: "yahoo-v8-range",
      fetch: (symbol, days) =>
        yahooLimiter.run(() => fetchYahooChartV8Range(symbol, days, YAHOO_TIMEOUT_MS)),
    },
  ];

  if (!skipSlow) {
    providers.push(
      {
        name: "yahoo-finance2",
        fetch: (symbol, days) =>
          yahooLimiter.run(() =>
            fetchYahooFinance2HourlyBars(symbol, days, YAHOO_TIMEOUT_MS),
          ),
      },
      {
        name: "yahoo-v8-retry",
        fetch: (symbol, days) =>
          yahooLimiter.run(() =>
            fetchYahooChartV8Direct(symbol, days, YAHOO_RETRY_TIMEOUT_MS),
          ),
      },
    );
  }

  return providers;
}

function backupProviders(): ChartProvider[] {
  return [
    {
      name: "finnhub",
      enabled: isFinnhubConfigured,
      fetch: fetchFinnhubHourlyBars,
    },
    {
      name: "polygon",
      enabled: isPolygonConfigured,
      fetch: fetchPolygonHourlyBars,
    },
    {
      name: "twelve-data",
      enabled: isTwelveDataConfigured,
      fetch: fetchTwelveDataHourlyBars,
    },
    {
      name: "alpha-vantage",
      enabled: isAlphaVantageConfigured,
      fetch: fetchAlphaVantageHourlyBars,
    },
    {
      name: "stooq",
      fetch: fetchStooqHourlyBars,
    },
  ];
}

function allProviders(options: FetchHourlyBarsOptions = {}): ChartProvider[] {
  return [...yahooProviders(options), ...backupProviders()];
}

function logMissingFinnhubHint(errors: string[]): void {
  if (isFinnhubConfigured()) return;
  const yahooFailed = errors.some((e) => e.toLowerCase().includes("yahoo"));
  if (!yahooFailed) return;
  console.warn(
    "[chart-data] Yahoo failed and FINNHUB_API_KEY is not set. " +
      "Add a free key at https://finnhub.io/register for reliable backup on Vercel.",
  );
}

/**
 * Fetch hourly OHLC bars — tries Yahoo endpoints then backup APIs until one succeeds.
 */
export async function fetchHourlyBars(
  symbol: string,
  days: number,
  options: FetchHourlyBarsOptions = {},
): Promise<HourlyBarsResult> {
  const cached = getCachedHourlyBars(symbol, days);
  if (cached) return cached;

  const errors: string[] = [];
  const tried: string[] = [];

  for (const provider of allProviders(options)) {
    if (provider.enabled && !provider.enabled()) continue;

    tried.push(provider.name);
    try {
      const bars = await provider.fetch(symbol, days);
      if (bars.length === 0) {
        errors.push(`${provider.name}: returned no bars`);
        continue;
      }
      setCachedHourlyBars(symbol, days, bars, provider.name);
      return { bars, source: provider.name };
    } catch (err) {
      errors.push(
        `${provider.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  logMissingFinnhubHint(errors);

  const providerList = tried.length > 0 ? tried.join(", ") : "none";
  throw new Error(
    errors.length > 0
      ? `All chart providers failed for ${symbol} (${providerList}): ${errors.join("; ")}`
      : `All chart providers failed for ${symbol} (${providerList})`,
  );
}

/** List configured provider names (for diagnostics). */
export function listChartProviders(options: FetchHourlyBarsOptions = {}): string[] {
  return allProviders(options)
    .filter((p) => !p.enabled || p.enabled())
    .map((p) => p.name);
}
