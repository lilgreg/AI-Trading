/** Full production diagnostic — run: npx tsx scripts/diag-prod-full.ts */
const BASE = process.env.PROD_URL ?? "https://ai-trading-scanner.vercel.app";

async function main() {
  const scanRes = await fetch(`${BASE}/api/scan`, { cache: "no-store" });
  const data = await scanRes.json();
  const results = data.results ?? [];

  const missingAll = results.filter(
    (r: { preMarketChange?: number | null; regularMarketChange?: number | null; postMarketChange?: number | null }) =>
      r.preMarketChange == null &&
      r.regularMarketChange == null &&
      r.postMarketChange == null,
  );
  const missingReg = results.filter(
    (r: { regularMarketChange?: number | null }) => r.regularMarketChange == null,
  );
  const onlyPre = results.filter(
    (r: { preMarketChange?: number | null; regularMarketChange?: number | null; postMarketChange?: number | null }) =>
      r.preMarketChange != null &&
      r.regularMarketChange == null &&
      r.postMarketChange == null,
  );

  const withPre = results.filter(
    (r: { preMarketChange?: number | null }) => r.preMarketChange != null,
  ).length;
  const withReg = results.filter(
    (r: { regularMarketChange?: number | null }) => r.regularMarketChange != null,
  ).length;
  const withPost = results.filter(
    (r: { postMarketChange?: number | null }) => r.postMarketChange != null,
  ).length;

  const noCross = results.filter(
    (r: { cross4h?: { crossoverAt?: string | null }; cross1h?: { crossoverAt?: string | null }; ema20?: number | null }) =>
      !r.cross4h?.crossoverAt &&
      !r.cross1h?.crossoverAt &&
      r.ema20 != null,
  );

  const byError: Record<string, string[]> = {};
  for (const r of results) {
    const e = r.error ?? "(none)";
    if (!byError[e]) byError[e] = [];
    byError[e].push(r.symbol);
  }

  console.log("=== SESSION COVERAGE ===");
  console.log("total:", results.length);
  console.log("missingAll:", missingAll.length);
  console.log("missingReg:", missingReg.length);
  console.log("onlyPre:", onlyPre.length);
  console.log("withPre:", withPre, "withReg:", withReg, "withPost:", withPost);
  console.log(
    "regPct:",
    ((withReg / results.length) * 100).toFixed(1) + "%",
  );

  console.log("\n=== ERROR SYMBOLS ===");
  for (const [err, syms] of Object.entries(byError)) {
    if (err === "(none)") continue;
    console.log(err + ":", syms.join(", "));
  }

  console.log("\n=== NO CROSS (with EMA) ===");
  console.log("count:", noCross.length);
  console.log(
    "sample:",
    noCross.slice(0, 10).map((r: { symbol: string }) => r.symbol).join(", "),
  );

  console.log("\n=== MISSING REG SAMPLE ===");
  console.log(
    missingReg
      .slice(0, 15)
      .map(
        (r: {
          symbol: string;
          preMarketChange?: number | null;
          regularMarketChange?: number | null;
          postMarketChange?: number | null;
        }) =>
          `${r.symbol}(pre=${r.preMarketChange ?? "null"},reg=${r.regularMarketChange ?? "null"},post=${r.postMarketChange ?? "null"})`,
      )
      .join("\n"),
  );
}

main().catch(console.error);
