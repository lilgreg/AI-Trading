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

export function tradingViewChartUrl(displaySymbol: string): string {
  const encoded = encodeURIComponent(displaySymbol.replace("-", "."));
  return `https://www.tradingview.com/chart/?symbol=${encoded}`;
}
