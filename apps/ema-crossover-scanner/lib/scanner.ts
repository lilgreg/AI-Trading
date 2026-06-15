import {
  findMostRecentBullishCrossover,
  formatCrossoverDateTime,
  latestEmaValues,
  type CrossoverInfo,
} from "./ema";
import { fetchHourlyBars } from "./chart-data";
import { evaluateAllPatterns, NONE_PATTERNS } from "./patterns";
import { sleep } from "./request-limit";
import { resolveLogoUrl } from "./symbol-logo";
import {
  resolveTradingViewSymbol,
  tradingViewChartUrl,
} from "./stocks";
import type { CrossoverDisplay, ParsedSymbol, StockScanResult } from "./types";
import { EMPTY_CROSSOVER } from "./types";
import { aggregateHourlyTo4h, fetchQuoteMeta } from "./yahoo";

const FAST_EMA = 20;
const SLOW_EMA = 50;

/** Parallel symbol scans per batch — kept low to avoid Yahoo throttling. */
export const SCAN_BATCH_SIZE = 4;
/** Pause between batches of this many symbols (rate-limit cooldown). */
export const SCAN_BATCH_GROUP_SIZE = 50;
export const SCAN_BATCH_GROUP_PAUSE_MS = 8_000;
export const SCAN_BATCH_PAUSE_MS = 1_500;
export const SCAN_RETRY_COOLDOWN_MS = 10_000;
export const SCAN_RETRY_BATCH_SIZE = 2;

function buildCrossoverDisplay(cross: CrossoverInfo | null): CrossoverDisplay {
  if (!cross) {
    return {
      crossoverAt: null,
      crossoverDate: null,
      crossoverTime: null,
      crossoverMsAgo: null,
    };
  }
  const formatted = formatCrossoverDateTime(cross.date);
  return {
    crossoverAt: cross.date.toISOString(),
    crossoverDate: formatted.crossoverDate,
    crossoverTime: formatted.crossoverTime,
    crossoverMsAgo: cross.msAgo,
  };
}

function isChartFetchError(result: StockScanResult): boolean {
  if (!result.error) return false;
  const msg = result.error.toLowerCase();
  return (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("yahoo chart") ||
    msg.includes("yahoo v8") ||
    msg.includes("all chart providers failed") ||
    msg.includes("429") ||
    msg.includes("rate") ||
    msg.includes("no hourly bar data") ||
    msg.includes("finnhub") ||
    msg.includes("polygon") ||
    msg.includes("alpha vantage") ||
    msg.includes("twelve data")
  );
}

export async function scanSymbol(
  parsed: ParsedSymbol,
  historyDays: number,
  includePatternDebug = false,
  symbolIndex?: number,
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
    cross1h: { ...EMPTY_CROSSOVER },
    cross4h: { ...EMPTY_CROSSOVER },
    tradingViewUrl: tradingViewChartUrl(tvSymbol, "4h"),
    logoUrl: null,
    dataSource: null,
  };

  try {
    const meta = await fetchQuoteMeta(parsed.yahoo);

    const resolvedTvEarly = resolveTradingViewSymbol(parsed, meta.quoteExchange);
    base.displayTicker = resolvedTvEarly.includes(":")
      ? resolvedTvEarly.split(":", 2)[1]
      : resolvedTvEarly;
    base.displaySymbol = resolvedTvEarly;
    base.tradingViewSymbol = resolvedTvEarly;
    base.tradingViewUrl = tradingViewChartUrl(resolvedTvEarly, "4h");

    let hourly: Awaited<ReturnType<typeof fetchHourlyBars>>["bars"];
    let dataSource: string | null = null;
    try {
      const chartResult = await fetchHourlyBars(parsed.yahoo, historyDays, {
        symbolIndex,
      });
      hourly = chartResult.bars;
      dataSource = chartResult.source;
    } catch (chartErr) {
      const message =
        chartErr instanceof Error ? chartErr.message : "Failed to fetch chart data";
      return { ...base, ...meta, exchange: meta.exchange ?? parsed.exchange, error: message };
    }

    const bars4h = aggregateHourlyTo4h(hourly);
    base.logoUrl = await resolveLogoUrl({
      displayTicker: base.displayTicker,
      tradingViewSymbol: base.tradingViewSymbol,
      yahooSymbol: parsed.yahoo,
      companyName: meta.name,
    });

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
      dataSource,
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

interface ScanBatchOptions {
  batchSize?: number;
  batchPauseMs?: number;
  groupSize?: number;
  groupPauseMs?: number;
}

async function scanSymbolBatch(
  symbols: ParsedSymbol[],
  historyDays: number,
  includePatternDebug: boolean,
  callbacks: ScanProgressCallbacks,
  options: ScanBatchOptions,
  symbolIndexFor?: (parsed: ParsedSymbol) => number | undefined,
): Promise<StockScanResult[]> {
  const batchSize = options.batchSize ?? SCAN_BATCH_SIZE;
  const batchPauseMs = options.batchPauseMs ?? SCAN_BATCH_PAUSE_MS;
  const groupSize = options.groupSize ?? SCAN_BATCH_GROUP_SIZE;
  const groupPauseMs = options.groupPauseMs ?? SCAN_BATCH_GROUP_PAUSE_MS;
  const results: StockScanResult[] = [];

  for (let i = 0; i < symbols.length; i += batchSize) {
    if (i > 0) {
      if (i % groupSize === 0) {
        await sleep(groupPauseMs);
      } else {
        await sleep(batchPauseMs);
      }
    }

    const batch = symbols.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((s) =>
        scanSymbol(
          s,
          historyDays,
          includePatternDebug,
          symbolIndexFor?.(s),
        ),
      ),
    );
    for (const result of batchResults) {
      results.push(result);
      callbacks.onResult?.(result);
    }
  }

  return results;
}

export async function scanSymbols(
  symbols: ParsedSymbol[],
  historyDays: number,
  includePatternDebug = false,
  callbacks: ScanProgressCallbacks = {},
  symbolIndexFor?: (parsed: ParsedSymbol) => number | undefined,
): Promise<StockScanResult[]> {
  const results = await scanSymbolBatch(
    symbols,
    historyDays,
    includePatternDebug,
    callbacks,
    {},
    symbolIndexFor,
  );

  const failedIndexes = results
    .map((result, index) => (isChartFetchError(result) ? index : -1))
    .filter((index) => index >= 0);

  if (failedIndexes.length === 0) {
    return sortByRecentCrossover(results);
  }

  await sleep(SCAN_RETRY_COOLDOWN_MS);

  const retrySymbols = failedIndexes.map((index) => symbols[index]);
  const retryResults = await scanSymbolBatch(
    retrySymbols,
    historyDays,
    includePatternDebug,
    callbacks,
    {
      batchSize: SCAN_RETRY_BATCH_SIZE,
      batchPauseMs: 2_000,
      groupSize: 20,
      groupPauseMs: 5_000,
    },
    (parsed) => {
      const batchIndex = symbols.findIndex((s) => s.yahoo === parsed.yahoo);
      return batchIndex >= 0 ? symbolIndexFor?.(symbols[batchIndex]) : undefined;
    },
  );

  for (let i = 0; i < failedIndexes.length; i += 1) {
    const originalIndex = failedIndexes[i];
    const retry = retryResults[i];
    if (!retry.error || retry.ema20 != null) {
      results[originalIndex] = retry;
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

export { isChartFetchError };
