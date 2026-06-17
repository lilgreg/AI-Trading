import { NextResponse } from "next/server";
import { Agent, fetch as undiciFetch } from "undici";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const PREVIEW_TIMEOUT_MS = 10_000;
const MAX_SUMMARY_LEN = 6_000;
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

/** Pull paragraph text from article/main content regions. */
function extractYahooNextArticleBody(html: string): string | null {
  const match = html.match(
    /<script id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]) as unknown;
    const str = JSON.stringify(parsed);
    const bodyMatch = str.match(/"articleBody"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (!bodyMatch) return null;
    const decoded = JSON.parse(`"${bodyMatch[1]}"`) as string;
    const text = stripHtml(decodeHtmlEntities(decoded));
    return text.length > 80 ? text : null;
  } catch {
    return null;
  }
}

function extractArticleParagraphs(html: string): string | null {
  const regionPattern =
    /<(article|main|div)[^>]*(?:class|id)=["'][^"']*(?:article|story|content|post-body|entry-content)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;

  let best = "";
  for (const match of html.matchAll(regionPattern)) {
    const inner = match[2];
    const paragraphs = inner.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    const parts: string[] = [];
    for (const p of paragraphs) {
      const text = stripHtml(decodeHtmlEntities(p[1]));
      if (text.length > 40) parts.push(text);
    }
    const combined = parts.join("\n\n");
    if (combined.length > best.length) best = combined;
  }

  if (best.length < 200) {
    const allParagraphs = html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    const parts: string[] = [];
    for (const p of allParagraphs) {
      const text = stripHtml(decodeHtmlEntities(p[1]));
      if (text.length > 60) parts.push(text);
      if (parts.join("\n\n").length > MAX_SUMMARY_LEN) break;
    }
    const fallback = parts.join("\n\n");
    if (fallback.length > best.length) best = fallback;
  }

  return best || null;
}

function longestText(...candidates: (string | null | undefined)[]): string | null {
  let best = "";
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && trimmed.length > best.length) best = trimmed;
  }
  return best || null;
}

export async function GET(request: Request) {
  const urlParam = new URL(request.url).searchParams.get("url");
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

  try {
    const res = await undiciFetch(target.toString(), {
      dispatcher: previewFetchAgent,
      headers: {
        "User-Agent": PREVIEW_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return NextResponse.json({ summary: null });
    }

    const html = await res.text();
    const metaSummary = longestText(
      extractMetaContent(html, "property", "og:description"),
      extractMetaContent(html, "name", "description"),
      extractMetaContent(html, "name", "twitter:description"),
      extractMetaContent(html, "property", "article:description"),
    );

    const summary = longestText(
      metaSummary ? decodeHtmlEntities(metaSummary) : null,
      extractYahooNextArticleBody(html),
      extractJsonLdText(html),
      extractArticleParagraphs(html),
    );

    const trimmed =
      summary && summary.length > MAX_SUMMARY_LEN
        ? `${summary.slice(0, MAX_SUMMARY_LEN).trim()}…`
        : summary;

    return NextResponse.json({ summary: trimmed });
  } catch {
    return NextResponse.json({ summary: null });
  }
}
