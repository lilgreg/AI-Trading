import { NextRequest, NextResponse } from "next/server";
import { runScanChunk } from "@/lib/scan-job";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";

  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 80)));

  try {
    const snapshot = await runScanChunk(offset, limit);
    if (!snapshot) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "Scan already in progress",
        offset,
        limit,
      });
    }

    return NextResponse.json({
      ok: true,
      offset,
      limit,
      scannedAt: snapshot.scannedAt,
      symbolCount: snapshot.symbolCount,
      scanComplete: snapshot.scanComplete,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chunk scan failed";
    return NextResponse.json({ error: message, offset, limit }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
