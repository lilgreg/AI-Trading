import YahooFinance from "yahoo-finance2";
import { Agent, fetch as undiciFetch } from "undici";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const agent = new Agent({ maxHeaderSize: 65536 });

function stripHtml(v: string) {
  return v.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

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

  const re =
    /<(article|div)[^>]*class=["'][^"']*article-body[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let i = 0;
  for (const m of html.matchAll(re)) {
    i++;
    const inner = m[2];
    const ps = [...inner.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((p) =>
      stripHtml(p[1]),
    );
    console.log(`article-body #${i}: ${ps.length} paragraphs, ${ps.join(" ").length} chars`);
    console.log("  first:", ps[0]?.slice(0, 100));
    console.log("  last:", ps[ps.length - 1]?.slice(0, 100));
  }
}

main().catch(console.error);
