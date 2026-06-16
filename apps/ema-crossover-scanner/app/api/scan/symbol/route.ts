import { NextRequest, NextResponse } from "next/server";
import { scanAndMergeSymbol } from "@/lib/scan-job";
import { parseSymbol } from "@/lib/stocks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("symbol")?.trim();
  if (!raw) {
    return NextResponse.json({ error: "symbol query param required" }, { status: 400 });
  }

  const parsed = parseSymbol(raw);
  if (!parsed) {
    return NextResponse.json({ error: `Invalid symbol: ${raw}` }, { status: 400 });
  }

  try {
    const result = await scanAndMergeSymbol(parsed.yahoo);
    if (!result) {
      return NextResponse.json(
        { error: `Symbol not in universe: ${parsed.yahoo}` },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { result, updatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Symbol scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
