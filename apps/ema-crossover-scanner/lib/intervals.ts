export type ScanInterval = "1h" | "4h";

export const DEFAULT_SCAN_INTERVAL: ScanInterval = "4h";

export function parseScanInterval(value: string | null | undefined): ScanInterval {
  if (value === "1h" || value === "4h") return value;
  const env = process.env.DEFAULT_SCAN_INTERVAL;
  if (env === "1h" || env === "4h") return env;
  return DEFAULT_SCAN_INTERVAL;
}

export function tradingViewIntervalParam(interval: ScanInterval): string {
  return interval === "1h" ? "60" : "240";
}
