import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const PREVIEW_TIMEOUT_MS = 5_000;

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
    .replace(/&#x27;/gi, "'");
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractJsonLdDescription(html: string): string | null {
  const scripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;

        if (typeof record.description === "string") {
          const description = stripHtml(decodeHtmlEntities(record.description));
          if (description) return description;
        }

        if (typeof record.articleBody === "string") {
          const body = stripHtml(decodeHtmlEntities(record.articleBody));
          if (body.length > 120) return body.slice(0, 4_000);
        }
      }
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }

  return null;
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
    const res = await fetch(target.toString(), {
      headers: {
        "User-Agent": "EMA-Crossover-Scanner/1.0",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
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
      extractJsonLdDescription(html),
    );
    return NextResponse.json({ summary });
  } catch {
    return NextResponse.json({ summary: null });
  }
}
