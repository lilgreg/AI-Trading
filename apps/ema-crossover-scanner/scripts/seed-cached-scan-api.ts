/**
 * One-off: build ema-scanner/cached-scan-api.json in R2 from the live snapshot.
 * Run: npx tsx scripts/seed-cached-scan-api.ts
 */
import { config } from "dotenv";
import path from "node:path";

config({ path: path.join(process.cwd(), ".env.local") });
config({ path: path.join(process.cwd(), ".env") });

async function main() {
  const { loadSnapshot } = await import("../lib/scan-cache");
  const { writeScanApiCache } = await import("../lib/scan-api-cache");

  const snapshot = await loadSnapshot({ enrich: false });
  if (!snapshot?.results?.length) {
    console.error("No snapshot in R2/local cache");
    process.exit(1);
  }

  await writeScanApiCache(snapshot);
  console.log(
    `Wrote cached scan API (${snapshot.results.length} rows, scannedAt=${snapshot.scannedAt})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
