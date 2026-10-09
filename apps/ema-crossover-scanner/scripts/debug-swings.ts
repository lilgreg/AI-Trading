import { aggregateHourlyTo4h, fetchHourlyBars, fetchQuoteMeta } from "../lib/yahoo";
import { parseSymbol } from "../lib/stocks";
import {
  barHigh,
  barLow,
  findSwingHighIndices,
  findSwingLowIndices,
  getBullishParams,
  getHeadShouldersParams,
  sliceRecentBars,
} from "../lib/patterns/utils";

async function debugSwings(ticker: string) {
  const parsed = parseSymbol(ticker);
  if (!parsed) return;
  const hourly = await fetchHourlyBars(parsed.yahoo, 120);
  const bars4h = aggregateHourlyTo4h(hourly);
  const meta = await fetchQuoteMeta(parsed.yahoo);

  for (const [label, bars] of [
    ["1h", sliceRecentBars(hourly)],
    ["4h", sliceRecentBars(bars4h)],
  ] as const) {
    const hsParams = getHeadShouldersParams(label as "1h" | "4h");
    const dbParams = getBullishParams(label as "1h" | "4h");
    const swingHighs = findSwingHighIndices(bars, hsParams.swingWindow);
    const swingLows = findSwingLowIndices(bars, dbParams.swingWindow);

    console.log(`\n${ticker} ${label}: price=${meta.price} bars=${bars.length}`);
    console.log(`  swingHighs (${swingHighs.length}): last 8:`);
    for (const idx of swingHighs.slice(-8)) {
      console.log(
        `    [${idx}] ${bars[idx].date.toISOString().slice(0, 16)} high=${barHigh(bars[idx]).toFixed(2)}`,
      );
    }
    console.log(`  swingLows (${swingLows.length}): last 8:`);
    for (const idx of swingLows.slice(-8)) {
      console.log(
        `    [${idx}] ${bars[idx].date.toISOString().slice(0, 16)} low=${barLow(bars[idx]).toFixed(2)}`,
      );
    }
  }
}

async function main() {
  for (const t of ["ARTY", "SNX"]) await debugSwings(t);
}

main().catch(console.error);
