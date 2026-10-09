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

  const bodyMatch = html.match(
    /data-testid=["']article-body["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div/i,
  );
  if (bodyMatch) {
    const ps = [...bodyMatch[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((p) =>
      stripHtml(p[1]),
    );
    console.log("article-body testid paragraphs:", ps.length);
    ps.forEach((p, i) => console.log(i, p.slice(0, 90)));
  } else {
    console.log("no article-body testid match");
  }

  const allP: string[] = [];
  for (const m of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const t = stripHtml(m[1]);
    if (t.length > 40) allP.push(t);
  }
  console.log("\nall long p tags:", allP.length);
  allP.slice(-8).forEach((p, i) => console.log(`tail ${i}:`, p.slice(0, 100)));
}

main().catch(console.error);
