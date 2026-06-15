const TV_LOGO_BASE = "https://s3-symbol-logo.tradingview.com";
const YAHOO_LOGO_BASE = "https://s.yimg.com/cv/apiv2/default/stock-logo";
const FINNHUB_LOGO_BASE =
  "https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo";

/** Only skip image probes when every URL is expected to fail (pure volatility indices). */
const INITIALS_ONLY_TICKERS = new Set(["VIX"]);

/** Known ticker → TradingView logoid slug (company name, not ticker). */
const TICKER_LOGOID: Record<string, string> = {
  SNX: "synnex",
  "BRK-B": "berkshire-hathaway",
  "BRK.B": "berkshire-hathaway",
  BRK: "berkshire-hathaway",
  KO: "coca-cola",
  JPM: "jpmorgan-chase",
  META: "meta-platforms",
  GOOG: "alphabet",
  GOOGL: "alphabet",
  SPY: "spdr-s-and-p-500-etf-trust",
  QQQ: "invesco-qqq-trust",
  IWM: "ishares-russell-2000-etf",
  DIA: "spdr-dow-jones-industrial-average-etf-trust",
  ARTY: "ishares-future-ai-tech-etf",
  TSM: "taiwan-semiconductor",
};

/** TradingView exchange prefix for {exchange}-{symbol} logo URLs. */
const TV_EXCHANGE_CODE: Record<string, string> = {
  NASDAQ: "XNAS",
  NYSE: "XNYS",
  AMEX: "XASE",
  CBOE: "XCBO",
  OTC: "OTC",
};

/** Known ticker → company domain for Clearbit (best-effort fallback). */
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

const LOGOID_CACHE = new Map<string, string | null>();
const LOGO_PROBE_TIMEOUT_MS = 2_500;

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

function parseTvSymbol(
  tradingViewSymbol?: string | null,
): { exchange: string | null; ticker: string } {
  const raw = tradingViewSymbol?.trim() ?? "";
  if (!raw.includes(":")) {
    return { exchange: null, ticker: stripExchangeTicker(raw) };
  }
  const [exchange, ticker] = raw.split(":", 2);
  return { exchange: exchange.toUpperCase(), ticker: stripExchangeTicker(ticker) };
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

/** Derive TradingView logoid slugs from a company / fund name. */
export function companyNameToLogoSlugs(name: string): string[] {
  const slugs = new Set<string>();
  let cleaned = name.trim();
  if (!cleaned) return [];

  cleaned = cleaned.replace(/^the\s+/i, "").replace(/\s+/g, " ");

  const corpSuffix =
    /\s+(Inc\.?|Corp\.?|Corporation|Company|Co\.?|Ltd\.?|Limited|PLC|LP|LLC|Holdings?|Group|N\.?V\.?|S\.?A\.?)\.?$/i;

  const variants = [cleaned, cleaned.replace(corpSuffix, "").trim()];
  if (/ishares/i.test(cleaned)) variants.push("ishares");
  if (/spdr/i.test(cleaned)) variants.push("spdr-s-and-p-500-etf-trust", "ssga-spdr");
  if (/invesco/i.test(cleaned) && /qqq/i.test(cleaned)) variants.push("invesco-qqq-trust");
  if (/vanguard/i.test(cleaned)) variants.push("vanguard");

  for (const base of variants) {
    if (!base) continue;
    const slug = base
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug) slugs.add(slug);
  }

  return [...slugs];
}

function tvLogoidUrls(logoid: string): string[] {
  const id = logoid.trim().toLowerCase();
  if (!id) return [];
  return [
    `${TV_LOGO_BASE}/${id}.svg`,
    `${TV_LOGO_BASE}/${id}.png`,
    `${TV_LOGO_BASE}/${id}--600.png`,
    `${TV_LOGO_BASE}/${id}--big.svg`,
  ];
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

function exchangePrefixedLogoUrls(tradingViewSymbol?: string | null): string[] {
  const { exchange, ticker } = parseTvSymbol(tradingViewSymbol);
  if (!exchange || !ticker) return [];

  const tvCode = TV_EXCHANGE_CODE[exchange] ?? exchange;
  const upperTicker = ticker.toUpperCase().replace(/\./g, "-");
  const urls: string[] = [];

  for (const prefix of [tvCode, exchange]) {
    urls.push(`${TV_LOGO_BASE}/${prefix}-${upperTicker}.svg`);
    urls.push(`${TV_LOGO_BASE}/${prefix}-${upperTicker}.png`);
  }

  return urls;
}

function tradingViewLogoUrls(
  displayTicker: string,
  tradingViewSymbol?: string | null,
  logoids: string[] = [],
): string[] {
  const raw = tradingViewSymbol?.trim() || displayTicker.trim();
  const urls: string[] = [];

  for (const logoid of logoids) {
    urls.push(...tvLogoidUrls(logoid));
  }

  for (const slug of tickerSlugVariants(raw)) {
    urls.push(`${TV_LOGO_BASE}/${slug}.svg`);
    urls.push(`${TV_LOGO_BASE}/${slug}.png`);
    urls.push(`${TV_LOGO_BASE}/${slug}--600.png`);
  }

  urls.push(...exchangePrefixedLogoUrls(tradingViewSymbol));
  urls.push(...cryptoTvLogoUrls(raw));

  return urls;
}

function yahooLogoUrl(yahooTicker: string): string {
  return `${YAHOO_LOGO_BASE}/${yahooTickerKey(yahooTicker)}.png`;
}

function finnhubLogoUrl(ticker: string): string {
  return `${FINNHUB_LOGO_BASE}/${yahooTickerKey(ticker)}.png`;
}

function fmpLogoUrl(ticker: string): string | null {
  const key = process.env.FMP_API_KEY?.trim();
  if (!key) return null;
  return `https://financialmodelingprep.com/image-stock/${yahooTickerKey(ticker)}.png?apikey=${key}`;
}

function googleFaviconUrl(ticker: string): string | null {
  const key = yahooTickerKey(ticker);
  const domain = TICKER_DOMAINS[key];
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
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
  const key = yahooTickerKey(displayTicker);
  const logoid = TICKER_LOGOID[key];
  if (logoid) return `${TV_LOGO_BASE}/${logoid}.svg`;
  const slug = logoTickerSlug(displayTicker, tradingViewSymbol);
  return `${TV_LOGO_BASE}/${slug}.svg`;
}

function collectLogoids(
  displayTicker: string,
  yahooSymbol?: string | null,
  companyName?: string | null,
  tradingViewLogoid?: string | null,
): string[] {
  const logoids = new Set<string>();
  const yahooKey = yahooTickerKey(yahooSymbol ?? displayTicker);

  const known = TICKER_LOGOID[yahooKey];
  if (known) logoids.add(known);

  if (tradingViewLogoid?.trim()) logoids.add(tradingViewLogoid.trim().toLowerCase());

  if (companyName) {
    for (const slug of companyNameToLogoSlugs(companyName)) {
      logoids.add(slug);
    }
  }

  return [...logoids];
}

/** Ordered fallback URLs — duplicates removed. */
export function buildLogoUrlChain(
  displayTicker: string,
  tradingViewSymbol?: string | null,
  yahooSymbol?: string | null,
  logoUrl?: string | null,
  companyName?: string | null,
  tradingViewLogoid?: string | null,
): string[] {
  const yahoo = yahooSymbol ?? displayTicker;
  const urls: string[] = [];

  if (logoUrl?.trim()) {
    urls.push(logoUrl.trim());
  }

  if (!shouldUseInitialsOnly(yahoo)) {
    const logoids = collectLogoids(
      displayTicker,
      yahoo,
      companyName,
      tradingViewLogoid,
    );
    urls.push(...tradingViewLogoUrls(displayTicker, tradingViewSymbol, logoids));
    urls.push(yahooLogoUrl(yahoo));
    urls.push(finnhubLogoUrl(yahoo));
    const fmp = fmpLogoUrl(yahoo);
    if (fmp) urls.push(fmp);
    const clearbit = clearbitLogoUrl(yahoo);
    if (clearbit) urls.push(clearbit);
    const favicon = googleFaviconUrl(yahoo);
    if (favicon) urls.push(favicon);
  }

  return [...new Set(urls)];
}

async function probeSingleUrl(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "image/*,*/*" },
    });
    if (!response.ok) return false;
    const contentType = response.headers.get("content-type") ?? "";
    return (
      contentType.includes("image") ||
      contentType.includes("svg") ||
      url.endsWith(".svg")
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Return the first URL in the list that responds with an image. */
export async function probeFirstWorkingUrl(
  urls: string[],
  timeoutMs = LOGO_PROBE_TIMEOUT_MS,
): Promise<string | null> {
  const candidates = [...new Set(urls)].filter(Boolean);
  if (candidates.length === 0) return null;

  return new Promise((resolve) => {
    let pending = candidates.length;
    let settled = false;

    for (const url of candidates) {
      probeSingleUrl(url, timeoutMs).then((ok) => {
        if (settled) return;
        if (ok) {
          settled = true;
          resolve(url);
          return;
        }
        pending -= 1;
        if (pending === 0) resolve(null);
      });
    }
  });
}

/** Fetch TradingView logoid from symbol page HTML (cached per TV symbol). */
export async function fetchTradingViewLogoid(
  tradingViewSymbol: string,
): Promise<string | null> {
  const cacheKey = tradingViewSymbol.trim().toUpperCase();
  if (LOGOID_CACHE.has(cacheKey)) {
    return LOGOID_CACHE.get(cacheKey) ?? null;
  }

  const pageSlug = cacheKey.replace(":", "-");
  const pageUrl = `https://www.tradingview.com/symbols/${pageSlug}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(pageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; EMAScanner/1.0; +https://github.com/)",
        Accept: "text/html",
      },
      signal: controller.signal,
      next: { revalidate: 86_400 },
    });

    if (!response.ok) {
      LOGOID_CACHE.set(cacheKey, null);
      return null;
    }

    const html = await response.text();
    const match =
      html.match(/"logoid"\s*:\s*"([^"]+)"/) ??
      html.match(/"logo_id"\s*:\s*"([^"]+)"/);
    const logoid = match?.[1]?.trim().toLowerCase() ?? null;
    LOGOID_CACHE.set(cacheKey, logoid);
    return logoid;
  } catch {
    LOGOID_CACHE.set(cacheKey, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolveLogoUrlOptions {
  displayTicker: string;
  tradingViewSymbol?: string | null;
  yahooSymbol?: string | null;
  companyName?: string | null;
  /** Skip network probes (client-side chain building only). */
  probe?: boolean;
}

/** Resolve a working logo URL during server-side scan. */
export async function resolveLogoUrl(
  options: ResolveLogoUrlOptions,
): Promise<string | null> {
  const {
    displayTicker,
    tradingViewSymbol,
    yahooSymbol,
    companyName,
    probe = true,
  } = options;

  const yahoo = yahooSymbol ?? displayTicker;
  if (shouldUseInitialsOnly(yahoo)) return null;

  const chain = buildLogoUrlChain(
    displayTicker,
    tradingViewSymbol,
    yahoo,
    null,
    companyName,
  );

  if (!probe) return chain[0] ?? null;

  const fromChain = await probeFirstWorkingUrl(chain);
  if (fromChain) return fromChain;

  if (tradingViewSymbol?.includes(":")) {
    const logoid = await fetchTradingViewLogoid(tradingViewSymbol);
    if (logoid) {
      const tvUrls = tvLogoidUrls(logoid);
      const fromTv = await probeFirstWorkingUrl(tvUrls);
      if (fromTv) return fromTv;
    }
  }

  return null;
}

/** Best-effort primary URL for server-side cache (no network probe). */
export function pickPrimaryLogoUrl(
  displayTicker: string,
  tradingViewSymbol?: string | null,
  yahooSymbol?: string | null,
  companyName?: string | null,
): string | null {
  const chain = buildLogoUrlChain(
    displayTicker,
    tradingViewSymbol,
    yahooSymbol,
    null,
    companyName,
  );
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
