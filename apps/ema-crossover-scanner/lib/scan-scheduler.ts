import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  runBackgroundScan,
  runScanChunk,
  type ScanJobConfig,
} from "./scan-job";
import { isCloudflareWorkersRuntime } from "./runtime";

/** Chunk schedule — mirrors custom-worker.ts cron slices. */
export const SCAN_CHUNKS = [
  { offset: 0, limit: 80 },
  { offset: 80, limit: 80 },
  { offset: 160, limit: 100 },
  { offset: 260, limit: 100 },
] as const;

export function scheduleBackgroundTask(task: () => Promise<void>): void {
  if (isCloudflareWorkersRuntime()) {
    try {
      const { ctx } = getCloudflareContext();
      ctx.waitUntil(task());
      return;
    } catch {
      // Preview/dev without Workers context — fall through to fire-and-forget.
    }
  }
  void task().catch(() => undefined);
}

export async function runChunkedScan(
  overrides: Partial<ScanJobConfig> = {},
  options: { force?: boolean } = {},
): Promise<void> {
  for (let i = 0; i < SCAN_CHUNKS.length; i += 1) {
    const chunk = SCAN_CHUNKS[i];
    const snapshot = await runScanChunk(
      chunk.offset,
      chunk.limit,
      overrides,
      { force: options.force },
    );
    if (snapshot === null && i === 0) {
      return;
    }
  }
}

/** Fire-and-forget scan — chunked on Workers, full scan elsewhere. */
export function scheduleScanJob(
  overrides: Partial<ScanJobConfig> = {},
  options: { force?: boolean } = {},
): void {
  scheduleBackgroundTask(async () => {
    if (isCloudflareWorkersRuntime()) {
      await runChunkedScan(overrides, options);
      return;
    }
    await runBackgroundScan(overrides, options);
  });
}
