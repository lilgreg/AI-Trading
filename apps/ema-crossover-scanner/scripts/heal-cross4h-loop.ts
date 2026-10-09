/** Trigger prod heal rounds until cross4h gaps shrink. */
const BASE =
  process.env.PROD_URL ?? "https://ai-trading-scanner.lilgreg1.workers.dev";

function hasCross(c?: { crossoverAt?: string | null; crossoverDate?: string | null }): boolean {
  return Boolean(c?.crossoverAt ?? c?.crossoverDate);
}

async function gapCount(): Promise<number> {
  const res = await fetch(`${BASE}/api/scan`, { cache: "no-store" });
  const text = await res.text();
  if (!text.startsWith("{")) throw new Error(`scan ${res.status}: ${text.slice(0, 60)}`);
  const data = JSON.parse(text) as { results?: { cross1h?: unknown; cross4h?: unknown }[] };
  return (data.results ?? []).filter((r) => hasCross(r.cross1h as never) && !hasCross(r.cross4h as never)).length;
}

async function healRound(): Promise<void> {
  const res = await fetch(`${BASE}/api/scan?heal=1`, { cache: "no-store" });
  await res.text();
}

async function main() {
  const maxRounds = Number(process.env.HEAL_ROUNDS ?? 20);
  for (let round = 1; round <= maxRounds; round += 1) {
    const before = await gapCount();
    console.log(`round ${round}: gaps=${before}`);
    if (before === 0) {
      console.log("Done");
      process.exit(0);
    }
    await healRound();
    await new Promise((r) => setTimeout(r, 15_000));
    const after = await gapCount();
    console.log(`  after heal: gaps=${after}`);
    if (after >= before && round > 5) {
      console.log("No progress, stopping");
      break;
    }
  }
  const remaining = await gapCount();
  console.log("Remaining gaps:", remaining);
  process.exit(remaining > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
