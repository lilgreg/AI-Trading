/**
 * Test news preview extraction with a real Yahoo headline URL.
 * Usage: npx tsx scripts/test-news-preview.ts
 */
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

async function main() {
  const result = await yahooFinance.search("AAPL", { quotesCount: 1, newsCount: 3 });
  const items = (result.news ?? []).filter((n) => n.link && n.title);
  if (items.length === 0) {
    console.log("No news items found");
    process.exit(1);
  }

  for (const item of items.slice(0, 2)) {
    const rawSummary = (item as { summary?: unknown }).summary;
    const yahooSummary = typeof rawSummary === "string" ? rawSummary.trim() : null;
    const url = item.link!;

    const res = await fetch(
      `http://localhost:3000/api/news/preview?url=${encodeURIComponent(url)}`,
      { cache: "no-store" },
    );
    const body = (await res.json()) as { summary?: string | null };
    const preview = body.summary?.trim() ?? "";

    console.log("---");
    console.log("Title:", item.title);
    console.log("URL:", url);
    console.log("Yahoo summary chars:", yahooSummary?.length ?? 0);
    if (yahooSummary) console.log("Yahoo preview:", yahooSummary.slice(0, 120) + "…");
    console.log("API preview chars:", preview.length);
    if (preview) console.log("API preview start:", preview.slice(0, 200) + "…");
    console.log("Longest:", Math.max(yahooSummary?.length ?? 0, preview.length));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
