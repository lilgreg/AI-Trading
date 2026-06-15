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
    const raw =
      extractMetaContent(html, "property", "og:description") ??
      extractMetaContent(html, "name", "description") ??
      extractMetaContent(html, "name", "twitter:description");

    const summary = raw ? decodeHtmlEntities(raw.trim()) : null;
    return NextResponse.json({ summary });
  } catch {
    return NextResponse.json({ summary: null });
  }
}
