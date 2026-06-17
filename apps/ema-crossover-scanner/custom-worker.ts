import { default as handler } from "./.open-next/worker.js";
import { runScanChunk } from "./lib/scan-job";

/** Cron chunk schedule — small slices to stay under Workers subrequest limits. */
const SCAN_CRON_CHUNKS: Record<string, { offset: number; limit: number }> = {
  "0 0 * * *": { offset: 0, limit: 12 },
  "5 0 * * *": { offset: 12, limit: 12 },
  "10 0 * * *": { offset: 24, limit: 12 },
  "15 0 * * *": { offset: 36, limit: 12 },
};

export default {
  fetch: handler.fetch,

  async scheduled(
    controller: ScheduledController,
    _env: CloudflareEnv,
    ctx: ExecutionContext,
  ) {
    const chunk = SCAN_CRON_CHUNKS[controller.cron];
    if (!chunk) {
      console.warn(`Unhandled cron expression: ${controller.cron}`);
      return;
    }

    ctx.waitUntil(
      (async () => {
        try {
          const snapshot = await runScanChunk(chunk.offset, chunk.limit);
          console.log(
            `Cron ${controller.cron} chunk offset=${chunk.offset} limit=${chunk.limit}`,
            snapshot
              ? `ok symbols=${snapshot.symbolCount} complete=${snapshot.scanComplete}`
              : "skipped (scan in progress)",
          );
        } catch (err) {
          console.error(`Cron scan chunk failed (${controller.cron}):`, err);
          throw err;
        }
      })(),
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;
