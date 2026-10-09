/** Compare prod preview across multiple article URLs. */
import YahooFinance from "yahoo-finance2";

async function main() {
  const BASE = "https://ai-trading-scanner.lilgreg1.workers.dev";
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const result = await yf.search("NVDA", { quotesCount: 1, newsCount: 5 });

  for (const item of (result.news ?? []).slice(0, 5)) {
    if (!item.link) continue;
    const qs = new URLSearchParams({ url: item.link, bust: String(Date.now()) });
    if (item.title) qs.set("headline", item.title);
    const preview = (await fetch(`${BASE}/api/news/preview?${qs}`, {
      cache: "no-store",
    }).then((r) => r.json())) as { fullText?: string | null; summary?: string | null };
    const text = preview.fullText ?? preview.summary ?? "";
    console.log(
      `${text.length} chars | ${item.title?.slice(0, 50)} | ${item.link.slice(0, 70)}`,
    );
  }

  const news = (await fetch(`${BASE}/api/news`).then((r) => r.json())) as {
    headlines?: { url?: string; headline?: string }[];
  };
  console.log("\nProd headlines:");
  for (const h of (news.headlines ?? []).slice(0, 5)) {
    if (!h.url) continue;
    const qs = new URLSearchParams({ url: h.url, bust: String(Date.now()) });
    const preview = (await fetch(`${BASE}/api/news/preview?${qs}`, {
      cache: "no-store",
    }).then((r) => r.json())) as { fullText?: string | null };
    const text = preview.fullText ?? "";
    console.log(`${text.length} chars | ${h.headline?.slice(0, 50)}`);
  }
}

main().catch(console.error);
