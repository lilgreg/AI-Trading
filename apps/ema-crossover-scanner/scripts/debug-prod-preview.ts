/** Fetch prod news + preview for debugging. */
async function main() {
  const BASE = "https://ai-trading-scanner.lilgreg1.workers.dev";
  const news = (await fetch(`${BASE}/api/news`, { cache: "no-store" }).then((r) =>
    r.json(),
  )) as {
    headlines?: { url?: string; headline?: string; summary?: string | null }[];
  };
  const article = news.headlines?.[0];
  if (!article?.url) {
    console.log("no article");
    return;
  }
  console.log("headline:", article.headline);
  console.log("yahooSummary len:", article.summary?.length ?? 0);
  console.log("url:", article.url);

  const qs = new URLSearchParams({ url: article.url });
  if (article.headline) qs.set("headline", article.headline);
  if (article.summary) qs.set("yahooSummary", article.summary);
  qs.set("bust", String(Date.now()));

  const preview = (await fetch(`${BASE}/api/news/preview?${qs}`, {
    cache: "no-store",
  }).then((r) => r.json())) as { summary?: string | null; fullText?: string | null };
  console.log("preview summary len:", preview.summary?.length ?? 0);
  console.log("preview fullText len:", preview.fullText?.length ?? 0);
  console.log("preview start:", (preview.fullText ?? preview.summary ?? "").slice(0, 300));
}

main().catch(console.error);
