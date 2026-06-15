import type { OhlcBar } from "../ema";
import type {
  BarTimeframe,
  BearishPatternLevels,
  BullishPatternLevels,
  PatternDetection,
  PatternEvalResult,
  PatternStatus,
  PatternTimeframe,
} from "./types";

/**
 * Algorithmic pattern detection — NOT TradingView auto-chart-patterns.
 * TradingView has no public pattern API; thresholds here prioritize fewer
 * false positives over matching TV's proprietary visual recognition.
 */
export const RECENCY_DAYS = 40;
export const RECENCY_MS = RECENCY_DAYS * 24 * 60 * 60 * 1000;

export interface BullishPatternParams {
  swingWindow: number;
  minBarsBetween: number;
  maxBarsBetween: number;
  maxRecencyBars: number;
  lowTolerance: number;
  minNecklineLift: number;
  shoulderTolerance: number;
  minHeadDepth: number;
  maxPatternSpan: number;
}

export interface BearishPatternParams {
  swingWindow: number;
  minBarsBetween: number;
  maxBarsBetween: number;
  maxRecencyBars: number;
  highTolerance: number;
  minNecklineDrop: number;
}

export function getBullishParams(tf: BarTimeframe): BullishPatternParams {
  if (tf === "4h") {
    return {
      swingWindow: 3,
      minBarsBetween: 10,
      maxBarsBetween: 45,
      maxRecencyBars: 55,
      lowTolerance: 0.008,
      minNecklineLift: 0.05,
      shoulderTolerance: 0.01,
      minHeadDepth: 0.045,
      maxPatternSpan: 55,
    };
  }
  return {
    swingWindow: 3,
    minBarsBetween: 14,
    maxBarsBetween: 110,
    maxRecencyBars: 220,
    lowTolerance: 0.008,
    minNecklineLift: 0.045,
    shoulderTolerance: 0.01,
    minHeadDepth: 0.055,
    maxPatternSpan: 140,
  };
}

export function getBearishParams(tf: BarTimeframe): BearishPatternParams {
  if (tf === "4h") {
    return {
      swingWindow: 3,
      minBarsBetween: 8,
      maxBarsBetween: 48,
      maxRecencyBars: 55,
      highTolerance: 0.007,
      minNecklineDrop: 0.045,
    };
  }
  return {
    swingWindow: 3,
    minBarsBetween: 10,
    maxBarsBetween: 130,
    maxRecencyBars: 220,
    highTolerance: 0.01,
    minNecklineDrop: 0.03,
  };
}

export function barLow(bar: OhlcBar): number {
  return bar.low ?? bar.close;
}

export function barHigh(bar: OhlcBar): number {
  return bar.high ?? bar.close;
}

export function barClose(bar: OhlcBar): number {
  return bar.close;
}

export function sliceRecentBars(bars: OhlcBar[], days: number = RECENCY_DAYS + 10): OhlcBar[] {
  if (bars.length === 0) return bars;
  const cutoff = bars.at(-1)!.date.getTime() - days * 24 * 60 * 60 * 1000;
  return bars.filter((b) => b.date.getTime() >= cutoff);
}

export function msAgoFromBar(bars: OhlcBar[], idx: number): number {
  return bars.at(-1)!.date.getTime() - bars[idx].date.getTime();
}

export function patternAgeDays(bars: OhlcBar[], idx: number): number {
  return Math.round(msAgoFromBar(bars, idx) / (24 * 60 * 60 * 1000));
}

export function isWithinRecency(bars: OhlcBar[], idx: number): boolean {
  return msAgoFromBar(bars, idx) <= RECENCY_MS;
}

export function isConfirmRecent(
  bars: OhlcBar[],
  confirmIdx: number,
  maxRecencyBars: number,
): boolean {
  return bars.length - 1 - confirmIdx <= maxRecencyBars;
}

/** Local minima — low must be lowest across ±swingWindow bars. */
export function findSwingLowIndices(bars: OhlcBar[], swingWindow = 3): number[] {
  const indices: number[] = [];
  for (let i = swingWindow; i < bars.length - swingWindow; i++) {
    const low = barLow(bars[i]);
    let isSwing = true;
    for (let j = 1; j <= swingWindow; j++) {
      if (low > barLow(bars[i - j]) || low > barLow(bars[i + j])) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) indices.push(i);
  }
  return indices;
}

/** Local maxima — high must be highest across ±swingWindow bars. */
export function findSwingHighIndices(bars: OhlcBar[], swingWindow = 3): number[] {
  const indices: number[] = [];
  for (let i = swingWindow; i < bars.length - swingWindow; i++) {
    const high = barHigh(bars[i]);
    let isSwing = true;
    for (let j = 1; j <= swingWindow; j++) {
      if (high < barHigh(bars[i - j]) || high < barHigh(bars[i + j])) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) indices.push(i);
  }
  return indices;
}

export function lowsWithinTolerance(a: number, b: number, tolerance: number): boolean {
  const avg = (a + b) / 2;
  if (avg === 0) return false;
  return Math.abs(a - b) / avg <= tolerance;
}

export function highsWithinTolerance(a: number, b: number, tolerance: number): boolean {
  const avg = (a + b) / 2;
  if (avg === 0) return false;
  return Math.abs(a - b) / avg <= tolerance;
}

export function resolveCurrentPrice(
  bars: OhlcBar[],
  currentPrice: number | null,
): number | null {
  return currentPrice ?? bars.at(-1)?.close ?? null;
}

/** After confirmation, price must close above neckline (breakout) to qualify as Active. */
export function hasNecklineBreakout(
  bars: OhlcBar[],
  confirmIdx: number,
  neckline: number,
): boolean {
  const threshold = neckline * 1.002;
  for (let i = confirmIdx + 1; i < bars.length; i++) {
    if (barClose(bars[i]) >= threshold) {
      return true;
    }
  }
  return false;
}

/** After confirmation, price must close below neckline (breakdown) to qualify as Active. */
export function hasNecklineBreakdown(
  bars: OhlcBar[],
  confirmIdx: number,
  neckline: number,
): boolean {
  const threshold = neckline * 0.998;
  for (let i = confirmIdx + 1; i < bars.length; i++) {
    if (barClose(bars[i]) <= threshold) {
      return true;
    }
  }
  return false;
}

const NONE_RESULT: PatternEvalResult = { status: "None", confirmMsAgo: null };

/** Bullish pattern lifecycle after confirmation (DB, IH&S). */
export function evaluateBullishPatternStatus(
  bars: OhlcBar[],
  pattern: BullishPatternLevels,
  currentPrice: number,
  maxRecencyBars: number,
  options: {
    minAboveNeckline?: number;
    showTarget?: boolean;
    minBarsAfterConfirm?: number;
    maxBarsAfterConfirm?: number;
  } = {},
): PatternEvalResult {
  const {
    minAboveNeckline = 1.005,
    showTarget = true,
    minBarsAfterConfirm = 3,
    maxBarsAfterConfirm = 50,
  } = options;
  const { confirmIdx, support, neckline, target } = pattern;

  if (
    !isWithinRecency(bars, confirmIdx) ||
    !isConfirmRecent(bars, confirmIdx, maxRecencyBars)
  ) {
    return NONE_RESULT;
  }

  const barsAfterConfirm = bars.length - 1 - confirmIdx;
  if (
    barsAfterConfirm < minBarsAfterConfirm ||
    barsAfterConfirm > maxBarsAfterConfirm
  ) {
    return NONE_RESULT;
  }

  const confirmMsAgo = msAgoFromBar(bars, confirmIdx);
  let targetHitIdx: number | null = null;
  let failedIdx: number | null = null;

  for (let i = confirmIdx; i < bars.length; i++) {
    if (barLow(bars[i]) < support * 0.995) {
      failedIdx = i;
      break;
    }
    if (barHigh(bars[i]) >= target) {
      targetHitIdx = i;
      break;
    }
  }

  if (targetHitIdx == null && currentPrice >= target) targetHitIdx = bars.length - 1;
  if (failedIdx == null && currentPrice < support * 0.995) failedIdx = bars.length - 1;

  if (targetHitIdx != null && isWithinRecency(bars, targetHitIdx) && showTarget) {
    return { status: "Target", confirmMsAgo, levels: pattern };
  }

  if (failedIdx != null && isWithinRecency(bars, failedIdx)) {
    // Broke support — bearish, not actionable for bullish scanner.
    return NONE_RESULT;
  }

  const confirmedActive =
    targetHitIdx == null &&
    failedIdx == null &&
    currentPrice > support * 1.01 &&
    currentPrice > neckline * minAboveNeckline &&
    currentPrice < target &&
    hasNecklineBreakout(bars, confirmIdx, neckline);

  if (confirmedActive) {
    return { status: "Active", confirmMsAgo, levels: pattern };
  }

  return NONE_RESULT;
}

/**
 * Bearish pattern lifecycle (double top).
 * Failed = broke below neckline recently → bullish reversal setup.
 */
export function evaluateBearishPatternStatus(
  bars: OhlcBar[],
  pattern: BearishPatternLevels,
  currentPrice: number,
  maxRecencyBars: number,
  options: {
    minBarsAfterConfirm?: number;
    maxBarsAfterConfirm?: number;
    requireBreakdownForActive?: boolean;
  } = {},
): PatternEvalResult {
  const {
    minBarsAfterConfirm = 3,
    maxBarsAfterConfirm = 50,
    requireBreakdownForActive = false,
  } = options;
  const { confirmIdx, resistance, neckline, target } = pattern;

  if (
    !isWithinRecency(bars, confirmIdx) ||
    !isConfirmRecent(bars, confirmIdx, maxRecencyBars)
  ) {
    return NONE_RESULT;
  }

  const barsAfterConfirm = bars.length - 1 - confirmIdx;
  if (
    barsAfterConfirm < minBarsAfterConfirm ||
    barsAfterConfirm > maxBarsAfterConfirm
  ) {
    return NONE_RESULT;
  }

  const confirmMsAgo = msAgoFromBar(bars, confirmIdx);
  let targetHitIdx: number | null = null;
  let reclaimedIdx: number | null = null;

  for (let i = confirmIdx + 1; i < bars.length; i++) {
    if (barClose(bars[i]) > resistance * 1.005) {
      reclaimedIdx = i;
      break;
    }
    if (barLow(bars[i]) <= target) {
      targetHitIdx = i;
      break;
    }
  }

  if (targetHitIdx == null && currentPrice <= target) targetHitIdx = bars.length - 1;
  if (reclaimedIdx == null && currentPrice > resistance * 1.005) {
    reclaimedIdx = bars.length - 1;
  }

  if (reclaimedIdx != null && isWithinRecency(bars, reclaimedIdx)) {
    return { status: "Failed", confirmMsAgo, levels: pattern };
  }

  if (targetHitIdx != null && isWithinRecency(bars, targetHitIdx)) {
    return NONE_RESULT;
  }

  const hasBreakdown = hasNecklineBreakdown(bars, confirmIdx, neckline);

  if (
    hasBreakdown &&
    targetHitIdx == null &&
    reclaimedIdx == null &&
    currentPrice <= neckline * 1.002 &&
    currentPrice > target &&
    currentPrice <= resistance * 1.01
  ) {
    return { status: "Active", confirmMsAgo, levels: pattern };
  }

  // Pre-breakdown: valid M-top with price retesting neckline/resistance zone.
  if (
    !requireBreakdownForActive &&
    !hasBreakdown &&
    targetHitIdx == null &&
    reclaimedIdx == null &&
    currentPrice >= neckline * 1.002 &&
    currentPrice <= resistance * 0.998 &&
    barHigh(bars[confirmIdx]) >= resistance * 0.995
  ) {
    return { status: "Active", confirmMsAgo, levels: pattern };
  }

  return NONE_RESULT;
}

const STATUS_PRIORITY: Record<PatternStatus, number> = {
  Active: 4,
  Failed: 3,
  Target: 2,
  None: 0,
};

/**
 * Merge 1h / 4h results.
 * "1h+4h" ONLY when both timeframes detect the same non-None status independently.
 */
export function mergeMultiTimeframe(
  oneHour: PatternEvalResult,
  fourHour: PatternEvalResult,
  includeDebug = false,
): PatternDetection {
  if (oneHour.status === "None" && fourHour.status === "None") {
    return { status: "None", timeframes: "None", confirmMsAgo: null };
  }

  let status: PatternStatus;
  let timeframes: PatternTimeframe;
  let confirmMsAgo: number | null;

  if (oneHour.status === "Active" && fourHour.status === "Active") {
    status = "Active";
    timeframes = "1h+4h";
    confirmMsAgo = Math.min(
      oneHour.confirmMsAgo ?? Number.MAX_SAFE_INTEGER,
      fourHour.confirmMsAgo ?? Number.MAX_SAFE_INTEGER,
    );
    if (!Number.isFinite(confirmMsAgo)) confirmMsAgo = null;
  } else if (
    oneHour.status !== "None" &&
    fourHour.status !== "None" &&
    oneHour.status === fourHour.status
  ) {
    status = oneHour.status;
    timeframes = "1h+4h";
    confirmMsAgo = Math.min(
      oneHour.confirmMsAgo ?? Number.MAX_SAFE_INTEGER,
      fourHour.confirmMsAgo ?? Number.MAX_SAFE_INTEGER,
    );
    if (!Number.isFinite(confirmMsAgo)) confirmMsAgo = null;
  } else {
    const candidates = [
      { tf: "1h" as const, result: oneHour },
      { tf: "4h" as const, result: fourHour },
    ].filter((c) => c.result.status !== "None");

    candidates.sort((a, b) => {
      const prio =
        STATUS_PRIORITY[b.result.status] - STATUS_PRIORITY[a.result.status];
      if (prio !== 0) return prio;
      return (
        (a.result.confirmMsAgo ?? Number.MAX_SAFE_INTEGER) -
        (b.result.confirmMsAgo ?? Number.MAX_SAFE_INTEGER)
      );
    });

    const best = candidates[0];
    status = best.result.status;
    timeframes = best.tf;
    confirmMsAgo = best.result.confirmMsAgo;
  }

  const detection: PatternDetection = { status, timeframes, confirmMsAgo };

  if (includeDebug) {
    const levels =
      oneHour.status !== "None"
        ? oneHour.levels
        : fourHour.status !== "None"
          ? fourHour.levels
          : undefined;

    detection.debug = {
      status1h: oneHour.status,
      status4h: fourHour.status,
    };

    if (confirmMsAgo != null) {
      detection.debug.patternAgeDays = Math.round(
        confirmMsAgo / (24 * 60 * 60 * 1000),
      );
    }

    if (levels && "support" in levels) {
      detection.debug.support = Math.round(levels.support * 100) / 100;
      detection.debug.neckline = Math.round(levels.neckline * 100) / 100;
      detection.debug.target = Math.round(levels.target * 100) / 100;
    } else if (levels && "resistance" in levels) {
      detection.debug.neckline = Math.round(levels.neckline * 100) / 100;
      detection.debug.target = Math.round(levels.target * 100) / 100;
    }
  }

  return detection;
}

/** Client-side sort key: lower = more interesting (Active, then recent). */
export function patternSortKey(detection: PatternDetection): number {
  const tier: Record<PatternStatus, number> = {
    Active: 0,
    Failed: 100,
    Target: 200,
    None: 1000,
  };
  const base = tier[detection.status];
  const recency = detection.confirmMsAgo ?? Number.MAX_SAFE_INTEGER;
  return base + recency / 1e15;
}
