import YahooFinance from "yahoo-finance2";
import { Agent, fetch as undiciFetch } from "undici";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const agent = new Agent({ maxHeaderSize: 65536 });

async function main() {
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const result = await yf.search("TLT", { quotesCount: 1, newsCount: 1 });
  const url = result.news?.[0]?.link;
  if (!url) return;
  const res = await undiciFetch(url, {
    dispatcher: agent,
    headers: { "User-Agent": UA, Referer: "https://finance.yahoo.com/" },
  });
  const html = await res.text();

  const markers = [
    "caas-body",
    "article-body",
    "article__body",
    "story-body",
    "content-body",
    "data-test-locator",
    "atomic",
    "stream-item",
    "__NEXT_DATA__",
    "application/ld+json",
  ];
  for (const m of markers) {
    const count = (html.match(new RegExp(m, "gi")) ?? []).length;
    if (count) console.log(m, count);
  }

  const ld = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (ld) {
    try {
      const parsed = JSON.parse(ld[1]);
      console.log("json-ld keys:", Object.keys(parsed));
      if (parsed.articleBody) console.log("articleBody len:", parsed.articleBody.length);
    } catch {
      console.log("json-ld parse fail");
    }
  }

  // Find divs with many <p> children regions
  const articleMatch = html.match(/data-test-locator=["']article["'][^>]*>([\s\S]{0,8000})/i);
  if (articleMatch) console.log("article locator snippet:", articleMatch[1].slice(0, 300));
}

main().catch(console.error);
