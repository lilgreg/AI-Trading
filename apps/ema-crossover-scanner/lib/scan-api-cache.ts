import { fillCross4hGaps } from "./cross4h-fallback";
import { rowNeedsChartHeal } from "./chart-error-sanitize";
import { countCross4hGapRows } from "./scan-job";
import {
  buildCacheStatus,
  toCachedResponse,
  type ScanSnapshot,
} from "./scan-cache";
import { getScanStorage } from "./scan-storage";

export const CACHED_SCAN_API_KEY = "ema-scanner/cached-scan-api.json";

/** Pre-built GET /api/scan JSON — served from R2 without OpenNext (avoids 1102). */
export async function writeScanApiCache(snapshot: ScanSnapshot): Promise<void> {
  const storage = getScanStorage();
  if (!storage.isPersistent()) return;

  const { results, changed } = fillCross4hGaps(snapshot.results);
  const snap = changed ? { ...snapshot, results } : snapshot;
  const status = await buildCacheStatus(snap);
  const base = toCachedResponse(snap, status);

  const payload = {
    ...base,
    unscannedCount: snap.results.filter((row) => row.error === "Not scanned yet")
      .length,
    chartRefreshPendingCount: snap.results.filter(
      (row) =>
        row.error === "Chart data refresh pending" ||
        (row.ema20 == null && row.error != null && rowNeedsChartHeal(row)),
    ).length,
    cross4hGapCount: countCross4hGapRows(snap.results),
  };

  await storage.writeJson(CACHED_SCAN_API_KEY, payload);
}
