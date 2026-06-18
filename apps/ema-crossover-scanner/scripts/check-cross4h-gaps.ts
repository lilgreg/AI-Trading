/** Quick prod scan cross4h gap analysis */
const BASE =
  process.env.PROD_URL ?? "https://ai-trading-scanner.lilgreg1.workers.dev";

interface Row {
  symbol?: string;
  ema20Above50?: boolean;
  ema20?: number | null;
  cross1h?: { crossoverAt?: string | null; crossoverDate?: string | null };
  cross4h?: { crossoverAt?: string | null; crossoverDate?: string | null; crossoverMsAgo?: number | null };
}

function hasCross(c?: Row["cross1h"]): boolean {
  return Boolean(c?.crossoverAt ?? c?.crossoverDate);
}

function msAgo(c?: Row["cross4h"]): number | null {
  return c?.crossoverMsAgo ?? null;
}

function sortLikeUi(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const aVal = msAgo(a.cross4h);
    const bVal = msAgo(b.cross4h);
    if (aVal != null && bVal != null) return aVal - bVal;
    if (aVal != null) return -1;
    if (bVal != null) return 1;
    if (a.ema20Above50 !== b.ema20Above50) return a.ema20Above50 ? -1 : 1;
    return 0;
  });
}

async function main() {
  const res = await fetch(`${BASE}/api/scan`);
  const data = (await res.json()) as { results?: Row[] };
  const rows = data.results ?? [];
  const sorted = sortLikeUi(rows);
  const gap = sorted.filter((r) => hasCross(r.cross1h) && !hasCross(r.cross4h));
  console.log("cross1h but no cross4h:", gap.length);
  for (const r of gap.slice(0, 15)) {
    console.log(
      `  ${r.symbol} above4h=${r.ema20Above50} ema20=${r.ema20?.toFixed(2)} cross1h=${r.cross1h?.crossoverAt}`,
    );
  }
  for (const idx of [263, 299, 325]) {
    const row = sorted[idx];
    if (!row) continue;
    console.log(
      `row${idx + 1} ${row.symbol} above=${row.ema20Above50} cross1h=${row.cross1h?.crossoverAt ?? "—"} cross4h=${row.cross4h?.crossoverAt ?? "—"}`,
    );
  }
}

main().catch(console.error);
