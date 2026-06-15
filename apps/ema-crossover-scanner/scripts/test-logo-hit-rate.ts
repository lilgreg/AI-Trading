/**
 * Logo hit rate across the full blue-chip universe (~190 symbols).
 * Usage: npx tsx scripts/test-logo-hit-rate.ts
 */
import {
  BLUE_CHIP_SYMBOLS,
  parseSymbol,
  resolveTradingViewSymbol,
} from "../lib/stocks";
import { buildLogoUrlChain, resolveLogoUrl, shouldUseInitialsOnly } from "../lib/symbol-logo";
import { fetchQuoteMeta } from "../lib/yahoo";

const BATCH = 10;

async function main() {
  let hits = 0;
  let initialsExpected = 0;
  let misses = 0;
  const missList: string[] = [];

  for (let i = 0; i < BLUE_CHIP_SYMBOLS.length; i += BATCH) {
    const slice = BLUE_CHIP_SYMBOLS.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (sym) => {
        const parsed = parseSymbol(sym);
        if (!parsed) return;

        const meta = await fetchQuoteMeta(parsed.yahoo);
        const tvSymbol = resolveTradingViewSymbol(parsed, meta.quoteExchange);
        const displayTicker = tvSymbol.includes(":")
          ? tvSymbol.split(":", 2)[1]
          : tvSymbol;

        const initialsOnly = shouldUseInitialsOnly(parsed.yahoo);
        if (initialsOnly) {
          initialsExpected += 1;
          return;
        }

        const resolved = await resolveLogoUrl({
          displayTicker,
          tradingViewSymbol: tvSymbol,
          yahooSymbol: parsed.yahoo,
          companyName: meta.name,
        });

        if (resolved) {
          hits += 1;
        } else {
          misses += 1;
          missList.push(sym);
          const chainLen = buildLogoUrlChain(
            displayTicker,
            tvSymbol,
            parsed.yahoo,
            null,
            meta.name,
          ).length;
          console.log(`${sym.padEnd(8)} MISS chain=${chainLen}`);
        }
      }),
    );
    process.stdout.write(`\r${Math.min(i + BATCH, BLUE_CHIP_SYMBOLS.length)}/${BLUE_CHIP_SYMBOLS.length}`);
  }

  const probed = hits + misses;
  const pct = probed > 0 ? Math.round((hits / probed) * 100) : 0;
  console.log(`\n\nHit rate: ${hits}/${probed} (${pct}%)`);
  console.log(`Initials-only (expected): ${initialsExpected}`);
  if (missList.length > 0) {
    console.log(`Misses: ${missList.join(", ")}`);
  }
}

main().catch(console.error);
