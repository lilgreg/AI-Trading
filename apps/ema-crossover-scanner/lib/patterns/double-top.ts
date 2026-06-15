import type { OhlcBar } from "../ema";
import type { BarTimeframe, BearishPatternLevels, PatternEvalResult } from "./types";
import {
  barHigh,
  barLow,
  evaluateBearishPatternStatus,
  findSwingHighIndices,
  getBearishParams,
  highsWithinTolerance,
  resolveCurrentPrice,
} from "./utils";

function findMostRecentPattern(
  bars: OhlcBar[],
  tf: BarTimeframe,
): BearishPatternLevels | null {
  const params = getBearishParams(tf);
  const swingHighs = findSwingHighIndices(bars, params.swingWindow);
  if (swingHighs.length < 2) return null;

  for (let s = swingHighs.length - 1; s >= 1; s--) {
    const secondHighIdx = swingHighs[s];
    const secondHigh = barHigh(bars[secondHighIdx]);

    for (let f = s - 1; f >= 0; f--) {
      const firstHighIdx = swingHighs[f];
      const separation = secondHighIdx - firstHighIdx;
      if (
        separation < params.minBarsBetween ||
        separation > params.maxBarsBetween
      ) {
        continue;
      }

      const firstHigh = barHigh(bars[firstHighIdx]);
      if (!highsWithinTolerance(firstHigh, secondHigh, params.highTolerance)) {
        continue;
      }

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

      const troughWindow = params.swingWindow;
      let troughIsSwing = true;
      for (let j = 1; j <= troughWindow; j++) {
        if (
          troughIdx - j < 0 ||
          troughIdx + j >= bars.length ||
          barLow(bars[troughIdx]) > barLow(bars[troughIdx - j]) ||
          barLow(bars[troughIdx]) > barLow(bars[troughIdx + j])
        ) {
          troughIsSwing = false;
          break;
        }
      }
      if (!troughIsSwing) continue;

      const target = neckline - (resistance - neckline);
      return {
        confirmIdx: secondHighIdx,
        resistance,
        neckline,
        target,
      };
    }
  }

  return null;
}

export function detectDoubleTop(
  bars: OhlcBar[],
  currentPrice: number | null,
  tf: BarTimeframe,
): PatternEvalResult {
  const params = getBearishParams(tf);
  if (bars.length < params.minBarsBetween + params.swingWindow * 2 + 5) {
    return { status: "None", confirmMsAgo: null };
  }

  const price = resolveCurrentPrice(bars, currentPrice);
  if (price == null) return { status: "None", confirmMsAgo: null };

  const pattern = findMostRecentPattern(bars, tf);
  if (!pattern) return { status: "None", confirmMsAgo: null };

  return evaluateBearishPatternStatus(
    bars,
    pattern,
    price,
    params.maxRecencyBars,
    {
      minBarsAfterConfirm: 3,
      maxBarsAfterConfirm: tf === "4h" ? 32 : 42,
      requireBreakdownForActive: tf === "4h",
    },
  );
}
