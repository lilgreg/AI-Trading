import { resolveScanJobConfig } from "./scan-job";
import type { ScanSnapshot } from "./scan-cache";
import { buildSymbolUniverse } from "./symbols";

/** Backfill universeIndex on legacy snapshots that predate index persistence. */
export async function backfillSnapshotIndexes(
  snapshot: ScanSnapshot,
): Promise<ScanSnapshot> {
  if (snapshot.results.every((row) => row.universeIndex != null)) {
    return snapshot;
  }

  const config = resolveScanJobConfig({});
  const { symbols } = await buildSymbolUniverse({
    includeBlueChips: config.includeBlueChips,
    watchlistText: config.watchlistText,
    customSymbols: config.customSymbols,
    tradingViewWatchlistUrl: config.tradingViewWatchlistUrl,
  });

  const indexBySymbol = new Map(
    symbols.map((parsed, index) => [parsed.yahoo, index]),
  );

  const results = snapshot.results.map((row) => ({
    ...row,
    universeIndex: row.universeIndex ?? indexBySymbol.get(row.symbol),
  }));

  const changed = results.some(
    (row, index) => row.universeIndex !== snapshot.results[index]?.universeIndex,
  );
  if (!changed) return snapshot;

  return { ...snapshot, results };
}
