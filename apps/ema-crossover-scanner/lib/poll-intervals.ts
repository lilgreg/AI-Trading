import { getUsMarketSession } from "./market-session";

export interface PollIntervals {
  quotesMs: number;
  newsMs: number;
  statusMs: number;
}

function parsePollMs(raw: string | undefined, fallback: number): number {
  const ms = Number(raw ?? fallback);
  if (!Number.isFinite(ms) || ms < 10_000) return fallback;
  return ms;
}

/** Client poll cadence — faster during regular session (9:30–16:00 ET). */
export function getPollIntervals(at: Date = new Date()): PollIntervals {
  const isRegular = getUsMarketSession(at) === "regular";

  const quotesMs = isRegular
    ? parsePollMs(process.env.NEXT_PUBLIC_QUOTES_POLL_MS_MARKET, 90_000)
    : parsePollMs(process.env.NEXT_PUBLIC_QUOTES_POLL_MS_OFF, 180_000);

  const newsMs = isRegular
    ? parsePollMs(
        process.env.NEXT_PUBLIC_NEWS_POLL_MS_MARKET ??
          process.env.NEXT_PUBLIC_NEWS_POLL_MS,
        120_000,
      )
    : parsePollMs(process.env.NEXT_PUBLIC_NEWS_POLL_MS_OFF, 300_000);

  const statusMs = parsePollMs(process.env.NEXT_PUBLIC_STATUS_POLL_MS, 180_000);

  return { quotesMs, newsMs, statusMs };
}
