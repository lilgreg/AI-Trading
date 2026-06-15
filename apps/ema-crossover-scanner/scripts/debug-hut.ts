import { aggregateHourlyTo4h, fetchHourlyBars, fetchQuoteMeta } from "../lib/yahoo";
import {
  barHigh,
  barLow,
  findSwingHighIndices,
  getBearishParams,
  highsWithinTolerance,
  sliceRecentBars,
  evaluateBearishPatternStatus,
} from "../lib/patterns/utils";
import { parseSymbol } from "../lib/stocks";

async function main() {
  const parsed = parseSymbol("HUT");
  if (!parsed) throw new Error("parse failed");

  const hourly = await fetchHourlyBars(parsed.yahoo, 120);
  const meta = await fetchQuoteMeta(parsed.yahoo);
  const bars = sliceRecentBars(hourly);
  const tf = "1h";
  const params = getBearishParams(tf);
  const swingHighs = findSwingHighIndices(bars, params.swingWindow);
  console.log("HUT price:", meta.price, "swingHighs:", swingHighs.length);

  for (let s = swingHighs.length - 1; s >= 1; s--) {
    const secondHighIdx = swingHighs[s];
    const secondHigh = barHigh(bars[secondHighIdx]);

    for (let f = s - 1; f >= 0; f--) {
      const firstHighIdx = swingHighs[f];
      const separation = secondHighIdx - firstHighIdx;
      if (separation < params.minBarsBetween || separation > params.maxBarsBetween) continue;

      const firstHigh = barHigh(bars[firstHighIdx]);
      if (!highsWithinTolerance(firstHigh, secondHigh, params.highTolerance)) continue;

      let neckline = Infinity;
      let troughIdx = -1;
      for (let i = firstHighIdx + 1; i < secondHighIdx; i++) {
        const low = barLow(bars[i]);
        if (low < neckline) {
          neckline = low;
          troughIdx = i;
        }
      }
      if (!Number.isFinite(neckline) || troughIdx < 0) continue;

      const resistance = Math.max(firstHigh, secondHigh);
      const drop = (resistance - neckline) / resistance;
      if (drop < params.minNecklineDrop) continue;

      const pattern = {
        confirmIdx: secondHighIdx,
        resistance,
        neckline,
        target: neckline - (resistance - neckline),
      };

      const evalResult = evaluateBearishPatternStatus(
        bars,
        pattern,
        meta.price!,
        params.maxRecencyBars,
        { minBarsAfterConfirm: 3, maxBarsAfterConfirm: 42, requireBreakdownForActive: false },
      );

      console.log({
        firstHighIdx,
        secondHighIdx,
        separation,
        resistance,
        neckline,
        drop,
        evalResult,
        barsAfter: bars.length - 1 - secondHighIdx,
      });
    }
  }
}

main();
