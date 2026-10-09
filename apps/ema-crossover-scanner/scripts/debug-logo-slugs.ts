/** Test logo slug generation and Yahoo URLs. */
function nameToSlug(name: string): string[] {
  const slugs = new Set<string>();
  const cleaned = name.trim();
  if (!cleaned) return [];

  const withoutSuffix = cleaned
    .replace(
      /\s+(Inc\.?|Corp\.?|Corporation|Company|Co\.?|Ltd\.?|Limited|PLC|LP|LLC|Holdings?|Group|N\.?V\.?|S\.?A\.?)\.?$/i,
      "",
    )
    .trim();

  for (const base of [cleaned, withoutSuffix]) {
    slugs.add(
      base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    );
  }

  return [...slugs].filter(Boolean);
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

async function main() {
  const names = [
    "Apple Inc.",
    "Microsoft Corporation",
    "TD SYNNEX Corporation",
    "iShares Future AI & Tech ETF",
    "The Coca-Cola Company",
    "Berkshire Hathaway Inc.",
  ];

  for (const name of names) {
    console.log(`\n${name}:`);
    for (const slug of nameToSlug(name)) {
      for (const url of [
        `https://s3-symbol-logo.tradingview.com/${slug}.svg`,
        `https://s3-symbol-logo.tradingview.com/${slug}--600.png`,
      ]) {
        if (await ok(url)) console.log("  OK", url);
      }
    }
  }

  const yahooUrls = [
    "https://s.yimg.com/cv/apiv2/default/stock-logo/AAPL.png",
    "https://logo.clearbit.com/apple.com",
    "https://logo.clearbit.com/tdsynnex.com",
  ];
  for (const url of yahooUrls) {
    console.log(url, (await ok(url)) ? "OK" : "FAIL");
  }
}

main().catch(console.error);
