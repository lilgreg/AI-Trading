import { NextResponse } from "next/server";
import { fetchEmaCrossNews, filterEmaCrossNewsSymbols } from "@/lib/news";
import { loadSnapshot } from "@/lib/scan-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const snapshot = await loadSnapshot({ enrich: false });
    const results = snapshot?.results ?? [];
    const qualifying = filterEmaCrossNewsSymbols(results);

    const headlines = await fetchEmaCrossNews(results);

    return NextResponse.json(
      {
        updatedAt: new Date().toISOString(),
        symbolCount: qualifying.length,
        headlines,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch news headlines";
    return NextResponse.json(
      { error: message, headlines: [], symbolCount: 0 },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
