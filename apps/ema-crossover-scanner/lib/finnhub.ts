import type { OhlcBar } from "./ema";
import { backupLimiter } from "./request-limit";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

function getApiKey(): string | null {
  const key = process.env.FINNHUB_API_KEY?.trim();
  return key || null;
}

export function isFinnhubConfigured(): boolean {
  return getApiKey() != null;
}

/** Finnhub resolution=60 → hourly candles (free tier). */
export async function fetchFinnhubHourlyBars(
  symbol: string,
  days: number,
): Promise<OhlcBar[]> {
  const token = getApiKey();
  if (!token) {
    throw new Error("FINNHUB_API_KEY not configured");
  }

  return backupLimiter.run(async () => {
    const to = Math.floor(Date.now() / 1000);
    const from = to - (days + 14) * 24 * 60 * 60;
    const url = new URL(`${FINNHUB_BASE}/stock/candle`);
    url.searchParams.set("symbol", symbol.toUpperCase());
    url.searchParams.set("resolution", "60");
    url.searchParams.set("from", String(from));
    url.searchParams.set("to", String(to));
    url.searchParams.set("token", token);

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Finnhub candle HTTP ${res.status} for ${symbol}`);
    }

    const body = (await res.json()) as {
      s?: string;
      t?: number[];
      o?: number[];
      h?: number[];
      l?: number[];
      c?: number[];
    };

    if (body.s !== "ok" || !body.t?.length || !body.c?.length) {
      throw new Error(`Finnhub returned no hourly data for ${symbol}`);
    }

    const bars: OhlcBar[] = [];
    for (let i = 0; i < body.t.length; i += 1) {
      const close = body.c[i];
      if (close == null) continue;
      bars.push({
        date: new Date(body.t[i] * 1000),
        open: body.o?.[i] ?? undefined,
        high: body.h?.[i] ?? undefined,
        low: body.l?.[i] ?? undefined,
        close,
      });
    }

    return bars.sort((a, b) => a.date.getTime() - b.date.getTime());
  });
}
