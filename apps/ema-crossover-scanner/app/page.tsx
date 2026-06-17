"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatMsAgo } from "@/lib/ema";
import { dailyChangeForScanRow } from "@/lib/daily-change";
import {
  filterSessionChangesForMarket,
} from "@/lib/market-session";
import {
  normalizeCachedResponse,
  normalizeCrossover,
  normalizePatterns,
} from "@/lib/normalize-scan-result";
import { patternSortKey } from "@/lib/pattern-sort";
import { isStooqChartError, sanitizeChartError } from "@/lib/chart-error-sanitize";
import { stripDisplayTicker } from "@/lib/stocks";
import { applyQuoteUpdates, mergeScanResultIntoRows, mergeScanResultsPreservingQuotes } from "@/lib/quote-updates";
import { StockLogo } from "@/components/stock-logo";
import { NewsArticleModal } from "@/components/news-article-modal";
import type { NewsHeadline } from "@/lib/news";
import { prefetchNewsPreview } from "@/lib/news-preview-cache";
import {
  clientFetch,
  formatRateLimitError,
  hydrateRateLimitFromStorage,
  isWorkerRateLimited,
  noteWorkerRateLimit,
} from "@/lib/client-poll";
import { createPollCoordinator } from "@/lib/poll-coordinator";
import type {
  CachedScanResponse,
  CrossoverDisplay,
  PatternDetection,
  StockScanResult,
} from "@/lib/types";

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

function formatScanDataAge(scannedAt: string | null): string {
  if (!scannedAt) return "never";
  const ms = Date.now() - new Date(scannedAt).getTime();
  if (ms < 60_000) return "just now";
  return `${formatMsAgo(ms)} ago`;
}

function SessionChangesCell({
  row,
  dailyChange,
}: {
  row: StockScanResult;
  dailyChange?: number | null;
}) {
  const filtered = filterSessionChangesForMarket({
    preMarketChange: row.preMarketChange,
    regularMarketChange: row.regularMarketChange,
    postMarketChange: row.postMarketChange,
  });

  const regFallback: number | null =
    filtered.regularMarketChange ??
    (filtered.preMarketChange == null && filtered.postMarketChange == null
      ? (dailyChange ?? null)
      : null);

  const rows = [
    { label: "Pre", value: filtered.preMarketChange },
    { label: "Reg", value: regFallback },
    { label: "AH", value: filtered.postMarketChange },
  ] as const;

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
    <span className="text-sm text-[var(--muted)]">—</span>
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

function crossoverCellError(
  cross: CrossoverDisplay | undefined,
  rowError?: string,
  hasEma?: boolean,
): string | undefined {
  if (hasCrossover(cross)) return undefined;
  if (hasEma) return undefined;
  return sanitizeChartError(rowError);
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

const STATUS_POLL_MS = 180_000;
const QUOTES_POLL_MS = 180_000;
const QUOTES_CHUNK_SIZE = 200;
const RETRY_FAILED_THRESHOLD = 10;
const RETRY_POLL_MS = 180_000;
/** Universe index at/after which symbols use staggered chart fetch + deferred retry. */
const TAIL_SYMBOL_INDEX = 122;
const TAIL_RETRY_POLL_MS = 180_000;
const TAIL_RETRY_MAX_ATTEMPTS = 10;
const CHART_ERROR_RETRY_MS = 180_000;
const CHART_ERROR_RETRY_STAGGER_MS = 5_000;
const CHART_ERROR_MAX_PER_CYCLE = 2;
const NEWS_POLL_MS = Number(process.env.NEXT_PUBLIC_NEWS_POLL_MS ?? 300_000);
const SCAN_POLL_MS = 60_000;
const HEAL_POLL_MS = 300_000;
const COORDINATOR_TICK_MS = 20_000;
const INITIAL_NEWS_DELAY_MS = 20_000;
const INITIAL_QUOTES_DELAY_MS = 15_000;
const INITIAL_HEAL_DELAY_MS = 60_000;
const NEWS_POLL_LABEL_SEC = Math.round(NEWS_POLL_MS / 1000);
const NEWS_FETCH_TIMEOUT_MS = 45_000;
const NEWS_FETCH_RETRIES = 3;
const NEWS_FETCH_RETRY_DELAY_MS = 2_000;

async function fetchJsonWithRetry<T>(
  url: string,
  options: { timeoutMs?: number; retries?: number; retryDelayMs?: number } = {},
): Promise<{ ok: boolean; status: number; body: T; rateLimited?: boolean }> {
  const timeoutMs = options.timeoutMs ?? NEWS_FETCH_TIMEOUT_MS;
  const retries = options.retries ?? NEWS_FETCH_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? NEWS_FETCH_RETRY_DELAY_MS;

  if (isWorkerRateLimited()) {
    return { ok: false, status: 429, body: {} as T, rateLimited: true };
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await clientFetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res) {
        return { ok: false, status: 429, body: {} as T, rateLimited: true };
      }
      const body = (await res.json()) as T;
      return { ok: res.ok, status: res.status, body };
    } catch (err) {
      lastError = err;
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to fetch news");
}

function isTailRow(row: StockScanResult): boolean {
  return row.universeIndex != null && row.universeIndex >= TAIL_SYMBOL_INDEX;
}

function isChartErrorRow(row: StockScanResult): boolean {
  if (!row.error) return false;
  if (isStooqChartError(row.error)) return true;
  if (row.error === "Chart data refresh pending") return true;
  return isTailChartError(row);
}

function isTailChartError(row: StockScanResult): boolean {
  return isTailRow(row) && Boolean(row.error);
}

function countChartErrors(results: StockScanResult[] | undefined): number {
  return results?.filter(isChartErrorRow).length ?? 0;
}

function countTailChartErrors(results: StockScanResult[] | undefined): number {
  return results?.filter(isTailChartError).length ?? 0;
}

function newsHeadlineId(item: NewsHeadline): string {
  return item.url || `${item.symbol}-${item.headline}`;
}

function ScanTableColgroup() {
  return (
    <colgroup>
      <col style={{ width: "36px" }} />
      <col style={{ width: "42px" }} />
      <col style={{ width: "88px" }} />
      <col style={{ width: "200px" }} />
      <col style={{ width: "92px" }} />
      <col style={{ width: "118px" }} />
      <col style={{ width: "138px" }} />
      <col style={{ width: "88px" }} />
      <col style={{ width: "88px" }} />
      <col style={{ width: "96px" }} />
      <col style={{ width: "118px" }} />
      <col style={{ width: "118px" }} />
    </colgroup>
  );
}

function ScanTableHeaderRow({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <tr>
      <th scope="col">#</th>
      <th scope="col" colSpan={2}>
        Symbol
      </th>
      <th scope="col">Name</th>
      <th scope="col">Price</th>
      <th
        scope="col"
        className="sortable"
        onClick={() => onSort("session")}
        aria-sort={ariaSortValue("session", sortKey, sortDir)}
      >
        Session Δ{sortIndicator(sortKey === "session", sortDir)}
      </th>
      <th
        scope="col"
        className="sortable"
        onClick={() => onSort("patterns")}
        aria-sort={ariaSortValue("patterns", sortKey, sortDir)}
      >
        Patterns{sortIndicator(sortKey === "patterns", sortDir)}
      </th>
      <th scope="col">20 EMA (4h)</th>
      <th scope="col">50 EMA (4h)</th>
      <th scope="col">Status (4h)</th>
      <th
        scope="col"
        className="sortable"
        onClick={() => onSort("cross4h")}
        aria-sort={ariaSortValue("cross4h", sortKey, sortDir)}
      >
        Cross 4h{sortIndicator(sortKey === "cross4h", sortDir)}
      </th>
      <th
        scope="col"
        className="sortable"
        onClick={() => onSort("cross1h")}
        aria-sort={ariaSortValue("cross1h", sortKey, sortDir)}
      >
        Cross 1h{sortIndicator(sortKey === "cross1h", sortDir)}
      </th>
    </tr>
  );
}

export default function HomePage() {
  const [data, setData] = useState<CachedScanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [retryingTail, setRetryingTail] = useState(false);
  const [tailRetryAttempts, setTailRetryAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [onlyAbove, setOnlyAbove] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("cross4h");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [quotesLive, setQuotesLive] = useState(false);
  const [quoteDailyBySymbol, setQuoteDailyBySymbol] = useState<
    Map<string, number | null>
  >(() => new Map());
  const [newsHeadlines, setNewsHeadlines] = useState<NewsHeadline[]>([]);
  const [newsSymbolCount, setNewsSymbolCount] = useState(0);
  const [newsLoading, setNewsLoading] = useState(false);
  const [glowingNewsIds, setGlowingNewsIds] = useState<Set<string>>(() => new Set());
  const [selectedNewsArticle, setSelectedNewsArticle] = useState<NewsHeadline | null>(
    null,
  );
  const retryPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tailRetryPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chartErrorRetryPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chartErrorRetryInFlightRef = useRef(false);
  const pageVisibleRef = useRef(true);
  const quoteChunkOffsetRef = useRef(0);
  const seenNewsIdsRef = useRef<Set<string>>(new Set());
  const newsBarRef = useRef<HTMLElement | null>(null);

  const applyScanPayload = useCallback(
    (
      json: CachedScanResponse,
      previous: CachedScanResponse | null,
    ): CachedScanResponse => {
      if (!previous?.results?.length) return json;
      return {
        ...json,
        results: mergeScanResultsPreservingQuotes(previous.results, json.results),
      };
    },
    [],
  );

  const fetchCache = useCallback(async (options?: { quiet?: boolean; heal?: boolean }) => {
    if (isWorkerRateLimited()) {
      const msg = formatRateLimitError();
      setRateLimitMsg(msg);
      if (!options?.quiet) setError(msg);
      return;
    }

    if (!options?.quiet) setLoading(true);
    setError(null);
    setRateLimitMsg(null);

    try {
      const healQuery = options?.heal === true ? "?heal=1" : "";
      const res = await clientFetch(`/api/scan${healQuery}`, { cache: "no-store" });
      if (!res) {
        const msg = formatRateLimitError();
        setRateLimitMsg(msg);
        if (!options?.quiet) setError(msg);
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        noteWorkerRateLimit(res.status, text);
        if (res.status === 429 || text.includes("1027")) {
          const msg = formatRateLimitError();
          setRateLimitMsg(msg);
          if (!options?.quiet) setError(msg);
          return;
        }
        let body: { error?: string } = {};
        try {
          body = JSON.parse(text) as { error?: string };
        } catch {
          // HTML error page
        }
        throw new Error(body.error ?? `Scan table failed (${res.status})`);
      }
      const json = normalizeCachedResponse(
        (await res.json()) as Partial<CachedScanResponse>,
      );
      setData((prev) => applyScanPayload(json, prev));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load scan";
      if (msg.toLowerCase().includes("failed to fetch") && isWorkerRateLimited()) {
        const rateMsg = formatRateLimitError();
        setRateLimitMsg(rateMsg);
        if (!options?.quiet) setError(rateMsg);
      } else {
        setError(msg);
      }
    } finally {
      if (!options?.quiet) setLoading(false);
    }
  }, [applyScanPayload]);

  const triggerRescan = useCallback(async () => {
    setRescanning(true);
    setError(null);
    try {
      const res = await clientFetch("/api/scan?force=true", { cache: "no-store" });
      if (!res) {
        setRateLimitMsg(formatRateLimitError());
        throw new Error(formatRateLimitError());
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Rescan failed (${res.status})`);
      }
      const raw = (await res.json()) as Partial<CachedScanResponse> & {
        message?: string;
      };
      const json = normalizeCachedResponse(raw);
      setData((prev) => {
        if (!json.results?.length && prev?.results?.length) {
          return {
            ...prev,
            scanInProgress: true,
            stale: json.stale ?? prev.stale,
            cacheEmpty: json.cacheEmpty ?? prev.cacheEmpty,
            scanStartedAt: json.scanStartedAt ?? prev.scanStartedAt,
            lastError: json.lastError ?? prev.lastError,
          };
        }
        const next = applyScanPayload(json, prev);
        if (raw.message === "Rescan started" && next) {
          return { ...next, scanInProgress: true };
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rescan failed");
    } finally {
      setRescanning(false);
    }
  }, [applyScanPayload]);

  const retryFailedScan = useCallback(async (options?: { quiet?: boolean }) => {
    if (!pageVisibleRef.current || isWorkerRateLimited()) return;
    if (!options?.quiet) setRetryingFailed(true);
    try {
      const res = await clientFetch("/api/scan/retry-failed", {
        method: "POST",
        cache: "no-store",
      });
      if (!res?.ok) return;

      const json = normalizeCachedResponse(
        (await res.json()) as Partial<CachedScanResponse> & {
          retryableRemaining?: number;
        },
      );
      setData((prev) => applyScanPayload(json, prev));

      const errors = json.results?.filter((r) => r.error).length ?? 0;
      const tailErrors = countTailChartErrors(json.results);
      if (errors <= RETRY_FAILED_THRESHOLD && tailErrors === 0) {
        setRetryingFailed(false);
      }
    } catch {
      // ignore background retry errors
    } finally {
      if (!options?.quiet) setRetryingFailed(false);
    }
  }, [applyScanPayload]);

  const retryTailScan = useCallback(async (options?: { quiet?: boolean }) => {
    if (!pageVisibleRef.current || isWorkerRateLimited()) return;
    if (!options?.quiet) setRetryingTail(true);
    try {
      const res = await clientFetch("/api/scan/retry-tail", {
        method: "POST",
        cache: "no-store",
      });
      if (!res?.ok) return;

      const json = normalizeCachedResponse(
        (await res.json()) as Partial<CachedScanResponse> & {
          tailErrorsRemaining?: number;
        },
      );
      setData((prev) => applyScanPayload(json, prev));
      setTailRetryAttempts((n) => n + 1);

      if ((json as { tailErrorsRemaining?: number }).tailErrorsRemaining === 0) {
        setRetryingTail(false);
      }
    } catch {
      // ignore background tail retry errors
    } finally {
      if (!options?.quiet) setRetryingTail(false);
    }
  }, [applyScanPayload]);

  const pollScanStatus = useCallback(async () => {
    if (!pageVisibleRef.current || isWorkerRateLimited()) return;
    try {
      const res = await clientFetch("/api/scan?status=true", { cache: "no-store" });
      if (!res?.ok) return;

      const status = (await res.json()) as Partial<CachedScanResponse> & {
        scannedAt?: string | null;
      };

      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          stale: status.stale ?? prev.stale,
          scanInProgress: status.scanInProgress ?? prev.scanInProgress,
          cacheEmpty: status.cacheEmpty ?? prev.cacheEmpty,
          scanStartedAt: status.scanStartedAt ?? prev.scanStartedAt,
          lastError: status.lastError ?? prev.lastError,
          staleAfterMinutes: status.staleAfterMinutes ?? prev.staleAfterMinutes,
        };
      });

      // Full cache refresh during scan is handled by SCAN_POLL; only heal stale/empty here.
      if (!status.scanInProgress && (status.stale || status.cacheEmpty)) {
        void fetchCache({ quiet: true });
      }
    } catch {
      // ignore background status poll errors
    }
  }, [fetchCache]);

  const pollNews = useCallback(async (options?: { quiet?: boolean }) => {
    if (!pageVisibleRef.current || isWorkerRateLimited()) {
      setNewsError(formatRateLimitError());
      return;
    }
    if (!options?.quiet) setNewsLoading(true);
    try {
      const { ok, status, body, rateLimited } = await fetchJsonWithRetry<{
        headlines?: NewsHeadline[];
        symbolCount?: number;
        error?: string;
      }>("/api/news");

      if (rateLimited || status === 429) {
        setNewsError(formatRateLimitError());
        return;
      }

      if (!ok) {
        if (newsHeadlines.length === 0) {
          setNewsError(body.error ?? `News failed (${status})`);
        }
        return;
      }

      if (body.error && !(body.headlines?.length)) {
        if (newsHeadlines.length === 0) {
          setNewsError(body.error);
        }
        return;
      }

      setNewsError(null);
      const incoming = body.headlines ?? [];
      const freshIds = incoming
        .map(newsHeadlineId)
        .filter((id) => !seenNewsIdsRef.current.has(id));

      if (seenNewsIdsRef.current.size > 0 && freshIds.length > 0) {
        setGlowingNewsIds(new Set(freshIds));
        setTimeout(() => setGlowingNewsIds(new Set()), 1800);
      }

      for (const id of incoming.map(newsHeadlineId)) {
        seenNewsIdsRef.current.add(id);
      }

      setNewsHeadlines(incoming);
      setNewsSymbolCount(body.symbolCount ?? 0);
    } catch (err) {
      if (newsHeadlines.length === 0) {
        const msg = err instanceof Error ? err.message : "Failed to fetch news";
        setNewsError(
          isWorkerRateLimited() || msg.toLowerCase().includes("failed to fetch")
            ? formatRateLimitError()
            : msg,
        );
      }
    } finally {
      if (!options?.quiet) setNewsLoading(false);
    }
  }, [newsHeadlines.length]);

  const applyQuotePayload = useCallback(
    (
      quotes: Array<{
        symbol: string;
        price: number | null;
        dailyChange: number | null;
        preMarketChange: number | null;
        regularMarketChange: number | null;
        postMarketChange: number | null;
      }>,
    ) => {
      if (!quotes.length) return;

      setQuotesLive(true);
      setQuoteDailyBySymbol((prev) => {
        const next = new Map(prev);
        for (const quote of quotes) {
          next.set(quote.symbol, quote.dailyChange);
        }
        return next;
      });
      setData((prev) => {
        if (!prev?.results?.length) return prev;
        return {
          ...prev,
          results: applyQuoteUpdates(prev.results, quotes),
        };
      });
    },
    [],
  );

  const pollQuotes = useCallback(async () => {
    if (!pageVisibleRef.current || isWorkerRateLimited()) return;
    try {
      const totalSymbols = data?.results?.length ?? 0;
      if (totalSymbols === 0) return;

      const offset = quoteChunkOffsetRef.current % totalSymbols;
      const res = await clientFetch(
        `/api/quotes?offset=${offset}&limit=${QUOTES_CHUNK_SIZE}`,
        { cache: "no-store" },
      );
      if (!res?.ok) return;

      const body = (await res.json()) as {
        quotes?: Array<{
          symbol: string;
          price: number | null;
          dailyChange: number | null;
          preMarketChange: number | null;
          regularMarketChange: number | null;
          postMarketChange: number | null;
        }>;
        totalSymbols?: number;
      };

      if (!body.quotes?.length) return;

      quoteChunkOffsetRef.current =
        (offset + body.quotes.length) % (body.totalSymbols ?? totalSymbols);

      applyQuotePayload(body.quotes);
    } catch {
      // ignore background quote poll errors
    }
  }, [applyQuotePayload, data?.results?.length]);

  const primeAllQuotes = useCallback(async () => {
    if (!pageVisibleRef.current || isWorkerRateLimited()) return;
    try {
      const res = await clientFetch(`/api/quotes?limit=500`, { cache: "no-store" });
      if (!res?.ok) return;

      const body = (await res.json()) as {
        quotes?: Array<{
          symbol: string;
          price: number | null;
          dailyChange: number | null;
          preMarketChange: number | null;
          regularMarketChange: number | null;
          postMarketChange: number | null;
        }>;
      };

      applyQuotePayload(body.quotes ?? []);
    } catch {
      // ignore quote priming errors
    }
  }, [applyQuotePayload]);

  const retryChartErrorSymbols = useCallback(async () => {
    if (chartErrorRetryInFlightRef.current || !pageVisibleRef.current || isWorkerRateLimited()) return;

    const errorRows =
      data?.results?.filter(isChartErrorRow) ?? [];
    if (errorRows.length === 0) return;

    chartErrorRetryInFlightRef.current = true;
    try {
      const staleFirst = [...errorRows].sort((a, b) => {
        const aStale = isStooqChartError(a.error) ? 0 : 1;
        const bStale = isStooqChartError(b.error) ? 0 : 1;
        return aStale - bStale;
      }).slice(0, CHART_ERROR_MAX_PER_CYCLE);

      for (let i = 0; i < staleFirst.length; i += 1) {
        if (isWorkerRateLimited()) break;
        if (i > 0) await new Promise((r) => setTimeout(r, CHART_ERROR_RETRY_STAGGER_MS));

        const row = staleFirst[i];
        const res = await clientFetch(
          `/api/scan/symbol?symbol=${encodeURIComponent(row.symbol)}`,
          { cache: "no-store" },
        );
        if (!res?.ok) continue;

        const body = (await res.json()) as { result?: StockScanResult };
        if (!body.result) continue;

        setData((prev) => {
          if (!prev?.results?.length) return prev;
          return {
            ...prev,
            results: mergeScanResultIntoRows(prev.results, body.result!),
          };
        });
      }
    } catch {
      // ignore background chart error retries
    } finally {
      chartErrorRetryInFlightRef.current = false;
    }
  }, [data?.results]);

  useEffect(() => {
    hydrateRateLimitFromStorage();
    if (isWorkerRateLimited()) {
      setRateLimitMsg(formatRateLimitError());
      setLoading(false);
      return;
    }
    void fetchCache();
  }, [fetchCache]);

  useEffect(() => {
    const onVisibility = () => {
      pageVisibleRef.current = !document.hidden;
    };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const tick = () => {
      setRateLimitMsg(isWorkerRateLimited() ? formatRateLimitError() : null);
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const coordinator = createPollCoordinator({
      tickMs: COORDINATOR_TICK_MS,
      isPaused: () => !pageVisibleRef.current || isWorkerRateLimited(),
    });

    coordinator.register({
      name: "scan-progress",
      intervalMs: SCAN_POLL_MS,
      enabled: () => Boolean(data?.scanInProgress),
      run: () => fetchCache({ quiet: true }),
    });
    coordinator.register({
      name: "status",
      intervalMs: STATUS_POLL_MS,
      enabled: () => Boolean(data),
      run: () => pollScanStatus(),
    });
    coordinator.register({
      name: "quotes",
      intervalMs: QUOTES_POLL_MS,
      enabled: () => Boolean(data && !data.cacheEmpty),
      run: () => pollQuotes(),
    });
    coordinator.register({
      name: "news",
      intervalMs: NEWS_POLL_MS,
      run: () => pollNews({ quiet: true }),
    });
    coordinator.register({
      name: "heal",
      intervalMs: HEAL_POLL_MS,
      enabled: () =>
        Boolean(
          data &&
            (data.cacheEmpty || (data.unscannedCount ?? 0) > 0),
        ),
      run: () => fetchCache({ quiet: true, heal: true }),
    });

    const boot = setTimeout(() => {
      coordinator.start();
      if (data && !data.cacheEmpty) {
        setTimeout(() => void pollQuotes(), INITIAL_QUOTES_DELAY_MS);
        setTimeout(() => void primeAllQuotes(), INITIAL_QUOTES_DELAY_MS);
      }
      setTimeout(() => void pollNews(), INITIAL_NEWS_DELAY_MS);
      if (
        data &&
        (data.cacheEmpty || (data.unscannedCount ?? 0) > 0)
      ) {
        setTimeout(
          () => void fetchCache({ quiet: true, heal: true }),
          INITIAL_HEAL_DELAY_MS,
        );
      }
    }, 2_000);

    return () => {
      clearTimeout(boot);
      coordinator.stop();
    };
  }, [
    data?.cacheEmpty,
    data?.scanInProgress,
    data?.unscannedCount,
    fetchCache,
    pollNews,
    pollQuotes,
    pollScanStatus,
    primeAllQuotes,
  ]);

  const errorCount = useMemo(
    () => data?.results?.filter((r) => r.error).length ?? 0,
    [data?.results],
  );

  const tailErrorCount = useMemo(
    () => countTailChartErrors(data?.results),
    [data?.results],
  );

  const unscannedCount = useMemo(
    () =>
      data?.unscannedCount ??
      data?.results?.filter((r) => r.error === "Not scanned yet").length ??
      0,
    [data?.results, data?.unscannedCount],
  );

  const shouldRetryFailed =
    (errorCount > RETRY_FAILED_THRESHOLD ||
      tailErrorCount > 0 ||
      unscannedCount > 0) &&
    tailErrorCount === 0;

  const shouldRetryTail =
    tailErrorCount > 0 &&
    tailRetryAttempts < TAIL_RETRY_MAX_ATTEMPTS &&
    !data?.scanInProgress;

  useEffect(() => {
    if (retryPollRef.current) clearInterval(retryPollRef.current);
    if (!data || data.cacheEmpty || data.scanInProgress) return;
    if (!shouldRetryFailed) {
      setRetryingFailed(false);
      return;
    }

    setRetryingFailed(true);
    void retryFailedScan({ quiet: true });
    retryPollRef.current = setInterval(() => {
      void retryFailedScan({ quiet: true });
    }, RETRY_POLL_MS);

    return () => {
      if (retryPollRef.current) clearInterval(retryPollRef.current);
    };
  }, [data?.cacheEmpty, data?.scanInProgress, shouldRetryFailed, retryFailedScan]);

  useEffect(() => {
    if (tailRetryPollRef.current) clearInterval(tailRetryPollRef.current);
    if (!data || data.cacheEmpty || data.scanInProgress) return;
    if (!shouldRetryTail) {
      setRetryingTail(false);
      return;
    }

    setRetryingTail(true);
    void retryTailScan({ quiet: true });
    tailRetryPollRef.current = setInterval(() => {
      void retryTailScan({ quiet: true });
    }, TAIL_RETRY_POLL_MS);

    return () => {
      if (tailRetryPollRef.current) clearInterval(tailRetryPollRef.current);
    };
  }, [
    data?.cacheEmpty,
    data?.scanInProgress,
    shouldRetryTail,
    retryTailScan,
  ]);

  const chartErrorCount = useMemo(
    () => countChartErrors(data?.results),
    [data?.results],
  );

  const shouldRetryChartErrors =
    chartErrorCount > 0 && !data?.scanInProgress;

  useEffect(() => {
    if (chartErrorRetryPollRef.current) clearInterval(chartErrorRetryPollRef.current);
    if (!data || data.cacheEmpty || data.scanInProgress) return;
    if (!shouldRetryChartErrors) return;

    void retryChartErrorSymbols();
    chartErrorRetryPollRef.current = setInterval(() => {
      void retryChartErrorSymbols();
    }, CHART_ERROR_RETRY_MS);

    return () => {
      if (chartErrorRetryPollRef.current) clearInterval(chartErrorRetryPollRef.current);
    };
  }, [
    data?.cacheEmpty,
    data?.scanInProgress,
    shouldRetryChartErrors,
    retryChartErrorSymbols,
  ]);

  useLayoutEffect(() => {
    const el = newsBarRef.current;
    if (!el) return;

    const setNewsHeight = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty(
        "--news-bar-height",
        `${height}px`,
      );
    };

    setNewsHeight();
    const observer = new ResizeObserver(setNewsHeight);
    observer.observe(el);
    window.addEventListener("resize", setNewsHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", setNewsHeight);
    };
  }, [newsHeadlines.length, newsLoading]);

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
        const sessionVal = (row: StockScanResult) =>
          dailyChangeForScanRow(row, quoteDailyBySymbol.get(row.symbol));
        const aVal = sessionVal(a);
        const bVal = sessionVal(b);
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
  }, [filteredResults, sortKey, sortDir, quoteDailyBySymbol]);

  const dailyChangeBySymbol = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const row of data?.results ?? []) {
      map.set(
        row.symbol,
        dailyChangeForScanRow(row, quoteDailyBySymbol.get(row.symbol)),
      );
    }
    return map;
  }, [data?.results, quoteDailyBySymbol]);

  const tradingViewUrlBySymbol = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of data?.results ?? []) {
      if (row.tradingViewUrl) map.set(row.symbol, row.tradingViewUrl);
    }
    return map;
  }, [data?.results]);

  const stats = useMemo(() => {
    const rows = filteredResults;
    return {
      above: rows.filter((r) => r.ema20Above50 && !r.error).length,
      withCross1h: rows.filter((r) => hasCrossover(r.cross1h)).length,
      withCross4h: rows.filter((r) => hasCrossover(r.cross4h)).length,
      errors: rows.filter((r) => r.error).length,
      total: data?.symbolCount ?? rows.length,
    };
  }, [filteredResults, data]);

  const showEmptyState = !loading && data?.cacheEmpty && !data?.scanInProgress;
  const showScanningState =
    !loading &&
    sortedResults.length === 0 &&
    (data?.scanInProgress || (data?.cacheEmpty && !showEmptyState));

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
          EMA crossovers and patterns come from a server scan (minutes to refresh).
          Price and session % update live via lightweight quote polling.
        </p>
      </header>

      {unscannedCount > 0 && (
        <div className="card mb-4 border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-4 py-3 text-sm text-[var(--text)]">
          Scanning {unscannedCount} remaining symbol{unscannedCount === 1 ? "" : "s"}…
          Cross and pattern columns fill in as each batch completes.
        </div>
      )}

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
              Server scan merges built-in blue chips (~190) with{" "}
              <code className="mono">TRADINGVIEW_WATCHLIST_URL</code> and optional{" "}
              <code className="mono">WATCHLIST_SYMBOLS</code>.
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

      {((rateLimitMsg ?? error)) && (
        <div
          className={`card mb-6 p-4 ${
            rateLimitMsg
              ? "border-[var(--amber)] text-[var(--amber)]"
              : "border-[var(--red)] text-[var(--red)]"
          }`}
        >
          {rateLimitMsg ?? error}
        </div>
      )}

      {retryingTail && !data?.scanInProgress && tailErrorCount > 0 && (
        <div className="card mb-6 border-[var(--accent)] p-4 text-sm text-[var(--accent)]">
          Refreshing chart data for symbols {TAIL_SYMBOL_INDEX + 1}+… ({tailErrorCount}{" "}
          remaining
          {tailRetryAttempts > 0
            ? ` · attempt ${tailRetryAttempts}/${TAIL_RETRY_MAX_ATTEMPTS}`
            : ""}
          )
        </div>
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
          <span className="text-[var(--muted)]">Scan data</span>{" "}
          <span className="font-semibold">
            {formatScanDataAge(data?.scannedAt ?? null)}
          </span>
          {data?.stale && !data.scanInProgress && (
            <span className="ml-2 text-[var(--amber)]">stale</span>
          )}
          {data?.scanInProgress && (
            <span className="ml-2 text-[var(--accent)]">Updating…</span>
          )}
          {retryingTail && !data?.scanInProgress && tailErrorCount > 0 && (
            <span className="ml-2 text-[var(--accent)]">
              · Refreshing symbols {TAIL_SYMBOL_INDEX + 1}+…
            </span>
          )}
          {retryingFailed && !data?.scanInProgress && !retryingTail && (
            <span className="ml-2 text-[var(--accent)]">· Retrying failed symbols…</span>
          )}
          {quotesLive && !data?.cacheEmpty && (
            <span className="ml-2 text-[var(--green)]">· Prices updating live</span>
          )}
        </div>
      </section>

      <section ref={newsBarRef} className="sticky-news-bar card mb-4 p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-[var(--text)]">
            News · Recent EMA crosses (1h/4h)
          </h2>
          <span className="text-xs text-[var(--muted)]">
            {newsError
              ? newsError
              : newsLoading && newsHeadlines.length === 0
              ? "Loading headlines…"
              : newsSymbolCount > 0
                ? `${newsSymbolCount} crossed symbols · ${newsHeadlines.length} headlines · refreshes every ~${NEWS_POLL_LABEL_SEC}s`
                : "No qualifying crosses yet"}
          </span>
        </div>
        {newsHeadlines.length > 0 ? (
          <div className="news-row">
            {newsHeadlines.map((item) => {
              const headlineId = newsHeadlineId(item);
              const isNew = glowingNewsIds.has(headlineId);
              const dailyChange =
                dailyChangeBySymbol.get(item.symbol) ?? item.dailyChange;

              return (
                <button
                  key={headlineId}
                  type="button"
                  className={`news-chip${isNew ? " news-chip-new" : ""}`}
                  onMouseEnter={() => prefetchNewsPreview(item.url)}
                  onFocus={() => prefetchNewsPreview(item.url)}
                  onClick={() =>
                    setSelectedNewsArticle({
                      ...item,
                      dailyChange:
                        dailyChangeBySymbol.get(item.symbol) ?? item.dailyChange,
                      tradingViewUrl:
                        item.tradingViewUrl ??
                        tradingViewUrlBySymbol.get(item.symbol),
                    })
                  }
                >
                  <div className="news-chip-ticker">
                    <span>{item.displayTicker}</span>
                    {dailyChange != null && (
                      <span
                        className={`news-chip-change ${changeColorClass(dailyChange)}`}
                      >
                        {formatSessionChange(dailyChange)}
                      </span>
                    )}
                  </div>
                  <div className="news-chip-headline">{item.headline}</div>
                  <div className="news-chip-meta">
                    {item.timeAgo} · {item.publisher}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Headlines appear when symbols have 20 &gt; 50 on 4h and a recent bullish
            1h or 4h crossover.
          </p>
        )}
      </section>

      <section className="card scan-table-card">
        <div className="scan-table-sticky-head">
          <table className="scan-table">
            <ScanTableColgroup />
            <thead className="scan-table-head">
              <ScanTableHeaderRow
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
            </thead>
          </table>
        </div>
        <table className="scan-table scan-table-body">
          <ScanTableColgroup />
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
              ) : showScanningState ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-[var(--muted)]">
                    {data?.lastError
                      ? `${data.lastError} — scanning…`
                      : "Scan in progress — results will appear as symbols complete."}
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
                  const ticker = stripDisplayTicker(
                    row.displayTicker ?? row.symbol ?? "—",
                  );

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
                            yahooSymbol={row.symbol}
                            companyName={row.name}
                            logoUrl={row.logoUrl}
                          />
                          <span>{ticker}</span>
                        </a>
                      </td>
                      <td className="max-w-[220px] truncate text-[var(--muted)]">
                        {row.name ?? "—"}
                      </td>
                      <td className="mono">{formatPrice(row.price)}</td>
                      <td>
                        <SessionChangesCell
                          row={row}
                          dailyChange={dailyChangeBySymbol.get(row.symbol)}
                        />
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
                        <CrossoverCell
                          cross={cross4h}
                          error={crossoverCellError(cross4h, row.error, row.ema20 != null)}
                        />
                      </td>
                      <td>
                        <CrossoverCell
                          cross={cross1h}
                          error={crossoverCellError(cross1h, row.error, row.ema20 != null)}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
          </tbody>
        </table>
      </section>

      <NewsArticleModal
        article={selectedNewsArticle}
        onClose={() => setSelectedNewsArticle(null)}
      />

      <footer className="mt-8 text-xs text-[var(--muted)]">
        Price data via Yahoo Finance (1h bars, aggregated to 4h). Pattern labels are
        algorithmic approximations on 1h/4h bars (40-day window) — confirmed Active
        patterns require neckline break; not TradingView auto-chart-patterns. Full
        EMA/pattern rescans take several minutes; prices and session % refresh every
        ~2 min. When scan data is older than 15 min use Rescan now or wait for
        nightly cron (Cloudflare runs chunked scans). Tick-by-tick live data would need a
        different architecture. Cross requires 20 EMA to cross below 50 before crossing
        back above. Not financial advice.
      </footer>
    </main>
  );
}
