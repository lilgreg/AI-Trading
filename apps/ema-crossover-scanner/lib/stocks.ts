import type { ScanInterval } from "./intervals";
import { tradingViewIntervalParam } from "./intervals";
import type { ParsedSymbol } from "./types";

/**
 * Default large-cap / blue-chip universe (190 symbols, deduped).
 * Sources: Dow 30 (2024–2025), S&P 100 / largest S&P 500 names, major sector
 * leaders (tech, finance, healthcare, energy, consumer, industrials, materials,
 * REITs, telecom, utilities). Tickers use Yahoo format (e.g. BRK-B).
 * Merged with TRADINGVIEW_WATCHLIST_URL in buildSymbolUniverse (deduped).
 */
export const BLUE_CHIP_SYMBOLS = [
  "A",
  "AAPL",
  "ABBV",
  "ABT",
  "ACN",
  "ADBE",
  "ADI",
  "ADSK",
  "AEP",
  "AIG",
  "AMAT",
  "AMD",
  "AMGN",
  "AMT",
  "AMZN",
  "AON",
  "APD",
  "AVGO",
  "AXP",
  "AZO",
  "BA",
  "BAC",
  "BIIB",
  "BK",
  "BLK",
  "BMY",
  "BRK-B",
  "BSX",
  "C",
  "CAT",
  "CB",
  "CCI",
  "CDNS",
  "CI",
  "CL",
  "CMCSA",
  "CMG",
  "COF",
  "COP",
  "COST",
  "CRM",
  "CRWD",
  "CSCO",
  "CSX",
  "CVS",
  "CVX",
  "D",
  "DD",
  "DE",
  "DELL",
  "DHR",
  "DIS",
  "DOW",
  "DUK",
  "DVN",
  "DXCM",
  "EA",
  "ECL",
  "EL",
  "ELV",
  "EMR",
  "EOG",
  "EQIX",
  "ETN",
  "EW",
  "EXC",
  "FANG",
  "FCX",
  "FDX",
  "FTNT",
  "GD",
  "GE",
  "GILD",
  "GIS",
  "GOOG",
  "GOOGL",
  "GS",
  "HAL",
  "HD",
  "HON",
  "HPQ",
  "HUM",
  "IBM",
  "ICE",
  "IDXX",
  "INTC",
  "INTU",
  "ISRG",
  "ITW",
  "JNJ",
  "JPM",
  "K",
  "KLAC",
  "KO",
  "LIN",
  "LLY",
  "LMT",
  "LOW",
  "LRCX",
  "LVS",
  "MA",
  "MCD",
  "MCK",
  "MCO",
  "MDT",
  "MET",
  "META",
  "MLM",
  "MMC",
  "MMM",
  "MO",
  "MPC",
  "MRK",
  "MS",
  "MSFT",
  "MU",
  "MRVL",
  "NEE",
  "NEM",
  "NFLX",
  "NKE",
  "NOC",
  "NOW",
  "NSC",
  "NUE",
  "NVDA",
  "NXPI",
  "O",
  "ON",
  "ORCL",
  "ORLY",
  "OXY",
  "PANW",
  "PARA",
  "PCAR",
  "PEP",
  "PFE",
  "PG",
  "PGR",
  "PH",
  "PLD",
  "PLTR",
  "PM",
  "PNC",
  "PSA",
  "PSX",
  "QCOM",
  "REGN",
  "RMD",
  "ROK",
  "ROST",
  "RTX",
  "SBUX",
  "SCHW",
  "SHW",
  "SLB",
  "SNOW",
  "SNPS",
  "SO",
  "SPG",
  "STM",
  "SYK",
  "T",
  "TGT",
  "TJX",
  "TMO",
  "TMUS",
  "TRV",
  "TTWO",
  "TXN",
  "UNH",
  "UNP",
  "UPS",
  "USB",
  "V",
  "VLO",
  "VMC",
  "VRTX",
  "VZ",
  "WBD",
  "WDAY",
  "WELL",
  "WFC",
  "WM",
  "WMB",
  "WMT",
  "XOM",
  "YUM",
  "ZBH",
  "ZTS",
] as const;

/** NYSE-listed tickers in BLUE_CHIP_SYMBOLS (others default NASDAQ). */
const NYSE_SYMBOLS = new Set([
  "A",
  "ABBV",
  "ABT",
  "AIG",
  "AMGN",
  "AMT",
  "AON",
  "APD",
  "AXP",
  "BA",
  "BAC",
  "BIIB",
  "BK",
  "BLK",
  "BMY",
  "BSX",
  "C",
  "CAT",
  "CB",
  "CCI",
  "CI",
  "CL",
  "CMG",
  "COF",
  "COP",
  "CRM",
  "CSCO",
  "CSX",
  "CVS",
  "CVX",
  "D",
  "DD",
  "DE",
  "DELL",
  "DHR",
  "DIS",
  "DOW",
  "DUK",
  "DVN",
  "DXCM",
  "EA",
  "ECL",
  "EL",
  "ELV",
  "EMR",
  "EOG",
  "EQIX",
  "ETN",
  "EW",
  "EXC",
  "FANG",
  "FCX",
  "FDX",
  "GD",
  "GE",
  "GILD",
  "GIS",
  "GS",
  "HAL",
  "HD",
  "HON",
  "HPQ",
  "HUM",
  "IBM",
  "ICE",
  "IDXX",
  "ITW",
  "JNJ",
  "JPM",
  "K",
  "KO",
  "LIN",
  "LLY",
  "LMT",
  "LOW",
  "LVS",
  "MA",
  "MCD",
  "MCK",
  "MCO",
  "MDT",
  "MET",
  "MLM",
  "MMC",
  "MMM",
  "MO",
  "MPC",
  "MRK",
  "MS",
  "NEE",
  "NEM",
  "NKE",
  "NOC",
  "NSC",
  "NUE",
  "O",
  "ORCL",
  "ORLY",
  "OXY",
  "PANW",
  "PARA",
  "PCAR",
  "PEP",
  "PFE",
  "PG",
  "PGR",
  "PH",
  "PLD",
  "PM",
  "PNC",
  "PSA",
  "PSX",
  "QCOM",
  "REGN",
  "RMD",
  "ROK",
  "ROST",
  "RTX",
  "SBUX",
  "SHW",
  "SLB",
  "SO",
  "SPG",
  "STM",
  "SYK",
  "T",
  "TGT",
  "TJX",
  "TMO",
  "TRV",
  "TTWO",
  "TXN",
  "UNH",
  "UNP",
  "UPS",
  "USB",
  "V",
  "VLO",
  "VMC",
  "VRTX",
  "VZ",
  "WBD",
  "WELL",
  "WFC",
  "WM",
  "WMB",
  "WMT",
  "XOM",
  "YUM",
  "ZBH",
  "ZTS",
]);

/** Delisted / unfixable tickers — excluded from universe scans. */
export const EXCLUDED_SYMBOLS = new Set([
  "AADX",
  "FJTSF",
  "HES",
  "HOCPF",
  "IPG",
  "K",
  "MMC",
  "PARA",
  "RDFN",
  "RYDAF",
  "TRLV",
  "VLKPF",
  "VSXY",
]);

export function isExcludedSymbol(yahoo: string): boolean {
  return EXCLUDED_SYMBOLS.has(yahoo.toUpperCase());
}

/** TradingView exchange prefix for tickers that need explicit mapping */
const TICKER_EXCHANGE: Record<string, string> = {
  "BRK-B": "NYSE",
};

/** Yahoo Finance tickers for indices / volatility products (TV ticker → Yahoo). */
const YAHOO_CHART_SYMBOL_OVERRIDES: Record<string, string> = {
  VIX: "^VIX",
  VVIX: "^VVIX",
  BTCUSD: "BTC-USD",
  ETHUSD: "ETH-USD",
  DJIA: "^DJI",
  DJI: "^DJI",
  SPX: "^GSPC",
  GSPC: "^GSPC",
  NDX: "^NDX",
  RUT: "^RUT",
  IXIC: "^IXIC",
  COMP: "^IXIC",
};

/** Strip exchange prefix and uppercase for UI display (CBOE:VIX → VIX). */
export function stripDisplayTicker(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const ticker = trimmed.includes(":") ? trimmed.split(":").pop()! : trimmed;
  return ticker.toUpperCase();
}

/** Map display/Yahoo tickers to Yahoo chart/quote symbols (VIX → ^VIX). */
export function resolveYahooChartSymbol(symbol: string): string {
  const base = stripDisplayTicker(symbol);
  return YAHOO_CHART_SYMBOL_OVERRIDES[base] ?? base;
}

const YAHOO_TO_TV_EXCHANGE: Record<string, string> = {
  NMS: "NASDAQ",
  NGM: "NASDAQ",
  NCM: "NASDAQ",
  NYQ: "NYSE",
  PCX: "AMEX",
  BTS: "CBOE",
};

export function yahooExchangeToTradingView(code: string | null | undefined): string | null {
  if (!code) return null;
  return YAHOO_TO_TV_EXCHANGE[code.toUpperCase()] ?? null;
}

export function resolveTradingViewSymbol(
  parsed: ParsedSymbol,
  quoteExchange?: string | null,
): string {
  if (parsed.display.includes(":")) return parsed.display;

  const fromQuote = yahooExchangeToTradingView(quoteExchange);
  const fromMap =
    TICKER_EXCHANGE[parsed.yahoo] ??
    (NYSE_SYMBOLS.has(parsed.yahoo) ? "NYSE" : undefined);
  const exchange = parsed.exchange ?? fromQuote ?? fromMap ?? "NASDAQ";
  const ticker = parsed.yahoo.replace(/-/g, ".");

  return `${exchange}:${ticker}`;
}

/** Parse TradingView-style symbols into Yahoo Finance format. */
export function parseSymbol(input: string): ParsedSymbol | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let exchange: string | null = null;
  let ticker = trimmed;

  if (trimmed.includes(":")) {
    const [ex, sym] = trimmed.split(":", 2);
    exchange = ex.toUpperCase();
    ticker = sym;
  }

  const yahoo = ticker.replace(/\./g, "-").toUpperCase();
  const display = exchange
    ? `${exchange}:${stripDisplayTicker(ticker)}`
    : yahoo;

  if (!/^[A-Z0-9.-]+$/.test(yahoo)) return null;

  return { raw: trimmed, yahoo, display, exchange };
}

/** Parse comma/newline-separated symbol lists (TradingView TXT export format) */
export function parseSymbolList(text: string): ParsedSymbol[] {
  const parts = text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const result: ParsedSymbol[] = [];

  for (const part of parts) {
    const parsed = parseSymbol(part);
    if (!parsed || seen.has(parsed.yahoo)) continue;
    seen.add(parsed.yahoo);
    result.push(parsed);
  }

  return result;
}

export function tradingViewChartUrl(
  tvSymbol: string,
  interval: ScanInterval = "4h",
): string {
  const layout = process.env.TRADINGVIEW_CHART_LAYOUT ?? "fW1aFTNk";
  const params = new URLSearchParams({
    symbol: tvSymbol,
    interval: tradingViewIntervalParam(interval),
  });
  return `https://www.tradingview.com/chart/${layout}/?${params.toString()}`;
}

/** Resolve chart link — backfill when cached row lost its URL during a failed rescan. */
export function resolveTradingViewChartUrl(row: {
  tradingViewUrl?: string | null;
  tradingViewSymbol?: string | null;
  displaySymbol?: string | null;
  symbol?: string | null;
}): string {
  const url = row.tradingViewUrl?.trim();
  if (url && url !== "#" && url.startsWith("https://www.tradingview.com/")) {
    return url;
  }
  const sym =
    row.tradingViewSymbol?.trim() ||
    row.displaySymbol?.trim() ||
    row.symbol?.trim();
  if (sym && sym !== "—") return tradingViewChartUrl(sym, "4h");
  return "#";
}

export function blueChipCount(): number {
  return BLUE_CHIP_SYMBOLS.length;
}
