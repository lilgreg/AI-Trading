/** Quick test: caas-body + prod preview for one Yahoo article. */
import YahooFinance from "yahoo-finance2";
import { Agent, fetch as undiciFetch } from "undici";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const agent = new Agent({ maxHeaderSize: 65536 });

async function main() {
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const result = await yf.search("TLT", { quotesCount: 1, newsCount: 1 });
  const item = result.news?.[0];
  if (!item?.link) {
    console.log("no news");
    process.exit(1);
  }
  console.log("URL:", item.link);
  console.log("Title:", item.title);

  const res = await undiciFetch(item.link, {
    dispatcher: agent,
    headers: { "User-Agent": UA, Referer: "https://finance.yahoo.com/" },
    redirect: "follow",
  });
  const html = await res.text();
  console.log("html len:", html.length);
  console.log("has caas-body:", /caas-body/i.test(html));

  const idx = html.search(/caas-body/i);
  if (idx >= 0) console.log("caas snippet:", html.slice(idx, idx + 200));

  const previewParams = new URLSearchParams({
    url: item.link,
    headline: item.title ?? "",
    yahooSummary: String((item as { summary?: string }).summary ?? ""),
  });
  const prodUrl = `https://ai-trading-scanner.lilgreg1.workers.dev/api/news/preview?${previewParams}`;
  const pr = await fetch(prodUrl);
  const body = (await pr.json()) as { summary?: string; fullText?: string };
  const text = body.fullText ?? body.summary ?? "";
  console.log("prod preview len:", text.length);
  console.log("prod start:", text.slice(0, 200));
  console.log("prod end:", text.slice(-250));
}

main().catch(console.error);
