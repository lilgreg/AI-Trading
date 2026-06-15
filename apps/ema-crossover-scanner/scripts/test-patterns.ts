import { scanSymbol } from "../lib/scanner";
import { parseSymbol } from "../lib/stocks";
import type { PatternDetection, SymbolPatterns } from "../lib/types";

const TICKERS = ["ARTY", "TSM", "SNX", "WARP", "HUT", "NBIS"];

function fmtPattern(name: string, p: PatternDetection): string {
  if (p.status === "None") return `${name}: None`;
  return `${name}: ${p.status} (${p.timeframes})`;
}

function printPatterns(ticker: string, p: SymbolPatterns) {
  console.log(`\n${ticker}:`);
  for (const [name, key] of [
    ["DB", "doubleBottom"],
    ["DT", "doubleTop"],
    ["HS", "headShoulders"],
    ["IHS", "inverseHeadShoulders"],
  ] as const) {
    const det = p[key];
    console.log(`  ${fmtPattern(name, det)}`);
    if (det.debug) console.log(`    debug ${name}:`, det.debug);
  }
}

async function main() {
  for (const ticker of TICKERS) {
    const parsed = parseSymbol(ticker);
    if (!parsed) {
      console.log(`${ticker}: could not parse`);
      continue;
    }
    const result = await scanSymbol(parsed, 120, true);
    printPatterns(ticker, result.patterns);
    console.log(
      `  Cross 4h: ${result.cross4h.crossoverAt ?? "none"} | Cross 1h: ${result.cross1h.crossoverAt ?? "none"}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
