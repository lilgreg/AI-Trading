/** Quick production API analyzer — run: npx tsx scripts/analyze-prod.ts */
const BASE = process.env.PROD_URL ?? "https://ai-trading-scanner.workers.dev";

async function main() {
  const statusRes = await fetch(`${BASE}/api/scan?status=true`, { cache: "no-store" });
  const status = await statusRes.json();
  console.log("=== STATUS ===");
  console.log(JSON.stringify(status, null, 2));

  const scanRes = await fetch(`${BASE}/api/scan`, { cache: "no-store" });
  const data = await scanRes.json();
  const results = data.results ?? [];

  const notScanned = results.filter((r: { error?: string }) => r.error === "Not scanned yet");
  console.log("\n=== COUNTS ===");
  console.log("total:", results.length);
  console.log("notScanned:", notScanned.length);
  console.log("scanComplete:", data.scanComplete);
  console.log("retryableCount:", data.retryableCount);

  const row0 = results[0];
  console.log("\n=== ROW 0 ===");
  console.log(JSON.stringify({
    symbol: row0?.symbol,
    preMarketChange: row0?.preMarketChange,
    regularMarketChange: row0?.regularMarketChange,
    postMarketChange: row0?.postMarketChange,
    universeIndex: row0?.universeIndex,
    error: row0?.error,
  }, null, 2));

  const row102 = results[101];
  console.log("\n=== ROW 102 (index 101) ===");
  console.log(JSON.stringify({
    symbol: row102?.symbol,
    universeIndex: row102?.universeIndex,
    error: row102?.error,
    cross4h: row102?.cross4h,
    ema20: row102?.ema20,
  }, null, 2));

  const row103 = results[102];
  console.log("\n=== ROW 103 (index 102) ===");
  console.log(JSON.stringify({
    symbol: row103?.symbol,
    universeIndex: row103?.universeIndex,
    error: row103?.error,
    cross4h: row103?.cross4h,
    ema20: row103?.ema20,
  }, null, 2));

  if (notScanned.length > 0) {
    const indices = notScanned.map((r: { universeIndex?: number; symbol: string }) =>
      `${r.universeIndex ?? "?"}:${r.symbol}`,
    );
    console.log("\n=== NOT SCANNED (first 10) ===");
    console.log(indices.slice(0, 10).join(", "));
    console.log("universeIndex range:", Math.min(...notScanned.map((r: { universeIndex?: number }) => r.universeIndex ?? 999)), "-", Math.max(...notScanned.map((r: { universeIndex?: number }) => r.universeIndex ?? -1)));
  }

  const withPre = results.filter((r: { preMarketChange?: number | null }) => r.preMarketChange != null).length;
  const withPost = results.filter((r: { postMarketChange?: number | null }) => r.postMarketChange != null).length;
  const withReg = results.filter((r: { regularMarketChange?: number | null }) => r.regularMarketChange != null).length;
  console.log("\n=== SESSION FIELDS ===");
  console.log("withPre:", withPre, "withReg:", withReg, "withPost:", withPost);
}

main().catch(console.error);
