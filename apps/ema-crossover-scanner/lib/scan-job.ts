import { createHash } from "node:crypto";
import { scanSymbols } from "./scanner";
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

export interface ScanJobConfig {
  includeBlueChips: boolean;
  historyDays: number;
  watchlistText?: string | null;
  customSymbols?: string | null;
  tradingViewWatchlistUrl?: string | null;
}

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

export async function runBackgroundScan(
  overrides: Partial<ScanJobConfig> = {},
): Promise<ScanSnapshot | null> {
  const acquired = await tryAcquireScanLock();
  if (!acquired) return null;

  const config = resolveScanJobConfig(overrides);
  const configKey = buildConfigKey(config);

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

    const results = await scanSymbols(symbols, config.historyDays);
    const completedAt = new Date().toISOString();

    const snapshot: ScanSnapshot = {
      scannedAt: completedAt,
      completedAt,
      configKey,
      symbolCount: results.length,
      results,
      sources,
      tradingViewWatchlistName,
    };

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

/** Fire-and-forget unless already running. Returns whether a scan was started. */
export async function ensureFreshScan(
  overrides: Partial<ScanJobConfig> = {},
  options: { force?: boolean } = {},
): Promise<boolean> {
  const snapshot = await loadSnapshot();
  const config = resolveScanJobConfig(overrides);
  const configKey = buildConfigKey(config);
  const configMismatch = snapshot != null && snapshot.configKey !== configKey;
  const stale = isSnapshotStale(snapshot) || configMismatch;

  if (!options.force && snapshot && !stale) return false;

  void runBackgroundScan(overrides).catch(() => undefined);
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
    staleAfterMs: getStaleAfterMs(),
  };
}
