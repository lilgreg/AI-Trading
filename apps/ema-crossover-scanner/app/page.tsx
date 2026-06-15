"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMsAgo } from "@/lib/ema";
import {
  normalizeCachedResponse,
  normalizeCrossover,
  normalizePatterns,
} from "@/lib/normalize-scan-result";
import { patternSortKey } from "@/lib/pattern-sort";
import { StockLogo } from "@/components/stock-logo";
import type { CachedScanResponse, CrossoverDisplay, PatternDetection } from "@/lib/types";
import type { StockScanResult } from "@/lib/types";

type SortKey = "session" | "patterns" | "cross1h" | "cross4h";
type SortDir = "asc" | "desc";

function formatPrice(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function formatEma(value: number | null): string {
  if (value == null) return "—";
  return value.toFixed(2);
}

function changeColorClass(value: number | null): string {
  if (value == null) return "text-[var(--muted)]";
  if (value > 0) return "text-[var(--green)]";
  if (value < 0) return "text-[var(--red)]";
  return "text-[var(--muted)]";
}

function formatSessionChange(value: number | null): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatCacheAge(scannedAt: string | null): string {
  if (!scannedAt) return "never";
  const ms = Date.now() - new Date(scannedAt).getTime();
  if (ms < 60_000) return "just now";
  return formatMsAgo(ms);
}

function SessionChangesCell({ row }: { row: StockScanResult }) {
  const rows = [
    { label: "Pre", value: row.preMarketChange },
    { label: "Reg", value: row.regularMarketChange },
    { label: "AH", value: row.postMarketChange },
  ] as const;

  const hasAny = rows.some((r) => r.value != null);
  if (!hasAny) {
    return <span className="text-[var(--muted)]">—</span>;
  }

  return (
    <div className="space-y-0.5 text-sm leading-snug">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-baseline gap-2">
          <span className="w-8 shrink-0 text-[var(--muted)]">{label}</span>
          <span className={`mono text-base ${changeColorClass(value)}`}>
            {formatSessionChange(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function patternBadgeClass(status: PatternDetection["status"]): string {
  if (status === "Active") return "badge-amber";
  if (status === "Target") return "badge-green";
  if (status === "Failed") return "badge-blue";
  return "badge-muted";
}

function formatPatternLabel(prefix: string, pattern: PatternDetection): string | null {
  if (pattern.status !== "Active") return null;
  const tf =
    pattern.timeframes !== "None" ? ` (${pattern.timeframes})` : "";
  return `${prefix} ${pattern.status}${tf}`;
}

function PatternsCell({ patterns }: { patterns: StockScanResult["patterns"] }) {
  const safe = normalizePatterns(patterns);
  const lines = [
    {
      key: "db",
      text: formatPatternLabel("DB", safe.doubleBottom),
      status: safe.doubleBottom.status,
    },
    {
      key: "dt",
      text: formatPatternLabel("DT", safe.doubleTop),
      status: safe.doubleTop.status,
    },
    {
      key: "hs",
      text: formatPatternLabel("HS", safe.headShoulders),
      status: safe.headShoulders.status,
    },
    {
      key: "ihs",
      text: formatPatternLabel("IHS", safe.inverseHeadShoulders),
      status: safe.inverseHeadShoulders.status,
    },
  ].filter((line) => line.text != null);

  if (lines.length === 0) {
    return <span className="text-sm text-[var(--muted)]">None</span>;
  }

  return (
    <div className="space-y-1 text-sm leading-snug">
      {lines.map(({ key, text, status }) => (
        <div key={key}>
          <span
            className={`${patternBadgeClass(status)} inline-block rounded-full px-2.5 py-0.5 text-sm`}
          >
            {text}
          </span>
        </div>
      ))}
    </div>
  );
}

function CrossoverCell({
  cross,
  error,
}: {
  cross: CrossoverDisplay | undefined;
  error?: string;
}) {
  if (error) {
    return <span className="text-[var(--red)] text-xs">{error}</span>;
  }

  const safe = normalizeCrossover(cross);
  const iso = safe.crossoverAt;
  if (iso) {
    const when = new Date(iso);
    if (!Number.isNaN(when.getTime())) {
      const dateStr = when.toLocaleDateString(undefined, { dateStyle: "short" });
      const timeStr = when.toLocaleTimeString(undefined, { timeStyle: "short" });

      return (
        <div>
          <div className="font-medium">{dateStr}</div>
          <div className="text-sm text-[var(--text)]">{timeStr}</div>
          <div className="text-xs text-[var(--muted)]">
            {safe.crossoverMsAgo != null
              ? formatMsAgo(safe.crossoverMsAgo)
              : "—"}
          </div>
        </div>
      );
    }
  }

  if (safe.crossoverDate) {
    return (
      <div>
        <div className="font-medium">{safe.crossoverDate}</div>
        {safe.crossoverTime && (
          <div className="text-sm text-[var(--text)]">{safe.crossoverTime}</div>
        )}
        <div className="text-xs text-[var(--muted)]">
          {safe.crossoverMsAgo != null
            ? formatMsAgo(safe.crossoverMsAgo)
            : "—"}
        </div>
      </div>
    );
  }

  return (
    <span className="badge-muted inline-block rounded-full px-2 py-0.5 text-xs">
      No cross in window
    </span>
  );
}

function rowPatternSortKey(patterns: StockScanResult["patterns"]): number {
  const safe = normalizePatterns(patterns);
  return Math.min(
    patternSortKey(safe.doubleBottom),
    patternSortKey(safe.doubleTop),
    patternSortKey(safe.headShoulders),
    patternSortKey(safe.inverseHeadShoulders),
  );
}

function hasCrossover(cross: CrossoverDisplay | undefined): boolean {
  const safe = normalizeCrossover(cross);
  return Boolean(safe.crossoverAt ?? safe.crossoverDate);
}

function crossoverMsAgo(cross: CrossoverDisplay | undefined): number | null {
  return normalizeCrossover(cross).crossoverMsAgo;
}

function ariaSortValue(key: SortKey, activeKey: SortKey, dir: SortDir) {
  if (key !== activeKey) return "none" as const;
  return dir === "asc" ? ("ascending" as const) : ("descending" as const);
}

function sortIndicator(active: boolean, dir: SortDir): string {
  if (!active) return "";
  return dir === "asc" ? " ↑" : " ↓";
}

const POLL_MS = 30_000;

export default function HomePage() {
  const [data, setData] = useState<CachedScanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyAbove, setOnlyAbove] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("cross4h");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCache = useCallback(async (options?: { quiet?: boolean }) => {
    if (!options?.quiet) setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/scan", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Scan failed (${res.status})`);
      }
      const json = normalizeCachedResponse(
        (await res.json()) as Partial<CachedScanResponse>,
      );
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scan");
    } finally {
      if (!options?.quiet) setLoading(false);
    }
  }, []);

  const triggerRescan = useCallback(async () => {
    setRescanning(true);
    setError(null);
    try {
      const res = await fetch("/api/scan?force=true", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Rescan failed (${res.status})`);
      }
      const json = normalizeCachedResponse(
        (await res.json()) as Partial<CachedScanResponse>,
      );
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rescan failed");
    } finally {
      setRescanning(false);
    }
  }, []);

  useEffect(() => {
    void fetchCache();
  }, [fetchCache]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);

    const shouldPoll =
      data?.scanInProgress || data?.stale || data?.cacheEmpty;
    if (!shouldPoll) return;

    pollRef.current = setInterval(() => {
      void fetchCache({ quiet: true });
    }, POLL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [data?.scanInProgress, data?.stale, data?.cacheEmpty, fetchCache]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(
        key === "patterns" || key.startsWith("cross") ? "asc" : "desc",
      );
    }
  };

  const filteredResults = useMemo(() => {
    if (!data?.results) return [];
    if (!onlyAbove) return data.results;
    return data.results.filter((r) => r.ema20Above50 && !r.error);
  }, [data, onlyAbove]);

  const sortedResults = useMemo(() => {
    if (filteredResults.length === 0) return [];
    const rows = [...filteredResults];

    rows.sort((a, b) => {
      let cmp = 0;

      if (sortKey === "session") {
        const aVal = a.regularMarketChange;
        const bVal = b.regularMarketChange;
        if (aVal == null && bVal == null) cmp = 0;
        else if (aVal == null) cmp = 1;
        else if (bVal == null) cmp = -1;
        else cmp = aVal - bVal;
      } else if (sortKey === "patterns") {
        cmp = rowPatternSortKey(a.patterns) - rowPatternSortKey(b.patterns);
      } else if (sortKey === "cross1h") {
        const aVal = crossoverMsAgo(a.cross1h);
        const bVal = crossoverMsAgo(b.cross1h);
        if (aVal == null && bVal == null) cmp = 0;
        else if (aVal == null) cmp = 1;
        else if (bVal == null) cmp = -1;
        else cmp = aVal - bVal;
      } else {
        const aVal = crossoverMsAgo(a.cross4h);
        const bVal = crossoverMsAgo(b.cross4h);
        if (aVal == null && bVal == null) cmp = 0;
        else if (aVal == null) cmp = 1;
        else if (bVal == null) cmp = -1;
        else cmp = aVal - bVal;
      }

      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [filteredResults, sortKey, sortDir]);

  const stats = useMemo(() => {
    const rows = filteredResults;
    return {
      above: rows.filter((r) => r.ema20Above50 && !r.error).length,
      withCross1h: rows.filter((r) => hasCrossover(r.cross1h) && !r.error).length,
      withCross4h: rows.filter((r) => hasCrossover(r.cross4h) && !r.error).length,
      errors: rows.filter((r) => r.error).length,
      total: data?.symbolCount ?? rows.length,
    };
  }, [filteredResults, data]);

  const showEmptyState = !loading && data?.cacheEmpty && !data?.scanInProgress;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--accent)]">
          AI Trading · EMA Scanner
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          20 EMA × 50 EMA Crossover Rank
        </h1>
        <p className="mt-2 max-w-2xl text-[var(--muted)]">
          Precomputed server scan — opens instantly from cache. Cross 4h and Cross 1h
          columns show each timeframe independently (times in your local timezone).
        </p>
      </header>

      <section className="card mb-6 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyAbove}
                onChange={(e) => setOnlyAbove(e.target.checked)}
              />
              Only show 20 &gt; 50 now (client filter)
            </label>
            <p className="text-xs text-[var(--muted)]">
              Server scan uses <code className="mono">TRADINGVIEW_WATCHLIST_URL</code>{" "}
              and <code className="mono">WATCHLIST_SYMBOLS</code> from Vercel env.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-secondary h-10 min-w-[100px] disabled:opacity-60"
              onClick={() => void fetchCache()}
              disabled={loading && !data}
            >
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-primary h-10 min-w-[120px] disabled:opacity-60"
              onClick={() => void triggerRescan()}
              disabled={rescanning || data?.scanInProgress}
            >
              {rescanning || data?.scanInProgress ? "Scanning…" : "Rescan now"}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="card mb-6 border-[var(--red)] p-4 text-[var(--red)]">{error}</div>
      )}

      <section className="mb-4 flex flex-wrap gap-3 text-sm">
        <div className="card px-4 py-2">
          <span className="text-[var(--muted)]">Symbols</span>{" "}
          <span className="font-semibold">{stats.total}</span>
        </div>
        <div className="card px-4 py-2">
          <span className="text-[var(--muted)]">20 &gt; 50 now (4h)</span>{" "}
          <span className="font-semibold text-[var(--green)]">{stats.above}</span>
        </div>
        <div className="card px-4 py-2">
          <span className="text-[var(--muted)]">1h crosses</span>{" "}
          <span className="font-semibold">{stats.withCross1h}</span>
        </div>
        <div className="card px-4 py-2">
          <span className="text-[var(--muted)]">4h crosses</span>{" "}
          <span className="font-semibold">{stats.withCross4h}</span>
        </div>
        {data?.tradingViewWatchlistName && (
          <div className="card px-4 py-2 text-[var(--muted)]">
            TV list:{" "}
            <span className="text-[var(--text)]">{data.tradingViewWatchlistName}</span>
          </div>
        )}
        <div className="card px-4 py-2">
          <span className="text-[var(--muted)]">Cache</span>{" "}
          <span className="font-semibold">
            {formatCacheAge(data?.scannedAt ?? null)}
          </span>
          {data?.stale && !data.scanInProgress && (
            <span className="ml-2 text-[var(--amber)]">stale</span>
          )}
          {data?.scanInProgress && (
            <span className="ml-2 text-[var(--accent)]">updating…</span>
          )}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="scan-table">
            <thead>
              <tr>
                <th>#</th>
                <th colSpan={2}>Symbol</th>
                <th>Name</th>
                <th>Price</th>
                <th
                  className="sortable"
                  onClick={() => handleSort("session")}
                  aria-sort={ariaSortValue("session", sortKey, sortDir)}
                >
                  Session Δ{sortIndicator(sortKey === "session", sortDir)}
                </th>
                <th
                  className="sortable"
                  onClick={() => handleSort("patterns")}
                  aria-sort={ariaSortValue("patterns", sortKey, sortDir)}
                >
                  Patterns{sortIndicator(sortKey === "patterns", sortDir)}
                </th>
                <th>20 EMA (4h)</th>
                <th>50 EMA (4h)</th>
                <th>Status (4h)</th>
                <th
                  className="sortable"
                  onClick={() => handleSort("cross4h")}
                  aria-sort={ariaSortValue("cross4h", sortKey, sortDir)}
                >
                  Cross 4h{sortIndicator(sortKey === "cross4h", sortDir)}
                </th>
                <th
                  className="sortable"
                  onClick={() => handleSort("cross1h")}
                  aria-sort={ariaSortValue("cross1h", sortKey, sortDir)}
                >
                  Cross 1h{sortIndicator(sortKey === "cross1h", sortDir)}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-[var(--muted)]">
                    Loading cached scan…
                  </td>
                </tr>
              ) : showEmptyState ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-[var(--muted)]">
                    No cached scan yet — background scan started. This page will
                    update automatically.
                  </td>
                </tr>
              ) : sortedResults.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-[var(--muted)]">
                    No results match filters.
                  </td>
                </tr>
              ) : (
                sortedResults.map((row, index) => {
                  const cross4h = row.cross4h ?? undefined;
                  const cross1h = row.cross1h ?? undefined;
                  const chartUrl = row.tradingViewUrl ?? "#";
                  const ticker = row.displayTicker ?? row.symbol ?? "—";

                  return (
                    <tr key={row.symbol}>
                      <td className="text-[var(--muted)]">{index + 1}</td>
                      <td className="mono py-0 text-base font-semibold" colSpan={2}>
                        <a
                          href={chartUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="symbol-link py-3.5"
                        >
                          <StockLogo
                            displayTicker={ticker}
                            tradingViewSymbol={row.tradingViewSymbol}
                          />
                          <span>{ticker}</span>
                        </a>
                      </td>
                      <td className="max-w-[220px] truncate text-[var(--muted)]">
                        {row.name ?? "—"}
                      </td>
                      <td className="mono">{formatPrice(row.price)}</td>
                      <td>
                        <SessionChangesCell row={row} />
                      </td>
                      <td>
                        <PatternsCell patterns={row.patterns} />
                      </td>
                      <td className="mono">{formatEma(row.ema20)}</td>
                      <td className="mono">{formatEma(row.ema50)}</td>
                      <td>
                        {row.error ? (
                          <span className="badge-muted inline-block rounded-full px-2 py-0.5 text-xs">
                            Error
                          </span>
                        ) : row.ema20Above50 ? (
                          <span className="badge-green inline-block rounded-full px-2 py-0.5 text-xs">
                            20 &gt; 50
                          </span>
                        ) : (
                          <span className="badge-red inline-block rounded-full px-2 py-0.5 text-xs">
                            20 ≤ 50
                          </span>
                        )}
                      </td>
                      <td>
                        <CrossoverCell cross={cross4h} error={row.error} />
                      </td>
                      <td>
                        <CrossoverCell cross={cross1h} error={row.error} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-8 text-xs text-[var(--muted)]">
        Price data via Yahoo Finance (1h bars, aggregated to 4h). Pattern labels are
        algorithmic approximations on 1h/4h bars (40-day window) — confirmed Active
        patterns require neckline break; not TradingView auto-chart-patterns. Server
        refreshes cache every 30 min via Vercel Cron; page polls while a scan runs.
        Cross requires 20 EMA to cross below 50 before crossing back above. Not
        financial advice.
      </footer>
    </main>
  );
}
