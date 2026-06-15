import type { PatternDetection, PatternStatus } from "./types";

/** Client-side sort key: lower = more interesting (Active, then recent). */
export function patternSortKey(detection: PatternDetection | undefined): number {
  const tier: Record<PatternStatus, number> = {
    Active: 0,
    Failed: 100,
    Target: 200,
    None: 1000,
  };
  const status = detection?.status;
  const base = status && status in tier ? tier[status] : tier.None;
  const recency = detection?.confirmMsAgo ?? Number.MAX_SAFE_INTEGER;
  return base + recency / 1e15;
}
