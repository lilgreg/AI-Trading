import { aggregateHourlyTo4h, fetchHourlyBars, fetchQuoteMeta } from "../lib/yahoo";
import { parseSymbol } from "../lib/stocks";
import {
  barHigh,
  barLow,
  evaluateBullishPatternStatus,
  evaluateHeadShouldersStatus,
  findSwingHighIndices,
  findSwingLowIndices,
  getBullishParams,
  getHeadShouldersParams,
  highsWithinTolerance,
  lowsWithinTolerance,
  sliceRecentBars,
} from "../lib/patterns/utils";

function tryDb(bars: ReturnType<typeof sliceRecentBars>, tf: "1h" | "4h", price: number) {
  const params = getBullishParams(tf);
  const swingLows = findSwingLowIndices(bars, params.swingWindow);
  let found = 0;
  for (let s = swingLows.length - 1; s >= 1; s--) {
    const secondLowIdx = swingLows[s];
    const secondLow = barLow(bars[secondLowIdx]);
    for (let f = s - 1; f >= 0; f--) {
      const firstLowIdx = swingLows[f];
      const separation = secondLowIdx - firstLowIdx;
      if (separation < params.minBarsBetween || separation > params.maxBarsBetween) continue;
      const firstLow = barLow(bars[firstLowIdx]);
      if (!lowsWithinTolerance(firstLow, secondLow, params.lowTolerance)) continue;
      let neckline = -Infinity;
      let peakIdx = -1;
      for (let i = firstLowIdx + 1; i < secondLowIdx; i++) {
        const high = barHigh(bars[i]);
        if (high > neckline) {
          neckline = high;
          peakIdx = i;
        }
      }
      if (!Number.isFinite(neckline)) continue;
      const support = Math.min(firstLow, secondLow);
      const lift = (neckline - support) / support;
      if (lift < params.minNecklineLift) continue;
      found++;
      const pattern = { confirmIdx: secondLowIdx, support, neckline, target: neckline + (neckline - support) };
      const evalResult = evaluateBullishPatternStatus(bars, pattern, price, params.maxRecencyBars, {
        minBarsAfterConfirm: 3,
        maxBarsAfterConfirm: tf === "4h" ? 32 : 42,
      });
      if (found <= 5) {
        console.log(
          `  DB candidate f=${firstLowIdx} s=${secondLowIdx} support=${support.toFixed(2)} neck=${neckline.toFixed(2)} lift=${(lift * 100).toFixed(1)}% => ${evalResult.status}`,
        );
      }
      if (evalResult.status === "Active") return;
    }
  }
}

function tryHs(bars: ReturnType<typeof sliceRecentBars>, tf: "1h" | "4h", price: number) {
  const params = getHeadShouldersParams(tf);
  const swingHighs = findSwingHighIndices(bars, params.swingWindow);
  let found = 0;
  for (let r = swingHighs.length - 1; r >= 2; r--) {
    const rightIdx = swingHighs[r];
    const rightHigh = barHigh(bars[rightIdx]);
    for (let h = r - 1; h >= 1; h--) {
      const headIdx = swingHighs[h];
      const headHigh = barHigh(bars[headIdx]);
      if (rightIdx - headIdx < params.minBarsBetween) continue;
      for (let l = h - 1; l >= 0; l--) {
        const leftIdx = swingHighs[l];
        const leftHigh = barHigh(bars[leftIdx]);
        if (headIdx - leftIdx < params.minBarsBetween) continue;
        if (rightIdx - leftIdx > params.maxPatternSpan) continue;
        if (headHigh <= leftHigh * 1.003 || headHigh <= rightHigh * 1.003) continue;
        if (!highsWithinTolerance(leftHigh, rightHigh, params.shoulderTolerance)) continue;
        const shoulderAvg = (leftHigh + rightHigh) / 2;
        const headDepth = (headHigh - shoulderAvg) / shoulderAvg;
        if (headDepth < params.minHeadDepth) continue;
        let leftTrough = Infinity;
        for (let i = leftIdx + 1; i < headIdx; i++) leftTrough = Math.min(leftTrough, barLow(bars[i]));
        let rightTrough = Infinity;
        for (let i = headIdx + 1; i < rightIdx; i++) rightTrough = Math.min(rightTrough, barLow(bars[i]));
        if (!Number.isFinite(leftTrough) || !Number.isFinite(rightTrough)) continue;
        const neckline = Math.max(leftTrough, rightTrough);
        const drop = (headHigh - neckline) / headHigh;
        if (drop < params.minNecklineDrop) continue;
        found++;
        const pattern = {
          confirmIdx: rightIdx,
          resistance: headHigh,
          neckline,
          target: neckline - (headHigh - neckline),
        };
        const evalResult = evaluateHeadShouldersStatus(bars, pattern, price, params.maxRecencyBars, {
          minBarsAfterConfirm: 3,
          maxBarsAfterConfirm: tf === "4h" ? 32 : 42,
        });
        if (found <= 8) {
          console.log(
            `  HS candidate l=${leftIdx} h=${headIdx} r=${rightIdx} L=${leftHigh.toFixed(2)} H=${headHigh.toFixed(2)} R=${rightHigh.toFixed(2)} depth=${(headDepth * 100).toFixed(1)}% => ${evalResult.status}`,
          );
        }
        if (evalResult.status === "Active") return;
      }
    }
  }
}

async function main() {
  for (const ticker of ["ARTY", "SNX"]) {
    const parsed = parseSymbol(ticker)!;
    const hourly = await fetchHourlyBars(parsed.yahoo, 120);
    const bars4h = aggregateHourlyTo4h(hourly);
    const meta = await fetchQuoteMeta(parsed.yahoo);
    for (const [label, bars] of [
      ["1h", sliceRecentBars(hourly)],
      ["4h", sliceRecentBars(bars4h)],
    ] as const) {
      console.log(`\n${ticker} ${label} price=${meta.price}`);
      tryDb(bars, label, meta.price!);
      tryHs(bars, label, meta.price!);
    }
  }
}

main().catch(console.error);
