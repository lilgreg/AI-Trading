import { CACHED_SCAN_API_KEY } from "./scan-api-cache";

const YAHOO_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DEFAULT_QUOTE_CHUNK = 12;
const YAHOO_TIMEOUT_MS = 5_000;
const YAHOO_PARALLEL = 4;

function parseNonNegativeInt(value: string | null, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function resolveYahooSymbol(symbol: string): string {
  return symbol.replace(/^[^:]+:/, "").toUpperCase();
}

function nySessionDateKey(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentChange(current: number, base: number): number | null {
  if (base === 0) return null;
  return ((current - base) / base) * 100;
}

function parseV8Meta(meta: Record<string, unknown>) {
  const previousClose =
    num(meta.chartPreviousClose) ??
    num(meta.previousClose) ??
    num(meta.regularMarketPreviousClose);
  const preMarketPrice = num(meta.preMarketPrice);
  const regularMarketPrice =
    num(meta.regularMarketPrice) ?? num(meta.currentPrice);
  const postMarketPrice = num(meta.postMarketPrice);

  const preMarketChange =
    preMarketPrice != null && previousClose != null
      ? percentChange(preMarketPrice, previousClose)
      : num(meta.preMarketChangePercent);

  const regularMarketChange =
    regularMarketPrice != null && previousClose != null
      ? percentChange(regularMarketPrice, previousClose)
      : num(meta.regularMarketChangePercent);

  const regularClose = regularMarketPrice;
  const postMarketChange =
    postMarketPrice != null && regularClose != null
      ? percentChange(postMarketPrice, regularClose)
      : num(meta.postMarketChangePercent);

  const price =
    postMarketPrice ??
    regularMarketPrice ??
    preMarketPrice ??
    num(meta.currentPrice);

  const dailyChange = num(meta.regularMarketChangePercent);

  return {
    price,
    dailyChange,
    preMarketChange,
    regularMarketChange,
    postMarketChange,
  };
}

async function fetchV8Quote(symbol: string): Promise<ReturnType<typeof parseV8Meta> | null> {
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
  );
  url.searchParams.set("interval", "1d");
  url.searchParams.set("range", "1d");
  url.searchParams.set("includePrePost", "true");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), YAHOO_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": YAHOO_USER_AGENT },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const body = (await res.json()) as {
      chart?: { result?: Array<{ meta?: Record<string, unknown> }> };
    };
    const meta = body.chart?.result?.[0]?.meta;
    if (!meta) return null;
    return parseV8Meta(meta);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchYahooQuotes(
  symbols: string[],
): Promise<Map<string, ReturnType<typeof parseV8Meta>>> {
  const out = new Map<string, ReturnType<typeof parseV8Meta>>();
  const unique = [...new Set(symbols.map(resolveYahooSymbol))];

  for (let i = 0; i < unique.length; i += YAHOO_PARALLEL) {
    const batch = unique.slice(i, i + YAHOO_PARALLEL);
    const results = await Promise.all(
      batch.map(async (symbol) => ({
        symbol,
        quote: await fetchV8Quote(symbol),
      })),
    );
    for (const { symbol, quote } of results) {
      if (quote) out.set(symbol, quote);
    }
  }

  return out;
}

/** Serve GET /api/quotes from R2 + Yahoo v8 — bypasses OpenNext (1102). */
async function tryServeQuotesApi(
  request: Request,
  env: CloudflareEnv,
): Promise<Response | null> {
  if (request.method !== "GET") return null;

  const url = new URL(request.url);
  if (url.pathname !== "/api/quotes") return null;

  const bucket = env.SCAN_CACHE_R2_BUCKET;
  if (!bucket) return null;

  const cached = await bucket.get(CACHED_SCAN_API_KEY);
  if (!cached) {
    return Response.json(
      { updatedAt: new Date().toISOString(), quotes: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const scan = (await cached.json()) as {
    results?: Array<{ symbol?: string; universeIndex?: number }>;
  };
  const rows = (scan.results ?? [])
    .filter((row) => typeof row.symbol === "string")
    .sort(
      (a, b) => (a.universeIndex ?? 0) - (b.universeIndex ?? 0),
    );

  const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);
  const limit = parseNonNegativeInt(
    url.searchParams.get("limit"),
    DEFAULT_QUOTE_CHUNK,
  );
  const slice = rows.slice(offset, offset + limit);
  const symbols = slice.map((row) => row.symbol as string);

  const yahooBySymbol = await fetchYahooQuotes(symbols);
  const sessionDate = nySessionDateKey();
  const quotes = symbols.map((symbol) => {
    const parsed = yahooBySymbol.get(resolveYahooSymbol(symbol)) ?? {
      price: null,
      dailyChange: null,
      preMarketChange: null,
      regularMarketChange: null,
      postMarketChange: null,
    };
    return {
      symbol,
      ...parsed,
      sessionSnapshotDate: sessionDate,
    };
  });

  return Response.json(
    {
      updatedAt: new Date().toISOString(),
      offset,
      limit,
      totalSymbols: rows.length,
      quotes,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export { tryServeQuotesApi };
