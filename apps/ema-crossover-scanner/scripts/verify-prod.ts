/** Production verification — run: npx tsx scripts/verify-prod.ts */
const BASE = process.env.PROD_URL ?? "https://ai-trading-scanner.vercel.app";

async function main() {
  const res = await fetch(`${BASE}/api/scan?status=true`, { cache: "no-store" });
  const status = await res.json();
  console.log("=== STATUS ===");
  console.log(JSON.stringify(status, null, 2));

  const scanRes = await fetch(`${BASE}/api/scan`, { cache: "no-store" });
  const data = await scanRes.json();
  const results = data.results ?? [];

  const byError: Record<string, number> = {};
  for (const r of results) {
    const e = r.error ?? "(none)";
    byError[e] = (byError[e] ?? 0) + 1;
  }

  console.log("\n=== ERROR COUNTS ===");
  console.log(JSON.stringify(byError, null, 2));
  console.log("unscannedCount:", data.unscannedCount);
  console.log("chartRefreshPendingCount:", data.chartRefreshPendingCount);
  console.log("scanComplete:", data.scanComplete);

  const targets = ["VIX", "QQQ", "SPY", "XOM"];
  console.log("\n=== TARGET SYMBOLS ===");
  for (const t of targets) {
    const r = results.find(
      (x: { symbol?: string; displayTicker?: string }) =>
        x.symbol === t || x.displayTicker === t,
    );
    if (r) {
      console.log(
        JSON.stringify({
          symbol: r.symbol,
          displayTicker: r.displayTicker,
          tradingViewSymbol: r.tradingViewSymbol,
          error: r.error,
          ema20: r.ema20,
          cross4h: r.cross4h?.crossoverAt ? "has cross" : "no cross",
          universeIndex: r.universeIndex,
        }),
      );
    } else {
      console.log(`${t}: not found`);
    }
  }

  const withEma = results.filter((r: { ema20?: number | null }) => r.ema20 != null).length;
  console.log("\n=== SUMMARY ===");
  console.log("withEma:", withEma, "/", results.length);
}

main().catch(console.error);
