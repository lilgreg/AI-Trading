import { buildSymbolUniverse } from "../lib/symbols";
import { loadSnapshot } from "../lib/scan-cache";

async function main() {
  const universe = await buildSymbolUniverse({
    includeBlueChips: true,
    tradingViewWatchlistUrl: process.env.TRADINGVIEW_WATCHLIST_URL,
  });

  const snxInUniverse = universe.symbols.some((s) => s.yahoo === "SNX");
  console.log("Universe:", universe.symbols.length, "symbols");
  console.log("Sources:", JSON.stringify(universe.sources));
  console.log("SNX in universe:", snxInUniverse ? "yes" : "no");

  const snapshot = await loadSnapshot();
  if (snapshot) {
    const snxInCache = snapshot.results.some((r) => r.symbol === "SNX");
    console.log("Cache:", snapshot.symbolCount, "symbols");
    console.log("SNX in cache:", snxInCache ? "yes" : "no");
  } else {
    console.log("Cache: empty");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
