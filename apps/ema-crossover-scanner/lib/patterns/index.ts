import type { OhlcBar } from "../ema";
import { detectDoubleBottom } from "./double-bottom";
import { detectDoubleTop } from "./double-top";
import { detectHeadShoulders } from "./head-shoulders";
import { detectInverseHeadShoulders } from "./inverse-head-shoulders";
import type { BarTimeframe, PatternDetection } from "./types";
import { NONE_PATTERN } from "./types";
import { mergeMultiTimeframe, sliceRecentBars } from "./utils";

export type {
  BarTimeframe,
  PatternDebugInfo,
  PatternDetection,
  PatternEvalResult,
  PatternStatus,
  PatternTimeframe,
} from "./types";
export { NONE_PATTERN } from "./types";
export { RECENCY_DAYS, patternSortKey } from "./utils";

export interface SymbolPatterns {
  doubleBottom: PatternDetection;
  doubleTop: PatternDetection;
  headShoulders: PatternDetection;
  inverseHeadShoulders: PatternDetection;
}

export const NONE_PATTERNS: SymbolPatterns = {
  doubleBottom: NONE_PATTERN,
  doubleTop: NONE_PATTERN,
  headShoulders: NONE_PATTERN,
  inverseHeadShoulders: NONE_PATTERN,
};

type Detector = (
  bars: OhlcBar[],
  price: number | null,
  tf: BarTimeframe,
) => import("./types").PatternEvalResult;

function evaluateOnTimeframes(
  detect: Detector,
  bars1h: OhlcBar[],
  bars4h: OhlcBar[],
  currentPrice: number | null,
  includeDebug: boolean,
): PatternDetection {
  const oneHour = detect(bars1h, currentPrice, "1h");
  const fourHour = detect(bars4h, currentPrice, "4h");
  return mergeMultiTimeframe(oneHour, fourHour, includeDebug);
}

export function evaluateAllPatterns(
  bars1h: OhlcBar[],
  bars4h: OhlcBar[],
  currentPrice: number | null,
  includeDebug = false,
): SymbolPatterns {
  const recent1h = sliceRecentBars(bars1h);
  const recent4h = sliceRecentBars(bars4h);

  return {
    doubleBottom: evaluateOnTimeframes(
      detectDoubleBottom,
      recent1h,
      recent4h,
      currentPrice,
      includeDebug,
    ),
    doubleTop: evaluateOnTimeframes(
      detectDoubleTop,
      recent1h,
      recent4h,
      currentPrice,
      includeDebug,
    ),
    headShoulders: evaluateOnTimeframes(
      detectHeadShoulders,
      recent1h,
      recent4h,
      currentPrice,
      includeDebug,
    ),
    inverseHeadShoulders: evaluateOnTimeframes(
      detectInverseHeadShoulders,
      recent1h,
      recent4h,
      currentPrice,
      includeDebug,
    ),
  };
}
