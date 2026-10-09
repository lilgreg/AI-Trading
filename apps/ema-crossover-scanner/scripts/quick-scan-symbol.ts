import { scanSymbol } from "../lib/scanner";
import { parseSymbol } from "../lib/stocks";

async function main() {
  const symbol = process.argv[2] ?? "ACN";
  const parsed = parseSymbol(symbol);
  if (!parsed) throw new Error(`bad symbol ${symbol}`);
  const result = await scanSymbol(parsed, 180, false, 0, { skipChartStagger: true });
  console.log(
    symbol,
    "above4h",
    result.ema20Above50,
    "cross1h",
    result.cross1h?.crossoverAt ?? "null",
    "cross4h",
    result.cross4h?.crossoverAt ?? "null",
    "error",
    result.error ?? "none",
  );
}

main().catch(console.error);
