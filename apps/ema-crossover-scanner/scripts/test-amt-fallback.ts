/**
 * Verify AMT chart data via backup providers when Yahoo is skipped.
 * Usage:
 *   npx tsx scripts/test-amt-fallback.ts
 *   CHART_SKIP_YAHOO=1 FINNHUB_API_KEY=xxx npx tsx scripts/test-amt-fallback.ts
 */
import { clearBarCache } from "../lib/bar-cache";
import { fetchHourlyBars, listChartProviders } from "../lib/chart-data";
import {
  findMostRecentBullishCrossover,
  latestEmaValues,
} from "../lib/ema";
import { aggregateHourlyTo4h } from "../lib/yahoo";

const SYMBOL = "AMT";
const DAYS = 120;
const FAST_EMA = 20;
const SLOW_EMA = 50;

async function runCase(label: string, env: Record<string, string | undefined>): Promise<boolean> {
  clearBarCache();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  console.log(`\n--- ${label} ---`);
  console.log(`Providers: ${listChartProviders().join(", ")}`);

  try {
    const { bars, source } = await fetchHourlyBars(SYMBOL, DAYS);
    const bars4h = aggregateHourlyTo4h(bars);
    const cross1h = findMostRecentBullishCrossover(bars, FAST_EMA, SLOW_EMA);
    const cross4h = findMostRecentBullishCrossover(bars4h, FAST_EMA, SLOW_EMA);
    const { emaFast, emaSlow, fastAboveSlow } = latestEmaValues(
      bars4h.map((b) => b.close),
      FAST_EMA,
      SLOW_EMA,
    );

    console.log(`OK source=${source} hourly=${bars.length} 4h=${bars4h.length}`);
    console.log(
      `EMA20=${emaFast?.toFixed(2)} EMA50=${emaSlow?.toFixed(2)} above50=${fastAboveSlow}`,
    );
    console.log(
      `Cross 1h=${cross1h ? cross1h.date.toISOString() : "none"} 4h=${cross4h ? cross4h.date.toISOString() : "none"}`,
    );

    if (bars.length < SLOW_EMA + 5) {
      console.log("FAIL insufficient hourly bars");
      return false;
    }
    if (emaFast == null || emaSlow == null) {
      console.log("FAIL missing EMA values");
      return false;
    }
    return true;
  } catch (err) {
    console.log(`FAIL ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function main() {
  let passed = 0;
  let total = 0;

  const cases: Array<[string, Record<string, string | undefined>]> = [
    ["Full provider chain", {}],
    [
      "Yahoo-spark only (skip slow Yahoo endpoints)",
      { CHART_SKIP_YAHOO_SLOW: "1", CHART_SKIP_YAHOO: undefined },
    ],
  ];

  if (process.env.FINNHUB_API_KEY?.trim()) {
    cases.push([
      "Backup-only (skip all Yahoo)",
      { CHART_SKIP_YAHOO: "1", CHART_SKIP_YAHOO_SLOW: undefined },
    ]);
  } else {
    console.log(
      "\nNote: Set FINNHUB_API_KEY to also test backup-only (non-Yahoo) path.",
    );
  }

  for (const [label, env] of cases) {
    total += 1;
    if (await runCase(label, env)) passed += 1;
  }

  console.log(`\nPassed ${passed}/${total}`);
  if (passed < total) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
