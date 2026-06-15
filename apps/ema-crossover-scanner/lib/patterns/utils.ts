import type { OhlcBar } from "../ema";
import type { PatternDetection, PatternLevels, PatternStatus, PatternTimeframe } from "./types";

export function barLow(bar: OhlcBar): number {
  return bar.low ?? bar.close;
}

export function barHigh(bar: OhlcBar): number {
  return bar.high ?? bar.close;
}

/** Local minima where the bar low is at or below adjacent bars. */
export function findSwingLowIndices(bars: OhlcBar[]): number[] {
  const indices: number[] = [];
  for (let i = 1; i < bars.length - 1; i++) {
    const low = barLow(bars[i]);
    if (low <= barLow(bars[i - 1]) && low <= barLow(bars[i + 1])) {
      indices.push(i);
    }
  }
  return indices;
}

export function lowsWithinTolerance(a: number, b: number, tolerance: number): boolean {
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

/** Status after pattern confirmation bar through current price. */
export function evaluatePatternStatus(
  bars: OhlcBar[],
  pattern: PatternLevels,
  currentPrice: number,
): PatternStatus {
  const { confirmIdx, support, target } = pattern;

  for (let i = confirmIdx; i < bars.length; i++) {
    if (barLow(bars[i]) < support) return "Failed";
    if (barHigh(bars[i]) >= target) return "Completed";
  }

  if (currentPrice < support) return "Failed";
  if (currentPrice >= target) return "Completed";
  if (currentPrice > support && currentPrice < target) return "Active";

  return "None";
}

const STATUS_PRIORITY: Record<PatternStatus, number> = {
  Active: 3,
  Failed: 2,
  Completed: 1,
  None: 0,
};

function timeframesFromMatches(
  matches: { tf: "1h" | "4h"; status: PatternStatus }[],
): PatternTimeframe {
  const has1h = matches.some((m) => m.tf === "1h");
  const has4h = matches.some((m) => m.tf === "4h");
  if (has1h && has4h) return "1h+4h";
  if (has1h) return "1h";
  if (has4h) return "4h";
  return "None";
}

/** Merge independent 1h / 4h detections; Active beats Failed beats Completed. */
export function mergeMultiTimeframe(
  oneHour: PatternStatus,
  fourHour: PatternStatus,
): PatternDetection {
  const entries: { tf: "1h" | "4h"; status: PatternStatus }[] = [
    { tf: "1h", status: oneHour },
    { tf: "4h", status: fourHour },
  ];

  const detected = entries.filter((e) => e.status !== "None");
  if (detected.length === 0) {
    return { status: "None", timeframes: "None" };
  }

  const topPriority = Math.max(...detected.map((e) => STATUS_PRIORITY[e.status]));
  const winning = detected.filter((e) => STATUS_PRIORITY[e.status] === topPriority);

  return {
    status: winning[0].status,
    timeframes: timeframesFromMatches(winning),
  };
}
