/** Production verification — run: npx tsx scripts/verify-prod.ts */
const BASE = process.env.PROD_URL ?? "https://ai-trading-scanner.workers.dev";

const BAD_ERRORS = new Set([
  "Not scanned yet",
  "Chart data refresh pending",
  "No chart data available",
  "Insufficient price history for EMA calculation",
]);

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

  const withReg = results.filter(
    (r: { regularMarketChange?: number | null }) => r.regularMarketChange != null,
  ).length;
  const regPct = results.length ? (withReg / results.length) * 100 : 0;

  console.log("\n=== ERROR COUNTS ===");
  console.log(JSON.stringify(byError, null, 2));
  console.log("unscannedCount:", data.unscannedCount);
  console.log("chartRefreshPendingCount:", data.chartRefreshPendingCount);
  console.log("scanComplete:", data.scanComplete);
  console.log("withReg:", withReg, "/", results.length, `(${regPct.toFixed(1)}%)`);

  const badRows = results.filter((r: { error?: string }) =>
    r.error ? BAD_ERRORS.has(r.error) : false,
  );

  console.log("\n=== SUCCESS CRITERIA ===");
  console.log("regPct >= 98%:", regPct >= 98 ? "PASS" : "FAIL");
  console.log("badErrors:", badRows.length, badRows.length === 0 ? "PASS" : "FAIL");
  if (badRows.length > 0) {
    console.log(
      badRows
        .map(
          (r: { symbol?: string; error?: string }) => `${r.symbol}:${r.error}`,
        )
        .join(", "),
    );
  }

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
          error: r.error,
          pre: r.preMarketChange,
          reg: r.regularMarketChange,
          post: r.postMarketChange,
          ema20: r.ema20,
          cross4h: r.cross4h?.crossoverAt ? "has cross" : "no cross",
        }),
      );
    } else {
      console.log(`${t}: not found`);
    }
  }

  const withEma = results.filter((r: { ema20?: number | null }) => r.ema20 != null).length;
  console.log("\n=== SUMMARY ===");
  console.log("withEma:", withEma, "/", results.length);
  console.log(
    "ALL PASS:",
    regPct >= 98 && badRows.length === 0 && data.unscannedCount === 0
      ? "YES"
      : "NO",
  );
}

main().catch(console.error);
