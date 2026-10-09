import { aggregateHourlyTo4h, fetchHourlyBars, fetchQuoteMeta } from "../lib/yahoo";
import { parseSymbol } from "../lib/stocks";
import {
  hasNecklineBreakdown,
  sliceRecentBars,
} from "../lib/patterns/utils";
import { detectDoubleTop } from "../lib/patterns/double-top";

async function main() {
  const parsed = parseSymbol("TSM");
  if (!parsed) throw new Error("parse failed");
  const hourly = await fetchHourlyBars(parsed.yahoo, 120);
  const meta = await fetchQuoteMeta(parsed.yahoo);
  const bars1h = sliceRecentBars(hourly);
  const bars4h = sliceRecentBars(aggregateHourlyTo4h(hourly));
  const price = meta.price!;

  console.log("TSM price:", price);
  console.log("1h DT:", detectDoubleTop(bars1h, price, "1h"));
  console.log("4h DT:", detectDoubleTop(bars4h, price, "4h"));

  const pattern = {
    confirmIdx: 568,
    resistance: 428.989,
    neckline: 405.55,
    target: 382.11,
  };
  console.log("1h breakdown:", hasNecklineBreakdown(bars1h, 568, 405.55));
}

main().catch(console.error);
