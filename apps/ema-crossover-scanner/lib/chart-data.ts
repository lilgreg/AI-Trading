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
import {
  fetchTwelveDataHourlyBars,
  isTwelveDataConfigured,
} from "./twelve-data";
import { isCloudflareWorkersRuntime } from "./runtime";
import { sleep, yahooLimiter } from "./request-limit";
import { resolveYahooChartSymbol } from "./stocks";
import {
  fetchYahooChartV8Direct,
  fetchYahooChartV8Range,
  fetchYahooSparkHourlyBars,
  YAHOO_CHART_TIMEOUT_MS,
  YAHOO_RETRY_TIMEOUT_MS,
} from "./yahoo";

export type Bar = OhlcBar;

export interface HourlyBarsResult {
  bars: OhlcBar[];
  source: string;
}

export interface FetchHourlyBarsOptions {
  /** Universe index — symbols >= tail threshold skip slow yahoo-finance2. */
  symbolIndex?: number;
  /** Skip per-index delay (heal/rescan paths). */
  skipStagger?: boolean;
  /** Bypass Yahoo R2 chart cache (cross4h heal / symbol rescan). */
  skipChartCache?: boolean;
}

/** Symbols at/after this index use staggered Yahoo-only chart fetch (burst throttling). */
export const CHART_TAIL_SYMBOL_INDEX = Number(
  process.env.CHART_TAIL_SYMBOL_INDEX ?? 122,
);

/** Per-index delay before first chart attempt for tail symbols. */
const TAIL_STAGGER_MS = Number(process.env.CHART_TAIL_STAGGER_MS ?? 1_500);

type ChartProvider = {
  name: string;
  enabled?: () => boolean;
  fetch: (
    symbol: string,
    days: number,
    options?: FetchHourlyBarsOptions,
  ) => Promise<OhlcBar[]>;
};

function skipYahooProviders(): boolean {
  return process.env.CHART_SKIP_YAHOO === "1" || process.env.CHART_SKIP_YAHOO === "true";
}

function chartFetchTimeoutMs(options?: FetchHourlyBarsOptions): number {
  return options?.skipChartCache ? YAHOO_RETRY_TIMEOUT_MS : YAHOO_CHART_TIMEOUT_MS;
}

/** Scan chart path uses direct Yahoo HTTP only — no yahoo-finance2 library. */
function yahooProviders(): ChartProvider[] {
  if (skipYahooProviders()) return [];

  const timeout = chartFetchTimeoutMs;
  return [
    {
      name: "yahoo-v8",
      fetch: (symbol, days, options) =>
        yahooLimiter.run(() =>
          fetchYahooChartV8Direct(symbol, days, timeout(options), {
            skipCache: options?.skipChartCache,
          }),
        ),
    },
    {
      name: "yahoo-spark",
      fetch: (symbol, days, options) =>
        yahooLimiter.run(() =>
          fetchYahooSparkHourlyBars(symbol, days, timeout(options), {
            skipCache: options?.skipChartCache,
          }),
        ),
    },
    {
      name: "yahoo-v8-range",
      fetch: (symbol, days, options) =>
        yahooLimiter.run(() =>
          fetchYahooChartV8Range(symbol, days, timeout(options), {
            skipCache: options?.skipChartCache,
          }),
        ),
    },
  ];
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
  ];
}

function isTailSymbol(options: FetchHourlyBarsOptions = {}): boolean {
  return (
    options.symbolIndex != null && options.symbolIndex >= CHART_TAIL_SYMBOL_INDEX
  );
}

function configuredBackupProviders(): ChartProvider[] {
  return backupProviders().filter((p) => !p.enabled || p.enabled());
}

function allProviders(options: FetchHourlyBarsOptions = {}): ChartProvider[] {
  const yahoo = yahooProviders();
  const finnhub = configuredBackupProviders().filter((p) => p.name === "finnhub");

  // Workers: one Yahoo endpoint for bulk scans; all Yahoo endpoints when bypassing cache (heal/rescan).
  if (isCloudflareWorkersRuntime()) {
    const yahooSet = options.skipChartCache ? yahoo : yahoo.slice(0, 1);
    return [...yahooSet, ...finnhub];
  }

  // Tail symbols: Yahoo v8 → spark → v8-range, then Finnhub only.
  if (isTailSymbol(options)) {
    return [...yahoo, ...finnhub];
  }

  return [...yahoo, ...configuredBackupProviders()];
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

async function applyTailStagger(options: FetchHourlyBarsOptions): Promise<void> {
  if (options.skipStagger) return;
  if (!isTailSymbol(options) || options.symbolIndex == null) return;
  const offset = options.symbolIndex - CHART_TAIL_SYMBOL_INDEX;
  if (offset <= 0) return;
  await sleep(TAIL_STAGGER_MS * offset);
}

/**
 * Fetch hourly OHLC bars — tries Yahoo endpoints then backup APIs until one succeeds.
 */
export async function fetchHourlyBars(
  symbol: string,
  days: number,
  options: FetchHourlyBarsOptions = {},
): Promise<HourlyBarsResult> {
  const chartSymbol = resolveYahooChartSymbol(symbol);
  if (!options.skipChartCache) {
    const cached = getCachedHourlyBars(chartSymbol, days);
    if (cached) return cached;
  }

  await applyTailStagger(options);

  const errors: string[] = [];
  const tried: string[] = [];

  for (const provider of allProviders(options)) {
    if (provider.enabled && !provider.enabled()) continue;

    tried.push(provider.name);
    try {
      const bars = await provider.fetch(chartSymbol, days, options);
      if (bars.length === 0) {
        errors.push(`${provider.name}: returned no bars`);
        continue;
      }
      setCachedHourlyBars(chartSymbol, days, bars, provider.name);
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
      ? `All chart providers failed for ${chartSymbol} (${providerList}): ${errors.join("; ")}`
      : `All chart providers failed for ${chartSymbol} (${providerList})`,
  );
}

/** List configured provider names (for diagnostics). */
export function listChartProviders(options: FetchHourlyBarsOptions = {}): string[] {
  return allProviders(options)
    .filter((p) => !p.enabled || p.enabled())
    .map((p) => p.name);
}
