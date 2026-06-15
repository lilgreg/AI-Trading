import type { OhlcBar } from "./ema";
import { backupLimiter } from "./request-limit";

function getApiKey(): string | null {
  const key = process.env.TWELVE_DATA_API_KEY?.trim();
  return key || null;
}

export function isTwelveDataConfigured(): boolean {
  return getApiKey() != null;
}

export async function fetchTwelveDataHourlyBars(
  symbol: string,
  days: number,
): Promise<OhlcBar[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("TWELVE_DATA_API_KEY not configured");
  }

  return backupLimiter.run(async () => {
    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol", symbol.toUpperCase());
    url.searchParams.set("interval", "1h");
    url.searchParams.set("outputsize", String(Math.min(5000, (days + 14) * 7)));
    url.searchParams.set("apikey", apiKey);

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Twelve Data HTTP ${res.status} for ${symbol}`);
    }

    const body = (await res.json()) as {
      status?: string;
      values?: Array<{
        datetime: string;
        open?: string;
        high?: string;
        low?: string;
        close?: string;
      }>;
      message?: string;
    };

    if (body.status === "error" || !body.values?.length) {
      throw new Error(body.message ?? `Twelve Data returned no data for ${symbol}`);
    }

    const cutoff = Date.now() - (days + 14) * 24 * 60 * 60 * 1000;
    const bars: OhlcBar[] = [];

    for (const row of body.values) {
      const close = Number(row.close);
      if (!Number.isFinite(close)) continue;
      const date = new Date(row.datetime);
      if (date.getTime() < cutoff) continue;
      bars.push({
        date,
        open: Number(row.open) || undefined,
        high: Number(row.high) || undefined,
        low: Number(row.low) || undefined,
        close,
      });
    }

    if (bars.length === 0) {
      throw new Error(`Twelve Data returned no bars in range for ${symbol}`);
    }

    return bars.sort((a, b) => a.date.getTime() - b.date.getTime());
  });
}
