export type PatternStatus = "Active" | "Failed" | "Target" | "None";
export type PatternTimeframe = "1h" | "4h" | "1h+4h" | "None";

export interface PatternDetection {
  status: PatternStatus;
  timeframes: PatternTimeframe;
  confirmMsAgo: number | null;
  /** Present when API called with ?debug=true */
  debug?: {
    support?: number;
    neckline?: number;
    target?: number;
    confirmDate?: string;
    patternAgeDays?: number;
    status1h?: PatternStatus;
    status4h?: PatternStatus;
  };
}

export interface SymbolPatterns {
  doubleBottom: PatternDetection;
  doubleTop: PatternDetection;
  headShoulders: PatternDetection;
  inverseHeadShoulders: PatternDetection;
}

export const NONE_PATTERN: PatternDetection = {
  status: "None",
  timeframes: "None",
  confirmMsAgo: null,
};

export const NONE_PATTERNS: SymbolPatterns = {
  doubleBottom: NONE_PATTERN,
  doubleTop: NONE_PATTERN,
  headShoulders: NONE_PATTERN,
  inverseHeadShoulders: NONE_PATTERN,
};

export interface CrossoverDisplay {
  /** ISO 8601 — format in browser for viewer local timezone */
  crossoverAt: string | null;
  /** @deprecated Use crossoverAt formatted client-side */
  crossoverDate: string | null;
  /** @deprecated Use crossoverAt formatted client-side */
  crossoverTime: string | null;
  crossoverMsAgo: number | null;
}

export const EMPTY_CROSSOVER: CrossoverDisplay = {
  crossoverAt: null,
  crossoverDate: null,
  crossoverTime: null,
  crossoverMsAgo: null,
};

export interface StockScanResult {
  symbol: string;
  /** Ticker only for UI (e.g. JNJ) */
  displayTicker: string;
  /** Full TradingView symbol (e.g. NYSE:JNJ) */
  displaySymbol: string;
  tradingViewSymbol: string;
  name: string | null;
  exchange: string | null;
  price: number | null;
  /** Pre-market % change vs previous close (Yahoo quote) */
  preMarketChange: number | null;
  /** Regular session % change vs previous close (Yahoo quote) */
  regularMarketChange: number | null;
  /** After-hours % change vs regular close (Yahoo quote) */
  postMarketChange: number | null;
  /** ET date (YYYY-MM-DD) when session % were last captured for overnight display */
  sessionSnapshotDate?: string | null;
  /** Recent chart patterns on 1h / 4h bars (40-day window) */
  patterns: SymbolPatterns;
  /** 4h 20/50 EMA values (status column reference timeframe) */
  ema20: number | null;
  ema50: number | null;
  ema20Above50: boolean;
  /** Most recent bullish 20/50 cross on 1h bars */
  cross1h: CrossoverDisplay;
  /** Most recent bullish 20/50 cross on 4h bars */
  cross4h: CrossoverDisplay;
  tradingViewUrl: string;
  /** Resolved logo CDN URL from scan (client may still fall back on error). */
  logoUrl?: string | null;
  /** Hourly bar provider used for this scan (yahoo-v8, yahoo-spark, finnhub, etc.). */
  dataSource?: string | null;
  /** Position in the configured symbol universe (0-based). */
  universeIndex?: number;
  error?: string;
}

export interface ScanMeta {
  scannedAt: string;
  symbolCount: number;
  sources: {
    blueChips: boolean;
    watchlist: boolean;
    custom: boolean;
    tradingViewWatchlist: boolean;
  };
  tradingViewWatchlistName?: string;
}

export interface ScanResponse extends ScanMeta {
  results: StockScanResult[];
}

export interface ScanCacheStatus {
  stale: boolean;
  scanInProgress: boolean;
  cacheEmpty: boolean;
  staleAfterMinutes: number;
  lastError: string | null;
  scanStartedAt: string | null;
}

export interface CachedScanResponse extends ScanResponse, ScanCacheStatus {
  scanComplete?: boolean;
  retryableCount?: number;
  unscannedCount?: number;
}

export interface ScanSnapshot extends ScanResponse {
  /** ISO timestamp when scan finished writing to cache */
  completedAt: string;
  /** Hash of scan config — invalidates cache when env changes */
  configKey: string;
  /** False while a multi-invocation scan is still in progress */
  scanComplete?: boolean;
  /** ISO timestamp of the most recent partial or final write */
  lastSavedAt?: string;
}

export interface ParsedSymbol {
  raw: string;
  yahoo: string;
  display: string;
  exchange: string | null;
}
