import {
  findMostRecentBullishCrossover,
  latestEmaValues,
} from "./ema";
import type { ParsedSymbol, StockScanResult } from "./types";
import { fetchHistoricalBars, fetchQuoteMeta } from "./yahoo";
import { tradingViewChartUrl } from "./stocks";

const FAST_EMA = 20;
const SLOW_EMA = 50;

export async function scanSymbol(
  parsed: ParsedSymbol,
  historyDays: number,
): Promise<StockScanResult> {
  const base: StockScanResult = {
    symbol: parsed.yahoo,
    displaySymbol: parsed.display,
    name: null,
    exchange: parsed.exchange,
    price: null,
    ema20: null,
    ema50: null,
    ema20Above50: false,
    crossoverDate: null,
    crossoverDaysAgo: null,
    tradingViewUrl: tradingViewChartUrl(parsed.display),
  };

  try {
    const [bars, meta] = await Promise.all([
      fetchHistoricalBars(parsed.yahoo, historyDays),
      fetchQuoteMeta(parsed.yahoo),
    ]);

    if (bars.length < SLOW_EMA + 5) {
      return {
        ...base,
        ...meta,
        error: "Insufficient price history for EMA calculation",
      };
    }

    const closes = bars.map((b) => b.close);
    const { emaFast, emaSlow, fastAboveSlow } = latestEmaValues(
      closes,
      FAST_EMA,
      SLOW_EMA,
    );
    const crossover = findMostRecentBullishCrossover(bars, FAST_EMA, SLOW_EMA);

    return {
      ...base,
      ...meta,
      exchange: meta.exchange ?? parsed.exchange,
      ema20: emaFast,
      ema50: emaSlow,
      ema20Above50: fastAboveSlow,
      crossoverDate: crossover?.date.toISOString().slice(0, 10) ?? null,
      crossoverDaysAgo: crossover?.daysAgo ?? null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch data";
    return { ...base, error: message };
  }
}

export async function scanSymbols(
  symbols: ParsedSymbol[],
  historyDays: number,
): Promise<StockScanResult[]> {
  const batchSize = 5;
  const results: StockScanResult[] = [];

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((s) => scanSymbol(s, historyDays)),
    );
    results.push(...batchResults);
  }

  return sortByRecentCrossover(results);
}

/** Most recent 20/50 bullish cross first; symbols without a cross sort last */
export function sortByRecentCrossover(results: StockScanResult[]): StockScanResult[] {
  return [...results].sort((a, b) => {
    const aHas = a.crossoverDaysAgo != null;
    const bHas = b.crossoverDaysAgo != null;

    if (aHas && bHas) return a.crossoverDaysAgo! - b.crossoverDaysAgo!;
    if (aHas) return -1;
    if (bHas) return 1;

    if (a.ema20Above50 !== b.ema20Above50) {
      return a.ema20Above50 ? -1 : 1;
    }

    return a.displaySymbol.localeCompare(b.displaySymbol);
  });
}
