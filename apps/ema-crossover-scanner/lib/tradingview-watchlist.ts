import { parseSymbol } from "@/lib/stocks";
import type { ParsedSymbol } from "@/lib/types";

const WATCHLIST_ID_PATTERN = /\/watchlists\/(\d+)\/?(?:\?|$)/i;

export interface TradingViewWatchlist {
  id: number;
  name: string;
  symbols: string[];
}

export function extractWatchlistId(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  try {
    const url = trimmed.startsWith("http")
      ? new URL(trimmed)
      : new URL(`https://www.tradingview.com/watchlists/${trimmed}/`);
    const match = url.pathname.match(WATCHLIST_ID_PATTERN);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

export function buildWatchlistPageUrl(id: number): string {
  return `https://www.tradingview.com/watchlists/${id}/`;
}

/** Parse symbols from a shared TradingView watchlist HTML page. */
export function parseWatchlistFromHtml(html: string): TradingViewWatchlist | null {
  const initDataMatch = html.match(
    /<script type="application\/prs\.init-data\+json">([\s\S]*?)<\/script>/,
  );

  if (initDataMatch) {
    try {
      const initData = JSON.parse(initDataMatch[1]) as {
        sharedWatchlist?: { list?: { id?: number; name?: string; symbols?: string[] } };
      };
      const list = initData.sharedWatchlist?.list;
      if (list?.id && Array.isArray(list.symbols)) {
        return normalizeWatchlist(list.id, list.name, list.symbols);
      }
    } catch {
      // fall through to regex parsing
    }
  }

  const listMatch = html.match(/"list"\s*:\s*(\{[\s\S]*?\})\s*,\s*"author"/);
  if (listMatch) {
    return parseListObject(listMatch[1]);
  }

  return null;
}

function normalizeWatchlist(
  id: number,
  name: string | undefined,
  symbols: string[],
): TradingViewWatchlist {
  return {
    id,
    name: name ?? "TradingView watchlist",
    symbols: symbols.filter(
      (symbol) => typeof symbol === "string" && symbol.trim() && !symbol.startsWith("###"),
    ),
  };
}

function parseListObject(raw: string): TradingViewWatchlist | null {
  try {
    const parsed = JSON.parse(raw) as {
      id?: number;
      name?: string;
      symbols?: string[];
    };

    if (!parsed.id || !Array.isArray(parsed.symbols)) return null;
    return normalizeWatchlist(parsed.id, parsed.name, parsed.symbols);
  } catch {
    const symbolsMatch = raw.match(/"symbols"\s*:\s*(\[[\s\S]*?\])/);
    const idMatch = raw.match(/"id"\s*:\s*(\d+)/);
    const nameMatch = raw.match(/"name"\s*:\s*"([^"]+)"/);

    if (!symbolsMatch || !idMatch) return null;

    try {
      const symbols = JSON.parse(symbolsMatch[1]) as string[];
      return normalizeWatchlist(Number(idMatch[1]), nameMatch?.[1], symbols);
    } catch {
      return null;
    }
  }
}

export async function fetchTradingViewSharedWatchlist(
  urlOrId: string,
): Promise<{ watchlist: TradingViewWatchlist; parsed: ParsedSymbol[] }> {
  const id = extractWatchlistId(urlOrId);
  if (!id) {
    throw new Error("Invalid TradingView watchlist link or ID");
  }

  const pageUrl = buildWatchlistPageUrl(id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  let response: Response;
  try {
    response = await fetch(pageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      next: { revalidate: 3600 },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`TradingView watchlist fetch failed (${response.status})`);
  }

  const html = await response.text();
  const watchlist = parseWatchlistFromHtml(html);

  if (!watchlist) {
    throw new Error("Could not parse symbols from TradingView watchlist page");
  }

  const seen = new Set<string>();
  const parsed: ParsedSymbol[] = [];

  for (const raw of watchlist.symbols) {
    const symbol = parseSymbol(raw);
    if (!symbol || seen.has(symbol.yahoo)) continue;
    seen.add(symbol.yahoo);
    parsed.push(symbol);
  }

  return { watchlist, parsed };
}
