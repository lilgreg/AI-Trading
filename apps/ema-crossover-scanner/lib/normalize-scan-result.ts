import type {
  CachedScanResponse,
  CrossoverDisplay,
  PatternDetection,
  StockScanResult,
  SymbolPatterns,
} from "./types";
import { EMPTY_CROSSOVER, NONE_PATTERNS } from "./types";

function normalizePattern(value: PatternDetection | undefined): PatternDetection {
  if (!value || typeof value.status !== "string") {
    return NONE_PATTERNS.doubleBottom;
  }
  return {
    status: value.status,
    timeframes: value.timeframes ?? "None",
    confirmMsAgo: value.confirmMsAgo ?? null,
    debug: value.debug,
  };
}

export function normalizePatterns(
  patterns: Partial<SymbolPatterns> | undefined | null,
): SymbolPatterns {
  if (!patterns) return { ...NONE_PATTERNS };

  return {
    doubleBottom: normalizePattern(patterns.doubleBottom),
    doubleTop: normalizePattern(patterns.doubleTop),
    headShoulders: normalizePattern(patterns.headShoulders),
    inverseHeadShoulders: normalizePattern(patterns.inverseHeadShoulders),
  };
}

export function normalizeCrossover(
  cross: Partial<CrossoverDisplay> | undefined | null,
): CrossoverDisplay {
  if (!cross) return { ...EMPTY_CROSSOVER };

  return {
    crossoverAt: cross.crossoverAt ?? null,
    crossoverDate: cross.crossoverDate ?? null,
    crossoverTime: cross.crossoverTime ?? null,
    crossoverMsAgo: cross.crossoverMsAgo ?? null,
  };
}

type LegacyScanRow = StockScanResult & {
  cross?: Partial<CrossoverDisplay> | null;
};

/** Backfill fields missing from older cached snapshots. */
export function normalizeScanResult(row: LegacyScanRow): StockScanResult {
  const legacyCross = row.cross;

  return {
    symbol: row.symbol ?? "UNKNOWN",
    displayTicker: row.displayTicker ?? row.symbol ?? "—",
    displaySymbol: row.displaySymbol ?? row.symbol ?? "—",
    tradingViewSymbol: row.tradingViewSymbol ?? row.displaySymbol ?? row.symbol ?? "—",
    name: row.name ?? null,
    exchange: row.exchange ?? null,
    price: row.price ?? null,
    preMarketChange: row.preMarketChange ?? null,
    regularMarketChange: row.regularMarketChange ?? null,
    postMarketChange: row.postMarketChange ?? null,
    patterns: normalizePatterns(row.patterns),
    ema20: row.ema20 ?? null,
    ema50: row.ema50 ?? null,
    ema20Above50: Boolean(row.ema20Above50),
    cross1h: normalizeCrossover(row.cross1h ?? legacyCross),
    cross4h: normalizeCrossover(row.cross4h ?? legacyCross),
    tradingViewUrl: row.tradingViewUrl ?? "#",
    error: row.error,
  };
}

export function normalizeCachedResponse(
  payload: Partial<CachedScanResponse> | null | undefined,
): CachedScanResponse {
  const results = Array.isArray(payload?.results) ? payload.results : [];

  return {
    scannedAt: payload?.scannedAt ?? new Date(0).toISOString(),
    symbolCount: payload?.symbolCount ?? results.length,
    results: results.map((row) => normalizeScanResult(row as LegacyScanRow)),
    sources: payload?.sources ?? {
      blueChips: false,
      watchlist: false,
      custom: false,
      tradingViewWatchlist: false,
    },
    tradingViewWatchlistName: payload?.tradingViewWatchlistName,
    stale: payload?.stale ?? true,
    scanInProgress: payload?.scanInProgress ?? false,
    cacheEmpty: payload?.cacheEmpty ?? results.length === 0,
    staleAfterMinutes: payload?.staleAfterMinutes ?? 15,
    lastError: payload?.lastError ?? null,
    scanStartedAt: payload?.scanStartedAt ?? null,
  };
}
