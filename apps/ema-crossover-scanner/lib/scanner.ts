import {
  findMostRecentBullishCrossover,
  formatCrossoverDateTime,
  latestEmaValues,
} from "./ema";
import type { ScanInterval } from "./intervals";
import { evaluateAllPatterns, NONE_PATTERNS } from "./patterns";
import {
  resolveTradingViewSymbol,
  tradingViewChartUrl,
} from "./stocks";
import type { ParsedSymbol, StockScanResult } from "./types";
import {
  aggregateHourlyTo4h,
  fetchHourlyBars,
  fetchQuoteMeta,
} from "./yahoo";

const FAST_EMA = 20;
const SLOW_EMA = 50;

export async function scanSymbol(
  parsed: ParsedSymbol,
  historyDays: number,
  interval: ScanInterval,
  includePatternDebug = false,
): Promise<StockScanResult> {
  const tvSymbol = resolveTradingViewSymbol(parsed);
  const displayTicker = tvSymbol.includes(":")
    ? tvSymbol.split(":", 2)[1]
    : tvSymbol;

  const base: StockScanResult = {
    symbol: parsed.yahoo,
    displayTicker,
    displaySymbol: tvSymbol,
    tradingViewSymbol: tvSymbol,
    name: null,
    exchange: parsed.exchange,
    price: null,
    preMarketChange: null,
    regularMarketChange: null,
    postMarketChange: null,
    patterns: NONE_PATTERNS,
    ema20: null,
    ema50: null,
    ema20Above50: false,
    crossoverDate: null,
    crossoverTime: null,
    crossoverMsAgo: null,
    crossoverDaysAgo: null,
    tradingViewUrl: tradingViewChartUrl(tvSymbol, interval),
  };

  try {
    const [hourly, meta] = await Promise.all([
      fetchHourlyBars(parsed.yahoo, historyDays),
      fetchQuoteMeta(parsed.yahoo),
    ]);
    const bars = interval === "1h" ? hourly : aggregateHourlyTo4h(hourly);
    const bars4h = aggregateHourlyTo4h(hourly);

    const resolvedTv = resolveTradingViewSymbol(parsed, meta.quoteExchange);
    base.displayTicker = resolvedTv.includes(":")
      ? resolvedTv.split(":", 2)[1]
      : resolvedTv;
    base.displaySymbol = resolvedTv;
    base.tradingViewSymbol = resolvedTv;
    base.tradingViewUrl = tradingViewChartUrl(resolvedTv, interval);

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

    let crossoverDate: string | null = null;
    let crossoverTime: string | null = null;
    let crossoverMsAgo: number | null = null;
    let crossoverDaysAgo: number | null = null;

    if (crossover) {
      const formatted = formatCrossoverDateTime(crossover.date);
      crossoverDate = formatted.crossoverDate;
      crossoverTime = formatted.crossoverTime;
      crossoverMsAgo = crossover.msAgo;
      crossoverDaysAgo = Math.round(crossover.msAgo / (1000 * 60 * 60 * 24));
    }

    const patterns = evaluateAllPatterns(hourly, bars4h, meta.price, includePatternDebug);

    return {
      ...base,
      ...meta,
      exchange: meta.exchange ?? parsed.exchange,
      ema20: emaFast,
      ema50: emaSlow,
      ema20Above50: fastAboveSlow,
      crossoverDate,
      crossoverTime,
      crossoverMsAgo,
      crossoverDaysAgo,
      patterns,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch data";
    return { ...base, error: message };
  }
}

export async function scanSymbols(
  symbols: ParsedSymbol[],
  historyDays: number,
  interval: ScanInterval,
  includePatternDebug = false,
): Promise<StockScanResult[]> {
  const batchSize = 8;
  const results: StockScanResult[] = [];

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((s) => scanSymbol(s, historyDays, interval, includePatternDebug)),
    );
    results.push(...batchResults);
  }

  return sortByRecentCrossover(results);
}

/** Most recent 20/50 bullish cross first; symbols without a cross sort last */
export function sortByRecentCrossover(results: StockScanResult[]): StockScanResult[] {
  return [...results].sort((a, b) => {
    const aHas = a.crossoverMsAgo != null;
    const bHas = b.crossoverMsAgo != null;

    if (aHas && bHas) return a.crossoverMsAgo! - b.crossoverMsAgo!;
    if (aHas) return -1;
    if (bHas) return 1;

    if (a.ema20Above50 !== b.ema20Above50) {
      return a.ema20Above50 ? -1 : 1;
    }

    return a.displayTicker.localeCompare(b.displayTicker);
  });
}
