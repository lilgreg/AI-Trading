import { NextRequest, NextResponse } from "next/server";
import { backfillMissingLogoUrls } from "@/lib/logo-backfill";
import {
  rowNeedsChartHeal,
  symbolsWithStaleChartErrors,
} from "@/lib/chart-error-sanitize";
import {
  buildCacheStatus,
  loadSnapshot,
  recoverStuckScanState,
  saveSnapshot,
  toCachedResponse,
  type ScanSnapshot,
} from "@/lib/scan-cache";
import {
  countRetryableResults,
  ensureFreshScan,
  hasUnscannedRows,
  healCacheOnRead,
  retryFailedSymbols,
  runBackgroundScan,
  scanAndMergeSymbol,
} from "@/lib/scan-job";
import { enrichSnapshotSessions } from "@/lib/session-snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYNC_RETRY_FAILED_LIMIT = 25;
const HEAL_MAX_SYMBOLS = 25;
const HEAL_MAX_ROUNDS = 3;
const SESSION_ENRICH_MAX = 8;

function parseForce(searchParams: URLSearchParams): boolean {
  return searchParams.get("force") === "true";
}

function parseHeal(searchParams: URLSearchParams): boolean {
  const heal = searchParams.get("heal");
  return heal === "1" || heal === "true";
}

function parseStatusOnly(searchParams: URLSearchParams): boolean {
  return searchParams.get("status") === "true";
}

async function ensureLogoBackfill(
  snapshot: ScanSnapshot | null,
): Promise<ScanSnapshot | null> {
  if (!snapshot?.results?.length) return snapshot;

  const { results, changed } = await backfillMissingLogoUrls(snapshot.results);
  if (!changed) return snapshot;

  const updated = { ...snapshot, results };
  void saveSnapshot(updated);
  return updated;
}

function queueStaleChartRescans(snapshot: ScanSnapshot | null): void {
  const staleSymbols = snapshot?.results
    ? symbolsWithStaleChartErrors(snapshot.results)
    : [];
  if (staleSymbols.length === 0) return;

  for (const symbol of staleSymbols.slice(0, 12)) {
    void scanAndMergeSymbol(symbol).catch(() => undefined);
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const force = parseForce(searchParams);
  const statusOnly = parseStatusOnly(searchParams);
  const heal = parseHeal(searchParams);

  let snapshot = await loadSnapshot();
  await recoverStuckScanState(snapshot);
  let status = await buildCacheStatus(snapshot);

  const hasUnscanned =
    snapshot?.results?.length ? hasUnscannedRows(snapshot.results) : false;
  const hasStaleChartRows =
    snapshot?.results?.length
      ? snapshot.results.some(rowNeedsChartHeal)
      : false;
  const needsHeal = hasUnscanned || hasStaleChartRows;

  if (statusOnly) {
    if (status.stale && !status.scanInProgress && !hasUnscanned) {
      void ensureFreshScan({});
      status = await buildCacheStatus(snapshot);
    }

    return NextResponse.json({
      scannedAt: snapshot?.scannedAt ?? null,
      completedAt: snapshot?.completedAt ?? null,
      symbolCount: snapshot?.symbolCount ?? 0,
      ...status,
    });
  }

  if (force) {
    void ensureFreshScan({}, { force: true });
  } else if (status.cacheEmpty) {
    void ensureFreshScan({});
  } else if (status.stale && !hasUnscanned) {
    void ensureFreshScan({});
  }

  if (
    !heal &&
    !status.scanInProgress &&
    snapshot?.results?.length &&
    countRetryableResults(snapshot.results) > 0 &&
    !hasUnscanned
  ) {
    try {
      const retried = await retryFailedSymbols({}, {
        maxSymbols: SYNC_RETRY_FAILED_LIMIT,
      });
      if (retried) {
        snapshot = retried;
      }
    } catch {
      // return cached snapshot if inline retry fails
    }
  }

  snapshot = await ensureLogoBackfill(snapshot);

  const shouldHeal =
    heal && snapshot?.results?.length && needsHeal;

  if (shouldHeal) {
    await recoverStuckScanState(snapshot);
    try {
      for (let round = 0; round < HEAL_MAX_ROUNDS; round += 1) {
        if (!snapshot?.results?.length) break;
        const stillNeedsHeal =
          hasUnscannedRows(snapshot.results) ||
          snapshot.results.some(rowNeedsChartHeal);
        if (!stillNeedsHeal) break;
        const healed = await healCacheOnRead(snapshot, {}, {
          maxSymbols: HEAL_MAX_SYMBOLS,
        });
        if (healed) snapshot = healed;
      }
    } catch {
      // return best-effort snapshot if inline heal fails
    }
  } else if (!status.scanInProgress) {
    queueStaleChartRescans(snapshot);
  }

  if (snapshot?.results?.length) {
    try {
      const { results, changed } = await enrichSnapshotSessions(
        snapshot.results,
        { maxSymbols: SESSION_ENRICH_MAX },
      );
      if (changed) {
        snapshot = { ...snapshot, results, lastSavedAt: new Date().toISOString() };
        await saveSnapshot(snapshot);
      }
    } catch {
      // return best-effort snapshot if session enrich fails
    }
  }

  status = await buildCacheStatus(snapshot);

  const unscannedCount = snapshot?.results?.filter(
    (row) => row.error === "Not scanned yet",
  ).length ?? 0;
  const chartRefreshPendingCount = snapshot?.results?.filter(
    (row) => row.error === "Chart data refresh pending",
  ).length ?? 0;

  return NextResponse.json(
    { ...toCachedResponse(snapshot, status), unscannedCount, chartRefreshPendingCount },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function POST(_request: NextRequest) {
  const snapshot = await loadSnapshot();
  await recoverStuckScanState(snapshot);
  const status = await buildCacheStatus(snapshot);

  if (status.scanInProgress) {
    return NextResponse.json({
      ...toCachedResponse(snapshot, status),
      message: "Scan already in progress",
    });
  }

  try {
    const updated = await runBackgroundScan({}, { force: true });
    const freshStatus = await buildCacheStatus(updated);
    return NextResponse.json(toCachedResponse(updated, freshStatus));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json(
      { error: message, ...toCachedResponse(snapshot, status) },
      { status: 500 },
    );
  }
}
