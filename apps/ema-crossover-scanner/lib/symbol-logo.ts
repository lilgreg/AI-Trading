/** Strip exchange prefix (NYSE:AAPL → aapl) for TradingView logo CDN. */
export function logoTickerSlug(
  displayTicker: string,
  tradingViewSymbol?: string | null,
): string {
  const raw = tradingViewSymbol?.trim() || displayTicker.trim();
  const ticker = raw.includes(":") ? raw.split(":", 2)[1] : raw;
  return ticker.toLowerCase();
}

/** TradingView symbol logo CDN — lowercase ticker, no exchange prefix. */
export function tradingViewLogoUrl(
  displayTicker: string,
  tradingViewSymbol?: string | null,
): string {
  const slug = logoTickerSlug(displayTicker, tradingViewSymbol);
  return `https://s3-symbol-logo.tradingview.com/${slug}.svg`;
}

export function logoInitials(ticker: string): string {
  const letters = ticker.replace(/[^A-Za-z0-9]/g, "");
  return (letters.slice(0, 2) || "?").toUpperCase();
}
