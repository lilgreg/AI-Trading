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
import { sleep } from "./request-limit";
import { buildSymbolUniverse } from "./symbols";

/** ~8 subrequests/symbol — keep each CF invocation well under the 50 limit. */
export const CF_FORCE_RESCAN_CHUNK_SIZE = 4;

export type CfScanChunk = { offset: number; limit: number };

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
): CfScanChunk | null {
  if (chunkOffset < 0 || chunkOffset >= symbolCount) return null;
  return {
    offset: chunkOffset,
    limit: Math.min(CF_FORCE_RESCAN_CHUNK_SIZE, symbolCount - chunkOffset),
  };
}

function* iterateCfScanChunks(symbolCount: number): Generator<CfScanChunk> {
  for (
    let offset = 0;
    offset < symbolCount;
    offset += CF_FORCE_RESCAN_CHUNK_SIZE
  ) {
    yield {
      offset,
      limit: Math.min(CF_FORCE_RESCAN_CHUNK_SIZE, symbolCount - offset),
    };
  }
}

async function pickCloudflareScanChunk(
  overrides: Partial<ScanJobConfig>,
  options: { force?: boolean; chunkOffset?: number },
): Promise<CfScanChunk | null> {
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

  for (const chunk of iterateCfScanChunks(symbols.length)) {
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

  await sleep(3_000);

  const chainUrl = new URL("https://worker/api/scan");
  chainUrl.searchParams.set("force", "continue");
  chainUrl.searchParams.set("chunkOffset", String(nextOffset));
  await selfRef.fetch(chainUrl.toString());
}
