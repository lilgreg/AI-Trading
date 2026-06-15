import {
  findMostRecentBullishCrossover,
  formatCrossoverDateTime,
  latestEmaValues,
  type CrossoverInfo,
} from "./ema";
import { evaluateAllPatterns, NONE_PATTERNS } from "./patterns";
import {
  resolveTradingViewSymbol,
  tradingViewChartUrl,
} from "./stocks";
import type {
  CrossoverDisplay,
  ParsedSymbol,
  StockScanResult,
} from "./types";
import {
  aggregateHourlyTo4h,
  fetchHourlyBars,
  fetchQuoteMeta,
} from "./yahoo";

const FAST_EMA = 20;
const SLOW_EMA = 50;
/** Parallel Yahoo fetches per batch — raised cautiously from 8. */
export const SCAN_BATCH_SIZE = 14;

function buildCrossoverDisplay(cross: CrossoverInfo | null): CrossoverDisplay {
  if (!cross) {
    return { crossoverDate: null, crossoverTime: null, crossoverMsAgo: null };
  }
  const formatted = formatCrossoverDateTime(cross.date);
  return {
    crossoverDate: formatted.crossoverDate,
    crossoverTime: formatted.crossoverTime,
    crossoverMsAgo: cross.msAgo,
  };
}

export async function scanSymbol(
  parsed: ParsedSymbol,
  historyDays: number,
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
    cross1h: { crossoverDate: null, crossoverTime: null, crossoverMsAgo: null },
    cross4h: { crossoverDate: null, crossoverTime: null, crossoverMsAgo: null },
    tradingViewUrl: tradingViewChartUrl(tvSymbol, "4h"),
  };

  try {
    const [hourly, meta] = await Promise.all([
      fetchHourlyBars(parsed.yahoo, historyDays),
      fetchQuoteMeta(parsed.yahoo),
    ]);
    const bars4h = aggregateHourlyTo4h(hourly);

    const resolvedTv = resolveTradingViewSymbol(parsed, meta.quoteExchange);
    base.displayTicker = resolvedTv.includes(":")
      ? resolvedTv.split(":", 2)[1]
      : resolvedTv;
    base.displaySymbol = resolvedTv;
    base.tradingViewSymbol = resolvedTv;
    base.tradingViewUrl = tradingViewChartUrl(resolvedTv, "4h");

    if (bars4h.length < SLOW_EMA + 5 || hourly.length < SLOW_EMA + 5) {
      return {
        ...base,
        ...meta,
        error: "Insufficient price history for EMA calculation",
      };
    }

    const closes4h = bars4h.map((b) => b.close);
    const { emaFast, emaSlow, fastAboveSlow } = latestEmaValues(
      closes4h,
      FAST_EMA,
      SLOW_EMA,
    );

    const cross1h = buildCrossoverDisplay(
      findMostRecentBullishCrossover(hourly, FAST_EMA, SLOW_EMA),
    );
    const cross4h = buildCrossoverDisplay(
      findMostRecentBullishCrossover(bars4h, FAST_EMA, SLOW_EMA),
    );

    const patterns = evaluateAllPatterns(hourly, bars4h, meta.price, includePatternDebug);

    return {
      ...base,
      ...meta,
      exchange: meta.exchange ?? parsed.exchange,
      ema20: emaFast,
      ema50: emaSlow,
      ema20Above50: fastAboveSlow,
      cross1h,
      cross4h,
      patterns,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch data";
    return { ...base, error: message };
  }
}

export interface ScanProgressCallbacks {
  onResult?: (result: StockScanResult) => void;
}

export async function scanSymbols(
  symbols: ParsedSymbol[],
  historyDays: number,
  includePatternDebug = false,
  callbacks: ScanProgressCallbacks = {},
): Promise<StockScanResult[]> {
  const results: StockScanResult[] = [];

  for (let i = 0; i < symbols.length; i += SCAN_BATCH_SIZE) {
    const batch = symbols.slice(i, i + SCAN_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((s) => scanSymbol(s, historyDays, includePatternDebug)),
    );
    for (const result of batchResults) {
      results.push(result);
      callbacks.onResult?.(result);
    }
  }

  return sortByRecentCrossover(results);
}

/** Most recent 4h bullish cross first; symbols without a cross sort last */
export function sortByRecentCrossover(results: StockScanResult[]): StockScanResult[] {
  return [...results].sort((a, b) => {
    const aHas = a.cross4h.crossoverMsAgo != null;
    const bHas = b.cross4h.crossoverMsAgo != null;

    if (aHas && bHas) return a.cross4h.crossoverMsAgo! - b.cross4h.crossoverMsAgo!;
    if (aHas) return -1;
    if (bHas) return 1;

    const a1h = a.cross1h.crossoverMsAgo;
    const b1h = b.cross1h.crossoverMsAgo;
    if (a1h != null && b1h != null) return a1h - b1h;
    if (a1h != null) return -1;
    if (b1h != null) return 1;

    if (a.ema20Above50 !== b.ema20Above50) {
      return a.ema20Above50 ? -1 : 1;
    }

    return a.displayTicker.localeCompare(b.displayTicker);
  });
}
