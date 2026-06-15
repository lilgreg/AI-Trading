import { createHash } from "node:crypto";
import {
  isChartFetchError,
  scanSymbols,
  sortByRecentCrossover,
} from "./scanner";
import {
  buildCacheStatus,
  getStaleAfterMs,
  isSnapshotStale,
  loadSnapshot,
  releaseScanLock,
  saveSnapshot,
  setScanError,
  tryAcquireScanLock,
  type ScanSnapshot,
} from "./scan-cache";
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
        displayTicker: parsed.display,
        displaySymbol: parsed.display,
        tradingViewSymbol: parsed.display,
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

          resultsBySymbol.set(result.symbol, keepPrior ? prior : result);
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

/** Fire-and-forget unless already running. Returns whether a scan was started. */
export async function ensureFreshScan(
  overrides: Partial<ScanJobConfig> = {},
  options: { force?: boolean } = {},
): Promise<boolean> {
  const snapshot = await loadSnapshot();
  const config = resolveScanJobConfig(overrides);
  const configKey = buildConfigKey(config);
  const configMismatch = snapshot != null && snapshot.configKey !== configKey;
  const incomplete = snapshot != null && snapshot.scanComplete === false;
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
  return {
    ...status,
    scannedAt: snapshot?.scannedAt ?? null,
    completedAt: snapshot?.completedAt ?? null,
    symbolCount: snapshot?.symbolCount ?? 0,
    scanComplete: snapshot?.scanComplete !== false,
    retryableCount: snapshot ? countRetryableResults(snapshot.results) : 0,
    staleAfterMs: getStaleAfterMs(),
  };
}

export { isChartFetchError };
