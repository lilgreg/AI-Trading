/** Rescan specific symbols on prod. Usage: npx tsx scripts/rescan-symbols.ts WMT DASH */
const BASE =
  process.env.PROD_URL ?? "https://ai-trading-scanner.lilgreg1.workers.dev";

async function main() {
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    console.error("Usage: npx tsx scripts/rescan-symbols.ts SYM [SYM...]");
    process.exit(1);
  }

  for (const symbol of symbols) {
    console.log("Rescan", symbol);
    const res = await fetch(
      `${BASE}/api/scan/symbol?symbol=${encodeURIComponent(symbol)}`,
      { cache: "no-store" },
    );
    const text = await res.text();
    if (!text.startsWith("{")) {
      console.log(" ", res.status, text.slice(0, 60));
      continue;
    }
    const body = JSON.parse(text) as {
      result?: {
        cross1h?: { crossoverAt?: string | null };
        cross4h?: { crossoverAt?: string | null };
      };
    };
    console.log(
      " ",
      res.status,
      "cross4h=",
      body.result?.cross4h?.crossoverAt ?? "null",
    );
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

main().catch(console.error);
