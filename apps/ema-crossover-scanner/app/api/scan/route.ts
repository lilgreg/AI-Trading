import { NextRequest, NextResponse } from "next/server";
import { scanSymbols } from "@/lib/scanner";
import { buildSymbolUniverse } from "@/lib/symbols";
import type { ScanResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function parseHistoryDays(value: string | null): number {
  const parsed = Number(value ?? process.env.HISTORY_DAYS ?? 120);
  if (!Number.isFinite(parsed) || parsed < 60) return 120;
  return Math.min(parsed, 365);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const customSymbols = searchParams.get("symbols");
  const watchlistText = searchParams.get("watchlist");
  const tradingViewWatchlistUrl = searchParams.get("tvWatchlist");
  const includeBlueChips = searchParams.get("blueChips") !== "false";
  const onlyAbove = searchParams.get("onlyAbove") === "true";
  const historyDays = parseHistoryDays(searchParams.get("days"));

  const { symbols, sources, tradingViewWatchlistName } = await buildSymbolUniverse({
    includeBlueChips,
    watchlistText,
    customSymbols,
    tradingViewWatchlistUrl,
  });

  if (symbols.length === 0) {
    return NextResponse.json(
      { error: "No symbols configured. Add WATCHLIST_SYMBOLS or pass ?symbols=" },
      { status: 400 },
    );
  }

  let results = await scanSymbols(symbols, historyDays);

  if (onlyAbove) {
    results = results.filter((r) => r.ema20Above50 && !r.error);
  }

  const response: ScanResponse = {
    scannedAt: new Date().toISOString(),
    symbolCount: results.length,
    results,
    sources,
    tradingViewWatchlistName,
  };

  return NextResponse.json(response);
}

export async function POST(request: NextRequest) {
  let body: {
    watchlist?: string;
    tvWatchlist?: string;
    symbols?: string;
    blueChips?: boolean;
    onlyAbove?: boolean;
    days?: number;
  } = {};

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const params = new URLSearchParams();
  if (body.symbols) params.set("symbols", body.symbols);
  if (body.watchlist) params.set("watchlist", body.watchlist);
  if (body.tvWatchlist) params.set("tvWatchlist", body.tvWatchlist);
  if (body.blueChips === false) params.set("blueChips", "false");
  if (body.onlyAbove) params.set("onlyAbove", "true");
  if (body.days) params.set("days", String(body.days));

  const url = new URL(request.url);
  url.search = params.toString();

  return GET(new NextRequest(url, { method: "GET" }));
}
