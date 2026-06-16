import type { StockScanResult } from "./types";

/** Legacy cached errors that reference removed Stooq provider. */
export function isStooqChartError(error: string | undefined | null): boolean {
  return error?.toLowerCase().includes("stooq") ?? false;
}

export function isStaleChartError(error: string | undefined | null): boolean {
  if (!error) return false;
  return isStooqChartError(error);
}

/** Replace stale provider errors so UI triggers refresh instead of showing Stooq text. */
export function sanitizeChartError(
  error: string | undefined,
): string | undefined {
  if (!error) return error;
  if (isStooqChartError(error)) return "Chart data refresh pending";
  return error;
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
        isStaleChartError(row.error) ||
        row.error === "Chart data refresh pending",
    )
    .map((row) => row.symbol);
}
