/** Actionable pattern states — stale completions are filtered to None. */
export type PatternStatus = "Active" | "Failed" | "Target" | "None";

/** Which bar intervals contributed the displayed status. */
export type PatternTimeframe = "1h" | "4h" | "1h+4h" | "None";

export type BarTimeframe = "1h" | "4h";

export interface PatternDebugInfo {
  support?: number;
  neckline?: number;
  target?: number;
  confirmDate?: string;
  patternAgeDays?: number;
  /** Per-timeframe status before merge (debug only). */
  status1h?: PatternStatus;
  status4h?: PatternStatus;
}

export interface PatternDetection {
  status: PatternStatus;
  timeframes: PatternTimeframe;
  /** Ms from pattern confirmation bar to latest bar; used for recency sorting. */
  confirmMsAgo: number | null;
  debug?: PatternDebugInfo;
}

export const NONE_PATTERN: PatternDetection = {
  status: "None",
  timeframes: "None",
  confirmMsAgo: null,
};

/** Bullish pattern geometry (double bottom, inverse H&S). */
export interface BullishPatternLevels {
  confirmIdx: number;
  support: number;
  neckline: number;
  target: number;
}

/** Bearish pattern geometry (double top). */
export interface BearishPatternLevels {
  confirmIdx: number;
  resistance: number;
  neckline: number;
  target: number;
}

export interface PatternEvalResult {
  status: PatternStatus;
  confirmMsAgo: number | null;
  levels?: BullishPatternLevels | BearishPatternLevels;
}
