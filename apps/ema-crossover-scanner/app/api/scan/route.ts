import { NextRequest, NextResponse } from "next/server";
import { backfillMissingLogoUrls } from "@/lib/logo-backfill";
import {
  buildCacheStatus,
  loadSnapshot,
  saveSnapshot,
  toCachedResponse,
  type ScanSnapshot,
} from "@/lib/scan-cache";
import {
  ensureFreshScan,
  retryFailedSymbolsInBackground,
  runBackgroundScan,
} from "@/lib/scan-job";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

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
  } else if (
    !status.scanInProgress &&
    snapshot?.results?.some((row) => row.error)
  ) {
    void retryFailedSymbolsInBackground({});
  }

  snapshot = await ensureLogoBackfill(snapshot);
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
