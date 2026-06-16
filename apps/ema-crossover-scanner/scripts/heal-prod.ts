/** Loop production heal until unscanned = 0. Run: npx tsx scripts/heal-prod.ts */
const BASE = process.env.PROD_URL ?? "https://ai-trading-scanner.vercel.app";
const MAX_ROUNDS = Number(process.env.HEAL_ROUNDS ?? 30);
const PAUSE_MS = Number(process.env.HEAL_PAUSE_MS ?? 15_000);

async function fetchUnscanned(): Promise<number> {
  const res = await fetch(`${BASE}/api/scan?heal=1`, { cache: "no-store" });
  const data = await res.json();
  const unscanned =
    data.unscannedCount ??
    (data.results ?? []).filter(
      (r: { error?: string }) => r.error === "Not scanned yet",
    ).length;
  const row0 = data.results?.[0];
  const withPre = (data.results ?? []).filter(
    (r: { preMarketChange?: number | null }) => r.preMarketChange != null,
  ).length;
  const withPost = (data.results ?? []).filter(
    (r: { postMarketChange?: number | null }) => r.postMarketChange != null,
  ).length;
  console.log(
    new Date().toISOString(),
    "unscanned:",
    unscanned,
    "scanComplete:",
    data.scanComplete,
    "scanInProgress:",
    data.scanInProgress,
    "withPre:",
    withPre,
    "withPost:",
    withPost,
    "row0:",
    row0?.symbol,
    row0?.preMarketChange,
    row0?.regularMarketChange,
    row0?.postMarketChange,
  );
  return unscanned;
}

async function main() {
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    console.log(`\n=== heal round ${round}/${MAX_ROUNDS} ===`);
    const unscanned = await fetchUnscanned();
    if (unscanned === 0) {
      console.log("Done — all symbols scanned.");
      return;
    }
    if (round < MAX_ROUNDS) {
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }
  const remaining = await fetchUnscanned();
  console.log(`Stopped after ${MAX_ROUNDS} rounds — ${remaining} still unscanned.`);
}

main().catch(console.error);
