import { aggregateHourlyTo4h, fetchHourlyBars, fetchQuoteMeta } from "../lib/yahoo";
import { parseSymbol } from "../lib/stocks";
import { detectDoubleBottom } from "../lib/patterns/double-bottom";
import { detectHeadShoulders } from "../lib/patterns/head-shoulders";
import { detectDoubleTop } from "../lib/patterns/double-top";
import { sliceRecentBars } from "../lib/patterns/utils";

async function debug(ticker: string) {
  const parsed = parseSymbol(ticker);
  if (!parsed) return;
  const hourly = await fetchHourlyBars(parsed.yahoo, 120);
  const bars4h = aggregateHourlyTo4h(hourly);
  const meta = await fetchQuoteMeta(parsed.yahoo);
  const recent1h = sliceRecentBars(hourly);
  const recent4h = sliceRecentBars(bars4h);

  console.log(`\n=== ${ticker} price=${meta.price} ===`);
  for (const [label, bars, tf] of [
    ["1h", recent1h, "1h"],
    ["4h", recent4h, "4h"],
  ] as const) {
    const db = detectDoubleBottom(bars, meta.price, tf);
    const dt = detectDoubleTop(bars, meta.price, tf);
    const hs = detectHeadShoulders(bars, meta.price, tf);
    console.log(`  ${label}: DB=${db.status} DT=${dt.status} HS=${hs.status}`);
    if (db.levels) console.log(`    DB levels:`, db.levels);
    if (dt.levels) console.log(`    DT levels:`, dt.levels);
    if (hs.levels) console.log(`    HS levels:`, hs.levels);
  }
}

async function main() {
  for (const t of ["ARTY", "SNX"]) {
    await debug(t);
  }
}

main().catch(console.error);
