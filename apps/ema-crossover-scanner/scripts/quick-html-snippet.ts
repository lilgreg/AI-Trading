import YahooFinance from "yahoo-finance2";
import { Agent, fetch as undiciFetch } from "undici";
import { writeFileSync } from "node:fs";

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
  const idx = html.indexOf("article-body");
  console.log("idx:", idx);
  if (idx >= 0) console.log(html.slice(idx - 80, idx + 400));

  // count paragraphs before vs after "Recommended Stories"
  const rec = html.indexOf("Recommended Stories");
  console.log("Recommended Stories idx:", rec);
  const allP = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  console.log("total p tags:", allP.length);
  let before = 0;
  let after = 0;
  for (const m of allP) {
    const pos = m.index ?? 0;
    if (rec < 0 || pos < rec) before++;
    else after++;
  }
  console.log("p before recommended:", before, "after:", after);
}

main().catch(console.error);
