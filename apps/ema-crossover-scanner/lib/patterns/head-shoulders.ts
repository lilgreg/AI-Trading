import type { OhlcBar } from "../ema";
import type { BarTimeframe, BearishPatternLevels, PatternEvalResult } from "./types";
import {
  barHigh,
  barLow,
  evaluateHeadShouldersStatus,
  findSwingHighIndices,
  getHeadShouldersParams,
  highsWithinTolerance,
  resolveCurrentPrice,
} from "./utils";

function findPatternCandidates(
  bars: OhlcBar[],
  tf: BarTimeframe,
): BearishPatternLevels[] {
  const params = getHeadShouldersParams(tf);
  const swingHighs = findSwingHighIndices(bars, params.swingWindow);
  if (swingHighs.length < 3) return [];

  const candidates: BearishPatternLevels[] = [];

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

        if (headHigh <= leftHigh * 1.002 || headHigh <= rightHigh * 1.002) continue;
        if (!highsWithinTolerance(leftHigh, rightHigh, params.shoulderTolerance)) {
          continue;
        }

        const shoulderAvg = (leftHigh + rightHigh) / 2;
        if (shoulderAvg === 0) continue;
        if ((headHigh - shoulderAvg) / shoulderAvg < params.minHeadDepth) continue;

        let leftTrough = Infinity;
        for (let i = leftIdx + 1; i < headIdx; i++) {
          leftTrough = Math.min(leftTrough, barLow(bars[i]));
        }
        let rightTrough = Infinity;
        for (let i = headIdx + 1; i < rightIdx; i++) {
          rightTrough = Math.min(rightTrough, barLow(bars[i]));
        }
        if (!Number.isFinite(leftTrough) || !Number.isFinite(rightTrough)) continue;

        const neckline = Math.max(leftTrough, rightTrough);
        const resistance = headHigh;
        const drop = (resistance - neckline) / resistance;
        if (drop < params.minNecklineDrop) continue;

        const troughAvg = (leftTrough + rightTrough) / 2;
        if (troughAvg === 0) continue;
        if (Math.abs(leftTrough - rightTrough) / troughAvg > 0.025) continue;

        const target = neckline - (resistance - neckline);
        if (target >= neckline * 0.99) continue;

        candidates.push({
          confirmIdx: rightIdx,
          resistance,
          neckline,
          target,
        });
      }
    }
  }

  return candidates;
}

export function detectHeadShoulders(
  bars: OhlcBar[],
  currentPrice: number | null,
  tf: BarTimeframe,
): PatternEvalResult {
  const params = getHeadShouldersParams(tf);
  if (bars.length < params.minBarsBetween * 3 + params.swingWindow * 2) {
    return { status: "None", confirmMsAgo: null };
  }

  const price = resolveCurrentPrice(bars, currentPrice);
  if (price == null) return { status: "None", confirmMsAgo: null };

  for (const pattern of findPatternCandidates(bars, tf)) {
    const result = evaluateHeadShouldersStatus(
      bars,
      pattern,
      price,
      params.maxRecencyBars,
      {
        minBarsAfterConfirm: 3,
        maxBarsAfterConfirm: tf === "4h" ? 32 : 42,
      },
    );
    if (result.status === "Active") {
      return result;
    }
  }

  return { status: "None", confirmMsAgo: null };
}
