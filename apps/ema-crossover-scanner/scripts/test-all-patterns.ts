import { scanSymbol } from "../lib/scanner";
import { parseSymbol } from "../lib/stocks";

const TICKERS = ["TSM", "WARP", "SNX", "HUT", "NBIS", "CMG"];

async function main() {
  for (const ticker of TICKERS) {
    const parsed = parseSymbol(ticker);
    if (!parsed) {
      console.log(`${ticker}: parse fail`);
      continue;
    }
    const r = await scanSymbol(parsed, 120, true);
    const p = r.patterns;
    console.log(`\n${ticker}:`);
    console.log(
      `  DB: ${p.doubleBottom.status} (${p.doubleBottom.timeframes})`,
      p.doubleBottom.debug ?? "",
    );
    console.log(
      `  DT: ${p.doubleTop.status} (${p.doubleTop.timeframes})`,
      p.doubleTop.debug ?? "",
    );
    console.log(
      `  IH&S: ${p.inverseHeadShoulders.status} (${p.inverseHeadShoulders.timeframes})`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
