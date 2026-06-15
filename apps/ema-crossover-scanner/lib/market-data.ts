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
import { fetchYahooHourlyBars } from "./yahoo";

export interface HourlyBarsResult {
  bars: OhlcBar[];
  source: string;
}

type Provider = {
  name: string;
  enabled: () => boolean;
  fetch: (symbol: string, days: number) => Promise<OhlcBar[]>;
};

function backupProviders(): Provider[] {
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

/**
 * Fetch hourly OHLC bars with in-memory cache, Yahoo retries, and optional backup APIs.
 */
export async function fetchHourlyBars(
  symbol: string,
  days: number,
): Promise<HourlyBarsResult> {
  const cached = getCachedHourlyBars(symbol, days);
  if (cached) return cached;

  const errors: string[] = [];

  try {
    const bars = await fetchYahooHourlyBars(symbol, days);
    setCachedHourlyBars(symbol, days, bars, "yahoo");
    return { bars, source: "yahoo" };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  for (const provider of backupProviders()) {
    if (!provider.enabled()) continue;
    try {
      const bars = await provider.fetch(symbol, days);
      setCachedHourlyBars(symbol, days, bars, provider.name);
      return { bars, source: provider.name };
    } catch (err) {
      errors.push(
        `${provider.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new Error(
    errors.length > 0
      ? errors.join("; ")
      : `No hourly bar data for ${symbol}`,
  );
}
