import { fetchHourlyBars } from "../lib/chart-data";
import { aggregateHourlyTo4h } from "../lib/yahoo";
import { resolveBullishCrossover, latestEmaValues } from "../lib/ema";

async function main() {
  const symbol = process.argv[2] ?? "ACN";
  const { bars } = await fetchHourlyBars(symbol, 180, { skipStagger: true });
  const b4 = aggregateHourlyTo4h(bars);
  const { fastAboveSlow } = latestEmaValues(
    b4.map((b) => b.close),
    20,
    50,
  );
  const c = resolveBullishCrossover(b4, 20, 50, fastAboveSlow);
  console.log(symbol, "above4h", fastAboveSlow, "cross4h", c?.date?.toISOString() ?? "null");
}

main().catch(console.error);
