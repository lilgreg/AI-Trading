import type { OhlcBar } from "./ema";
import { backupLimiter } from "./request-limit";

function getApiKey(): string | null {
  const key = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  return key || null;
}

export function isAlphaVantageConfigured(): boolean {
  return getApiKey() != null;
}

export async function fetchAlphaVantageHourlyBars(
  symbol: string,
  days: number,
): Promise<OhlcBar[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ALPHA_VANTAGE_API_KEY not configured");
  }

  return backupLimiter.run(async () => {
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", "TIME_SERIES_INTRADAY");
    url.searchParams.set("symbol", symbol.toUpperCase());
    url.searchParams.set("interval", "60min");
    url.searchParams.set("outputsize", days > 60 ? "full" : "compact");
    url.searchParams.set("apikey", apiKey);

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Alpha Vantage HTTP ${res.status} for ${symbol}`);
    }

    const body = (await res.json()) as Record<string, unknown>;
    const seriesKey = Object.keys(body).find((k) =>
      k.startsWith("Time Series"),
    );
    if (!seriesKey) {
      const note = typeof body.Note === "string" ? body.Note : null;
      const info = typeof body.Information === "string" ? body.Information : null;
      throw new Error(
        note ?? info ?? `Alpha Vantage returned no intraday data for ${symbol}`,
      );
    }

    const series = body[seriesKey] as Record<
      string,
      { "1. open"?: string; "2. high"?: string; "3. low"?: string; "4. close"?: string }
    >;

    const cutoff = Date.now() - (days + 14) * 24 * 60 * 60 * 1000;
    const bars: OhlcBar[] = [];

    for (const [timestamp, row] of Object.entries(series)) {
      const close = Number(row["4. close"]);
      if (!Number.isFinite(close)) continue;
      const date = new Date(timestamp);
      if (date.getTime() < cutoff) continue;
      bars.push({
        date,
        open: Number(row["1. open"]) || undefined,
        high: Number(row["2. high"]) || undefined,
        low: Number(row["3. low"]) || undefined,
        close,
      });
    }

    if (bars.length === 0) {
      throw new Error(`Alpha Vantage returned no bars in range for ${symbol}`);
    }

    return bars.sort((a, b) => a.date.getTime() - b.date.getTime());
  });
}
