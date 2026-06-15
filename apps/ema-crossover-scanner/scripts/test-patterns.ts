import { scanSymbol } from "../lib/scanner";
import { parseSymbol } from "../lib/stocks";
import type { PatternDetection } from "../lib/types";

const TICKERS = ["TSM", "HUT", "NBIS", "SNX"];

function fmtPattern(name: string, p: PatternDetection): string {
  if (p.status === "None") return `${name}: None`;
  return `${name}: ${p.status} (${p.timeframes})`;
}

async function main() {
  for (const ticker of TICKERS) {
    const parsed = parseSymbol(ticker);
    if (!parsed) {
      console.log(`${ticker}: could not parse`);
      continue;
    }
    const result = await scanSymbol(parsed, 120, true);
    const p = result.patterns;
    console.log(`\n${ticker}:`);
    console.log(`  ${fmtPattern("DB", p.doubleBottom)}`);
    if (p.doubleBottom.debug) console.log("    debug DB:", p.doubleBottom.debug);
    console.log(`  ${fmtPattern("DT", p.doubleTop)}`);
    if (p.doubleTop.debug) console.log("    debug DT:", p.doubleTop.debug);
    console.log(`  ${fmtPattern("IH&S", p.inverseHeadShoulders)}`);
    console.log(
      `  Cross 1h: ${result.cross1h.crossoverDate ?? "none"} | Cross 4h: ${result.cross4h.crossoverDate ?? "none"}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
