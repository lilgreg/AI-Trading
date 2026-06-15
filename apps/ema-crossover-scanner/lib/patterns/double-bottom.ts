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

function findPatternCandidates(
  bars: OhlcBar[],
  tf: BarTimeframe,
): BullishPatternLevels[] {
  const params = getBullishParams(tf);
  const swingLows = findSwingLowIndices(bars, params.swingWindow);
  if (swingLows.length < 2) return [];

  const candidates: BullishPatternLevels[] = [];

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

      const support = Math.min(firstLow, secondLow);

      // W-bottom: no bar between the two lows may dip below support.
      let hasLowerMidLow = false;
      for (let i = firstLowIdx + 1; i < secondLowIdx; i++) {
        if (barLow(bars[i]) < support * 0.995) {
          hasLowerMidLow = true;
          break;
        }
      }
      if (hasLowerMidLow) continue;

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

      const lift = (neckline - support) / support;
      if (lift < params.minNecklineLift) continue;

      // Peak between lows must be a swing high (clear W-shape, not drift).
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
      candidates.push({
        confirmIdx: secondLowIdx,
        support,
        neckline,
        target,
      });
    }
  }

  return candidates;
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

  const evalOptions = {
    showTarget: true,
    requireNecklineBreakout: true,
    minAboveNeckline: 1.002,
    minBarsAfterConfirm: 3,
    maxBarsAfterConfirm: tf === "4h" ? 32 : 42,
  };

  for (const pattern of findPatternCandidates(bars, tf)) {
    const result = evaluateBullishPatternStatus(
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
