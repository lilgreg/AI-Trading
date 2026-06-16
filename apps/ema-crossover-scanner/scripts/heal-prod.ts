/** Loop production heal until success criteria pass. Run: npx tsx scripts/heal-prod.ts */
const BASE = process.env.PROD_URL ?? "https://ai-trading-scanner.vercel.app";
const MAX_ROUNDS = Number(process.env.HEAL_ROUNDS ?? 50);
const PAUSE_MS = Number(process.env.HEAL_PAUSE_MS ?? 20_000);

const BAD_ERRORS = new Set([
  "Not scanned yet",
  "Chart data refresh pending",
  "No chart data available",
  "Insufficient price history for EMA calculation",
]);

interface HealCounts {
  unscanned: number;
  chartRefreshPending: number;
  badErrors: number;
  withReg: number;
  total: number;
  scanComplete: boolean;
  scanInProgress: boolean;
}

async function fetchHealCounts(): Promise<HealCounts> {
  const res = await fetch(`${BASE}/api/scan?heal=1`, { cache: "no-store" });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Heal request failed (${res.status}): ${text.slice(0, 120)}`);
  }

  const results = (data.results as { error?: string; regularMarketChange?: number | null }[]) ?? [];
  const unscanned =
    (data.unscannedCount as number) ??
    results.filter((r) => r.error === "Not scanned yet").length;
  const chartRefreshPending =
    (data.chartRefreshPendingCount as number) ??
    results.filter((r) => r.error === "Chart data refresh pending").length;
  const badErrors = results.filter((r) => r.error && BAD_ERRORS.has(r.error)).length;
  const withReg = results.filter((r) => r.regularMarketChange != null).length;
  const total = results.length;
  const regPct = total ? ((withReg / total) * 100).toFixed(1) : "0";

  console.log(
    new Date().toISOString(),
    "total:",
    total,
    "reg:",
    `${withReg} (${regPct}%)`,
    "badErrors:",
    badErrors,
    "unscanned:",
    unscanned,
    "chartPending:",
    chartRefreshPending,
    "scanComplete:",
    data.scanComplete,
    "scanInProgress:",
    data.scanInProgress,
  );

  if (badErrors > 0) {
    const bad = results
      .filter((r) => r.error && BAD_ERRORS.has(r.error))
      .map((r) => `${(r as { symbol?: string }).symbol}:${r.error}`)
      .slice(0, 15);
    console.log("  bad:", bad.join(", "));
  }

  return {
    unscanned,
    chartRefreshPending,
    badErrors,
    withReg,
    total,
    scanComplete: Boolean(data.scanComplete),
    scanInProgress: Boolean(data.scanInProgress),
  };
}

function isDone(counts: HealCounts): boolean {
  const regPct = counts.total ? counts.withReg / counts.total : 0;
  return (
    counts.unscanned === 0 &&
    counts.chartRefreshPending === 0 &&
    counts.badErrors === 0 &&
    regPct >= 0.98
  );
}

async function main() {
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    console.log(`\n=== heal round ${round}/${MAX_ROUNDS} ===`);
    const counts = await fetchHealCounts();
    if (isDone(counts)) {
      console.log("Done — all success criteria pass.");
      return;
    }
    if (round < MAX_ROUNDS) {
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }

  const remaining = await fetchHealCounts();
  console.log(
    `Stopped after ${MAX_ROUNDS} rounds — reg=${remaining.withReg}/${remaining.total}, badErrors=${remaining.badErrors}.`,
  );
}

main().catch(console.error);
