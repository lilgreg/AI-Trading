import { fetchQuoteMeta } from "../lib/yahoo";
import { fetchSessionChangesFromChart } from "../lib/session-snapshot";

async function main() {
  const symbol = process.argv[2] ?? "AAPL";
  const meta = await fetchQuoteMeta(symbol);
  console.log("quote meta:", JSON.stringify(meta, null, 2));
  const fromChart = await fetchSessionChangesFromChart(symbol);
  console.log("from chart:", JSON.stringify(fromChart, null, 2));
}

main().catch(console.error);
