import { fetchHourlyBars, fetchQuoteMeta } from "../lib/yahoo";
import { parseSymbol } from "../lib/stocks";
import {
  evaluateBullishPatternStatus,
  getBullishParams,
  hasNecklineBreakout,
  sliceRecentBars,
} from "../lib/patterns/utils";
import { detectDoubleBottom } from "../lib/patterns/double-bottom";

async function main() {
  const parsed = parseSymbol("SNX");
  if (!parsed) throw new Error("parse failed");
  const hourly = await fetchHourlyBars(parsed.yahoo, 120);
  const meta = await fetchQuoteMeta(parsed.yahoo);
  const bars = sliceRecentBars(hourly);
  const price = meta.price!;
  const params = getBullishParams("1h");

  const patterns = [
    { confirmIdx: 482, support: 264.99, neckline: 279.59, target: 294.2 },
    { confirmIdx: 488, support: 264.99, neckline: 279.59, target: 294.2 },
  ];

  for (const pattern of patterns) {
    console.log("\nPattern", pattern);
    console.log("  price > neckline*1.002", price > pattern.neckline * 1.002);
    console.log("  hasBreakout", hasNecklineBreakout(bars, pattern.confirmIdx, pattern.neckline));
    console.log(
      "  eval",
      evaluateBullishPatternStatus(bars, pattern, price, params.maxRecencyBars, {
        requireNecklineBreakout: true,
        minAboveNeckline: 1.002,
        minBarsAfterConfirm: 3,
        maxBarsAfterConfirm: 42,
      }),
    );
  }

  console.log("\ndetectDoubleBottom:", detectDoubleBottom(bars, price, "1h"));
}

main().catch(console.error);
