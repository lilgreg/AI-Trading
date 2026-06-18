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

  let crossoverMsAgo = row.cross1h.crossoverMsAgo;
  if (row.cross1h.crossoverAt) {
    const atMs = Date.parse(row.cross1h.crossoverAt);
    if (Number.isFinite(atMs)) {
      const derived = Date.now() - atMs;
      if (derived > 0 && (crossoverMsAgo == null || crossoverMsAgo <= 0)) {
        crossoverMsAgo = derived;
      }
    }
  }

  return {
    ...row,
    cross4h: {
      crossoverAt: row.cross1h.crossoverAt,
      crossoverDate: row.cross1h.crossoverDate,
      crossoverTime: row.cross1h.crossoverTime,
      crossoverMsAgo,
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
