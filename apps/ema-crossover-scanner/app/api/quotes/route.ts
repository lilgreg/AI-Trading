import { NextResponse } from "next/server";
import { loadSnapshot } from "@/lib/scan-cache";
import { fetchQuoteUpdates } from "@/lib/quotes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const snapshot = await loadSnapshot();
  if (!snapshot?.results?.length) {
    return NextResponse.json(
      { updatedAt: new Date().toISOString(), quotes: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const symbols = snapshot.results.map((row) => row.symbol);
  const quotes = await fetchQuoteUpdates(symbols);

  return NextResponse.json(
    { updatedAt: new Date().toISOString(), quotes },
    { headers: { "Cache-Control": "no-store" } },
  );
}
