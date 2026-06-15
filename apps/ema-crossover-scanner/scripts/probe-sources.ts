/**
 * Quick probe of chart data sources for AMT.
 * Usage: npx tsx scripts/probe-sources.ts
 */
const TIMEOUT = 10_000;

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function probe(name: string, url: string, init?: RequestInit): Promise<void> {
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(url, init);
    const text = await res.text();
    console.log(
      `${name.padEnd(14)} ${res.status} ${String(text.length).padStart(6)}b ${Date.now() - t0}ms ${text.slice(0, 70).replace(/\s+/g, " ")}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.name : String(err);
    console.log(`${name.padEnd(14)} ERR ${msg} ${Date.now() - t0}ms`);
  }
}

async function main() {
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const headers = { "User-Agent": ua, Accept: "*/*" };

  await probe(
    "yahoo-spark",
    "https://query1.finance.yahoo.com/v7/finance/spark?symbols=AMT&range=6mo&interval=1h&includePrePost=false",
    { headers },
  );
  await probe(
    "yahoo-v8-rng",
    "https://query1.finance.yahoo.com/v8/finance/chart/AMT?range=6mo&interval=1h&includePrePost=false",
    { headers },
  );
  await probe(
    "yahoo-v8-q2",
    "https://query2.finance.yahoo.com/v8/finance/chart/AMT?range=6mo&interval=1h",
    { headers },
  );
  await probe("stooq-daily", "https://stooq.com/q/d/l/?s=amt.us&i=d", {
    headers: { ...headers, Referer: "https://stooq.com/" },
  });
  await probe("stooq-h60", "https://stooq.com/q/d/l/?s=amt.us&i=60", {
    headers: { ...headers, Referer: "https://stooq.com/" },
  });

  const fhKey = process.env.FINNHUB_API_KEY?.trim();
  if (fhKey) {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 134 * 24 * 60 * 60;
    await probe(
      "finnhub",
      `https://finnhub.io/api/v1/stock/candle?symbol=AMT&resolution=60&from=${from}&to=${to}&token=${fhKey}`,
    );
  } else {
    console.log("finnhub        SKIP (no FINNHUB_API_KEY)");
  }
}

main().catch(console.error);
