/** Debug full preview extraction chain for a Yahoo article URL. */
import YahooFinance from "yahoo-finance2";
import { Agent, fetch as undiciFetch } from "undici";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const agent = new Agent({
  maxHeaderSize: 65536,
  connectTimeout: 12_000,
  headersTimeout: 12_000,
  bodyTimeout: 12_000,
});

function extractMetaContent(html: string, attr: "property" | "name", key: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${key}["']`,
    "i",
  );
  const match = html.match(pattern);
  return match?.[1] ?? match?.[2] ?? null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractYahooNextArticleBody(html: string): string | null {
  const match = html.match(
    /<script id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    const bodyKeys = new Set(["articleBody", "description", "summary", "content"]);
    let best = "";
    const walk = (node: unknown): void => {
      if (node == null) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (typeof node !== "object") return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (bodyKeys.has(key) && typeof value === "string") {
          const text = stripHtml(decodeHtmlEntities(value));
          if (text.length > best.length) best = text;
        }
        walk(value);
      }
    };
    walk(parsed);
    return best.length > 80 ? best : null;
  } catch {
    return null;
  }
}

function extractJsonLdText(html: string): string | null {
  const scripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  let best = "";
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        for (const key of ["articleBody", "description", "text"]) {
          if (typeof record[key] === "string") {
            const text = stripHtml(decodeHtmlEntities(record[key]));
            if (text.length > best.length) best = text;
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return best || null;
}

function extractArticleParagraphs(html: string): string | null {
  const allParagraphs = html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  const parts: string[] = [];
  for (const p of allParagraphs) {
    const text = stripHtml(decodeHtmlEntities(p[1]));
    if (text.length > 60) parts.push(text);
    if (parts.join("\n\n").length > 8000) break;
  }
  const combined = parts.join("\n\n");
  return combined.length > 200 ? combined : null;
}

async function main() {
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const result = await yf.search("NVDA", { quotesCount: 1, newsCount: 2 });
  for (const item of (result.news ?? []).slice(0, 2)) {
    if (!item.link) continue;
    const res = await undiciFetch(item.link, {
      dispatcher: agent,
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
    });
    const html = await res.text();
    const og = extractMetaContent(html, "property", "og:description");
    const next = extractYahooNextArticleBody(html);
    const jsonLd = extractJsonLdText(html);
    const paras = extractArticleParagraphs(html);
    const hasNext = html.includes("__NEXT_DATA__");
    console.log("title:", item.title?.slice(0, 60));
    console.log("html:", html.length, "hasNext:", hasNext);
    console.log("og:", og?.length ?? 0);
    console.log("next:", next?.length ?? 0);
    console.log("jsonLd:", jsonLd?.length ?? 0);
    console.log("paras:", paras?.length ?? 0);
    if (next) console.log("next start:", next.slice(0, 120));
    if (paras) console.log("paras start:", paras.slice(0, 120));
    console.log("---");
  }
}

main().catch(console.error);
