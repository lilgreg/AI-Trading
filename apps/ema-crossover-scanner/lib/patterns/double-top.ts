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

function findPatternCandidates(
  bars: OhlcBar[],
  tf: BarTimeframe,
): BearishPatternLevels[] {
  const params = getBearishParams(tf);
  const swingHighs = findSwingHighIndices(bars, params.swingWindow);
  if (swingHighs.length < 2) return [];

  const candidates: BearishPatternLevels[] = [];

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

      const resistance = Math.max(firstHigh, secondHigh);

      // M-top: no bar between the two highs may exceed resistance (distinguishes from H&S / spikes).
      let hasHigherMidPeak = false;
      for (let i = firstHighIdx + 1; i < secondHighIdx; i++) {
        if (barHigh(bars[i]) > resistance * 1.005) {
          hasHigherMidPeak = true;
          break;
        }
      }
      if (hasHigherMidPeak) continue;

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

      const drop = (resistance - neckline) / resistance;
      if (drop < params.minNecklineDrop) continue;

      // Trough between highs must be a swing low (clear M-shape).
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
      candidates.push({
        confirmIdx: secondHighIdx,
        resistance,
        neckline,
        target,
      });
    }
  }

  return candidates;
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

  const evalOptions = {
    minBarsAfterConfirm: 3,
    maxBarsAfterConfirm: tf === "4h" ? 32 : 42,
    requireBreakdownForActive: true,
  };

  for (const pattern of findPatternCandidates(bars, tf)) {
    const result = evaluateBearishPatternStatus(
      bars,
      pattern,
      price,
      params.maxRecencyBars,
      evalOptions,
    );
    if (result.status === "Active") {
      return result;
    }
  }

  return { status: "None", confirmMsAgo: null };
}
