/** Test preview extraction without Next.js server. */
import YahooFinance from "yahoo-finance2";
import { Agent, fetch as undiciFetch } from "undici";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const agent = new Agent({ maxHeaderSize: 65536, connectTimeout: 12_000, headersTimeout: 12_000, bodyTimeout: 12_000 });

function extractMetaContent(html: string, attr: "property" | "name", key: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${key}["']`,
    "i",
  );
  const match = html.match(pattern);
  return match?.[1] ?? match?.[2] ?? null;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function main() {
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const result = await yf.search("NVDA", { quotesCount: 1, newsCount: 3 });
  for (const item of (result.news ?? []).slice(0, 3)) {
    if (!item.link) continue;
    const res = await undiciFetch(item.link, {
      dispatcher: agent,
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
    });
    const html = await res.text();
    const og = extractMetaContent(html, "property", "og:description");
    const desc = extractMetaContent(html, "name", "description");
    const best = [og, desc].filter(Boolean).sort((a, b) => (b?.length ?? 0) - (a?.length ?? 0))[0];
    console.log("title:", item.title?.slice(0, 55));
    console.log("status:", res.status, "html:", html.length, "summary:", best?.length ?? 0);
    if (best) console.log("text:", stripHtml(best).slice(0, 180));
    console.log("---");
  }
}

main().catch(console.error);
