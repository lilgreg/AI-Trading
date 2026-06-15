/** Pattern lifecycle — algorithmic; won't match TradingView auto-patterns exactly. */
export type PatternStatus = "Active" | "Failed" | "Completed" | "None";

/** Which bar intervals contributed the displayed status. */
export type PatternTimeframe = "1h" | "4h" | "1h+4h" | "None";

export interface PatternDetection {
  status: PatternStatus;
  timeframes: PatternTimeframe;
}

export const NONE_PATTERN: PatternDetection = { status: "None", timeframes: "None" };

export interface PatternLevels {
  /** Bar index where the pattern is considered formed (second low / right shoulder). */
  confirmIdx: number;
  support: number;
  neckline: number;
  target: number;
}
