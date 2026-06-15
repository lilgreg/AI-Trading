export interface StockScanResult {
  symbol: string;
  displaySymbol: string;
  name: string | null;
  exchange: string | null;
  price: number | null;
  ema20: number | null;
  ema50: number | null;
  ema20Above50: boolean;
  crossoverDate: string | null;
  crossoverDaysAgo: number | null;
  tradingViewUrl: string;
  error?: string;
}

export interface ScanResponse {
  scannedAt: string;
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
