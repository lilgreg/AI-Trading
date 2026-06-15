/**
 * Spot-check scan reliability for symbols that often fail after Yahoo throttling.
 * Usage: npx tsx scripts/test-scan-reliability.ts
 */
import { clearBarCache } from "../lib/bar-cache";
import { buildSymbolUniverse } from "../lib/symbols";
import { scanSymbol } from "../lib/scanner";

const SPOT_CHECK = ["AMT", "SNX", "ZBH", "ZTS", "PLTR", "CRWD"];

async function main() {
  clearBarCache();

  const { symbols } = await buildSymbolUniverse({ includeBlueChips: true });
  const byTicker = new Map(symbols.map((s) => [s.yahoo.toUpperCase(), s]));

  const targets = [
    ...SPOT_CHECK.map((t) => byTicker.get(t)).filter(Boolean),
    ...symbols.slice(-20),
  ];

  const unique = [...new Map(targets.map((s) => [s!.yahoo, s!])).values()];
  console.log(`Testing ${unique.length} symbols (AMT/SNX/last-20 overlap deduped)…\n`);

  let ok = 0;
  let fail = 0;

  for (const parsed of unique) {
    const result = await scanSymbol(parsed, 120);
    const hasEma = result.ema20 != null && result.ema50 != null;
    const status = hasEma ? "OK" : "FAIL";
    if (hasEma) ok += 1;
    else fail += 1;
    console.log(
      `${status.padEnd(5)} ${result.displayTicker.padEnd(6)} ema20=${result.ema20?.toFixed(2) ?? "—"} cross4h=${result.cross4h.crossoverMsAgo ?? "—"}${result.error ? ` err=${result.error.slice(0, 80)}` : ""}`,
    );
  }

  console.log(`\nSuccess: ${ok}/${unique.length} (${((ok / unique.length) * 100).toFixed(1)}%)`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
