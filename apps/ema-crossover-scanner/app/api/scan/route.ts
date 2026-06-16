import { NextRequest, NextResponse } from "next/server";
import { backfillMissingLogoUrls } from "@/lib/logo-backfill";
import {
  symbolsWithStaleChartErrors,
} from "@/lib/chart-error-sanitize";
import {
  buildCacheStatus,
  loadSnapshot,
  saveSnapshot,
  toCachedResponse,
  type ScanSnapshot,
} from "@/lib/scan-cache";
import {
  countRetryableResults,
  ensureFreshScan,
  retryFailedSymbols,
  runBackgroundScan,
  scanAndMergeSymbol,
} from "@/lib/scan-job";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYNC_RETRY_FAILED_LIMIT = 10;

function parseForce(searchParams: URLSearchParams): boolean {
  return searchParams.get("force") === "true";
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

  let snapshot = await loadSnapshot();
  let status = await buildCacheStatus(snapshot);

  if (statusOnly) {
    if (status.stale && !status.scanInProgress) {
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
  } else if (status.cacheEmpty || status.stale) {
    void ensureFreshScan({});
  }

  if (
    !status.scanInProgress &&
    snapshot?.results?.length &&
    countRetryableResults(snapshot.results) > 0
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
  queueStaleChartRescans(snapshot);
  status = await buildCacheStatus(snapshot);

  return NextResponse.json(toCachedResponse(snapshot, status), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(_request: NextRequest) {
  const snapshot = await loadSnapshot();
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
