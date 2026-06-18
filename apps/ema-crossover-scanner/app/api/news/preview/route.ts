import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { Agent, fetch as undiciFetch } from "undici";
import { isCloudflareWorkersRuntime } from "@/lib/runtime";
import { getYahooCached, setYahooCached } from "@/lib/yahoo-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const PREVIEW_TIMEOUT_MS = 10_000;
const MAX_SUMMARY_LEN = 50_000;
const MIN_USEFUL_LEN = 500;
const PREVIEW_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Some publishers send huge Set-Cookie headers — default undici limit is 16KB. */
const previewFetchAgent = new Agent({
  maxHeaderSize: 65536,
  connectTimeout: PREVIEW_TIMEOUT_MS,
  headersTimeout: PREVIEW_TIMEOUT_MS,
  bodyTimeout: PREVIEW_TIMEOUT_MS,
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
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const BOILERPLATE_RE =
  /^(skip to navigation|yahoo finance is not a broker|the above button links|sign in to view)/i;
const AFFILIATE_RE =
  /coinbase|broker-dealer|cryptocurrencies for sale|facilitate trading|stocktwits|10m\+ investors|newsroom\[at\]/i;
const FOOTER_START_RE =
  /^(view comments|terms and privacy|recommended stories|related:|copyright ©|sign in to access|advertisement|portfolio\b)/i;
const FOOTER_INLINE_RE =
  /\b(Terms and Privacy Policy|Privacy Dashboard|Recommended Stories|Copyright ©|Sign in to access your portfolio|ADVERTISEMENT)\b/i;
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
  if (/^skip to /i.test(text)) return false;
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
  const strict = trimFooterJunk(kept.join("\n\n"));
  if (strict.length >= 80) return strict;

  // Some Yahoo layouts use shorter ledes; keep non-footer paragraphs if strict filter removed all.
  const relaxed: string[] = [];
  for (const part of parts) {
    if (FOOTER_START_RE.test(part.trim()) || FOOTER_INLINE_RE.test(part)) break;
    if (part.trim().length >= 40) relaxed.push(part.trim());
  }
  return trimFooterJunk(relaxed.join("\n\n"));
}

/** Slice a bounded HTML region after a marker (avoids brittle single-</div> regex). */
function sliceAfterMarker(html: string, marker: RegExp, maxLen = 80_000): string | null {
  const match = html.match(marker);
  if (!match || match.index == null) return null;
  const start = match.index + match[0].length;
  return html.slice(start, start + maxLen);
}

function extractParagraphsFromHtml(
  htmlChunk: string,
  minLen = 30,
): string[] {
  const parts: string[] = [];
  for (const p of htmlChunk.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripHtml(decodeHtmlEntities(p[1]));
    if (!text) continue;
    if (FOOTER_START_RE.test(text.trim()) || FOOTER_INLINE_RE.test(text)) break;
    if (text.length >= minLen) parts.push(text);
  }
  return parts;
}

function extractCanonicalUrl(html: string): string | null {
  const patterns = [
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
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
      // ignore malformed JSON-LD blocks
    }
  }

  return best || null;
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

const PREVIEW_HEADERS = {
  "User-Agent": PREVIEW_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://finance.yahoo.com/",
};

async function fetchPreviewHtml(url: string): Promise<string | null> {
  if (isCloudflareWorkersRuntime()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: PREVIEW_HEADERS,
        redirect: "follow",
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) return null;
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  const res = await undiciFetch(url, {
    dispatcher: previewFetchAgent,
    headers: PREVIEW_HEADERS,
    redirect: "follow",
  });
  if (!res.ok) return null;
  return res.text();
}

function extractYahooTestIdArticleBody(html: string): string | null {
  const chunk = sliceAfterMarker(html, /data-testid=["']article-body["'][^>]*>/i);
  if (!chunk) return null;

  const combined = joinUsefulParagraphs(extractParagraphsFromHtml(chunk));
  return combined.length > 80 ? combined : null;
}

function extractYahooCaasParagraphs(html: string): string | null {
  const chunk = sliceAfterMarker(html, /class=["'][^"']*caas-body[^"']*["'][^>]*>/i);
  if (!chunk) return null;

  const combined = joinUsefulParagraphs(extractParagraphsFromHtml(chunk, 40));
  return combined.length > 80 ? combined : null;
}

function extractYahooArticleLocator(html: string): string | null {
  const chunk = sliceAfterMarker(html, /data-test-locator=["']article["'][^>]*>/i);
  if (!chunk) return null;

  const combined = joinUsefulParagraphs(extractParagraphsFromHtml(chunk));
  return combined.length > 80 ? combined : null;
}

function extractArticleParagraphs(html: string): string | null {
  const candidates = [
    extractYahooTestIdArticleBody(html),
    extractYahooCaasParagraphs(html),
    extractYahooArticleLocator(html),
  ];

  let best = "";
  for (const text of candidates) {
    if (text && text.length > best.length) best = text;
  }
  if (best.length >= 200) return best;

  const regionPattern =
    /<(article|main|div)[^>]*(?:class|id|data-testid)=["'][^"']*(?:article-body|article|story|content|post-body|entry-content)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;

  for (const match of html.matchAll(regionPattern)) {
    const combined = joinUsefulParagraphs(extractParagraphsFromHtml(match[2], 40));
    if (combined.length > best.length) best = combined;
  }

  return best || candidates.find((t) => t && t.length > 80) || null;
}

function longestText(...candidates: (string | null | undefined)[]): string | null {
  let best = "";
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && trimmed.length > best.length) best = trimmed;
  }
  return best || null;
}

function buildFallbackSummary(
  headline?: string | null,
  yahooSummary?: string | null,
): string | null {
  const summary = yahooSummary?.trim();
  const title = headline?.trim();
  if (summary && summary.length >= MIN_USEFUL_LEN) return summary;
  if (summary && title && summary !== title) return summary;
  if (summary && summary.length >= 80) return summary;
  return null;
}

function trimSummary(summary: string | null): string | null {
  if (!summary) return null;
  if (summary.length <= MAX_SUMMARY_LEN) return summary;
  return `${summary.slice(0, MAX_SUMMARY_LEN).trim()}…`;
}

function previewCacheId(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 32);
}

function extractMetaSummary(html: string): string | null {
  const metaSummary = longestText(
    extractMetaContent(html, "property", "og:description"),
    extractMetaContent(html, "name", "description"),
    extractMetaContent(html, "name", "twitter:description"),
    extractMetaContent(html, "property", "article:description"),
  );
  return metaSummary ? decodeHtmlEntities(metaSummary) : null;
}

/** Priority: article paragraphs > Yahoo __NEXT_DATA__ > JSON-LD > meta description. */
function extractFullArticleText(html: string): string | null {
  const text = longestText(
    extractArticleParagraphs(html),
    extractYahooNextArticleBody(html),
    extractJsonLdText(html),
  );
  return text ? trimFooterJunk(text) : null;
}

async function fetchCanonicalArticleText(
  html: string,
  sourceUrl: string,
): Promise<string | null> {
  const href = extractCanonicalUrl(html);
  if (!href) return null;

  let canonicalUrl: string;
  try {
    canonicalUrl = new URL(href, sourceUrl).toString();
  } catch {
    return null;
  }
  if (canonicalUrl === sourceUrl) return null;

  const canonicalHtml = await fetchPreviewHtml(canonicalUrl);
  if (!canonicalHtml) return null;
  return extractFullArticleText(canonicalHtml);
}

async function scrapeSummary(
  url: string,
): Promise<{ summary: string | null; fullText: string | null }> {
  const html = await fetchPreviewHtml(url);
  if (!html) return { summary: null, fullText: null };

  let fullText = extractFullArticleText(html);
  if (!fullText || fullText.length < MIN_USEFUL_LEN) {
    const canonicalText = await fetchCanonicalArticleText(html, url);
    if (canonicalText && canonicalText.length > (fullText?.length ?? 0)) {
      fullText = canonicalText;
    }
  }

  const metaSummary = extractMetaSummary(html);
  const summary = longestText(
    fullText,
    metaSummary && metaSummary.length >= 80 ? metaSummary : null,
  );

  return { summary, fullText: fullText ?? summary };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const urlParam = params.get("url");
  if (!urlParam) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(urlParam);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    return NextResponse.json({ error: "Invalid url protocol" }, { status: 400 });
  }

  const headline = params.get("headline");
  const yahooSummary = params.get("yahooSummary");
  const cacheId = previewCacheId(target.toString());

  try {
    const cached = await getYahooCached<{
      summary: string | null;
      fullText?: string | null;
    }>("news-preview", cacheId);
    const cachedFull = cached?.fullText?.trim() || cached?.summary?.trim() || "";
    if (cachedFull.length >= MIN_USEFUL_LEN) {
      return NextResponse.json({
        summary: cached?.summary ?? cachedFull,
        fullText: cached?.fullText ?? cachedFull,
      });
    }

    const scraped = await scrapeSummary(target.toString());
    const fallback = buildFallbackSummary(headline, yahooSummary);
    const fullText = trimSummary(
      longestText(scraped.fullText, scraped.summary, fallback) ?? fallback,
    );
    const summary = fullText;

    if (fullText && fullText.length >= MIN_USEFUL_LEN) {
      await setYahooCached("news-preview", cacheId, { summary, fullText });
    }

    return NextResponse.json({ summary: summary ?? null, fullText: fullText ?? null });
  } catch {
    const fallback = trimSummary(buildFallbackSummary(headline, yahooSummary));
    return NextResponse.json({ summary: fallback, fullText: fallback });
  }
}
