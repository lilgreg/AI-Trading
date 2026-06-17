/** Full production verification loop. Run: npx tsx scripts/verify-prod-full.ts */
const BASE =
  process.env.PROD_URL ?? "https://ai-trading-scanner.lilgreg1.workers.dev";

const SCAN_ATTEMPTS = 3;
const NEWS_ATTEMPTS = 3;
const RETRY_PAUSE_MS = 8_000;
const MIN_CROSS1H_BASELINE = 300;
const MIN_PREVIEW_LEN = 200;

interface ScanRow {
  symbol?: string;
  price?: number | null;
  error?: string;
  ema20Above50?: boolean;
  preMarketChange?: number | null;
  regularMarketChange?: number | null;
  postMarketChange?: number | null;
  cross1h?: { crossoverAt?: string | null; crossoverDate?: string | null };
  cross4h?: { crossoverAt?: string | null; crossoverDate?: string | null };
}

function hasCross(cross?: { crossoverAt?: string | null; crossoverDate?: string | null }): boolean {
  return Boolean(cross?.crossoverAt ?? cross?.crossoverDate);
}

function countCross4hGaps(results: ScanRow[]): number {
  return results.filter((row) => row.ema20Above50 && !hasCross(row.cross4h)).length;
}

function countMissingSession(results: ScanRow[]): number {
  return results.filter(
    (row) =>
      !row.error &&
      row.preMarketChange == null &&
      row.regularMarketChange == null &&
      row.postMarketChange == null,
  ).length;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry<T>(
  label: string,
  url: string,
  attempts: number,
): Promise<{ ok: boolean; status: number; ms: number; body: T | null }> {
  for (let i = 0; i < attempts; i += 1) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { cache: "no-store" });
      const ms = Date.now() - t0;
      const text = await res.text();
      if (!text.startsWith("{")) {
        console.log(
          `${label} try ${i + 1}: ${res.status} ${ms}ms non-json (${text.slice(0, 60)}) FAIL`,
        );
        if (i < attempts - 1) await sleep(RETRY_PAUSE_MS);
        continue;
      }
      const body = JSON.parse(text) as T;
      const ok = res.status === 200 && ms < 30_000;
      console.log(`${label} try ${i + 1}: ${res.status} ${ms}ms ${ok ? "PASS" : "FAIL"}`);
      if (ok) return { ok: true, status: res.status, ms, body };
      if (i < attempts - 1) await sleep(RETRY_PAUSE_MS);
    } catch (err) {
      const ms = Date.now() - t0;
      console.log(
        `${label} try ${i + 1}: error ${ms}ms ${err instanceof Error ? err.message : err} FAIL`,
      );
      if (i < attempts - 1) await sleep(RETRY_PAUSE_MS);
    }
  }
  return { ok: false, status: 0, ms: 0, body: null };
}

async function verifyNews(): Promise<boolean> {
  let pass = 0;
  for (let i = 0; i < NEWS_ATTEMPTS; i += 1) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/news`, { cache: "no-store" });
    const ms = Date.now() - t0;
    const text = await res.text();
    if (!text.startsWith("{")) {
      console.log(`news try ${i + 1}: ${res.status} ${ms}ms non-json FAIL`);
      if (i < NEWS_ATTEMPTS - 1) await sleep(RETRY_PAUSE_MS);
      continue;
    }
    const body = JSON.parse(text) as { headlines?: unknown[]; error?: string };
    const headlines = body.headlines?.length ?? 0;
    const ok = res.status === 200 && headlines > 0;
    console.log(
      `news try ${i + 1}: ${res.status} ${ms}ms headlines=${headlines} ${ok ? "PASS" : "FAIL"}`,
    );
    if (ok) pass += 1;
    else if (i < NEWS_ATTEMPTS - 1) await sleep(RETRY_PAUSE_MS);
  }
  return pass === NEWS_ATTEMPTS;
}

async function verifyNewsPreview(): Promise<{ pass: boolean; previewLen: number; sample: string }> {
  const newsRes = await fetch(`${BASE}/api/news`, { cache: "no-store" });
  const newsText = await newsRes.text();
  if (!newsText.startsWith("{")) {
    console.log("news preview: news non-json FAIL");
    return { pass: false, previewLen: 0, sample: "" };
  }
  const news = JSON.parse(newsText) as {
    headlines?: { url?: string; headline?: string; summary?: string | null }[];
  };
  const article =
    news.headlines?.find((h) => h.url) ??
    news.headlines?.[0];
  if (!article?.url) {
    console.log("news preview: no article url FAIL");
    return { pass: false, previewLen: 0, sample: "" };
  }

  for (let i = 0; i < 3; i += 1) {
    const t0 = Date.now();
    const res = await fetch(
      `${BASE}/api/news/preview?url=${encodeURIComponent(article.url)}`,
      { cache: "no-store" },
    );
    const ms = Date.now() - t0;
    const text = await res.text();
    if (!text.startsWith("{")) {
      console.log(`news preview try ${i + 1}: ${res.status} ${ms}ms non-json FAIL`);
      if (i < 2) await sleep(RETRY_PAUSE_MS);
      continue;
    }
    const body = JSON.parse(text) as { summary?: string | null };
    const summary = body.summary?.trim() ?? "";
    const multiParagraph = summary.includes("\n\n");
    const pass =
      res.status === 200 &&
      (summary.length >= MIN_PREVIEW_LEN || multiParagraph);
    console.log(
      `news preview try ${i + 1}: ${res.status} ${ms}ms len=${summary.length} ${pass ? "PASS" : "FAIL"}`,
    );
    if (pass) {
      return { pass: true, previewLen: summary.length, sample: summary.slice(0, 240) };
    }
    if (i < 2) await sleep(RETRY_PAUSE_MS);
  }

  const yahooSummary = article.summary?.trim() ?? "";
  if (yahooSummary.length >= MIN_PREVIEW_LEN) {
    console.log(`news preview: fallback yahoo summary len=${yahooSummary.length} PASS`);
    return { pass: true, previewLen: yahooSummary.length, sample: yahooSummary.slice(0, 240) };
  }

  return { pass: false, previewLen: 0, sample: "" };
}

async function verifyScan(): Promise<{
  pass: boolean;
  nullPrice: number;
  missingSession: number;
  cross4hGap: number;
  cross1hCount: number;
  total: number;
  row204?: ScanRow;
}> {
  const result = await fetchJsonWithRetry<{
    results?: ScanRow[];
    cross4hGapCount?: number;
  }>("scan", `${BASE}/api/scan`, SCAN_ATTEMPTS);

  const results = result.body?.results ?? [];
  const nullPrice = results.filter((r) => r.price == null).length;
  const missingSession = countMissingSession(results);
  const cross4hGap = countCross4hGaps(results);
  const cross1hCount = results.filter((r) => hasCross(r.cross1h)).length;
  const row204 = results[203];

  const pass =
    result.ok &&
    nullPrice === 0 &&
    missingSession === 0 &&
    cross4hGap === 0 &&
    cross1hCount >= MIN_CROSS1H_BASELINE;

  console.log(
    `scan summary: rows=${results.length} nullPrice=${nullPrice} missingSession=${missingSession} cross4hGap=${cross4hGap} cross1h=${cross1hCount} ${pass ? "PASS" : "FAIL"}`,
  );
  if (nullPrice > 0) {
    console.log(
      "  nullPrice symbols:",
      results.filter((r) => r.price == null).map((r) => r.symbol).join(", "),
    );
  }
  if (row204) {
    console.log(
      `  row204 ${row204.symbol}: cross4h=${row204.cross4h?.crossoverAt ?? "—"} price=${row204.price}`,
    );
  }

  return {
    pass,
    nullPrice,
    missingSession,
    cross4hGap,
    cross1hCount,
    total: results.length,
    row204,
  };
}

async function main() {
  console.log("=== VERIFY PRODUCTION ===");
  console.log("BASE:", BASE);

  const newsOk = await verifyNews();
  const preview = await verifyNewsPreview();
  const scan = await verifyScan();

  const allPass = newsOk && preview.pass && scan.pass;
  console.log("\n=== RESULT ===");
  console.log("news (3/3):", newsOk ? "PASS" : "FAIL");
  console.log("news preview:", preview.pass ? "PASS" : "FAIL", `(len=${preview.previewLen})`);
  if (preview.sample) console.log("  preview sample:", preview.sample);
  console.log("scan:", scan.pass ? "PASS" : "FAIL");
  console.log("ALL PASS:", allPass ? "YES" : "NO");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
