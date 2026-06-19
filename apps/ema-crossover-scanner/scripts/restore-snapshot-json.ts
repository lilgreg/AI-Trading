/**
 * Restore R2 snapshot + cached scan API from a local JSON backup.
 * Run: npx tsx scripts/restore-snapshot-json.ts [path-to-json]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import type { ScanSnapshot } from "../lib/types";

config({ path: path.join(process.cwd(), ".env.local") });
config({ path: path.join(process.cwd(), ".env") });

async function main() {
  const inputPath =
    process.argv[2] ??
    path.join(process.cwd(), "final-scan.json");

  const raw = JSON.parse(await readFile(inputPath, "utf8")) as Record<
    string,
    unknown
  >;

  const { buildConfigKey, resolveScanJobConfig } = await import(
    "../lib/scan-job"
  );
  const { saveSnapshot } = await import("../lib/scan-cache");
  const { writeScanApiCache } = await import("../lib/scan-api-cache");

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

  await saveSnapshot(snapshot);
  await writeScanApiCache(snapshot);

  console.log(
    `Restored ${results.length} rows from ${inputPath} (scannedAt=${snapshot.scannedAt})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
