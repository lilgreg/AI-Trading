/** Loop production heal until success criteria pass. Run: npx tsx scripts/heal-prod.ts */
const BASE = process.env.PROD_URL ?? "https://ai-trading-scanner.workers.dev";
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
  nullPrice: number;
  cross4hGap: number;
  total: number;
  scanComplete: boolean;
  scanInProgress: boolean;
}

function countCross4hGaps(
  results: { ema20Above50?: boolean; cross1h?: { crossoverAt?: string | null; crossoverDate?: string | null }; cross4h?: { crossoverAt?: string | null; crossoverDate?: string | null } }[],
): number {
  return results.filter((row) => {
    if (!row.ema20Above50) return false;
    const c1 = row.cross1h?.crossoverAt ?? row.cross1h?.crossoverDate;
    const c4 = row.cross4h?.crossoverAt ?? row.cross4h?.crossoverDate;
    return Boolean(c1 && !c4);
  }).length;
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

  const results = (data.results as { error?: string; regularMarketChange?: number | null; price?: number | null; ema20Above50?: boolean; cross1h?: { crossoverAt?: string | null; crossoverDate?: string | null }; cross4h?: { crossoverAt?: string | null; crossoverDate?: string | null } }[]) ?? [];
  const unscanned =
    (data.unscannedCount as number) ??
    results.filter((r) => r.error === "Not scanned yet").length;
  const chartRefreshPending =
    (data.chartRefreshPendingCount as number) ??
    results.filter((r) => r.error === "Chart data refresh pending").length;
  const badErrors = results.filter((r) => r.error && BAD_ERRORS.has(r.error)).length;
  const withReg = results.filter((r) => r.regularMarketChange != null).length;
  const nullPrice = results.filter((r) => r.price == null).length;
  const cross4hGap =
    (data.cross4hGapCount as number) ?? countCross4hGaps(results);
  const total = results.length;
  const regPct = total ? ((withReg / total) * 100).toFixed(1) : "0";
  const nullPct = total ? ((nullPrice / total) * 100).toFixed(1) : "0";

  console.log(
    new Date().toISOString(),
    "total:",
    total,
    "reg:",
    `${withReg} (${regPct}%)`,
    "nullPrice:",
    `${nullPrice} (${nullPct}%)`,
    "cross4hGap:",
    cross4hGap,
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
    nullPrice,
    cross4hGap,
    total,
    scanComplete: Boolean(data.scanComplete),
    scanInProgress: Boolean(data.scanInProgress),
  };
}

function isDone(counts: HealCounts): boolean {
  const regPct = counts.total ? counts.withReg / counts.total : 0;
  const nullPct = counts.total ? counts.nullPrice / counts.total : 0;
  return (
    counts.unscanned === 0 &&
    counts.chartRefreshPending === 0 &&
    counts.badErrors === 0 &&
    counts.cross4hGap === 0 &&
    (counts.nullPrice <= 10 || nullPct < 0.05) &&
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
    `Stopped after ${MAX_ROUNDS} rounds — reg=${remaining.withReg}/${remaining.total}, nullPrice=${remaining.nullPrice}, cross4hGap=${remaining.cross4hGap}, badErrors=${remaining.badErrors}.`,
  );
}

main().catch(console.error);
