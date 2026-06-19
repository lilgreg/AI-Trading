/**
 * Restore prod R2 scan cache via wrangler (no R2 S3 credentials needed).
 * Run: npx tsx scripts/restore-via-wrangler.ts [path-to-json]
 */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ScanSnapshot } from "../lib/types";

const BUCKET = process.env.R2_BUCKET_NAME ?? "ai-trading-scanner";
const OUT_DIR = path.join(os.tmpdir(), "ema-scanner-restore");

async function main() {
  const inputPath =
    process.argv[2] ?? path.join(process.cwd(), "prod-live-scan.json");

  const raw = JSON.parse(await readFile(inputPath, "utf8")) as Record<
    string,
    unknown
  >;

  const { buildConfigKey, resolveScanJobConfig } = await import(
    "../lib/scan-job"
  );
  const { buildCacheStatus, toCachedResponse } = await import(
    "../lib/scan-cache"
  );
  const { countCross4hGapRows } = await import("../lib/scan-job");
  const { rowNeedsChartHeal } = await import("../lib/chart-error-sanitize");

  const configKey = buildConfigKey(resolveScanJobConfig({}));
  const now = new Date().toISOString();
  const results = raw.results as ScanSnapshot["results"];

  if (!Array.isArray(results) || results.length === 0) {
    console.error("Backup JSON has no results array");
    process.exit(1);
  }

  const snapshot: ScanSnapshot = {
    scannedAt: (raw.scannedAt as string) ?? now,
    completedAt: (raw.completedAt as string) ?? now,
    lastSavedAt: now,
    configKey,
    symbolCount: results.length,
    results,
    sources: (raw.sources as ScanSnapshot["sources"]) ?? {
      blueChips: true,
      watchlist: false,
      custom: false,
      tradingViewWatchlist: true,
    },
    tradingViewWatchlistName: raw.tradingViewWatchlistName as
      | string
      | undefined,
    scanComplete: raw.scanComplete !== false,
  };

  const status = await buildCacheStatus(snapshot);
  const cachedApi = {
    ...toCachedResponse(snapshot, status),
    unscannedCount: snapshot.results.filter(
      (row) => row.error === "Not scanned yet",
    ).length,
    chartRefreshPendingCount: snapshot.results.filter(
      (row) =>
        row.error === "Chart data refresh pending" ||
        (row.ema20 == null && row.error != null && rowNeedsChartHeal(row)),
    ).length,
    cross4hGapCount: countCross4hGapRows(snapshot.results),
  };

  const meta = {
    scannedAt: snapshot.scannedAt,
    completedAt: snapshot.completedAt,
    symbolCount: snapshot.symbolCount,
    scanComplete: snapshot.scanComplete,
    sources: snapshot.sources,
    tradingViewWatchlistName: snapshot.tradingViewWatchlistName,
  };

  const expiredLock = {
    startedAt: new Date(0).toISOString(),
    expiresAt: new Date(0).toISOString(),
  };

  await mkdir(OUT_DIR, { recursive: true });
  const files = {
    "ema-scanner/snapshot.json": snapshot,
    "ema-scanner/snapshot-meta.json": meta,
    "ema-scanner/cached-scan-api.json": cachedApi,
    "ema-scanner/scan-lock.json": expiredLock,
  };

  for (const [key, payload] of Object.entries(files)) {
    const localPath = path.join(OUT_DIR, key.replace(/\//g, "-"));
    await writeFile(localPath, JSON.stringify(payload));
    console.log(`Uploading ${key} (${results.length} rows)...`);
    const wranglerBin =
      process.platform === "win32"
        ? path.join(process.cwd(), "node_modules", ".bin", "wrangler.cmd")
        : path.join(process.cwd(), "node_modules", ".bin", "wrangler");
    const result = spawnSync(
      `"${wranglerBin}" r2 object put ${BUCKET}/${key} --file="${localPath}" --remote`,
      { stdio: "inherit", cwd: process.cwd(), shell: true },
    );
    if (result.status !== 0) {
      throw new Error(`wrangler upload failed for ${key} (exit ${result.status})`);
    }
  }

  const ok = results.filter(
    (row) => row.cross4h?.crossoverAt && !row.error,
  ).length;
  console.log(
    `Restored ${results.length} rows from ${inputPath} (cross4h ok=${ok}, scannedAt=${snapshot.scannedAt})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
