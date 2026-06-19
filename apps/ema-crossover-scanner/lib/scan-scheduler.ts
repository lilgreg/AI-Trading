import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  isRetryableResult,
  resolveScanJobConfig,
  runBackgroundScan,
  runScanChunk,
  type ScanJobConfig,
} from "./scan-job";
import { loadSnapshot } from "./scan-cache";
import { isCloudflareWorkersRuntime } from "./runtime";
import { buildSymbolUniverse } from "./symbols";

/** Small chunks for Cloudflare — stay under the 50 subrequest limit per invocation. */
const CF_SCAN_CHUNKS = [
  { offset: 0, limit: 12 },
  { offset: 12, limit: 12 },
  { offset: 24, limit: 12 },
  { offset: 36, limit: 12 },
  { offset: 48, limit: 12 },
  { offset: 60, limit: 12 },
  { offset: 72, limit: 12 },
  { offset: 84, limit: 12 },
  { offset: 96, limit: 12 },
  { offset: 108, limit: 12 },
  { offset: 120, limit: 12 },
  { offset: 132, limit: 12 },
  { offset: 144, limit: 12 },
  { offset: 156, limit: 12 },
  { offset: 168, limit: 12 },
  { offset: 180, limit: 12 },
  { offset: 192, limit: 12 },
  { offset: 204, limit: 12 },
  { offset: 216, limit: 12 },
  { offset: 228, limit: 12 },
  { offset: 240, limit: 12 },
  { offset: 252, limit: 12 },
  { offset: 264, limit: 12 },
  { offset: 276, limit: 12 },
  { offset: 288, limit: 12 },
  { offset: 300, limit: 12 },
  { offset: 312, limit: 14 },
] as const;

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

export function pickForceRescanChunk(
  chunkOffset: number,
  symbolCount: number,
): (typeof CF_SCAN_CHUNKS)[number] | null {
  for (const chunk of CF_SCAN_CHUNKS) {
    if (chunk.offset < chunkOffset) continue;
    if (chunk.offset >= symbolCount) return null;
    return chunk;
  }
  return null;
}

async function pickCloudflareScanChunk(
  overrides: Partial<ScanJobConfig>,
  options: { force?: boolean; chunkOffset?: number },
): Promise<(typeof CF_SCAN_CHUNKS)[number] | null> {
  const config = resolveScanJobConfig(overrides);
  const { symbols } = await buildSymbolUniverse({
    includeBlueChips: config.includeBlueChips,
    watchlistText: config.watchlistText,
    customSymbols: config.customSymbols,
    tradingViewWatchlistUrl: config.tradingViewWatchlistUrl,
  });

  if (options.force === true) {
    return pickForceRescanChunk(options.chunkOffset ?? 0, symbols.length);
  }

  const snapshot = await loadSnapshot({ enrich: false });
  const bySymbol = new Map(
    snapshot?.results?.map((row) => [row.symbol, row]) ?? [],
  );

  for (const chunk of CF_SCAN_CHUNKS) {
    const slice = symbols.slice(chunk.offset, chunk.offset + chunk.limit);
    const needsScan = slice.some((parsed) => {
      const row = bySymbol.get(parsed.yahoo);
      if (!row) return true;
      if (row.error === "Not scanned yet") return true;
      return isRetryableResult(row);
    });
    if (needsScan) return chunk;
  }

  return null;
}

export async function runChunkedScan(
  overrides: Partial<ScanJobConfig> = {},
  options: { force?: boolean; chunkOffset?: number } = {},
): Promise<void> {
  if (isCloudflareWorkersRuntime()) {
    const config = resolveScanJobConfig(overrides);
    const { symbols } = await buildSymbolUniverse({
      includeBlueChips: config.includeBlueChips,
      watchlistText: config.watchlistText,
      customSymbols: config.customSymbols,
      tradingViewWatchlistUrl: config.tradingViewWatchlistUrl,
    });

    const chunk = await pickCloudflareScanChunk(overrides, options);
    if (!chunk) return;

    const snapshot = await runScanChunk(chunk.offset, chunk.limit, overrides, options);
    const nextOffset = chunk.offset + chunk.limit;

    if (options.force === true && nextOffset < symbols.length) {
      scheduleScanJob(overrides, { force: true, chunkOffset: nextOffset });
      return;
    }

    if (!options.force && snapshot && !snapshot.scanComplete) {
      scheduleScanJob(overrides, options);
    }
    return;
  }

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
let scanJobQueued = false;

export function scheduleScanJob(
  overrides: Partial<ScanJobConfig> = {},
  options: { force?: boolean; chunkOffset?: number } = {},
): void {
  if (scanJobQueued) return;

  scanJobQueued = true;
  scheduleBackgroundTask(async () => {
    try {
      if (isCloudflareWorkersRuntime()) {
        await runChunkedScan(overrides, options);
        return;
      }
      await runBackgroundScan(overrides, options);
    } finally {
      scanJobQueued = false;
    }
  });
}

/** One CF chunk per invocation; chain via WORKER_SELF_REFERENCE for fresh CPU budget. */
export async function runForceRescanChunk(
  env: CloudflareEnv,
  chunkOffset: number,
): Promise<void> {
  const config = resolveScanJobConfig({});
  const { symbols } = await buildSymbolUniverse({
    includeBlueChips: config.includeBlueChips,
    watchlistText: config.watchlistText,
    customSymbols: config.customSymbols,
    tradingViewWatchlistUrl: config.tradingViewWatchlistUrl,
  });

  const chunk = pickForceRescanChunk(chunkOffset, symbols.length);
  if (!chunk) return;

  const snapshot = await runScanChunk(chunk.offset, chunk.limit, {}, {
    force: true,
  });
  if (!snapshot) {
    console.warn(
      `Force rescan chunk offset=${chunkOffset} skipped (lock held)`,
    );
    const selfRef = env.WORKER_SELF_REFERENCE;
    if (selfRef) {
      const retryUrl = new URL("https://worker/api/scan");
      retryUrl.searchParams.set("force", "continue");
      retryUrl.searchParams.set("chunkOffset", String(chunkOffset));
      await selfRef.fetch(retryUrl.toString());
    }
    return;
  }

  console.log(
    `Force rescan chunk offset=${chunk.offset} limit=${chunk.limit}`,
    `scannedAt=${snapshot.scannedAt} complete=${snapshot.scanComplete}`,
  );

  const nextOffset = chunk.offset + chunk.limit;
  if (nextOffset >= symbols.length) return;

  const selfRef = env.WORKER_SELF_REFERENCE;
  if (!selfRef) {
    console.warn("WORKER_SELF_REFERENCE missing — force rescan chain stopped");
    return;
  }

  const chainUrl = new URL("https://worker/api/scan");
  chainUrl.searchParams.set("force", "continue");
  chainUrl.searchParams.set("chunkOffset", String(nextOffset));
  await selfRef.fetch(chainUrl.toString());
}
