import type { OhlcBar } from "./ema";
import { backupLimiter } from "./request-limit";

const STOOQ_HOSTS = ["stooq.com", "stooq.pl"];

function toStooqSymbol(symbol: string): string {
  const upper = symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (upper.includes(".")) return upper.toLowerCase();
  return `${upper.toLowerCase()}.us`;
}

function isBotWall(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    lower.includes("<!doctype html") ||
    lower.includes("requires javascript") ||
    lower.includes("__verify")
  );
}

function parseStooqCsv(body: string, cutoffMs: number): OhlcBar[] {
  const lines = body.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const bars: OhlcBar[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(",");
    if (parts.length < 5) continue;

    const date = new Date(parts[0]);
    if (Number.isNaN(date.getTime()) || date.getTime() < cutoffMs) continue;

    const open = Number(parts[1]);
    const high = Number(parts[2]);
    const low = Number(parts[3]);
    const close = Number(parts[4]);
    if (!Number.isFinite(close)) continue;

    bars.push({
      date,
      open: Number.isFinite(open) ? open : undefined,
      high: Number.isFinite(high) ? high : undefined,
      low: Number.isFinite(low) ? low : undefined,
      close,
    });
  }

  return bars.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Stooq CSV — keyless US stock fallback (hourly when available, else daily). */
export async function fetchStooqHourlyBars(
  symbol: string,
  days: number,
): Promise<OhlcBar[]> {
  return backupLimiter.run(async () => {
    const stooqSymbol = toStooqSymbol(symbol);
    const cutoffMs = Date.now() - (days + 14) * 24 * 60 * 60 * 1000;
    let lastError: unknown;

    for (const host of STOOQ_HOSTS) {
      for (const interval of ["60", "d"] as const) {
        const url = new URL(`https://${host}/q/d/l/`);
        url.searchParams.set("s", stooqSymbol);
        url.searchParams.set("i", interval);

        try {
          const res = await fetch(url, {
            cache: "no-store",
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Accept: "text/csv,text/plain,*/*",
              Referer: `https://${host}/`,
            },
          });

          if (!res.ok) {
            throw new Error(`Stooq HTTP ${res.status} for ${symbol}`);
          }

          const body = await res.text();
          if (isBotWall(body)) {
            throw new Error(`Stooq bot wall for ${symbol} on ${host}`);
          }

          const bars = parseStooqCsv(body, cutoffMs);
          if (bars.length === 0) {
            throw new Error(`Stooq returned no bars for ${symbol} (${interval})`);
          }

          if (interval === "d") {
            throw new Error(
              `Stooq only returned daily bars for ${symbol} — need hourly`,
            );
          }

          return bars;
        } catch (err) {
          lastError = err;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Stooq failed for ${symbol}`);
  });
}
