import { createHash } from "node:crypto";
import {
  isChartFetchError,
  scanSymbol,
  scanSymbols,
  sortByRecentCrossover,
} from "./scanner";
import { CHART_TAIL_SYMBOL_INDEX } from "./chart-data";
import { rowNeedsChartHeal } from "./chart-error-sanitize";
import { sleep } from "./request-limit";
import { mergeScanResultsPreservingQuotes } from "./quote-updates";
import {
  buildCacheStatus,
  getStaleAfterMs,
  isSnapshotStale,
  loadSnapshot,
  recoverStuckScanState,
  releaseScanLock,
  saveSnapshot,
  setScanError,
  tryAcquireScanLock,
  type ScanSnapshot,
} from "./scan-cache";
import { stripDisplayTicker, resolveTradingViewSymbol } from "./stocks";
import { buildSymbolUniverse } from "./symbols";
import type { ParsedSymbol, StockScanResult } from "./types";
import { EMPTY_CROSSOVER, NONE_PATTERNS } from "./types";

export interface ScanJobConfig {
  includeBlueChips: boolean;
  historyDays: number;
  watchlistText?: string | null;
  customSymbols?: string | null;
  tradingViewWatchlistUrl?: string | null;
}

/** Persist partial progress every N completed symbols. */
const PARTIAL_SAVE_EVERY = 8;
const DEFAULT_RETRY_BATCH = 50;

function parseHistoryDays(value: string | undefined): number {
  const parsed = Number(value ?? 120);
  if (!Number.isFinite(parsed) || parsed < 60) return 120;
  return Math.min(parsed, 365);
}

export function resolveScanJobConfig(
  overrides: Partial<ScanJobConfig> = {},
): ScanJobConfig {
  const includeBlueChips =
    overrides.includeBlueChips ??
    process.env.INCLUDE_BLUE_CHIPS !== "false";

  return {
    includeBlueChips,
    historyDays: overrides.historyDays ?? parseHistoryDays(process.env.HISTORY_DAYS),
    watchlistText: overrides.watchlistText ?? null,
    customSymbols: overrides.customSymbols ?? null,
    tradingViewWatchlistUrl:
      overrides.tradingViewWatchlistUrl ??
      process.env.TRADINGVIEW_WATCHLIST_URL?.trim() ??
      null,
  };
}

export function buildConfigKey(config: ScanJobConfig): string {
  const payload = JSON.stringify({
    includeBlueChips: config.includeBlueChips,
    historyDays: config.historyDays,
    watchlistText: config.watchlistText ?? "",
    customSymbols: config.customSymbols ?? "",
    tradingViewWatchlistUrl: config.tradingViewWatchlistUrl ?? "",
    envWatchlist: process.env.WATCHLIST_SYMBOLS?.trim() ?? "",
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function isSuccessfulResult(result: StockScanResult): boolean {
  return !result.error && result.ema20 != null && result.ema50 != null;
}

/** Symbols that need a (re)scan — includes timeouts, missing EMA, and never-scanned rows. */
export function isRetryableResult(result: StockScanResult): boolean {
  if (isSuccessfulResult(result)) return false;
  if (!result.error) return result.ema20 == null || result.ema50 == null;
  if (result.error === "Not scanned yet") return true;
  return true;
}

export function countRetryableResults(results: StockScanResult[]): number {
  return results.filter(isRetryableResult).length;
}

export function hasUnscannedRows(results: StockScanResult[]): boolean {
  return results.some((row) => row.error === "Not scanned yet");
}

function buildOrderedResults(
  symbols: ParsedSymbol[],
  bySymbol: Map<string, StockScanResult>,
  fallbackBySymbol: Map<string, StockScanResult>,
): StockScanResult[] {
  return symbols.map((parsed) => {
    return (
      bySymbol.get(parsed.yahoo) ??
      fallbackBySymbol.get(parsed.yahoo) ??
      {
        symbol: parsed.yahoo,
        displayTicker: stripDisplayTicker(parsed.display),
        displaySymbol: parsed.display,
        tradingViewSymbol: parsed.display.includes(":")
          ? parsed.display
          : resolveTradingViewSymbol(parsed),
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
        tradingViewUrl: "#",
        error: "Not scanned yet",
      }
    );
  });
}

function symbolsNeedingScan(
  symbols: ParsedSymbol[],
  existingBySymbol: Map<string, StockScanResult>,
  rescanAll: boolean,
): ParsedSymbol[] {
  if (rescanAll) return symbols;
  return symbols.filter((parsed) => {
    const existing = existingBySymbol.get(parsed.yahoo);
    if (!existing) return true;
    return !isSuccessfulResult(existing);
  });
}

function isScanFullyAttempted(
  symbols: ParsedSymbol[],
  resultsBySymbol: Map<string, StockScanResult>,
  fallbackBySymbol: Map<string, StockScanResult>,
): boolean {
  return symbols.every((parsed) => {
    const row =
      resultsBySymbol.get(parsed.yahoo) ?? fallbackBySymbol.get(parsed.yahoo);
    if (!row) return false;
    return row.error !== "Not scanned yet";
  });
}

function buildSnapshot(
  symbols: ParsedSymbol[],
  resultsBySymbol: Map<string, StockScanResult>,
  fallbackBySymbol: Map<string, StockScanResult>,
  configKey: string,
  sources: ScanSnapshot["sources"],
  tradingViewWatchlistName: string | undefined,
  scanComplete: boolean,
  previousCompletedAt: string | null,
): ScanSnapshot {
  const now = new Date().toISOString();
  const ordered = buildOrderedResults(symbols, resultsBySymbol, fallbackBySymbol);
  const results = scanComplete ? sortByRecentCrossover(ordered) : ordered;

  return {
    scannedAt: now,
    completedAt: scanComplete ? now : (previousCompletedAt ?? now),
    lastSavedAt: now,
    configKey,
    symbolCount: results.length,
    results,
    sources,
    tradingViewWatchlistName,
    scanComplete,
  };
}

async function mergeScanResults(
  overrides: Partial<ScanJobConfig>,
  options: {
    rescanAll?: boolean;
    symbolFilter?: (parsed: ParsedSymbol) => boolean;
    maxSymbols?: number;
  } = {},
): Promise<ScanSnapshot | null> {
  const config = resolveScanJobConfig(overrides);
  const configKey = buildConfigKey(config);
  const rescanAll = options.rescanAll === true;

  const { symbols, sources, tradingViewWatchlistName } =
    await buildSymbolUniverse({
      includeBlueChips: config.includeBlueChips,
      watchlistText: config.watchlistText,
      customSymbols: config.customSymbols,
      tradingViewWatchlistUrl: config.tradingViewWatchlistUrl,
    });

  if (symbols.length === 0) {
    throw new Error(
      "No symbols configured. Set WATCHLIST_SYMBOLS or TRADINGVIEW_WATCHLIST_URL.",
    );
  }

  const existing = await loadSnapshot();
  const existingBySymbol = new Map<string, StockScanResult>();
  if (existing?.configKey === configKey && existing.results?.length) {
    for (const row of existing.results) {
      existingBySymbol.set(row.symbol, row);
    }
  }

  const resultsBySymbol = new Map<string, StockScanResult>();
  if (!rescanAll) {
    for (const [symbol, row] of existingBySymbol) {
      if (isSuccessfulResult(row)) {
        resultsBySymbol.set(symbol, row);
      }
    }
  }

  const previousCompletedAt = existing?.completedAt ?? null;
  const fallbackBySymbol = rescanAll ? new Map<string, StockScanResult>() : existingBySymbol;

  let toScan = symbolsNeedingScan(symbols, existingBySymbol, rescanAll);
  if (options.symbolFilter) {
    toScan = toScan.filter(options.symbolFilter);
  }
  if (options.maxSymbols != null && options.maxSymbols > 0) {
    toScan = toScan.slice(0, options.maxSymbols);
  }

  let completedSinceSave = 0;

  const persistPartial = async (scanComplete: boolean) => {
    await saveSnapshot(
      buildSnapshot(
        symbols,
        resultsBySymbol,
        fallbackBySymbol,
        configKey,
        sources,
        tradingViewWatchlistName,
        scanComplete,
        previousCompletedAt,
      ),
    );
  };

  if (toScan.length > 0) {
    const symbolIndexByYahoo = new Map(
      symbols.map((parsed, index) => [parsed.yahoo, index]),
    );
    await scanSymbols(
      toScan,
      config.historyDays,
      false,
      {
        onResult: async (result) => {
          const prior =
            resultsBySymbol.get(result.symbol) ??
            fallbackBySymbol.get(result.symbol);
          const keepPrior =
            prior != null &&
            isSuccessfulResult(prior) &&
            Boolean(result.error) &&
            result.ema20 == null;

          let next = keepPrior ? prior : result;

          if (prior && !keepPrior) {
            next = mergeScanResultsPreservingQuotes([prior], [result])[0];
          }

          resultsBySymbol.set(result.symbol, { ...next, universeIndex: symbolIndexByYahoo.get(result.symbol) });
          completedSinceSave += 1;
          if (completedSinceSave >= PARTIAL_SAVE_EVERY) {
            completedSinceSave = 0;
            await persistPartial(false);
          }
        },
      },
      (parsed) => symbolIndexByYahoo.get(parsed.yahoo),
    );
  }

  const scanComplete = isScanFullyAttempted(symbols, resultsBySymbol, fallbackBySymbol);
  const snapshot = buildSnapshot(
    symbols,
    resultsBySymbol,
    fallbackBySymbol,
    configKey,
    sources,
    tradingViewWatchlistName,
    scanComplete,
    previousCompletedAt,
  );

  await saveSnapshot(snapshot);
  setScanError(null);
  return snapshot;
}

export async function runBackgroundScan(
  overrides: Partial<ScanJobConfig> = {},
  options: { force?: boolean } = {},
): Promise<ScanSnapshot | null> {
  const acquired = await tryAcquireScanLock();
  if (!acquired) return null;

  try {
    return await mergeScanResults(overrides, { rescanAll: options.force === true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Background scan failed";
    setScanError(message);
    throw err;
  } finally {
    await releaseScanLock();
  }
}

/** Scan a slice of the symbol universe — for chunked cron on Vercel Hobby (300s limit). */
export async function runScanChunk(
  offset: number,
  limit: number,
  overrides: Partial<ScanJobConfig> = {},
): Promise<ScanSnapshot | null> {
  const acquired = await tryAcquireScanLock();
  if (!acquired) return null;

  try {
    const config = resolveScanJobConfig(overrides);
    const { symbols } = await buildSymbolUniverse({
      includeBlueChips: config.includeBlueChips,
      watchlistText: config.watchlistText,
      customSymbols: config.customSymbols,
      tradingViewWatchlistUrl: config.tradingViewWatchlistUrl,
    });

    const slice = new Set(
      symbols.slice(offset, offset + limit).map((parsed) => parsed.yahoo),
    );

    return await mergeScanResults(overrides, {
      symbolFilter: (parsed) => slice.has(parsed.yahoo),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chunk scan failed";
    setScanError(message);
    throw err;
  } finally {
    await releaseScanLock();
  }
}

let retryInFlight = false;

/** Synchronous retry of failed/missing symbols — used by /api/scan/retry-failed. */
export async function retryFailedSymbols(
  overrides: Partial<ScanJobConfig> = {},
  options: { maxSymbols?: number } = {},
): Promise<ScanSnapshot | null> {
  const maxSymbols = options.maxSymbols ?? DEFAULT_RETRY_BATCH;
  const snapshot = await loadSnapshot();
  if (!snapshot?.results?.length) return null;

  const config = resolveScanJobConfig(overrides);
  const configKey = buildConfigKey(config);
  if (snapshot.configKey !== configKey) return null;

  const failedSet = new Set(
    snapshot.results.filter(isRetryableResult).map((row) => row.symbol),
  );
  if (failedSet.size === 0) return snapshot;

  const acquired = await tryAcquireScanLock();
  if (!acquired) return null;

  try {
    return await mergeScanResults(overrides, {
      symbolFilter: (parsed) => failedSet.has(parsed.yahoo),
      maxSymbols,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Retry failed";
    setScanError(message);
    throw err;
  } finally {
    await releaseScanLock();
  }
}

/** Re-scan failed symbols in the background (fire-and-forget). */
export async function retryFailedSymbolsInBackground(
  overrides: Partial<ScanJobConfig> = {},
): Promise<boolean> {
  if (retryInFlight) return false;

  const snapshot = await loadSnapshot();
  if (!snapshot?.results?.length) return false;
  if (countRetryableResults(snapshot.results) === 0) return false;

  retryInFlight = true;

  void retryFailedSymbols(overrides, { maxSymbols: DEFAULT_RETRY_BATCH })
    .catch(() => undefined)
    .finally(() => {
      retryInFlight = false;
    });

  return true;
}

const TAIL_RETRY_MAX_PER_CALL = 5;
const TAIL_RETRY_DELAY_MS = 3_000;

function isTailChartError(
  row: StockScanResult,
  symbolIndexByYahoo: Map<string, number>,
): boolean {
  const idx = row.universeIndex ?? symbolIndexByYahoo.get(row.symbol);
  if (idx == null || idx < CHART_TAIL_SYMBOL_INDEX) return false;
  return Boolean(row.error) && isChartFetchError(row);
}

function mergeScanResultPreservingQuotes(
  incoming: StockScanResult,
  prior: StockScanResult | undefined,
): StockScanResult {
  if (!prior) return incoming;

  if (isSuccessfulResult(prior) && incoming.error && incoming.ema20 == null) {
    return { ...prior, universeIndex: incoming.universeIndex ?? prior.universeIndex };
  }

  if (incoming.error) {
    return {
      ...incoming,
      price: incoming.price ?? prior.price,
      preMarketChange: incoming.preMarketChange ?? prior.preMarketChange,
      regularMarketChange:
        incoming.regularMarketChange ?? prior.regularMarketChange,
      postMarketChange: incoming.postMarketChange ?? prior.postMarketChange,
    };
  }

  return incoming;
}

const HEAL_MAX_PER_REQUEST = 12;
const HEAL_RESCAN_DELAY_MS = 800;

/**
 * Synchronously rescan rows with stale chart errors or never-scanned placeholders.
 * Persists healed rows to cache before returning.
 */
export async function healCacheOnRead(
  snapshot: ScanSnapshot,
  overrides: Partial<ScanJobConfig> = {},
  options: { maxSymbols?: number } = {},
): Promise<ScanSnapshot> {
  const acquired = await tryAcquireScanLock();
  if (!acquired) return snapshot;

  try {
    const fresh = await loadSnapshot();
    snapshot = fresh ?? snapshot;

    const maxSymbols = options.maxSymbols ?? HEAL_MAX_PER_REQUEST;
    const unscannedRows = snapshot.results.filter(
      (row) => row.error === "Not scanned yet",
    );
    const staleChartRows = snapshot.results.filter(
      (row) => row.error !== "Not scanned yet" && rowNeedsChartHeal(row),
    );
    const unscannedBatch = unscannedRows.slice(0, maxSymbols);
    const staleBatch = staleChartRows.slice(
      0,
      Math.max(0, maxSymbols - unscannedBatch.length),
    );
    const toHeal = [...unscannedBatch, ...staleBatch];
    if (toHeal.length === 0) return snapshot;

    const config = resolveScanJobConfig(overrides);
    const configKey = buildConfigKey(config);
    if (snapshot.configKey !== configKey) return snapshot;

    const { symbols, sources, tradingViewWatchlistName } =
      await buildSymbolUniverse({
        includeBlueChips: config.includeBlueChips,
        watchlistText: config.watchlistText,
        customSymbols: config.customSymbols,
        tradingViewWatchlistUrl: config.tradingViewWatchlistUrl,
      });

    const symbolIndexByYahoo = new Map(
      symbols.map((parsed, index) => [parsed.yahoo, index]),
    );

    const resultsBySymbol = new Map(
      snapshot.results.map((row) => [row.symbol, row]),
    );

    for (let i = 0; i < toHeal.length; i += 1) {
      if (i > 0) await sleep(HEAL_RESCAN_DELAY_MS);

      const row = toHeal[i];
      const index = row.universeIndex ?? symbolIndexByYahoo.get(row.symbol);
      if (index == null) continue;

      const parsed = symbols[index];
      if (!parsed) continue;

      const prior = resultsBySymbol.get(parsed.yahoo);
      const scanned = await scanSymbol(parsed, config.historyDays, false, index, {
        skipChartStagger: true,
      });
      const next = mergeScanResultPreservingQuotes(scanned, prior);
      resultsBySymbol.set(parsed.yahoo, { ...next, universeIndex: index });
    }

    const fallbackBySymbol = new Map(
      snapshot.results.map((row) => [row.symbol, row]),
    );
    const scanComplete = isScanFullyAttempted(
      symbols,
      resultsBySymbol,
      fallbackBySymbol,
    );
    const updated = buildSnapshot(
      symbols,
      resultsBySymbol,
      fallbackBySymbol,
      configKey,
      sources,
      tradingViewWatchlistName,
      scanComplete,
      snapshot.completedAt ?? null,
    );

    await saveSnapshot(updated);
    setScanError(null);
    return updated;
  } finally {
    await releaseScanLock();
  }
}

/** Retry chart fetch for tail symbols (index >= 122) with staggered Yahoo providers. */
export async function retryTailSymbols(
  overrides: Partial<ScanJobConfig> = {},
  options: { maxSymbols?: number } = {},
): Promise<ScanSnapshot | null> {
  const maxSymbols = options.maxSymbols ?? TAIL_RETRY_MAX_PER_CALL;
  const snapshot = await loadSnapshot();
  if (!snapshot?.results?.length) return null;

  const config = resolveScanJobConfig(overrides);
  const configKey = buildConfigKey(config);
  if (snapshot.configKey !== configKey) return null;

  const { symbols, sources, tradingViewWatchlistName } =
    await buildSymbolUniverse({
      includeBlueChips: config.includeBlueChips,
      watchlistText: config.watchlistText,
      customSymbols: config.customSymbols,
      tradingViewWatchlistUrl: config.tradingViewWatchlistUrl,
    });

  const symbolIndexByYahoo = new Map(
    symbols.map((parsed, index) => [parsed.yahoo, index]),
  );

  const toRetry = snapshot.results.filter((row) =>
    isTailChartError(row, symbolIndexByYahoo),
  );
  if (toRetry.length === 0) return snapshot;

  const acquired = await tryAcquireScanLock();
  if (!acquired) return null;

  try {
    const resultsBySymbol = new Map(
      snapshot.results.map((row) => [row.symbol, row]),
    );
    const batch = toRetry.slice(0, maxSymbols);

    for (let i = 0; i < batch.length; i += 1) {
      if (i > 0) await sleep(TAIL_RETRY_DELAY_MS);

      const row = batch[i];
      const index = row.universeIndex ?? symbolIndexByYahoo.get(row.symbol);
      const parsed =
        index != null ? symbols[index] : symbols.find((s) => s.yahoo === row.symbol);
      if (!parsed || index == null) continue;

      const prior = resultsBySymbol.get(parsed.yahoo);
      const scanned = await scanSymbol(parsed, config.historyDays, false, index, {
        skipChartStagger: true,
      });
      const next = mergeScanResultPreservingQuotes(scanned, prior);
      resultsBySymbol.set(parsed.yahoo, { ...next, universeIndex: index });
    }

    const fallbackBySymbol = new Map(snapshot.results.map((row) => [row.symbol, row]));
    const updated = buildSnapshot(
      symbols,
      resultsBySymbol,
      fallbackBySymbol,
      configKey,
      sources,
      tradingViewWatchlistName,
      snapshot.scanComplete !== false,
      snapshot.completedAt ?? null,
    );

    await saveSnapshot(updated);
    setScanError(null);
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tail retry failed";
    setScanError(message);
    throw err;
  } finally {
    await releaseScanLock();
  }
}

/** Scan one symbol and merge into the cached snapshot. */
export async function scanAndMergeSymbol(
  yahooSymbol: string,
  overrides: Partial<ScanJobConfig> = {},
): Promise<StockScanResult | null> {
  const config = resolveScanJobConfig(overrides);
  const configKey = buildConfigKey(config);

  const { symbols, sources, tradingViewWatchlistName } =
    await buildSymbolUniverse({
      includeBlueChips: config.includeBlueChips,
      watchlistText: config.watchlistText,
      customSymbols: config.customSymbols,
      tradingViewWatchlistUrl: config.tradingViewWatchlistUrl,
    });

  const index = symbols.findIndex((parsed) => parsed.yahoo === yahooSymbol);
  if (index < 0) return null;

  const parsed = symbols[index];
  const snapshot = await loadSnapshot();
  const prior = snapshot?.results?.find((row) => row.symbol === yahooSymbol);

  const scanned = await scanSymbol(parsed, config.historyDays, false, index, {
    skipChartStagger: true,
  });
  const result = mergeScanResultPreservingQuotes(scanned, prior);
  const merged = { ...result, universeIndex: index };

  if (snapshot?.results?.length) {
    if (snapshot.configKey === configKey) {
      const resultsBySymbol = new Map(
        snapshot.results.map((row) => [row.symbol, row]),
      );
      resultsBySymbol.set(yahooSymbol, merged);

      const fallbackBySymbol = new Map(
        snapshot.results.map((row) => [row.symbol, row]),
      );
      const updated = buildSnapshot(
        symbols,
        resultsBySymbol,
        fallbackBySymbol,
        configKey,
        sources,
        tradingViewWatchlistName,
        snapshot.scanComplete !== false,
        snapshot.completedAt ?? null,
      );
      await saveSnapshot(updated);
    } else {
      const results = snapshot.results.map((row) =>
        row.symbol === yahooSymbol ? merged : row,
      );
      await saveSnapshot({
        ...snapshot,
        results,
        lastSavedAt: new Date().toISOString(),
      });
    }
    setScanError(null);
  }

  return merged;
}

export function countTailChartErrors(
  results: StockScanResult[],
  symbolIndexByYahoo: Map<string, number>,
): number {
  return results.filter((row) => isTailChartError(row, symbolIndexByYahoo)).length;
}

/** Fire-and-forget unless already running. Returns whether a scan was started. */
export async function ensureFreshScan(
  overrides: Partial<ScanJobConfig> = {},
  options: { force?: boolean } = {},
): Promise<boolean> {
  const snapshot = await loadSnapshot();
  await recoverStuckScanState(snapshot);
  const config = resolveScanJobConfig(overrides);
  const configKey = buildConfigKey(config);
  const configMismatch = snapshot != null && snapshot.configKey !== configKey;
  const incomplete =
    snapshot != null &&
    (snapshot.scanComplete === false || hasUnscannedRows(snapshot.results));
  const hasRetryable =
    snapshot != null && countRetryableResults(snapshot.results) > 0;
  const stale = isSnapshotStale(snapshot) || configMismatch || incomplete;

  if (!options.force && snapshot && !stale) {
    if (hasRetryable) {
      void retryFailedSymbolsInBackground(overrides);
    }
    return false;
  }

  void runBackgroundScan(overrides, options).catch(() => undefined);
  return true;
}

export async function getScanStatus() {
  const snapshot = await loadSnapshot();
  const status = await buildCacheStatus(snapshot);
  const scanComplete =
    snapshot != null &&
    snapshot.scanComplete !== false &&
    !hasUnscannedRows(snapshot.results);
  return {
    ...status,
    scannedAt: snapshot?.scannedAt ?? null,
    completedAt: snapshot?.completedAt ?? null,
    symbolCount: snapshot?.symbolCount ?? 0,
    scanComplete,
    retryableCount: snapshot ? countRetryableResults(snapshot.results) : 0,
    staleAfterMs: getStaleAfterMs(),
  };
}

export { isChartFetchError };
