import { fetchHourlyBars } from "../lib/chart-data";
import { findMostRecentBullishCrossover } from "../lib/ema";
import { aggregateHourlyTo4h } from "../lib/yahoo";

async function main() {
  const symbol = process.argv[2] ?? "AAPL";
  const { bars, source } = await fetchHourlyBars(symbol, 180, { skipStagger: true });
  const bars4h = aggregateHourlyTo4h(bars);
  const c1 = findMostRecentBullishCrossover(bars, 20, 50);
  const c4 = findMostRecentBullishCrossover(bars4h, 20, 50);
  console.log("symbol:", symbol, "bars:", bars.length, "source:", source);
  console.log("cross1h:", c1?.date?.toISOString() ?? "null");
  console.log("cross4h:", c4?.date?.toISOString() ?? "null");
}

main().catch(console.error);
