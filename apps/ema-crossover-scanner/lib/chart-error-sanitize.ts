import type { StockScanResult } from "./types";

/** Legacy cached errors that reference removed Stooq provider. */
export function isStooqChartError(error: string | undefined | null): boolean {
  return error?.toLowerCase().includes("stooq") ?? false;
}

export function isAllProvidersFailedError(
  error: string | undefined | null,
): boolean {
  return error?.toLowerCase().includes("all chart providers failed") ?? false;
}

export function isStaleChartError(error: string | undefined | null): boolean {
  if (!error) return false;
  if (isStooqChartError(error)) return true;
  if (isAllProvidersFailedError(error)) return true;
  if (error === "Chart data refresh pending") return true;
  return false;
}

/** Replace stale provider errors so UI never shows removed provider names. */
export function sanitizeChartError(
  error: string | undefined,
): string | undefined {
  if (!error) return error;
  if (isStaleChartError(error)) return "Chart data refresh pending";
  if (isStooqChartError(error)) return "Chart data refresh pending";
  return error;
}

/** True when cached row needs a synchronous chart rescan (legacy blob errors). */
export function rowNeedsChartHeal(row: StockScanResult): boolean {
  if (row.ema20 != null) return false;
  if (!row.error) return false;
  if (isStaleChartError(row.error)) return true;
  return false;
}

export function sanitizeScanResult(row: StockScanResult): StockScanResult {
  if (!row.error || !isStaleChartError(row.error)) return row;
  return { ...row, error: sanitizeChartError(row.error) };
}

export function sanitizeScanResults(
  results: StockScanResult[],
): StockScanResult[] {
  return results.map(sanitizeScanResult);
}

export function symbolsWithStaleChartErrors(
  results: StockScanResult[],
): string[] {
  return results
    .filter(
      (row) =>
        row.ema20 == null &&
        (isStaleChartError(row.error) ||
          row.error === "Chart data refresh pending"),
    )
    .map((row) => row.symbol);
}
