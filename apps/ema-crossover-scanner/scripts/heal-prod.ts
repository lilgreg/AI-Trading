/** Loop production heal until success criteria pass. Run: npx tsx scripts/heal-prod.ts */
const BASE =
  process.env.PROD_URL ?? "https://ai-trading-scanner.lilgreg1.workers.dev";
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
  missingSession: number;
  cross4hGap: number;
  total: number;
  scanComplete: boolean;
  scanInProgress: boolean;
  nullPriceSymbols: string[];
  cross4hGapSymbols: string[];
}

function hasCross(cross?: { crossoverAt?: string | null; crossoverDate?: string | null }): boolean {
  return Boolean(cross?.crossoverAt ?? cross?.crossoverDate);
}

function countCross4hGaps(
  results: {
    symbol?: string;
    cross1h?: { crossoverAt?: string | null; crossoverDate?: string | null };
    cross4h?: { crossoverAt?: string | null; crossoverDate?: string | null };
  }[],
): { count: number; symbols: string[] } {
  const gaps = results.filter(
    (row) => hasCross(row.cross1h) && !hasCross(row.cross4h),
  );
  return { count: gaps.length, symbols: gaps.map((r) => r.symbol ?? "?") };
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

  const results = (data.results as {
    symbol?: string;
    error?: string;
    regularMarketChange?: number | null;
    price?: number | null;
    ema20Above50?: boolean;
    preMarketChange?: number | null;
    postMarketChange?: number | null;
    cross4h?: { crossoverAt?: string | null; crossoverDate?: string | null };
  }[]) ?? [];
  const unscanned =
    (data.unscannedCount as number) ??
    results.filter((r) => r.error === "Not scanned yet").length;
  const chartRefreshPending =
    (data.chartRefreshPendingCount as number) ??
    results.filter((r) => r.error === "Chart data refresh pending").length;
  const badErrors = results.filter((r) => r.error && BAD_ERRORS.has(r.error)).length;
  const withReg = results.filter((r) => r.regularMarketChange != null).length;
  const nullPriceSymbols = results.filter((r) => r.price == null).map((r) => r.symbol ?? "?");
  const nullPrice = nullPriceSymbols.length;
  const missingSession = results.filter(
    (r) =>
      !r.error &&
      r.preMarketChange == null &&
      r.regularMarketChange == null &&
      r.postMarketChange == null,
  ).length;
  const cross4h = countCross4hGaps(results);
  const total = results.length;

  console.log(
    new Date().toISOString(),
    "total:",
    total,
    "reg:",
    withReg,
    "nullPrice:",
    nullPrice,
    nullPriceSymbols.length ? `[${nullPriceSymbols.join(",")}]` : "",
    "missingSession:",
    missingSession,
    "cross4hGap:",
    cross4h.count,
    cross4h.symbols.length ? `[${cross4h.symbols.slice(0, 8).join(",")}]` : "",
    "badErrors:",
    badErrors,
    "unscanned:",
    unscanned,
    "chartPending:",
    chartRefreshPending,
  );

  return {
    unscanned,
    chartRefreshPending,
    badErrors,
    withReg,
    nullPrice,
    missingSession,
    cross4hGap: cross4h.count,
    total,
    scanComplete: Boolean(data.scanComplete),
    scanInProgress: Boolean(data.scanInProgress),
    nullPriceSymbols,
    cross4hGapSymbols: cross4h.symbols,
  };
}

function isDone(counts: HealCounts): boolean {
  return (
    counts.unscanned === 0 &&
    counts.chartRefreshPending === 0 &&
    counts.badErrors === 0 &&
    counts.nullPrice === 0 &&
    counts.missingSession === 0 &&
    counts.cross4hGap === 0
  );
}

async function rescanSymbols(symbols: string[]): Promise<void> {
  for (const symbol of symbols.slice(0, 12)) {
    console.log("  rescan", symbol);
    try {
      const res = await fetch(
        `${BASE}/api/scan/symbol?symbol=${encodeURIComponent(symbol)}`,
        { cache: "no-store" },
      );
      console.log("    ", res.status, (await res.text()).slice(0, 80));
    } catch (err) {
      console.log("    error", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 4_000));
  }
}

async function rescanCross4hGaps(): Promise<number> {
  const res = await fetch(`${BASE}/api/scan`, { cache: "no-store" });
  const data = (await res.json()) as {
    results?: {
      symbol?: string;
      cross1h?: { crossoverAt?: string | null; crossoverDate?: string | null };
      cross4h?: { crossoverAt?: string | null; crossoverDate?: string | null };
    }[];
  };
  const gaps =
    data.results?.filter((row) => hasCross(row.cross1h) && !hasCross(row.cross4h)) ?? [];
  console.log(`Rescanning ${gaps.length} cross4h gap symbols (batch 10, 3s delay)`);
  for (let i = 0; i < gaps.length; i += 10) {
    const batch = gaps.slice(i, i + 10);
    for (const row of batch) {
      if (!row.symbol) continue;
      console.log("  rescan", row.symbol);
      try {
        const r = await fetch(
          `${BASE}/api/scan/symbol?symbol=${encodeURIComponent(row.symbol)}`,
          { cache: "no-store" },
        );
        console.log("    ", r.status);
      } catch (err) {
        console.log("    error", err instanceof Error ? err.message : err);
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  return gaps.length;
}

async function main() {
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    console.log(`\n=== heal round ${round}/${MAX_ROUNDS} ===`);
    const counts = await fetchHealCounts();
    if (isDone(counts)) {
      console.log("Done — all success criteria pass.");
      return;
    }

    const toRescan = [
      ...counts.nullPriceSymbols,
      ...counts.cross4hGapSymbols.filter((s) => !counts.nullPriceSymbols.includes(s)),
    ];
    if (toRescan.length > 0 && round % 2 === 1) {
      await rescanSymbols(toRescan);
    } else if (counts.cross4hGap > 0 && round === 1) {
      await rescanCross4hGaps();
    }

    if (round < MAX_ROUNDS) {
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }

  const remaining = await fetchHealCounts();
  console.log(
    `Stopped after ${MAX_ROUNDS} rounds — nullPrice=${remaining.nullPrice}, cross4hGap=${remaining.cross4hGap}, missingSession=${remaining.missingSession}.`,
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
