import { NextRequest, NextResponse } from "next/server";
import { CHART_TAIL_SYMBOL_INDEX } from "@/lib/chart-data";
import { applyQuoteUpdates } from "@/lib/quote-updates";
import { loadSnapshot, saveSnapshot } from "@/lib/scan-cache";
import { fetchQuoteUpdates } from "@/lib/quotes";
import { enrichSnapshotSessions } from "@/lib/session-snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_QUOTE_CHUNK = 80;

function parseNonNegativeInt(value: string | null, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function parseOptionalInt(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
}

export async function GET(request: NextRequest) {
  try {
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
  const universeMin =
    parseOptionalInt(searchParams.get("universeMin")) ??
    parseOptionalInt(searchParams.get("tailFrom"));
  const universeMax = parseOptionalInt(searchParams.get("universeMax"));

  let rows = snapshot.results;
  if (universeMin != null) {
    rows = rows.filter(
      (row) => (row.universeIndex ?? -1) >= universeMin,
    );
  }
  if (universeMax != null) {
    rows = rows.filter(
      (row) => (row.universeIndex ?? Number.MAX_SAFE_INTEGER) <= universeMax,
    );
  }

  const symbols = rows
    .slice()
    .sort((a, b) => (a.universeIndex ?? 0) - (b.universeIndex ?? 0))
    .map((row) => row.symbol);
  const existingBySymbol = new Map(
    snapshot.results.map((row) => [row.symbol, row]),
  );
  const quotes = await fetchQuoteUpdates(symbols, {
    offset,
    limit,
    existingBySymbol,
  });

  let mergedResults = applyQuoteUpdates(snapshot.results, quotes);
  let sessionChanged = false;
  try {
    const enriched = await enrichSnapshotSessions(mergedResults, {
      maxSymbols: 20,
    });
    mergedResults = enriched.results;
    sessionChanged = enriched.changed;
  } catch {
    // best-effort session enrich
  }

  const changed =
    sessionChanged ||
    mergedResults.some((row, index) => {
      const prev = snapshot.results[index];
      return (
        row.preMarketChange !== prev.preMarketChange ||
        row.regularMarketChange !== prev.regularMarketChange ||
        row.postMarketChange !== prev.postMarketChange ||
        row.price !== prev.price ||
        row.sessionSnapshotDate !== prev.sessionSnapshotDate
      );
    });

  if (changed) {
    await saveSnapshot({
      ...snapshot,
      results: mergedResults,
      lastSavedAt: new Date().toISOString(),
    });
  }

  return NextResponse.json(
    {
      updatedAt: new Date().toISOString(),
      offset,
      limit,
      totalSymbols: symbols.length,
      universeMin: universeMin ?? null,
      universeMax: universeMax ?? null,
      tailSymbolIndex: CHART_TAIL_SYMBOL_INDEX,
      quotes,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Quote fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
