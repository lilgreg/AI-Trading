import { NextRequest, NextResponse } from "next/server";
import { backfillMissingLogoUrls } from "@/lib/logo-backfill";
import {
  buildCacheStatus,
  loadSnapshot,
  saveSnapshot,
  toCachedResponse,
  type ScanSnapshot,
} from "@/lib/scan-cache";
import { countRetryableResults, retryFailedSymbols } from "@/lib/scan-job";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  const maxSymbols = Math.min(
    50,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 50)),
  );

  let snapshot = await loadSnapshot();
  const retryableBefore = snapshot ? countRetryableResults(snapshot.results) : 0;

  if (retryableBefore === 0) {
    const status = await buildCacheStatus(snapshot);
    return NextResponse.json({
      ...toCachedResponse(snapshot, status),
      retried: 0,
      retryableRemaining: 0,
      message: "No failed symbols to retry",
    });
  }

  try {
    const updated = await retryFailedSymbols({}, { maxSymbols });
    snapshot = await ensureLogoBackfill(updated);
    const status = await buildCacheStatus(snapshot);
    const retryableAfter = snapshot ? countRetryableResults(snapshot.results) : 0;

    return NextResponse.json({
      ...toCachedResponse(snapshot, status),
      retried: Math.max(0, retryableBefore - retryableAfter),
      retryableRemaining: retryableAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Retry failed";
    const status = await buildCacheStatus(snapshot);
    return NextResponse.json(
      { error: message, ...toCachedResponse(snapshot, status) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
