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

/** Cron chunk size — small slices to stay under Workers subrequest limits (~8 subreq/symbol). */
const CRON_CHUNK_SIZE = 4;
/** Nightly cron expression → chunk index. */
const CRON_CHUNK_ORDER: Record<string, number> = {
  "0 0 * * *": 0,
  "5 0 * * *": 1,
  "10 0 * * *": 2,
  "15 0 * * *": 3,
};
/** Upper bound for the rotation modulus (real universe ≈ 328). */
const CRON_MAX_SYMBOLS = 400;

/** Rotate the nightly scan window so all symbols are covered over successive nights. */
function cronNightBaseOffset(at: Date): number {
  const symbolsPerNight = CRON_CHUNK_SIZE * Object.keys(CRON_CHUNK_ORDER).length;
  const start = Date.UTC(at.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((at.getTime() - start) / 86_400_000);
  const nights = Math.ceil(CRON_MAX_SYMBOLS / symbolsPerNight);
  return (dayOfYear % nights) * symbolsPerNight;
}

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

    const chunkIndex = CRON_CHUNK_ORDER[controller.cron];
    if (chunkIndex === undefined) {
      console.warn(`Unhandled cron expression: ${controller.cron}`);
      return;
    }

    const offset =
      cronNightBaseOffset(new Date(controller.scheduledTime)) +
      chunkIndex * CRON_CHUNK_SIZE;

    ctx.waitUntil(
      (async () => {
        try {
          const snapshot = await runScanChunk(offset, CRON_CHUNK_SIZE);
          console.log(
            `Cron ${controller.cron} chunk offset=${offset} limit=${CRON_CHUNK_SIZE}`,
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
