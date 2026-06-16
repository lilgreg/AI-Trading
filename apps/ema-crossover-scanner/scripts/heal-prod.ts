/** Loop production heal until unscanned and chart-pending = 0. Run: npx tsx scripts/heal-prod.ts */
const BASE = process.env.PROD_URL ?? "https://ai-trading-scanner.vercel.app";
const MAX_ROUNDS = Number(process.env.HEAL_ROUNDS ?? 30);
const PAUSE_MS = Number(process.env.HEAL_PAUSE_MS ?? 15_000);

interface HealCounts {
  unscanned: number;
  chartRefreshPending: number;
}

async function fetchHealCounts(): Promise<HealCounts> {
  const res = await fetch(`${BASE}/api/scan?heal=1`, { cache: "no-store" });
  const data = await res.json();
  const results = data.results ?? [];
  const unscanned =
    data.unscannedCount ??
    results.filter((r: { error?: string }) => r.error === "Not scanned yet").length;
  const chartRefreshPending =
    data.chartRefreshPendingCount ??
    results.filter(
      (r: { error?: string }) => r.error === "Chart data refresh pending",
    ).length;

  const row0 = results[0];
  const withPre = results.filter(
    (r: { preMarketChange?: number | null }) => r.preMarketChange != null,
  ).length;
  const withPost = results.filter(
    (r: { postMarketChange?: number | null }) => r.postMarketChange != null,
  ).length;

  console.log(
    new Date().toISOString(),
    "unscanned:",
    unscanned,
    "chartPending:",
    chartRefreshPending,
    "scanComplete:",
    data.scanComplete,
    "scanInProgress:",
    data.scanInProgress,
    "withPre:",
    withPre,
    "withPost:",
    withPost,
    "row0:",
    row0?.symbol,
    row0?.displayTicker,
  );

  return { unscanned, chartRefreshPending };
}

function isDone(counts: HealCounts): boolean {
  return counts.unscanned === 0 && counts.chartRefreshPending === 0;
}

async function main() {
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    console.log(`\n=== heal round ${round}/${MAX_ROUNDS} ===`);
    const counts = await fetchHealCounts();
    if (isDone(counts)) {
      console.log("Done — all symbols scanned with resolved chart data.");
      return;
    }
    if (round < MAX_ROUNDS) {
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }

  const remaining = await fetchHealCounts();
  console.log(
    `Stopped after ${MAX_ROUNDS} rounds — unscanned=${remaining.unscanned}, chartPending=${remaining.chartRefreshPending}.`,
  );
}

main().catch(console.error);
