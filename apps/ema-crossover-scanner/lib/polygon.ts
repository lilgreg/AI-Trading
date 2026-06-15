import type { OhlcBar } from "./ema";
import { backupLimiter } from "./request-limit";

function getApiKey(): string | null {
  const key = process.env.POLYGON_API_KEY?.trim();
  return key || null;
}

export function isPolygonConfigured(): boolean {
  return getApiKey() != null;
}

export async function fetchPolygonHourlyBars(
  symbol: string,
  days: number,
): Promise<OhlcBar[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("POLYGON_API_KEY not configured");
  }

  return backupLimiter.run(async () => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days - 14);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const url = new URL(
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol.toUpperCase())}/range/1/hour/${fromStr}/${toStr}`,
    );
    url.searchParams.set("adjusted", "true");
    url.searchParams.set("sort", "asc");
    url.searchParams.set("limit", "50000");
    url.searchParams.set("apiKey", apiKey);

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Polygon HTTP ${res.status} for ${symbol}`);
    }

    const body = (await res.json()) as {
      results?: Array<{
        t: number;
        o?: number;
        h?: number;
        l?: number;
        c?: number;
      }>;
      status?: string;
    };

    if (!body.results?.length) {
      throw new Error(`Polygon returned no hourly data for ${symbol}`);
    }

    return body.results
      .filter((row) => row.c != null)
      .map((row) => ({
        date: new Date(row.t),
        open: row.o ?? undefined,
        high: row.h ?? undefined,
        low: row.l ?? undefined,
        close: row.c as number,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  });
}
