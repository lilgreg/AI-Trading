/**
 * Test scan for symbols at index 120-130 in the universe.
 * Usage: npx tsx scripts/test-batch-slice-120.ts
 */
import { clearBarCache } from "../lib/bar-cache";
import { scanSymbol } from "../lib/scanner";
import { buildSymbolUniverse } from "../lib/symbols";

async function main() {
  clearBarCache();
  const { symbols } = await buildSymbolUniverse({ includeBlueChips: true });
  const slice = symbols.slice(120, 131);
  console.log(`Universe: ${symbols.length} symbols. Testing index 120-130 (${slice.length} symbols):\n`);
  console.log(slice.map((s, i) => `${120 + i}: ${s.yahoo}`).join(", "));
  console.log();

  let ok = 0;
  for (let i = 0; i < slice.length; i += 1) {
    const parsed = slice[i];
    const result = await scanSymbol(parsed, 120, false, 120 + i);
    const hasEma = result.ema20 != null && result.ema50 != null;
    if (hasEma) ok += 1;
    console.log(
      `${hasEma ? "OK" : "FAIL"} ${result.displayTicker.padEnd(6)} ema20=${result.ema20?.toFixed(2) ?? "—"}${result.error ? ` err=${result.error.slice(0, 60)}` : ""}`,
    );
  }
  console.log(`\nSuccess: ${ok}/${slice.length}`);
  if (ok < slice.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
