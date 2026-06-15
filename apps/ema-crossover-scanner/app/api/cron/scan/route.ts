import { NextRequest, NextResponse } from "next/server";
import { runBackgroundScan } from "@/lib/scan-job";

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

  try {
    const snapshot = await runBackgroundScan();
    if (!snapshot) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "Scan already in progress",
      });
    }

    return NextResponse.json({
      ok: true,
      scannedAt: snapshot.scannedAt,
      symbolCount: snapshot.symbolCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cron scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
