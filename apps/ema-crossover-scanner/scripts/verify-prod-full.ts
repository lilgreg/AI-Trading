/** Full production verification loop. Run: npx tsx scripts/verify-prod-full.ts */
const BASE = process.env.PROD_URL ?? "https://ai-trading-scanner.workers.dev";

function countCross4hGaps(
  results: { ema20Above50?: boolean; cross1h?: { crossoverAt?: string | null; crossoverDate?: string | null }; cross4h?: { crossoverAt?: string | null; crossoverDate?: string | null } }[],
): number {
  return results.filter((row) => {
    if (!row.ema20Above50) return false;
    const c1 = row.cross1h?.crossoverAt ?? row.cross1h?.crossoverDate;
    const c4 = row.cross4h?.crossoverAt ?? row.cross4h?.crossoverDate;
    return Boolean(c1 && !c4);
  }).length;
}

async function verifyNews(): Promise<boolean> {
  let pass = 0;
  for (let i = 0; i < 3; i += 1) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/news`, { cache: "no-store" });
    const ms = Date.now() - t0;
    const body = (await res.json()) as { headlines?: unknown[]; error?: string };
    const headlines = body.headlines?.length ?? 0;
    const ok = res.status === 200 && headlines > 0;
    console.log(`news try ${i + 1}: ${res.status} ${ms}ms headlines=${headlines} ${ok ? "PASS" : "FAIL"}`);
    if (ok) pass += 1;
  }
  return pass === 3;
}

async function verifyScan(): Promise<{ pass: boolean; nullPrice: number; cross4hGap: number; total: number; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/scan`, { cache: "no-store" });
  const ms = Date.now() - t0;
  const body = (await res.json()) as {
    results?: { price?: number | null; ema20Above50?: boolean; cross1h?: { crossoverAt?: string | null; crossoverDate?: string | null }; cross4h?: { crossoverAt?: string | null; crossoverDate?: string | null } }[];
    cross4hGapCount?: number;
  };
  const results = body.results ?? [];
  const nullPrice = results.filter((r) => r.price == null).length;
  const cross4hGap = body.cross4hGapCount ?? countCross4hGaps(results);
  const nullPct = results.length ? nullPrice / results.length : 0;
  const pass =
    res.status === 200 &&
    ms < 30_000 &&
    cross4hGap === 0 &&
    (nullPrice <= 10 || nullPct < 0.05);
  console.log(
    `scan: ${res.status} ${ms}ms rows=${results.length} nullPrice=${nullPrice} (${(nullPct * 100).toFixed(1)}%) cross4hGap=${cross4hGap} ${pass ? "PASS" : "FAIL"}`,
  );
  return { pass, nullPrice, cross4hGap, total: results.length, ms };
}

async function main() {
  console.log("=== VERIFY PRODUCTION ===");
  console.log("BASE:", BASE);

  const newsOk = await verifyNews();
  const scan = await verifyScan();

  const allPass = newsOk && scan.pass;
  console.log("\n=== RESULT ===");
  console.log("news (3/3):", newsOk ? "PASS" : "FAIL");
  console.log("scan:", scan.pass ? "PASS" : "FAIL");
  console.log("ALL PASS:", allPass ? "YES" : "NO");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
