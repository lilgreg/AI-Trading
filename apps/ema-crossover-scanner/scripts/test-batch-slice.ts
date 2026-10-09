import { clearBarCache } from "../lib/bar-cache";
import { scanSymbols } from "../lib/scanner";
import { buildSymbolUniverse } from "../lib/symbols";

async function main() {
  clearBarCache();
  const { symbols } = await buildSymbolUniverse({ includeBlueChips: true });
  const start = Number(process.argv[2] ?? 115);
  const count = Number(process.argv[3] ?? 20);
  const slice = symbols.slice(start, start + count);

  console.log(`Total universe: ${symbols.length}`);
  console.log(`Slice ${start + 1}-${start + slice.length}: ${slice.map((s) => s.yahoo).join(", ")}\n`);

  const t0 = Date.now();
  const results = await scanSymbols(slice, 120);
  const ok = results.filter((r) => r.ema20 != null).length;
  const failed = results.filter((r) => r.error && r.ema20 == null);

  console.log(
    `Success: ${ok}/${results.length} (${((ok / results.length) * 100).toFixed(1)}%) in ${Math.round((Date.now() - t0) / 1000)}s`,
  );
  for (const r of failed) {
    console.log(`FAIL ${r.displayTicker}: ${r.error?.slice(0, 100)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
