import { NextRequest, NextResponse } from "next/server";
import {
  buildCacheStatus,
  loadSnapshot,
  toCachedResponse,
} from "@/lib/scan-cache";
import { ensureFreshScan, runBackgroundScan } from "@/lib/scan-job";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function parseForce(searchParams: URLSearchParams): boolean {
  return searchParams.get("force") === "true";
}

function parseStatusOnly(searchParams: URLSearchParams): boolean {
  return searchParams.get("status") === "true";
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const force = parseForce(searchParams);
  const statusOnly = parseStatusOnly(searchParams);

  const snapshot = await loadSnapshot();
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
    const updated = await runBackgroundScan();
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
