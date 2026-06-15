import type { OhlcBar } from "../ema";
import type { PatternLevels, PatternStatus } from "./types";
import {
  barHigh,
  barLow,
  evaluatePatternStatus,
  findSwingLowIndices,
  lowsWithinTolerance,
  resolveCurrentPrice,
} from "./utils";

const SHOULDER_TOLERANCE = 0.04;
const MIN_BARS_BETWEEN_PIVOTS = 3;
const MAX_BARS_SPAN = 120;
const MIN_HEAD_DEPTH = 0.02;
const MIN_NECKLINE_LIFT = 0.01;

/**
 * Inverse H&S: left shoulder, lower head, right shoulder; neckline from intervening peaks.
 * Support = lowest of the three lows. Algorithmic — not TradingView-identical.
 */
function findMostRecentPattern(bars: OhlcBar[]): PatternLevels | null {
  const swingLows = findSwingLowIndices(bars);
  if (swingLows.length < 3) return null;

  for (let r = swingLows.length - 1; r >= 2; r--) {
    const rightIdx = swingLows[r];
    const rightLow = barLow(bars[rightIdx]);

    for (let h = r - 1; h >= 1; h--) {
      const headIdx = swingLows[h];
      const headLow = barLow(bars[headIdx]);

      if (rightIdx - headIdx < MIN_BARS_BETWEEN_PIVOTS) continue;

      for (let l = h - 1; l >= 0; l--) {
        const leftIdx = swingLows[l];
        const leftLow = barLow(bars[leftIdx]);

        if (headIdx - leftIdx < MIN_BARS_BETWEEN_PIVOTS) continue;
        if (rightIdx - leftIdx > MAX_BARS_SPAN) continue;

        if (headLow >= leftLow || headLow >= rightLow) continue;
        if (!lowsWithinTolerance(leftLow, rightLow, SHOULDER_TOLERANCE)) continue;

        const shoulderAvg = (leftLow + rightLow) / 2;
        if (shoulderAvg === 0) continue;
        if ((shoulderAvg - headLow) / shoulderAvg < MIN_HEAD_DEPTH) continue;

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
        if (lift < MIN_NECKLINE_LIFT) continue;

        const target = neckline + (neckline - headLow);
        if (target <= neckline) continue;

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
): PatternStatus {
  if (bars.length < 15) return "None";

  const price = resolveCurrentPrice(bars, currentPrice);
  if (price == null) return "None";

  const pattern = findMostRecentPattern(bars);
  if (!pattern) return "None";

  return evaluatePatternStatus(bars, pattern, price);
}
