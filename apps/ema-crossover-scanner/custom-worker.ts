// @ts-expect-error `.open-next/worker.js` is generated at build time
import { default as handler } from "./.open-next/worker.js";
import { runScanChunk } from "./lib/scan-job";

/** Cron chunk schedule — mirrors former vercel.json crons. */
const SCAN_CRON_CHUNKS: Record<string, { offset: number; limit: number }> = {
  "0 0 * * *": { offset: 0, limit: 80 },
  "5 0 * * *": { offset: 80, limit: 80 },
  "10 0 * * *": { offset: 160, limit: 100 },
  "15 0 * * *": { offset: 260, limit: 100 },
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
