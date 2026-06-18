import type { StockScanResult } from "./types";

function hasCross(cross?: {
  crossoverAt?: string | null;
  crossoverDate?: string | null;
}): boolean {
  return Boolean(cross?.crossoverAt ?? cross?.crossoverDate);
}

/** Ensure cross4h is populated whenever cross1h exists (display + verify). */
export function fillCross4hFromCross1h(row: StockScanResult): StockScanResult {
  if (!hasCross(row.cross1h) || hasCross(row.cross4h)) return row;

  return {
    ...row,
    cross4h: {
      crossoverAt: row.cross1h.crossoverAt,
      crossoverDate: row.cross1h.crossoverDate,
      crossoverTime: row.cross1h.crossoverTime,
      crossoverMsAgo: row.cross1h.crossoverMsAgo,
    },
  };
}

export function fillCross4hGaps(results: StockScanResult[]): {
  results: StockScanResult[];
  changed: boolean;
} {
  let changed = false;
  const next = results.map((row) => {
    const filled = fillCross4hFromCross1h(row);
    if (filled !== row) changed = true;
    return filled;
  });
  return { results: next, changed };
}
