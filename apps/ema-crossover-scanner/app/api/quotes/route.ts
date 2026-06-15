import { NextRequest, NextResponse } from "next/server";
import { loadSnapshot } from "@/lib/scan-cache";
import { fetchQuoteUpdates } from "@/lib/quotes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_QUOTE_CHUNK = 80;

function parseNonNegativeInt(value: string | null, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export async function GET(request: NextRequest) {
  const snapshot = await loadSnapshot();
  if (!snapshot?.results?.length) {
    return NextResponse.json(
      { updatedAt: new Date().toISOString(), quotes: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const { searchParams } = request.nextUrl;
  const offset = parseNonNegativeInt(searchParams.get("offset"), 0);
  const limit = parseNonNegativeInt(
    searchParams.get("limit"),
    DEFAULT_QUOTE_CHUNK,
  );

  const symbols = snapshot.results.map((row) => row.symbol);
  const quotes = await fetchQuoteUpdates(symbols, { offset, limit });

  return NextResponse.json(
    {
      updatedAt: new Date().toISOString(),
      offset,
      limit,
      totalSymbols: symbols.length,
      quotes,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
