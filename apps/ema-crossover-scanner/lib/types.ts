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
  inverseHeadShoulders: PatternDetection;
}

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
  /** Recent chart patterns on 1h / 4h bars (40-day window) */
  patterns: SymbolPatterns;
  ema20: number | null;
  ema50: number | null;
  ema20Above50: boolean;
  crossoverDate: string | null;
  crossoverTime: string | null;
  crossoverMsAgo: number | null;
  crossoverDaysAgo: number | null;
  tradingViewUrl: string;
  error?: string;
}

export interface ScanResponse {
  scannedAt: string;
  interval: "1h" | "4h";
  symbolCount: number;
  results: StockScanResult[];
  sources: {
    blueChips: boolean;
    watchlist: boolean;
    custom: boolean;
    tradingViewWatchlist: boolean;
  };
  tradingViewWatchlistName?: string;
}

export interface ParsedSymbol {
  raw: string;
  yahoo: string;
  display: string;
  exchange: string | null;
}
