/** Temporary debug script — probe TradingView logo resolution. */
async function fetchHtml(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EMAScanner/1.0)" },
  });
  return r.text();
}

async function ok(url: string): Promise<boolean> {
  try {
    const r = await fetch(url);
    const ct = r.headers.get("content-type") ?? "";
    return r.ok && (ct.includes("image") || ct.includes("svg"));
  } catch {
    return false;
  }
}

function extractLogoid(html: string): string | null {
  const m =
    html.match(/"logoid"\s*:\s*"([^"]+)"/) ??
    html.match(/"logo_id"\s*:\s*"([^"]+)"/) ??
    html.match(/logoid=([^&"']+)/);
  return m?.[1] ?? null;
}

function nameToSlug(name: string): string {
  return name
    .replace(/\s+(Inc\.?|Corp\.?|Corporation|Company|Co\.?|Ltd\.?|Limited|PLC|LP|LLC|Holdings?|Group|N\.?V\.?)\.?$/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  const symbols = ["NASDAQ:AAPL", "NASDAQ:MSFT", "NASDAQ:SNX", "NASDAQ:ARTY", "NYSE:BRK.B", "NYSE:KO", "NYSE:JPM"];

  for (const sym of symbols) {
    const url = `https://www.tradingview.com/symbols/${sym.replace(":", "-")}/`;
    const html = await fetchHtml(url);
    const logoid = extractLogoid(html);
    const logos = [...html.matchAll(/s3-symbol-logo\.tradingview\.com\/[^"'\s?]+/g)].map((m) => m[0]);
    console.log(`\n=== ${sym} ===`);
    console.log("logoid:", logoid);
    console.log("unique logo paths:", [...new Set(logos)].slice(0, 5));
    if (logoid) {
      for (const ext of ["svg", "png"]) {
        const logoUrl = `https://s3-symbol-logo.tradingview.com/${logoid}.${ext}`;
        console.log(`  ${logoUrl}: ${(await ok(logoUrl)) ? "OK" : "FAIL"}`);
      }
    }
  }
}

async function probeSlugs() {
  async function ok(url: string): Promise<boolean> {
    try {
      const r = await fetch(url);
      const ct = r.headers.get("content-type") ?? "";
      return r.ok && (ct.includes("image") || ct.includes("svg"));
    } catch {
      return false;
    }
  }

  const slugs = [
    "td-synnex",
    "synnex",
    "snx",
    "ishares-future-ai-tech-etf",
    "ishares-artificial-intelligence-and-tech-etf",
    "arty",
    "invesco-qqq-trust",
    "spdr-s-and-p-500-etf-trust",
  ];

  for (const slug of slugs) {
    for (const url of [
      `https://s3-symbol-logo.tradingview.com/${slug}.svg`,
      `https://s3-symbol-logo.tradingview.com/${slug}.png`,
      `https://s3-symbol-logo.tradingview.com/${slug}--600.png`,
    ]) {
      if (await ok(url)) console.log("OK", url);
    }
  }

  const searchUrl =
    "https://symbol-search.tradingview.com/symbol_search/?text=SNX&exchange=NASDAQ&search_type=undefined&domain=production&sort_by_country=US";
  const r = await fetch(searchUrl, { headers: { Origin: "https://www.tradingview.com" } });
  const data = (await r.json()) as Array<Record<string, unknown>>;
  console.log("\nSNX search:", JSON.stringify(data[0], null, 2));
}

main()
  .then(() => probeSlugs())
  .catch(console.error);
