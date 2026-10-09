/** Verify news preview extraction filters footer junk. */
import YahooFinance from "yahoo-finance2";
import { Agent, fetch as undiciFetch } from "undici";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const agent = new Agent({ maxHeaderSize: 65536 });

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

const FOOTER_START_RE =
  /^(view comments|terms and privacy|recommended stories|related:|copyright ©|sign in to access|advertisement|portfolio\b)/i;
const FOOTER_INLINE_RE =
  /\b(Terms and Privacy Policy|Privacy Dashboard|Recommended Stories|Copyright ©|Sign in to access your portfolio|ADVERTISEMENT)\b/i;
const BOILERPLATE_RE =
  /^(skip to navigation|yahoo finance is not a broker|the above button links|sign in to view)/i;
const AFFILIATE_RE =
  /coinbase|broker-dealer|cryptocurrencies for sale|facilitate trading|stocktwits|10m\+ investors|newsroom\[at\]/i;
const TABLE_CELL_RE = /^(index|move|close|symbol|ticker)$/i;
const TABLE_DATA_RE = /^-?\d+(\.\d+)?%$|^[\d,]+\.\d{2}$/;

function isUsefulParagraph(text: string): boolean {
  if (text.length < 50) return false;
  if (BOILERPLATE_RE.test(text)) return false;
  if (AFFILIATE_RE.test(text)) return false;
  if (FOOTER_START_RE.test(text)) return false;
  if (FOOTER_INLINE_RE.test(text)) return false;
  if (TABLE_CELL_RE.test(text)) return false;
  if (TABLE_DATA_RE.test(text)) return false;
  if (/has no position in any of the stocks/i.test(text)) return false;
  return true;
}

function trimFooterJunk(text: string): string {
  const inline = text.search(FOOTER_INLINE_RE);
  if (inline > 200) return text.slice(0, inline).trim();
  const lines = text.split(/\n\n+/);
  const kept: string[] = [];
  for (const line of lines) {
    if (FOOTER_START_RE.test(line.trim()) || FOOTER_INLINE_RE.test(line)) break;
    kept.push(line);
  }
  return kept.join("\n\n").trim();
}

function joinUsefulParagraphs(parts: string[]): string {
  const kept: string[] = [];
  for (const part of parts) {
    if (FOOTER_START_RE.test(part.trim()) || FOOTER_INLINE_RE.test(part)) break;
    if (isUsefulParagraph(part)) kept.push(part);
  }
  return trimFooterJunk(kept.join("\n\n"));
}

function extractYahooTestIdArticleBody(html: string): string | null {
  const match = html.match(
    /data-testid=["']article-body["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div/i,
  );
  if (!match) return null;
  const parts: string[] = [];
  for (const p of match[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripHtml(decodeHtmlEntities(p[1]));
    if (!text) continue;
    if (FOOTER_START_RE.test(text.trim()) || FOOTER_INLINE_RE.test(text)) break;
    if (text.length > 30) parts.push(text);
  }
  const combined = joinUsefulParagraphs(parts);
  return combined.length > 80 ? combined : null;
}

async function main() {
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const result = await yf.search("TLT", { quotesCount: 1, newsCount: 1 });
  const url = result.news?.[0]?.link;
  if (!url) throw new Error("no news");

  const res = await undiciFetch(url, {
    dispatcher: agent,
    headers: { "User-Agent": UA, Referer: "https://finance.yahoo.com/" },
  });
  const html = await res.text();
  const text = extractYahooTestIdArticleBody(html);
  if (!text) throw new Error("extraction failed");

  const bad = [
    "Terms and Privacy Policy",
    "Recommended Stories",
    "Copyright ©",
    "Sign in to access your portfolio",
    "ADVERTISEMENT",
    "View Comments",
  ];
  for (const phrase of bad) {
    if (text.includes(phrase)) {
      throw new Error(`footer junk still present: ${phrase}`);
    }
  }

  console.log("OK chars:", text.length);
  console.log("start:", text.slice(0, 120));
  console.log("end:", text.slice(-120));
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
