import type { OhlcBar } from "../ema";
import { detectDoubleBottom } from "./double-bottom";
import { detectInverseHeadShoulders } from "./inverse-head-shoulders";
import type { PatternDetection } from "./types";
import { NONE_PATTERN } from "./types";
import { mergeMultiTimeframe } from "./utils";

export type { PatternDetection, PatternStatus, PatternTimeframe } from "./types";
export { NONE_PATTERN } from "./types";

export interface SymbolPatterns {
  doubleBottom: PatternDetection;
  inverseHeadShoulders: PatternDetection;
}

export const NONE_PATTERNS: SymbolPatterns = {
  doubleBottom: NONE_PATTERN,
  inverseHeadShoulders: NONE_PATTERN,
};

/** Evaluate double-bottom on 1h and 4h bars; merge timeframe labels. */
export function evaluateDoubleBottomPatterns(
  bars1h: OhlcBar[],
  bars4h: OhlcBar[],
  currentPrice: number | null,
): PatternDetection {
  const oneHour = detectDoubleBottom(bars1h, currentPrice);
  const fourHour = detectDoubleBottom(bars4h, currentPrice);
  return mergeMultiTimeframe(oneHour, fourHour);
}

/** Evaluate inverse H&S on 1h and 4h bars; merge timeframe labels. */
export function evaluateInverseHeadShouldersPatterns(
  bars1h: OhlcBar[],
  bars4h: OhlcBar[],
  currentPrice: number | null,
): PatternDetection {
  const oneHour = detectInverseHeadShoulders(bars1h, currentPrice);
  const fourHour = detectInverseHeadShoulders(bars4h, currentPrice);
  return mergeMultiTimeframe(oneHour, fourHour);
}

export function evaluateAllPatterns(
  bars1h: OhlcBar[],
  bars4h: OhlcBar[],
  currentPrice: number | null,
): SymbolPatterns {
  return {
    doubleBottom: evaluateDoubleBottomPatterns(bars1h, bars4h, currentPrice),
    inverseHeadShoulders: evaluateInverseHeadShouldersPatterns(
      bars1h,
      bars4h,
      currentPrice,
    ),
  };
}
