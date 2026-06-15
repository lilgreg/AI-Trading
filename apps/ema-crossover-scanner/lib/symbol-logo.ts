const TV_LOGO_BASE = "https://s3-symbol-logo.tradingview.com";
const YAHOO_LOGO_BASE = "https://s.yimg.com/cv/apiv2/default/stock-logo";

/** ETFs / indices that rarely have usable CDN logos — show initials badge. */
const INITIALS_ONLY_TICKERS = new Set([
  "SPY",
  "QQQ",
  "IWM",
  "DIA",
  "VIX",
  "VTI",
  "VOO",
  "IVV",
  "AGG",
  "BND",
  "GLD",
  "SLV",
  "TLT",
  "HYG",
  "LQD",
  "EEM",
  "EFA",
  "VEA",
  "VWO",
  "ARKK",
  "XLF",
  "XLK",
  "XLE",
  "XLV",
  "XLI",
  "XLP",
  "XLY",
  "XLU",
  "XLB",
  "XLRE",
  "XLC",
  "SMH",
  "SOXX",
  "KWEB",
  "FXI",
  "EWJ",
  "EWZ",
  "TQQQ",
  "SQQQ",
  "UVXY",
  "VXX",
]);

/** Known ticker → company domain for Clearbit (skip when unknown). */
const TICKER_DOMAINS: Record<string, string> = {
  AAPL: "apple.com",
  MSFT: "microsoft.com",
  GOOGL: "google.com",
  GOOG: "google.com",
  AMZN: "amazon.com",
  META: "meta.com",
  NVDA: "nvidia.com",
  TSLA: "tesla.com",
  BRK: "berkshirehathaway.com",
  "BRK-B": "berkshirehathaway.com",
  "BRK.B": "berkshirehathaway.com",
  JPM: "jpmorganchase.com",
  V: "visa.com",
  MA: "mastercard.com",
  JNJ: "jnj.com",
  WMT: "walmart.com",
  PG: "pg.com",
  UNH: "unitedhealthgroup.com",
  HD: "homedepot.com",
  BAC: "bankofamerica.com",
  XOM: "exxonmobil.com",
  CVX: "chevron.com",
  KO: "coca-cola.com",
  PEP: "pepsico.com",
  COST: "costco.com",
  DIS: "disney.com",
  NFLX: "netflix.com",
  AMD: "amd.com",
  INTC: "intel.com",
  CRM: "salesforce.com",
  ORCL: "oracle.com",
  ADBE: "adobe.com",
  CSCO: "cisco.com",
  IBM: "ibm.com",
  GS: "goldmansachs.com",
  MS: "morganstanley.com",
  CAT: "cat.com",
  BA: "boeing.com",
  GE: "ge.com",
  SNX: "tdsynnex.com",
  TSM: "tsmc.com",
  ARTY: "ishares.com",
  SPY: "ssga.com",
  QQQ: "invesco.com",
};

const LOGO_BADGE_COLORS = [
  "#2962ff",
  "#089981",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#ea580c",
  "#4f46e5",
  "#0d9488",
];

/** Strip exchange prefix (NYSE:AAPL → AAPL). */
export function stripExchangeTicker(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.includes(":") ? trimmed.split(":", 2)[1] : trimmed;
}

/** Strip exchange prefix (NYSE:AAPL → aapl) for TradingView logo CDN. */
export function logoTickerSlug(
  displayTicker: string,
  tradingViewSymbol?: string | null,
): string {
  return stripExchangeTicker(tradingViewSymbol?.trim() || displayTicker.trim()).toLowerCase();
}

function yahooTickerKey(ticker: string): string {
  return stripExchangeTicker(ticker).replace(/\./g, "-").toUpperCase();
}

function tickerSlugVariants(ticker: string): string[] {
  const base = stripExchangeTicker(ticker);
  const lower = base.toLowerCase();
  const variants = new Set<string>();

  variants.add(lower);
  variants.add(lower.replace(/\./g, "-"));
  variants.add(lower.replace(/-/g, "."));
  variants.add(lower.replace(/[^a-z0-9]/g, ""));

  return [...variants].filter(Boolean);
}

function cryptoTvLogoUrls(ticker: string): string[] {
  const upper = stripExchangeTicker(ticker).toUpperCase();
  const urls: string[] = [];

  const cryptoMap: Record<string, string[]> = {
    BTC: ["XTVCBTC", "bitcoin"],
    BTCUSD: ["XTVCBTC", "bitcoin"],
    ETH: ["XTVCETH", "ethereum"],
    ETHUSD: ["XTVCETH", "ethereum"],
    SOL: ["XTVCSOL", "solana"],
    DOGE: ["XTVCDOGE", "dogecoin"],
    XRP: ["XTVCXRP", "ripple"],
    ADA: ["XTVCADA", "cardano"],
  };

  const keys = [upper];
  if (upper.endsWith("USD") && upper.length > 3) {
    keys.push(upper.slice(0, -3));
  }

  for (const key of keys) {
    const slugs = cryptoMap[key];
    if (!slugs) continue;
    for (const slug of slugs) {
      urls.push(`${TV_LOGO_BASE}/crypto/${slug}.svg`);
      urls.push(`${TV_LOGO_BASE}/${slug}.svg`);
    }
  }

  return urls;
}

function tradingViewLogoUrls(
  displayTicker: string,
  tradingViewSymbol?: string | null,
): string[] {
  const raw = tradingViewSymbol?.trim() || displayTicker.trim();
  const urls: string[] = [];

  for (const slug of tickerSlugVariants(raw)) {
    urls.push(`${TV_LOGO_BASE}/${slug}.svg`);
  }

  urls.push(...cryptoTvLogoUrls(raw));

  return urls;
}

function yahooLogoUrl(yahooTicker: string): string {
  return `${YAHOO_LOGO_BASE}/${yahooTickerKey(yahooTicker)}.png`;
}

function clearbitLogoUrl(ticker: string): string | null {
  const key = yahooTickerKey(ticker);
  const domain = TICKER_DOMAINS[key];
  if (!domain) return null;
  return `https://logo.clearbit.com/${domain}`;
}

export function shouldUseInitialsOnly(ticker: string): boolean {
  return INITIALS_ONLY_TICKERS.has(yahooTickerKey(ticker));
}

/** TradingView symbol logo CDN — primary slug (legacy helper). */
export function tradingViewLogoUrl(
  displayTicker: string,
  tradingViewSymbol?: string | null,
): string {
  const slug = logoTickerSlug(displayTicker, tradingViewSymbol);
  return `${TV_LOGO_BASE}/${slug}.svg`;
}

/** Ordered fallback URLs — duplicates removed. */
export function buildLogoUrlChain(
  displayTicker: string,
  tradingViewSymbol?: string | null,
  yahooSymbol?: string | null,
  logoUrl?: string | null,
): string[] {
  const yahoo = yahooSymbol ?? displayTicker;
  const urls: string[] = [];

  if (logoUrl?.trim()) {
    urls.push(logoUrl.trim());
  }

  if (!shouldUseInitialsOnly(yahoo)) {
    urls.push(...tradingViewLogoUrls(displayTicker, tradingViewSymbol));
    urls.push(yahooLogoUrl(yahoo));
    const clearbit = clearbitLogoUrl(yahoo);
    if (clearbit) urls.push(clearbit);
  }

  return [...new Set(urls)];
}

/** Best-effort primary URL for server-side cache (no network probe). */
export function pickPrimaryLogoUrl(
  displayTicker: string,
  tradingViewSymbol?: string | null,
  yahooSymbol?: string | null,
): string | null {
  const chain = buildLogoUrlChain(displayTicker, tradingViewSymbol, yahooSymbol);
  return chain[0] ?? null;
}

export function logoInitials(ticker: string): string {
  const letters = stripExchangeTicker(ticker).replace(/[^A-Za-z0-9]/g, "");
  return (letters.slice(0, 2) || "?").toUpperCase();
}

export function logoBadgeColor(ticker: string): string {
  const key = stripExchangeTicker(ticker);
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return LOGO_BADGE_COLORS[Math.abs(hash) % LOGO_BADGE_COLORS.length];
}
