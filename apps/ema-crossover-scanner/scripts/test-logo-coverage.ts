/**
 * Report logo resolution coverage for sample symbols.
 * Usage: npx tsx scripts/test-logo-coverage.ts
 */
import { parseSymbol } from "../lib/stocks";
import { resolveLogoUrl, buildLogoUrlChain } from "../lib/symbol-logo";
import { fetchQuoteMeta } from "../lib/yahoo";
import { resolveTradingViewSymbol } from "../lib/stocks";

const SAMPLE_SYMBOLS = [
  "AAPL",
  "MSFT",
  "SNX",
  "ARTY",
  "BRK-B",
  "KO",
  "JPM",
  "NVDA",
  "META",
  "SPY",
  "QQQ",
  "VIX",
  "GOOGL",
  "TSLA",
  "AMD",
  "PLTR",
  "CRWD",
  "COST",
  "WMT",
  "XOM",
];

async function main() {
  let withLogo = 0;
  let withoutLogo = 0;

  console.log("Symbol\tName\tLogo URL");
  console.log("------\t----\t--------");

  for (const sym of SAMPLE_SYMBOLS) {
    const parsed = parseSymbol(sym);
    if (!parsed) continue;

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

    const chainLen = buildLogoUrlChain(
      displayTicker,
      tvSymbol,
      parsed.yahoo,
      null,
      meta.name,
    ).length;

    if (logoUrl) {
      withLogo += 1;
      console.log(`${sym}\t${meta.name ?? "—"}\t${logoUrl}`);
    } else {
      withoutLogo += 1;
      console.log(`${sym}\t${meta.name ?? "—"}\t(initials, chain=${chainLen})`);
    }
  }

  const total = withLogo + withoutLogo;
  const pct = total > 0 ? ((withLogo / total) * 100).toFixed(1) : "0";
  console.log(`\nReal logos: ${withLogo}/${total} (${pct}%)`);
  console.log(`Initials fallback: ${withoutLogo}/${total}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
