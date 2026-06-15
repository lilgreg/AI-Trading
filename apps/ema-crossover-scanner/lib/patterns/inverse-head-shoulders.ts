import type { OhlcBar } from "../ema";
import type { BarTimeframe, BullishPatternLevels, PatternEvalResult } from "./types";
import {
  barHigh,
  barLow,
  evaluateBullishPatternStatus,
  findSwingLowIndices,
  getBullishParams,
  lowsWithinTolerance,
  resolveCurrentPrice,
} from "./utils";

function findMostRecentPattern(
  bars: OhlcBar[],
  tf: BarTimeframe,
): BullishPatternLevels | null {
  const params = getBullishParams(tf);
  const swingLows = findSwingLowIndices(bars, params.swingWindow);
  if (swingLows.length < 3) return null;

  for (let r = swingLows.length - 1; r >= 2; r--) {
    const rightIdx = swingLows[r];
    const rightLow = barLow(bars[rightIdx]);

    for (let h = r - 1; h >= 1; h--) {
      const headIdx = swingLows[h];
      const headLow = barLow(bars[headIdx]);

      if (rightIdx - headIdx < params.minBarsBetween) continue;

      for (let l = h - 1; l >= 0; l--) {
        const leftIdx = swingLows[l];
        const leftLow = barLow(bars[leftIdx]);

        if (headIdx - leftIdx < params.minBarsBetween) continue;
        if (rightIdx - leftIdx > params.maxPatternSpan) continue;

        if (headLow >= leftLow * 0.998 || headLow >= rightLow * 0.998) continue;
        if (!lowsWithinTolerance(leftLow, rightLow, params.shoulderTolerance)) {
          continue;
        }

        const shoulderAvg = (leftLow + rightLow) / 2;
        if (shoulderAvg === 0) continue;
        if ((shoulderAvg - headLow) / shoulderAvg < params.minHeadDepth) continue;

        let leftPeak = -Infinity;
        for (let i = leftIdx + 1; i < headIdx; i++) {
          leftPeak = Math.max(leftPeak, barHigh(bars[i]));
        }
        let rightPeak = -Infinity;
        for (let i = headIdx + 1; i < rightIdx; i++) {
          rightPeak = Math.max(rightPeak, barHigh(bars[i]));
        }
        if (!Number.isFinite(leftPeak) || !Number.isFinite(rightPeak)) continue;

        const neckline = Math.min(leftPeak, rightPeak);
        const support = Math.min(headLow, leftLow, rightLow);
        const lift = (neckline - support) / support;
        if (lift < params.minNecklineLift) continue;

        // Shoulder peaks should be roughly level (symmetric neckline).
        const peakAvg = (leftPeak + rightPeak) / 2;
        if (peakAvg === 0) continue;
        if (Math.abs(leftPeak - rightPeak) / peakAvg > 0.015) continue;

        const target = neckline + (neckline - headLow);
        if (target <= neckline * 1.01) continue;

        return {
          confirmIdx: rightIdx,
          support,
          neckline,
          target,
        };
      }
    }
  }

  return null;
}

export function detectInverseHeadShoulders(
  bars: OhlcBar[],
  currentPrice: number | null,
  tf: BarTimeframe,
): PatternEvalResult {
  const params = getBullishParams(tf);
  if (bars.length < params.minBarsBetween * 3 + params.swingWindow * 2) {
    return { status: "None", confirmMsAgo: null };
  }

  const price = resolveCurrentPrice(bars, currentPrice);
  if (price == null) return { status: "None", confirmMsAgo: null };

  const pattern = findMostRecentPattern(bars, tf);
  if (!pattern) return { status: "None", confirmMsAgo: null };

  return evaluateBullishPatternStatus(
    bars,
    pattern,
    price,
    params.maxRecencyBars,
    {
      allowForming: false,
      minAboveNeckline: 1.02,
      showTarget: false,
      minBarsAfterConfirm: 5,
      maxBarsAfterConfirm: tf === "4h" ? 30 : 40,
    },
  );
}
