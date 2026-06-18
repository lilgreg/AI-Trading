import type { SessionChanges } from "./market-session";
import { getUsMarketSession } from "./market-session";
import { isStaleSessionSnapshot, nySessionDateKey } from "./quote-updates";
import { resolveYahooChartSymbol } from "./stocks";
import type { StockScanResult } from "./types";
import { getYahooCached, setYahooCached } from "./yahoo-cache";
import { YAHOO_CHART_TIMEOUT_MS } from "./yahoo";

const YAHOO_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function percentChange(current: number, base: number): number | null {
  if (base === 0) return null;
  return ((current - base) / base) * 100;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nyDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function nyMinutesSinceMidnight(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

interface IntradayBar {
  date: Date;
  close: number;
}

function parseIntradayBars(body: {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
      meta?: Record<string, unknown>;
    }>;
  };
}): { bars: IntradayBar[]; meta: Record<string, unknown> | null } {
  const result = body.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const bars: IntradayBar[] = [];

  for (let i = 0; i < timestamps.length; i += 1) {
    const close = closes[i];
    if (close == null) continue;
    bars.push({ date: new Date(timestamps[i] * 1000), close });
  }

  return { bars, meta: result?.meta ?? null };
}

/**
 * Derive Pre/Reg/AH % from Yahoo v8 intraday chart (includePrePost=true).
 * Used overnight when live quote fields are null.
 */
export async function fetchSessionChangesFromChart(
  rawSymbol: string,
): Promise<SessionChanges | null> {
  const symbol = resolveYahooChartSymbol(rawSymbol);
  const cached = await getYahooCached<SessionChanges>("session-chart", symbol);
  if (cached) return cached;

  const derived = await fetchSessionChangesFromChartUncached(rawSymbol);
  if (derived) await setYahooCached("session-chart", symbol, derived);
  return derived;
}

async function fetchSessionChangesFromChartUncached(
  rawSymbol: string,
): Promise<SessionChanges | null> {
  const symbol = resolveYahooChartSymbol(rawSymbol);
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
  );
  url.searchParams.set("interval", "5m");
  url.searchParams.set("range", "2d");
  url.searchParams.set("includePrePost", "true");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), YAHOO_CHART_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": YAHOO_USER_AGENT },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const body = (await res.json()) as Parameters<typeof parseIntradayBars>[0];
    const { bars, meta } = parseIntradayBars(body);
    if (bars.length === 0) return null;

    const previousClose =
      num(meta?.chartPreviousClose) ??
      num(meta?.previousClose) ??
      num(meta?.regularMarketPreviousClose);

    const regStart = 9 * 60 + 30;
    const regEnd = 16 * 60;
    const ahEnd = 20 * 60;

    const byDay = new Map<string, IntradayBar[]>();
    for (const bar of bars) {
      const key = nyDateKey(bar.date);
      const list = byDay.get(key) ?? [];
      list.push(bar);
      byDay.set(key, list);
    }

    const sortedDays = [...byDay.keys()].sort();
    const sessionDay = sortedDays.at(-1);
    if (!sessionDay) return null;

    const dayBars = byDay.get(sessionDay) ?? [];
    const preBars = dayBars.filter((b) => {
      const m = nyMinutesSinceMidnight(b.date);
      return m >= 4 * 60 && m < regStart;
    });
    const regBars = dayBars.filter((b) => {
      const m = nyMinutesSinceMidnight(b.date);
      return m >= regStart && m < regEnd;
    });
    const ahBars = dayBars.filter((b) => {
      const m = nyMinutesSinceMidnight(b.date);
      return m >= regEnd && m < ahEnd;
    });

    const preMarketPrice = preBars.at(-1)?.close ?? num(meta?.preMarketPrice);
    const regularClose =
      regBars.at(-1)?.close ??
      num(meta?.regularMarketPrice) ??
      num(meta?.previousClose);
    const postMarketPrice = ahBars.at(-1)?.close ?? num(meta?.postMarketPrice);

    const preMarketChange =
      preMarketPrice != null && previousClose != null
        ? percentChange(preMarketPrice, previousClose)
        : null;

    const regularMarketChange =
      regularClose != null && previousClose != null
        ? percentChange(regularClose, previousClose)
        : null;

    const postMarketChange =
      postMarketPrice != null && regularClose != null
        ? percentChange(postMarketPrice, regularClose)
        : null;

    if (
      preMarketChange == null &&
      regularMarketChange == null &&
      postMarketChange == null
    ) {
      return null;
    }

    return { preMarketChange, regularMarketChange, postMarketChange };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface SessionSnapshotFields {
  preMarketChange: number | null;
  regularMarketChange: number | null;
  postMarketChange: number | null;
  sessionSnapshotDate: string | null;
}

/** Capture non-null session % for overnight display. */
export function captureSessionSnapshot(
  changes: SessionChanges,
  at: Date = new Date(),
): SessionSnapshotFields | null {
  const hasAny =
    changes.preMarketChange != null ||
    changes.regularMarketChange != null ||
    changes.postMarketChange != null;
  if (!hasAny) return null;

  return {
    preMarketChange: changes.preMarketChange,
    regularMarketChange: changes.regularMarketChange,
    postMarketChange: changes.postMarketChange,
    sessionSnapshotDate: nyDateKey(at),
  };
}

function mergeSessionField(
  live: number | null | undefined,
  cached: number | null | undefined,
): number | null {
  if (live != null) return live;
  if (cached != null) return cached;
  return null;
}

/**
 * Resolve session % for display/storage: live quote → row snapshot → chart derive.
 */
export async function resolveSessionChanges(
  row: Pick<
    StockScanResult,
    | "symbol"
    | "preMarketChange"
    | "regularMarketChange"
    | "postMarketChange"
    | "sessionSnapshotDate"
  >,
  live?: SessionChanges,
): Promise<SessionChanges & { sessionSnapshotDate?: string | null }> {
  const rowIsStale = isStaleSessionSnapshot(row.sessionSnapshotDate);

  const merged: SessionChanges = {
    preMarketChange: rowIsStale
      ? (live?.preMarketChange ?? null)
      : mergeSessionField(live?.preMarketChange, row.preMarketChange),
    regularMarketChange: rowIsStale
      ? (live?.regularMarketChange ?? null)
      : mergeSessionField(live?.regularMarketChange, row.regularMarketChange),
    postMarketChange: rowIsStale
      ? (live?.postMarketChange ?? null)
      : mergeSessionField(live?.postMarketChange, row.postMarketChange),
  };

  const needsDerive =
    merged.preMarketChange == null ||
    merged.regularMarketChange == null ||
    merged.postMarketChange == null;

  if (needsDerive) {
    const fromChart = await fetchSessionChangesFromChart(row.symbol);
    if (fromChart) {
      merged.preMarketChange =
        merged.preMarketChange ?? fromChart.preMarketChange;
      merged.regularMarketChange =
        merged.regularMarketChange ?? fromChart.regularMarketChange;
      merged.postMarketChange =
        merged.postMarketChange ?? fromChart.postMarketChange;
    }
  }

  const snapshot = captureSessionSnapshot(merged);
  return {
    ...merged,
    sessionSnapshotDate:
      snapshot?.sessionSnapshotDate ??
      (rowIsStale ? nySessionDateKey() : row.sessionSnapshotDate) ??
      null,
  };
}

/** Apply resolved session fields onto a scan row. */
export function applySessionSnapshot(
  row: StockScanResult,
  resolved: SessionChanges & { sessionSnapshotDate?: string | null },
): StockScanResult {
  return {
    ...row,
    preMarketChange: resolved.preMarketChange ?? row.preMarketChange,
    regularMarketChange: resolved.regularMarketChange ?? row.regularMarketChange,
    postMarketChange: resolved.postMarketChange ?? row.postMarketChange,
    sessionSnapshotDate:
      resolved.sessionSnapshotDate ?? row.sessionSnapshotDate ?? null,
  };
}

function rowNeedsSessionEnrich(row: StockScanResult): boolean {
  return (
    row.preMarketChange == null ||
    row.regularMarketChange == null ||
    row.postMarketChange == null
  );
}

/**
 * Fill missing Pre/AH from chart on read — persists to snapshot when changed.
 */
export async function enrichSnapshotSessions(
  results: StockScanResult[],
  options: { maxSymbols?: number } = {},
): Promise<{ results: StockScanResult[]; changed: boolean }> {
  const maxSymbols = options.maxSymbols ?? 40;
  const toEnrich = results.filter(rowNeedsSessionEnrich).slice(0, maxSymbols);
  if (toEnrich.length === 0) return { results, changed: false };

  const bySymbol = new Map(results.map((row) => [row.symbol, row]));
  let changed = false;
  const ENRICH_BATCH = 6;

  for (let i = 0; i < toEnrich.length; i += ENRICH_BATCH) {
    const batch = toEnrich.slice(i, i + ENRICH_BATCH);
    const resolvedBatch = await Promise.all(
      batch.map((row) => resolveSessionChanges(row)),
    );
    for (let j = 0; j < batch.length; j += 1) {
      const row = batch[j];
      const next = applySessionSnapshot(row, resolvedBatch[j]);
      if (
        next.preMarketChange !== row.preMarketChange ||
        next.regularMarketChange !== row.regularMarketChange ||
        next.postMarketChange !== row.postMarketChange ||
        next.sessionSnapshotDate !== row.sessionSnapshotDate
      ) {
        bySymbol.set(row.symbol, next);
        changed = true;
      }
    }
  }

  if (!changed) return { results, changed: false };
  return {
    results: results.map((row) => bySymbol.get(row.symbol) ?? row),
    changed: true,
  };
}
