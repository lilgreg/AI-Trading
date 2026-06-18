import { getUsMarketSession } from "./market-session";

export interface PollIntervals {
  quotesMs: number;
  newsMs: number;
  statusMs: number;
}

export const DEFAULT_NEWS_POLL_MS = 120_000;
export const DEFAULT_NEWS_POLL_MS_OFF = 300_000;
export const DEFAULT_QUOTES_POLL_MS_MARKET = 90_000;
export const DEFAULT_QUOTES_POLL_MS_OFF = 180_000;
export const DEFAULT_STATUS_POLL_MS = 180_000;
export const MIN_POLL_MS = 10_000;

function parsePollMs(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  const ms = Number(trimmed && trimmed.length > 0 ? trimmed : fallback);
  if (!Number.isFinite(ms) || ms < MIN_POLL_MS) return fallback;
  return ms;
}

/** Human-readable poll cadence for UI labels (never 0/NaN). */
export function newsPollLabelSec(at: Date = new Date()): number {
  const sec = Math.round(getPollIntervals(at).newsMs / 1000);
  if (!Number.isFinite(sec) || sec < 10) {
    return Math.round(DEFAULT_NEWS_POLL_MS / 1000);
  }
  return sec;
}

/** Client poll cadence — faster during regular session (9:30–16:00 ET). */
export function getPollIntervals(at: Date = new Date()): PollIntervals {
  const isRegular = getUsMarketSession(at) === "regular";

  const quotesMs = isRegular
    ? parsePollMs(
        process.env.NEXT_PUBLIC_QUOTES_POLL_MS_MARKET,
        DEFAULT_QUOTES_POLL_MS_MARKET,
      )
    : parsePollMs(
        process.env.NEXT_PUBLIC_QUOTES_POLL_MS_OFF,
        DEFAULT_QUOTES_POLL_MS_OFF,
      );

  const newsMs = isRegular
    ? parsePollMs(
        process.env.NEXT_PUBLIC_NEWS_POLL_MS_MARKET ??
          process.env.NEXT_PUBLIC_NEWS_POLL_MS,
        DEFAULT_NEWS_POLL_MS,
      )
    : parsePollMs(
        process.env.NEXT_PUBLIC_NEWS_POLL_MS_OFF,
        DEFAULT_NEWS_POLL_MS_OFF,
      );

  const statusMs = parsePollMs(
    process.env.NEXT_PUBLIC_STATUS_POLL_MS,
    DEFAULT_STATUS_POLL_MS,
  );

  return { quotesMs, newsMs, statusMs };
}
