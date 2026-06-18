/** Rescan symbols with cross1h but missing cross4h. Run: npx tsx scripts/rescan-cross4h-gaps.ts */
const BASE =
  process.env.PROD_URL ?? "https://ai-trading-scanner.lilgreg1.workers.dev";
const BATCH_SIZE = 10;
const DELAY_MS = 3_000;

function hasCross(c?: { crossoverAt?: string | null; crossoverDate?: string | null }): boolean {
  return Boolean(c?.crossoverAt ?? c?.crossoverDate);
}

async function main() {
  const res = await fetch(`${BASE}/api/scan`, { cache: "no-store" });
  const data = (await res.json()) as {
    results?: {
      symbol?: string;
      cross1h?: { crossoverAt?: string | null; crossoverDate?: string | null };
      cross4h?: { crossoverAt?: string | null; crossoverDate?: string | null };
    }[];
  };
  const gaps =
    data.results?.filter((row) => hasCross(row.cross1h) && !hasCross(row.cross4h)) ?? [];
  console.log(`Found ${gaps.length} cross4h gaps`);

  for (let i = 0; i < gaps.length; i += BATCH_SIZE) {
    const batch = gaps.slice(i, i + BATCH_SIZE);
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.map((r) => r.symbol).join(", ")}`);
    for (const row of batch) {
      if (!row.symbol) continue;
      const r = await fetch(
        `${BASE}/api/scan/symbol?symbol=${encodeURIComponent(row.symbol)}`,
        { cache: "no-store" },
      );
      console.log(`  ${row.symbol}: ${r.status}`);
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  const check = await fetch(`${BASE}/api/scan`, { cache: "no-store" });
  const after = (await check.json()) as typeof data;
  const remaining =
    after.results?.filter((row) => hasCross(row.cross1h) && !hasCross(row.cross4h)).length ?? 0;
  console.log(`Remaining gaps: ${remaining}`);
  process.exit(remaining > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
