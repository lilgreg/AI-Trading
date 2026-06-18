/**
 * Evaluate scan + session helpers using lib/ imports only.
 * Replaces ad-hoc node -e probes that tried to require .next/server/chunks.
 *
 * Usage: npx tsx scripts/eval-scan.ts
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { clearBarCache } from "../lib/bar-cache";
import {
  rowNeedsChartHeal,
  sanitizeChartError,
} from "../lib/chart-error-sanitize";
import {
  filterSessionChangesForMarket,
  getUsMarketSession,
} from "../lib/market-session";
import { scanSymbol } from "../lib/scanner";
import { buildSymbolUniverse } from "../lib/symbols";
import type { StockScanResult } from "../lib/types";

function loadEnvLocal(): void {
  const path = join(__dirname, "..", ".env.local");
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function fmtPct(value: number | null | undefined): string {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function printScanResult(result: StockScanResult, session: ReturnType<typeof getUsMarketSession>): void {
  const filtered = filterSessionChangesForMarket(
    {
      preMarketChange: result.preMarketChange,
      regularMarketChange: result.regularMarketChange,
      postMarketChange: result.postMarketChange,
    },
    session,
  );

  console.log(`\n--- ${result.displayTicker} (${result.symbol}) ---`);
  console.log(`  session=${session} src=${result.dataSource ?? "—"} price=${result.price?.toFixed(2) ?? "—"}`);
  console.log(
    `  raw pre=${fmtPct(result.preMarketChange)} reg=${fmtPct(result.regularMarketChange)} ah=${fmtPct(result.postMarketChange)}`,
  );
  console.log(
    `  filtered pre=${fmtPct(filtered.preMarketChange)} reg=${fmtPct(filtered.regularMarketChange)} ah=${fmtPct(filtered.postMarketChange)}`,
  );
  console.log(
    `  ema20=${result.ema20?.toFixed(2) ?? "—"} ema50=${result.ema50?.toFixed(2) ?? "—"} above50=${result.ema20Above50}`,
  );
  console.log(
    `  cross1h=${result.cross1h.crossoverDate ?? "none"} (${result.cross1h.crossoverMsAgo ?? "—"}ms ago)`,
  );
  console.log(
    `  cross4h=${result.cross4h.crossoverDate ?? "none"} (${result.cross4h.crossoverMsAgo ?? "—"}ms ago)`,
  );
  if (result.error) {
    console.log(`  error=${sanitizeChartError(result.error)} heal=${rowNeedsChartHeal(result)}`);
  }
}

function runSessionSanityChecks(): void {
  console.log("=== Session + chart-error sanity ===");
  const session = getUsMarketSession();
  console.log(`Current US session: ${session}`);

  const preReg = filterSessionChangesForMarket(
    { preMarketChange: 1.2, regularMarketChange: 0.5, postMarketChange: null },
    "regular",
  );
  console.log(`pre during regular: ${preReg.preMarketChange}`);

  const preClosedOvernight = filterSessionChangesForMarket(
    { preMarketChange: 1.2, regularMarketChange: 0.5, postMarketChange: -0.3 },
    "closed",
  );
  console.log(`pre during closed overnight: ${preClosedOvernight.preMarketChange}`);

  const ahClosed = filterSessionChangesForMarket(
    { preMarketChange: 1.2, regularMarketChange: 0.5, postMarketChange: -0.3 },
    "closed",
  );
  console.log(`ah during closed: ${ahClosed.postMarketChange}`);

  const ahPre = filterSessionChangesForMarket(
    { preMarketChange: 1.2, regularMarketChange: 0.5, postMarketChange: -0.3 },
    "pre",
  );
  console.log(`ah during pre-market: ${ahPre.postMarketChange}`);

  const stooqErr =
    "All chart providers failed for AMT (stooq): stooq: Stooq bot wall";
  console.log(`sanitize: ${sanitizeChartError(stooqErr)}`);
  console.log(
    `needs heal: ${rowNeedsChartHeal({ symbol: "AMT", ema20: null, error: stooqErr } as StockScanResult)}`,
  );
}

async function main(): Promise<void> {
  loadEnvLocal();
  runSessionSanityChecks();

  clearBarCache();
  const { symbols } = await buildSymbolUniverse({ includeBlueChips: true });
  const session = getUsMarketSession();

  const amt = symbols.find((s) => s.yahoo.toUpperCase() === "AMT");
  const slice = symbols.slice(120, 131);
  const targets = [
    ...(amt ? [amt] : []),
    ...slice.filter((s) => s.yahoo.toUpperCase() !== "AMT"),
  ];

  console.log(`\n=== Scan eval (AMT + index 120-130) ===`);
  console.log(`Universe: ${symbols.length} symbols, testing ${targets.length} tickers`);

  let ok = 0;
  for (const parsed of targets) {
    const result = await scanSymbol(parsed, 120);
    printScanResult(result, session);
    if (result.ema20 != null && result.ema50 != null) ok += 1;
  }

  console.log(`\nEMA success: ${ok}/${targets.length}`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
