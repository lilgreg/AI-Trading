const BASE =
  process.env.PROD_URL ?? "https://ai-trading-scanner.lilgreg1.workers.dev";

async function main() {
  const res = await fetch(`${BASE}/api/scan`);
  const data = (await res.json()) as {
    results?: {
      symbol?: string;
      error?: string;
      preMarketChange?: number | null;
      regularMarketChange?: number | null;
      postMarketChange?: number | null;
    }[];
  };
  const miss = (data.results ?? []).filter(
    (row) =>
      !row.error &&
      row.preMarketChange == null &&
      row.regularMarketChange == null &&
      row.postMarketChange == null,
  );
  console.log("missing session:", miss.map((r) => r.symbol).join(", "));
}

main().catch(console.error);
