import { NextRequest, NextResponse } from "next/server";
import { backfillMissingLogoUrls } from "@/lib/logo-backfill";
import {
  buildCacheStatus,
  loadSnapshot,
  saveSnapshot,
  toCachedResponse,
  type ScanSnapshot,
} from "@/lib/scan-cache";
import { CHART_TAIL_SYMBOL_INDEX } from "@/lib/chart-data";
import {
  countTailChartErrors,
  resolveScanJobConfig,
  retryTailSymbols,
} from "@/lib/scan-job";
import { buildSymbolUniverse } from "@/lib/symbols";

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
    5,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 5)),
  );

  let snapshot = await loadSnapshot();
  const config = resolveScanJobConfig({});
  const { symbols } = await buildSymbolUniverse({
    includeBlueChips: config.includeBlueChips,
    watchlistText: config.watchlistText,
    customSymbols: config.customSymbols,
    tradingViewWatchlistUrl: config.tradingViewWatchlistUrl,
  });
  const symbolIndexByYahoo = new Map(
    symbols.map((parsed, index) => [parsed.yahoo, index]),
  );

  const tailErrorsBefore = snapshot
    ? countTailChartErrors(snapshot.results, symbolIndexByYahoo)
    : 0;

  if (tailErrorsBefore === 0) {
    const status = await buildCacheStatus(snapshot);
    return NextResponse.json({
      ...toCachedResponse(snapshot, status),
      retried: 0,
      tailErrorsRemaining: 0,
      message: "No tail chart errors to retry",
    });
  }

  try {
    const updated = await retryTailSymbols({}, { maxSymbols });
    if (!updated) {
      const status = await buildCacheStatus(snapshot);
      return NextResponse.json({
        ...toCachedResponse(snapshot, status),
        retried: 0,
        tailErrorsRemaining: tailErrorsBefore,
        message: "Tail retry skipped (scan lock held)",
      });
    }

    snapshot = await ensureLogoBackfill(updated);
    const status = await buildCacheStatus(snapshot);
    const tailErrorsAfter = snapshot
      ? countTailChartErrors(snapshot.results, symbolIndexByYahoo)
      : 0;

    return NextResponse.json({
      ...toCachedResponse(snapshot, status),
      retried: Math.max(0, tailErrorsBefore - tailErrorsAfter),
      tailErrorsRemaining: tailErrorsAfter,
      tailSymbolStart: CHART_TAIL_SYMBOL_INDEX + 1,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tail retry failed";
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
