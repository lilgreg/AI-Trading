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

export async function runBackgroundScan(
  overrides: Partial<ScanJobConfig> = {},
  options: { force?: boolean } = {},
): Promise<ScanSnapshot | null> {
  const acquired = await tryAcquireScanLock();
  if (!acquired) return null;

  const config = resolveScanJobConfig(overrides);
  const configKey = buildConfigKey(config);
  const rescanAll = options.force === true;

  try {
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
    const toScan = symbolsNeedingScan(symbols, existingBySymbol, rescanAll);
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
      await scanSymbols(toScan, config.historyDays, false, {
        onResult: (result) => {
          resultsBySymbol.set(result.symbol, result);
          completedSinceSave += 1;
          if (completedSinceSave >= PARTIAL_SAVE_EVERY) {
            completedSinceSave = 0;
            void persistPartial(false);
          }
        },
      });
    }

    const snapshot = buildSnapshot(
      symbols,
      resultsBySymbol,
      fallbackBySymbol,
      configKey,
      sources,
      tradingViewWatchlistName,
      true,
      previousCompletedAt,
    );

    await saveSnapshot(snapshot);
    setScanError(null);
    return snapshot;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Background scan failed";
    setScanError(message);
    throw err;
  } finally {
    await releaseScanLock();
  }
}

let retryInFlight = false;

/** Re-scan only symbols with chart fetch errors; merge into cached snapshot. */
export async function retryFailedSymbolsInBackground(
  overrides: Partial<ScanJobConfig> = {},
): Promise<boolean> {
  if (retryInFlight) return false;

  const snapshot = await loadSnapshot();
  if (!snapshot?.results?.length) return false;

  const config = resolveScanJobConfig(overrides);
  const configKey = buildConfigKey(config);
  if (snapshot.configKey !== configKey) return false;

  const failed = snapshot.results.filter(isChartFetchError);
  if (failed.length === 0) return false;

  const acquired = await tryAcquireScanLock();
  if (!acquired) return false;

  retryInFlight = true;

  void (async () => {
    try {
      const { symbols, sources, tradingViewWatchlistName } =
        await buildSymbolUniverse({
          includeBlueChips: config.includeBlueChips,
          watchlistText: config.watchlistText,
          customSymbols: config.customSymbols,
          tradingViewWatchlistUrl: config.tradingViewWatchlistUrl,
        });

      const failedSet = new Set(failed.map((row) => row.symbol));
      const toRetry = symbols.filter((parsed) => failedSet.has(parsed.yahoo));
      if (toRetry.length === 0) return;

      const bySymbol = new Map(snapshot.results.map((row) => [row.symbol, row]));
      const retried = await scanSymbols(toRetry, config.historyDays);

      for (const row of retried) {
        if (!row.error || row.ema20 != null) {
          bySymbol.set(row.symbol, row);
        }
      }

      const ordered = symbols.map((parsed) => bySymbol.get(parsed.yahoo)!);
      const now = new Date().toISOString();

      await saveSnapshot({
        ...snapshot,
        scannedAt: now,
        lastSavedAt: now,
        completedAt: now,
        symbolCount: ordered.length,
        results: sortByRecentCrossover(ordered),
        sources,
        tradingViewWatchlistName,
        scanComplete: true,
      });
    } catch {
      // best-effort background retry
    } finally {
      retryInFlight = false;
      await releaseScanLock();
    }
  })();

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
  const stale = isSnapshotStale(snapshot) || configMismatch || incomplete;

  if (!options.force && snapshot && !stale) return false;

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
    staleAfterMs: getStaleAfterMs(),
  };
}
