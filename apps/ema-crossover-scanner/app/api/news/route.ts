import { NextResponse } from "next/server";
import { fetchEmaCrossNews, filterEmaCrossNewsSymbols } from "@/lib/news";
import { loadSnapshot } from "@/lib/scan-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const snapshot = await loadSnapshot();
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
}
