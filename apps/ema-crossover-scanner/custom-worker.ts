import { default as handler } from "./.open-next/worker.js";
import { runForceRescanChunk } from "./lib/scan-scheduler";
import { runScanChunk } from "./lib/scan-job";
import { initScanStorageFromEnv } from "./lib/scan-storage";
import { tryServeQuotesApi } from "./lib/worker-quotes-fast";
import { tryServeScanApi, tryStartForceRescan } from "./lib/worker-scan-fast";
import {
  guardWorkerRequest,
  recordGlobalRequest,
} from "./lib/worker-request-guard";

/** Server actions must reach OpenNext; everything else can use prebuilt ASSETS. */
function isServerActionRequest(request: Request): boolean {
  return request.headers.has("Next-Action");
}

async function tryServeAsset(
  request: Request,
  env: CloudflareEnv,
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const url = new URL(request.url);
  const path = url.pathname;
  if (path.startsWith("/api/") || isServerActionRequest(request)) {
    return null;
  }

  try {
    let asset = await env.ASSETS.fetch(request);
    if (asset.status === 404 && !path.includes(".")) {
      const indexUrl = new URL(request.url);
      indexUrl.pathname = "/index.html";
      asset = await env.ASSETS.fetch(
        new Request(indexUrl.toString(), { method: request.method, headers: request.headers }),
      );
    }
    if (asset.status !== 404) return asset;
  } catch {
    // fall through to OpenNext handler
  }
  return null;
}

function parseChunkOffset(url: URL): number {
  const raw = url.searchParams.get("chunkOffset");
  const parsed = Number(raw ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

async function tryHandleForceRescan(
  request: Request,
  env: CloudflareEnv,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/scan") return null;
  if (request.method !== "GET" && request.method !== "POST") return null;

  const force = url.searchParams.get("force") === "true";
  const continueScan = url.searchParams.get("force") === "continue";
  if (!force && !continueScan) return null;

  initScanStorageFromEnv(env);

  if (continueScan) {
    const chunkOffset = parseChunkOffset(url);
    ctx.waitUntil(
      runForceRescanChunk(env, chunkOffset).catch((err) => {
        console.error(`Force rescan continue offset=${chunkOffset} failed:`, err);
      }),
    );
    return new Response(null, { status: 204 });
  }

  const result = await tryStartForceRescan(env);
  if (!result) return null;

  if (result.started) {
    ctx.waitUntil(
      runForceRescanChunk(env, 0).catch((err) => {
        console.error("Force rescan failed:", err);
      }),
    );
  }

  return Response.json(result.payload, {
    status: 202,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Cron chunk schedule — small slices to stay under Workers subrequest limits. */
const SCAN_CRON_CHUNKS: Record<string, { offset: number; limit: number }> = {
  "0 0 * * *": { offset: 0, limit: 12 },
  "5 0 * * *": { offset: 12, limit: 12 },
  "10 0 * * *": { offset: 24, limit: 12 },
  "15 0 * * *": { offset: 36, limit: 12 },
};

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const asset = await tryServeAsset(request, env);
    if (asset) return asset;

    const forceRescan = await tryHandleForceRescan(request, env, ctx);
    if (forceRescan) return forceRescan;

    const scanApi = await tryServeScanApi(request, env);
    if (scanApi) return scanApi;

    const quotesApi = await tryServeQuotesApi(request, env);
    if (quotesApi) return quotesApi;

    const guard = guardWorkerRequest(request.url);
    if (!guard.allowed) {
      return new Response(
        JSON.stringify({
          error: "Too many requests — try again shortly",
          retryAfterSec: guard.retryAfterSec,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(guard.retryAfterSec),
            "Cache-Control": "no-store",
          },
        },
      );
    }

    ctx.waitUntil(recordGlobalRequest(env));
    return handler.fetch!(request, env, ctx);
  },

  async scheduled(
    controller: ScheduledController,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ) {
    initScanStorageFromEnv(env);

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
              ? `ok symbols=${snapshot.symbolCount} scannedAt=${snapshot.scannedAt}`
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
