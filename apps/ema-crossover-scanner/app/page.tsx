"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMsAgo } from "@/lib/ema";
import type { ScanInterval } from "@/lib/intervals";
import type { PatternDetection } from "@/lib/types";
import type { ScanResponse, StockScanResult } from "@/lib/types";

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
    <div className="space-y-0.5 text-xs leading-tight">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-baseline gap-2">
          <span className="w-7 shrink-0 text-[var(--muted)]">{label}</span>
          <span className={`mono ${changeColorClass(value)}`}>
            {formatSessionChange(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function patternBadgeClass(status: PatternDetection["status"]): string {
  if (status === "Active") return "badge-amber";
  if (status === "Completed") return "badge-green";
  if (status === "Failed") return "badge-red";
  return "badge-muted";
}

function formatPatternLine(prefix: string, pattern: PatternDetection): string {
  if (pattern.status === "None") return `${prefix}: None`;
  if (pattern.timeframes === "None") return `${prefix}: ${pattern.status}`;
  return `${prefix}: ${pattern.status} (${pattern.timeframes})`;
}

function PatternsCell({ patterns }: { patterns: StockScanResult["patterns"] }) {
  const lines = [
    { key: "db", text: formatPatternLine("DB", patterns.doubleBottom), status: patterns.doubleBottom.status },
    {
      key: "ihs",
      text: formatPatternLine("IH&S", patterns.inverseHeadShoulders),
      status: patterns.inverseHeadShoulders.status,
    },
  ];

  return (
    <div className="space-y-1 text-xs leading-tight">
      {lines.map(({ key, text, status }) => (
        <div key={key}>
          <span className={`${patternBadgeClass(status)} inline-block rounded-full px-2 py-0.5`}>
            {text}
          </span>
        </div>
      ))}
    </div>
  );
}

function CrossoverCell({ row }: { row: StockScanResult }) {
  if (row.error) {
    return <span className="text-[var(--red)] text-xs">{row.error}</span>;
  }

  if (!row.crossoverDate) {
    return (
      <span className="badge-muted inline-block rounded-full px-2 py-0.5 text-xs">
        No cross in window
      </span>
    );
  }

  return (
    <div>
      <div className="font-medium">{row.crossoverDate}</div>
      {row.crossoverTime && (
        <div className="text-sm text-[var(--text)]">{row.crossoverTime}</div>
      )}
      <div className="text-xs text-[var(--muted)]">
        {row.crossoverMsAgo != null
          ? formatMsAgo(row.crossoverMsAgo)
          : row.crossoverDaysAgo === 0
            ? "Today"
            : `${row.crossoverDaysAgo}d ago`}
      </div>
    </div>
  );
}

const DEFAULT_TV_WATCHLIST =
  "https://www.tradingview.com/watchlists/156233778/";

export default function HomePage() {
  const [data, setData] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeBlueChips, setIncludeBlueChips] = useState(true);
  const [onlyAbove, setOnlyAbove] = useState(false);
  const [watchlist, setWatchlist] = useState("");
  const [tvWatchlistUrl, setTvWatchlistUrl] = useState(DEFAULT_TV_WATCHLIST);
  const [interval, setInterval] = useState<ScanInterval>("4h");

  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (!includeBlueChips) params.set("blueChips", "false");
      if (onlyAbove) params.set("onlyAbove", "true");
      if (watchlist.trim()) params.set("watchlist", watchlist.trim());
      if (tvWatchlistUrl.trim()) params.set("tvWatchlist", tvWatchlistUrl.trim());
      params.set("interval", interval);

      const res = await fetch(`/api/scan?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Scan failed (${res.status})`);
      }

      const json: ScanResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }, [includeBlueChips, onlyAbove, watchlist, tvWatchlistUrl, interval]);

  useEffect(() => {
    void runScan();
  }, [runScan]);

  const stats = useMemo(() => {
    if (!data) return { above: 0, withCross: 0, errors: 0 };
    return {
      above: data.results.filter((r) => r.ema20Above50 && !r.error).length,
      withCross: data.results.filter((r) => r.crossoverDate && !r.error).length,
      errors: data.results.filter((r) => r.error).length,
    };
  }, [data]);

  const handleFileUpload = async (file: File) => {
    const text = await file.text();
    setWatchlist(text);
  };

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
          Ranks stocks by the most recent full cycle where the 20 EMA crossed below
          the 50, then back above. Uses {interval} candles from your TradingView
          watchlist plus blue-chip defaults (overlaps deduped).
        </p>
      </header>

      <section className="card mb-6 p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-3">
            <label className="block text-sm text-[var(--muted)]">
              Chart interval
            </label>
            <div className="flex gap-2">
              {(["4h", "1h"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`btn ${interval === value ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setInterval(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            <label className="block text-sm text-[var(--muted)]">
              TradingView shared watchlist link
            </label>
            <input
              className="input font-mono text-xs"
              placeholder="https://www.tradingview.com/watchlists/156233778/"
              value={tvWatchlistUrl}
              onChange={(e) => setTvWatchlistUrl(e.target.value)}
            />
            <label className="block text-sm text-[var(--muted)]">
              Extra symbols (paste or upload .txt export)
            </label>
            <textarea
              className="input min-h-[88px] font-mono text-xs"
              placeholder={"NASDAQ:AAPL, NYSE:JPM\nor one symbol per line"}
              value={watchlist}
              onChange={(e) => setWatchlist(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeBlueChips}
                  onChange={(e) => setIncludeBlueChips(e.target.checked)}
                />
                Include blue-chip defaults
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyAbove}
                  onChange={(e) => setOnlyAbove(e.target.checked)}
                />
                Only 20 &gt; 50 now
              </label>
              <label className="btn btn-secondary cursor-pointer">
                Upload .txt
                <input
                  type="file"
                  accept=".txt,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFileUpload(file);
                  }}
                />
              </label>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary h-10 min-w-[120px] disabled:opacity-60"
            onClick={() => void runScan()}
            disabled={loading}
          >
            {loading ? "Scanning…" : "Refresh scan"}
          </button>
        </div>
      </section>

      {error && (
        <div className="card mb-6 border-[var(--red)] p-4 text-[var(--red)]">{error}</div>
      )}

      <section className="mb-4 flex flex-wrap gap-3 text-sm">
        <div className="card px-4 py-2">
          <span className="text-[var(--muted)]">Interval</span>{" "}
          <span className="font-semibold">{data?.interval ?? interval}</span>
        </div>
        <div className="card px-4 py-2">
          <span className="text-[var(--muted)]">Symbols</span>{" "}
          <span className="font-semibold">{data?.symbolCount ?? "—"}</span>
        </div>
        <div className="card px-4 py-2">
          <span className="text-[var(--muted)]">20 &gt; 50 now</span>{" "}
          <span className="font-semibold text-[var(--green)]">{stats.above}</span>
        </div>
        <div className="card px-4 py-2">
          <span className="text-[var(--muted)]">Recent crosses</span>{" "}
          <span className="font-semibold">{stats.withCross}</span>
        </div>
        {data?.tradingViewWatchlistName && (
          <div className="card px-4 py-2 text-[var(--muted)]">
            TV list: <span className="text-[var(--text)]">{data.tradingViewWatchlistName}</span>
          </div>
        )}
        {data?.scannedAt && (
          <div className="card px-4 py-2 text-[var(--muted)]">
            Updated {new Date(data.scannedAt).toLocaleString()}
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="scan-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Symbol</th>
                <th>Name</th>
                <th>Price</th>
                <th>Session Δ</th>
                <th>Patterns</th>
                <th>20 EMA</th>
                <th>50 EMA</th>
                <th>Status</th>
                <th>Last bullish cross</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-[var(--muted)]">
                    Fetching market data and computing EMAs…
                  </td>
                </tr>
              ) : (
                data?.results.map((row, index) => (
                  <tr key={row.symbol}>
                    <td className="text-[var(--muted)]">{index + 1}</td>
                    <td className="mono font-medium">
                      <a
                        href={row.tradingViewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--accent)] hover:underline"
                      >
                        {row.displayTicker}
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
                      <CrossoverCell row={row} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-8 text-xs text-[var(--muted)]">
        Price data via Yahoo Finance ({interval} candles). Cross requires 20 EMA to cross
        below 50 before crossing back above. Not financial advice.
      </footer>
    </main>
  );
}
