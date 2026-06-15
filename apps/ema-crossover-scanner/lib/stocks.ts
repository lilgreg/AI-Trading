import type { ScanInterval } from "./intervals";
import { tradingViewIntervalParam } from "./intervals";
import type { ParsedSymbol } from "./types";

/** Default large-cap / blue-chip universe */
export const BLUE_CHIP_SYMBOLS = [
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "NVDA",
  "META",
  "BRK-B",
  "JPM",
  "V",
  "UNH",
  "JNJ",
  "WMT",
  "PG",
  "MA",
  "HD",
  "DIS",
  "BAC",
  "XOM",
  "CVX",
  "LLY",
  "AVGO",
  "COST",
  "ABBV",
  "KO",
  "PEP",
  "MRK",
  "TMO",
  "CSCO",
  "ACN",
  "MCD",
] as const;

/** TradingView exchange prefix for common tickers without EXCHANGE: prefix */
const TICKER_EXCHANGE: Record<string, string> = {
  AAPL: "NASDAQ",
  MSFT: "NASDAQ",
  GOOGL: "NASDAQ",
  AMZN: "NASDAQ",
  NVDA: "NASDAQ",
  META: "NASDAQ",
  "BRK-B": "NYSE",
  JPM: "NYSE",
  V: "NYSE",
  UNH: "NYSE",
  JNJ: "NYSE",
  WMT: "NYSE",
  PG: "NYSE",
  MA: "NYSE",
  HD: "NYSE",
  DIS: "NYSE",
  BAC: "NYSE",
  XOM: "NYSE",
  CVX: "NYSE",
  LLY: "NYSE",
  AVGO: "NASDAQ",
  COST: "NASDAQ",
  ABBV: "NYSE",
  KO: "NYSE",
  PEP: "NASDAQ",
  MRK: "NYSE",
  TMO: "NYSE",
  CSCO: "NASDAQ",
  ACN: "NYSE",
  MCD: "NYSE",
};

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
  const fromMap = TICKER_EXCHANGE[parsed.yahoo];
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
  const display = exchange ? `${exchange}:${ticker.toUpperCase()}` : yahoo;

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
