import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
async function main() {
  const base = process.argv[2] ?? "http://127.0.0.1:3000";
  const result = await yf.search("AAPL", { quotesCount: 1, newsCount: 2 });
  for (const item of (result.news ?? []).slice(0, 2)) {
    if (!item.link) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(
        `${base}/api/news/preview?url=${encodeURIComponent(item.link)}`,
        { signal: controller.signal },
      );
      const body = (await res.json()) as { summary?: string | null };
      console.log("title:", item.title?.slice(0, 60));
      console.log("yahoo summary:", (item as { summary?: string }).summary?.length ?? 0);
      console.log("api summary:", body.summary?.length ?? 0);
      console.log("preview:", body.summary?.slice(0, 150));
    } catch (err) {
      console.log("title:", item.title?.slice(0, 60));
      console.log("error:", err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
    console.log("---");
  }
}

main().catch(console.error);
