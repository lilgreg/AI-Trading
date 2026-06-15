import {
  BLUE_CHIP_SYMBOLS,
  parseSymbol,
  parseSymbolList,
} from "@/lib/stocks";
import type { ParsedSymbol } from "@/lib/types";

export function buildSymbolUniverse(options: {
  includeBlueChips: boolean;
  watchlistText?: string | null;
  customSymbols?: string | null;
}): { symbols: ParsedSymbol[]; sources: { blueChips: boolean; watchlist: boolean; custom: boolean } } {
  const seen = new Set<string>();
  const symbols: ParsedSymbol[] = [];

  const addText = (text: string) => {
    for (const s of parseSymbolList(text)) {
      if (seen.has(s.yahoo)) continue;
      seen.add(s.yahoo);
      symbols.push(s);
    }
  };

  if (options.includeBlueChips) {
    for (const sym of BLUE_CHIP_SYMBOLS) {
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

  return {
    symbols,
    sources: {
      blueChips: options.includeBlueChips,
      watchlist: Boolean(envWatchlist || options.watchlistText),
      custom: Boolean(options.customSymbols),
    },
  };
}
