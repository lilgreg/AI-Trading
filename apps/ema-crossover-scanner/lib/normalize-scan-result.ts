import { NONE_PATTERNS } from "./patterns";
import type {
  CrossoverDisplay,
  PatternDetection,
  StockScanResult,
  SymbolPatterns,
} from "./types";
import { EMPTY_CROSSOVER } from "./types";

function normalizePattern(value: PatternDetection | undefined): PatternDetection {
  return value ?? NONE_PATTERNS.doubleBottom;
}

export function normalizePatterns(
  patterns: Partial<SymbolPatterns> | undefined,
): SymbolPatterns {
  if (!patterns) return { ...NONE_PATTERNS };

  return {
    doubleBottom: normalizePattern(patterns.doubleBottom),
    doubleTop: normalizePattern(patterns.doubleTop),
    headShoulders: normalizePattern(patterns.headShoulders),
    inverseHeadShoulders: normalizePattern(patterns.inverseHeadShoulders),
  };
}

export function normalizeCrossover(
  cross: Partial<CrossoverDisplay> | undefined | null,
): CrossoverDisplay {
  if (!cross) return { ...EMPTY_CROSSOVER };

  return {
    crossoverAt: cross.crossoverAt ?? null,
    crossoverDate: cross.crossoverDate ?? null,
    crossoverTime: cross.crossoverTime ?? null,
    crossoverMsAgo: cross.crossoverMsAgo ?? null,
  };
}

/** Backfill fields missing from older cached snapshots. */
export function normalizeScanResult(
  row: StockScanResult,
): StockScanResult {
  return {
    ...row,
    patterns: normalizePatterns(row.patterns),
    cross1h: normalizeCrossover(row.cross1h),
    cross4h: normalizeCrossover(row.cross4h),
  };
}
