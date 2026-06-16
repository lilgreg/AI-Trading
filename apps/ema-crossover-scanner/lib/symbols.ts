import {
  BLUE_CHIP_SYMBOLS,
  isExcludedSymbol,
  parseSymbol,
  parseSymbolList,
} from "@/lib/stocks";
import { fetchTradingViewSharedWatchlist } from "@/lib/tradingview-watchlist";
import type { ParsedSymbol } from "@/lib/types";

export interface SymbolUniverseResult {
  symbols: ParsedSymbol[];
  sources: {
    blueChips: boolean;
    watchlist: boolean;
    custom: boolean;
    tradingViewWatchlist: boolean;
  };
  tradingViewWatchlistName?: string;
}

export async function buildSymbolUniverse(options: {
  includeBlueChips: boolean;
  watchlistText?: string | null;
  customSymbols?: string | null;
  tradingViewWatchlistUrl?: string | null;
}): Promise<SymbolUniverseResult> {
  const seen = new Set<string>();
  const symbols: ParsedSymbol[] = [];
  let tradingViewWatchlistName: string | undefined;

  const addParsed = (list: ParsedSymbol[]) => {
    for (const s of list) {
      if (seen.has(s.yahoo) || isExcludedSymbol(s.yahoo)) continue;
      seen.add(s.yahoo);
      symbols.push(s);
    }
  };

  const addText = (text: string) => {
    addParsed(parseSymbolList(text));
  };

  if (options.includeBlueChips) {
    for (const sym of BLUE_CHIP_SYMBOLS) {
      if (isExcludedSymbol(sym)) continue;
      const parsed = parseSymbol(sym);
      if (!parsed || seen.has(parsed.yahoo)) continue;
      seen.add(parsed.yahoo);
      symbols.push(parsed);
    }
  }

  const envWatchlist = process.env.WATCHLIST_SYMBOLS?.trim();
  if (envWatchlist) addText(envWatchlist);
  if (options.watchlistText) addText(options.watchlistText);
  if (options.customSymbols) addText(options.customSymbols);

  const tvUrl =
    options.tradingViewWatchlistUrl?.trim() ||
    process.env.TRADINGVIEW_WATCHLIST_URL?.trim() ||
    null;

  let tradingViewWatchlist = false;
  if (tvUrl) {
    const { watchlist, parsed } = await fetchTradingViewSharedWatchlist(tvUrl);
    tradingViewWatchlist = true;
    tradingViewWatchlistName = watchlist.name;
    addParsed(parsed);
  }

  return {
    symbols,
    tradingViewWatchlistName,
    sources: {
      blueChips: options.includeBlueChips,
      watchlist: Boolean(envWatchlist || options.watchlistText),
      custom: Boolean(options.customSymbols),
      tradingViewWatchlist,
    },
  };
}
