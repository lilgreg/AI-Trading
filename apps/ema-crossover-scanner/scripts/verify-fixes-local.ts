/** Local verification for news preview + tail cross detection. */
import YahooFinance from "yahoo-finance2";
import { buildSymbolUniverse } from "../lib/symbols";
import { scanSymbol } from "../lib/scanner";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

async function testNewsPreview(baseUrl: string) {
  const result = await yahooFinance.search("NVDA", { quotesCount: 1, newsCount: 3 });
  const items = (result.news ?? []).filter((n) => n.link && n.title).slice(0, 2);
  let pass = 0;

  for (const item of items) {
    const res = await fetch(
      `${baseUrl}/api/news/preview?url=${encodeURIComponent(item.link!)}`,
      { cache: "no-store" },
    );
    const body = (await res.json()) as { summary?: string | null };
    const len = body.summary?.trim().length ?? 0;
    console.log(`News: ${item.title?.slice(0, 60)}… chars=${len}`);
    if (len >= 80) pass += 1;
  }

  console.log(`News preview: ${pass}/${items.length} adequate`);
  return pass >= 2;
}

async function testTailCrosses() {
  const { symbols } = await buildSymbolUniverse({ includeBlueChips: true });
  const tail = symbols.slice(205, 215);
  let withCross = 0;
  let withEma = 0;

  for (let i = 0; i < tail.length; i += 1) {
    const parsed = tail[i];
    const index = 205 + i;
    const row = await scanSymbol(parsed, 180, false, index, { skipChartStagger: true });
    const hasCross = Boolean(row.cross4h.crossoverAt || row.cross1h.crossoverAt);
    if (row.ema20 != null) withEma += 1;
    if (hasCross) withCross += 1;
    console.log(
      `${row.displayTicker.padEnd(6)} ema=${row.ema20 != null ? "Y" : "N"} cross4h=${row.cross4h.crossoverAt ?? "—"} cross1h=${row.cross1h.crossoverAt ?? "—"} bars=${row.error ?? "ok"}`,
    );
  }

  console.log(`Tail crosses: ${withCross}/${withEma} with EMA have cross data`);
  return withEma > 0 && withCross / withEma >= 0.9;
}

async function main() {
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
  const newsOk = await testNewsPreview(baseUrl);
  const crossOk = await testTailCrosses();
  console.log(`\nResult: news=${newsOk ? "PASS" : "FAIL"} cross=${crossOk ? "PASS" : "FAIL"}`);
  process.exit(newsOk && crossOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
