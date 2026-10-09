import { aggregateHourlyTo4h, fetchHourlyBars, fetchQuoteMeta } from "../lib/yahoo";
import { detectDoubleBottom } from "../lib/patterns/double-bottom";
import { detectDoubleTop } from "../lib/patterns/double-top";
import {
  barHigh,
  barLow,
  findSwingHighIndices,
  findSwingLowIndices,
  getBearishParams,
  getBullishParams,
  highsWithinTolerance,
  lowsWithinTolerance,
  sliceRecentBars,
} from "../lib/patterns/utils";
import { parseSymbol } from "../lib/stocks";

const ticker = process.argv[2] ?? "SNX";

async function main() {
  const parsed = parseSymbol(ticker);
  if (!parsed) throw new Error("parse failed");

  const hourly = await fetchHourlyBars(parsed.yahoo, 120);
  const meta = await fetchQuoteMeta(parsed.yahoo);
  const bars1h = sliceRecentBars(hourly);
  const bars4h = sliceRecentBars(aggregateHourlyTo4h(hourly));
  const price = meta.price!;

  console.log(`${ticker} price:`, price);

  for (const tf of ["1h", "4h"] as const) {
    const bars = tf === "1h" ? bars1h : bars4h;
    const db = detectDoubleBottom(bars, price, tf);
    const dt = detectDoubleTop(bars, price, tf);
    console.log(`\n${tf} DB:`, db);
    console.log(`${tf} DT:`, dt);

    const bParams = getBullishParams(tf);
    const swingLows = findSwingLowIndices(bars, bParams.swingWindow);
    console.log(`${tf} recent swing lows (last 5):`, swingLows.slice(-5).map((i) => ({
      idx: i,
      date: bars[i].date.toISOString().slice(0, 16),
      low: barLow(bars[i]),
    })));

    const bearParams = getBearishParams(tf);
    const swingHighs = findSwingHighIndices(bars, bearParams.swingWindow);
    console.log(`${tf} recent swing highs (last 5):`, swingHighs.slice(-5).map((i) => ({
      idx: i,
      date: bars[i].date.toISOString().slice(0, 16),
      high: barHigh(bars[i]),
    })));

    // Show best DT candidate
    for (let s = swingHighs.length - 1; s >= 1; s--) {
      const secondHighIdx = swingHighs[s];
      const secondHigh = barHigh(bars[secondHighIdx]);
      for (let f = s - 1; f >= 0; f--) {
        const firstHighIdx = swingHighs[f];
        const separation = secondHighIdx - firstHighIdx;
        if (separation < bearParams.minBarsBetween || separation > bearParams.maxBarsBetween) continue;
        const firstHigh = barHigh(bars[firstHighIdx]);
        if (!highsWithinTolerance(firstHigh, secondHigh, bearParams.highTolerance)) continue;
        let neckline = Infinity;
        for (let i = firstHighIdx + 1; i < secondHighIdx; i++) {
          neckline = Math.min(neckline, barLow(bars[i]));
        }
        const resistance = Math.max(firstHigh, secondHigh);
        const drop = (resistance - neckline) / resistance;
        if (drop < bearParams.minNecklineDrop) continue;
        console.log(`${tf} DT candidate:`, {
          firstHighIdx,
          secondHighIdx,
          firstHigh,
          secondHigh,
          separation,
          neckline,
          drop,
          barsAfter: bars.length - 1 - secondHighIdx,
        });
        break;
      }
      break;
    }

    // Show best DB candidate
    for (let s = swingLows.length - 1; s >= 1; s--) {
      const secondLowIdx = swingLows[s];
      const secondLow = barLow(bars[secondLowIdx]);
      for (let f = s - 1; f >= 0; f--) {
        const firstLowIdx = swingLows[f];
        const separation = secondLowIdx - firstLowIdx;
        if (separation < bParams.minBarsBetween || separation > bParams.maxBarsBetween) continue;
        const firstLow = barLow(bars[firstLowIdx]);
        if (!lowsWithinTolerance(firstLow, secondLow, bParams.lowTolerance)) continue;
        let neckline = -Infinity;
        for (let i = firstLowIdx + 1; i < secondLowIdx; i++) {
          neckline = Math.max(neckline, barHigh(bars[i]));
        }
        const support = Math.min(firstLow, secondLow);
        const lift = (neckline - support) / support;
        if (lift < bParams.minNecklineLift) continue;
        console.log(`${tf} DB candidate:`, {
          firstLowIdx,
          secondLowIdx,
          firstLow,
          secondLow,
          separation,
          neckline,
          lift,
          barsAfter: bars.length - 1 - secondLowIdx,
        });
        break;
      }
      break;
    }
  }
}

main().catch(console.error);
