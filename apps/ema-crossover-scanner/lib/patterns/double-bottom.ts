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
  if (swingLows.length < 2) return null;

  for (let s = swingLows.length - 1; s >= 1; s--) {
    const secondLowIdx = swingLows[s];
    const secondLow = barLow(bars[secondLowIdx]);

    for (let f = s - 1; f >= 0; f--) {
      const firstLowIdx = swingLows[f];
      const separation = secondLowIdx - firstLowIdx;
      if (
        separation < params.minBarsBetween ||
        separation > params.maxBarsBetween
      ) {
        continue;
      }

      const firstLow = barLow(bars[firstLowIdx]);
      if (!lowsWithinTolerance(firstLow, secondLow, params.lowTolerance)) {
        continue;
      }

      let neckline = -Infinity;
      let peakIdx = -1;
      for (let i = firstLowIdx + 1; i < secondLowIdx; i++) {
        const high = barHigh(bars[i]);
        if (high > neckline) {
          neckline = high;
          peakIdx = i;
        }
      }
      if (!Number.isFinite(neckline) || peakIdx < 0) continue;

      const support = Math.min(firstLow, secondLow);
      const lift = (neckline - support) / support;
      if (lift < params.minNecklineLift) continue;

      // Peak between lows must be a swing high (clear V-shape).
      const peakWindow = params.swingWindow;
      let peakIsSwing = true;
      for (let j = 1; j <= peakWindow; j++) {
        if (
          peakIdx - j < 0 ||
          peakIdx + j >= bars.length ||
          barHigh(bars[peakIdx]) < barHigh(bars[peakIdx - j]) ||
          barHigh(bars[peakIdx]) < barHigh(bars[peakIdx + j])
        ) {
          peakIsSwing = false;
          break;
        }
      }
      if (!peakIsSwing) continue;

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
  tf: BarTimeframe,
): PatternEvalResult {
  const params = getBullishParams(tf);
  if (bars.length < params.minBarsBetween + params.swingWindow * 2 + 5) {
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
      allowForming: true,
      showTarget: true,
      minBarsAfterConfirm: 3,
      maxBarsAfterConfirm: tf === "4h" ? 35 : 45,
    },
  );
}
