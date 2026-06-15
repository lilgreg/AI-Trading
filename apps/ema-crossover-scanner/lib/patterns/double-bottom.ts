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

const LOW_TOLERANCE = 0.03;
const MIN_BARS_BETWEEN_LOWS = 3;
const MAX_BARS_BETWEEN_LOWS = 80;
const MIN_NECKLINE_LIFT = 0.01;

/**
 * Two swing lows at similar price with a peak between them.
 * Target = neckline + (neckline − support). Algorithmic — not TradingView-identical.
 */
function findMostRecentPattern(bars: OhlcBar[]): PatternLevels | null {
  const swingLows = findSwingLowIndices(bars);
  if (swingLows.length < 2) return null;

  for (let s = swingLows.length - 1; s >= 1; s--) {
    const secondLowIdx = swingLows[s];
    const secondLow = barLow(bars[secondLowIdx]);

    for (let f = s - 1; f >= 0; f--) {
      const firstLowIdx = swingLows[f];
      const separation = secondLowIdx - firstLowIdx;
      if (separation < MIN_BARS_BETWEEN_LOWS || separation > MAX_BARS_BETWEEN_LOWS) {
        continue;
      }

      const firstLow = barLow(bars[firstLowIdx]);
      if (!lowsWithinTolerance(firstLow, secondLow, LOW_TOLERANCE)) continue;

      let neckline = -Infinity;
      for (let i = firstLowIdx + 1; i < secondLowIdx; i++) {
        neckline = Math.max(neckline, barHigh(bars[i]));
      }
      if (!Number.isFinite(neckline)) continue;

      const support = Math.min(firstLow, secondLow);
      const lift = (neckline - support) / support;
      if (lift < MIN_NECKLINE_LIFT) continue;

      const target = neckline + (neckline - support);
      return {
        confirmIdx: secondLowIdx,
        support,
        neckline,
        target,
      };
    }
  }

  return null;
}

export function detectDoubleBottom(
  bars: OhlcBar[],
  currentPrice: number | null,
): PatternStatus {
  if (bars.length < 10) return "None";

  const price = resolveCurrentPrice(bars, currentPrice);
  if (price == null) return "None";

  const pattern = findMostRecentPattern(bars);
  if (!pattern) return "None";

  return evaluatePatternStatus(bars, pattern, price);
}
