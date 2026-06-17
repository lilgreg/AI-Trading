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

    if (qualifying.length === 0) {
      return NextResponse.json(
        {
          updatedAt: new Date().toISOString(),
          symbolCount: 0,
          headlines: [] as Awaited<ReturnType<typeof fetchEmaCrossNews>>,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

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
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
