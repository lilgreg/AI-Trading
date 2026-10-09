/** Broader logo coverage across blue-chip universe. */
import { BLUE_CHIP_SYMBOLS, resolveTradingViewSymbol, parseSymbol } from "../lib/stocks";
import { resolveLogoUrl } from "../lib/symbol-logo";
import { fetchQuoteMeta } from "../lib/yahoo";

const BATCH = 10;

async function main() {
  let withLogo = 0;
  let withoutLogo = 0;
  const missing: string[] = [];

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

        const logoUrl = await resolveLogoUrl({
          displayTicker,
          tradingViewSymbol: tvSymbol,
          yahooSymbol: parsed.yahoo,
          companyName: meta.name,
        });

        if (logoUrl) withLogo += 1;
        else {
          withoutLogo += 1;
          missing.push(sym);
        }
      }),
    );
    process.stdout.write(`\r${i + slice.length}/${BLUE_CHIP_SYMBOLS.length}`);
  }

  const total = withLogo + withoutLogo;
  const pct = ((withLogo / total) * 100).toFixed(1);
  console.log(`\n\nBlue-chip logos: ${withLogo}/${total} (${pct}%)`);
  if (missing.length) {
    console.log("Missing:", missing.join(", "));
  }
}

main().catch(console.error);
