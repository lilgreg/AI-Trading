import {
  filterSessionChangesForMarket,
  getUsMarketSession,
  type SessionChanges,
  type UsMarketSession,
} from "./market-session";

export interface DailyChangeQuotePrices {
  previousClose: number | null;
  preMarketPrice?: number | null;
  regularMarketPrice?: number | null;
  postMarketPrice?: number | null;
}

function percentChange(current: number, base: number): number | null {
  if (base === 0) return null;
  return ((current - base) / base) * 100;
}

function currentPriceForSession(
  prices: DailyChangeQuotePrices,
  session: UsMarketSession,
): number | null {
  const pre = prices.preMarketPrice ?? null;
  const reg = prices.regularMarketPrice ?? null;
  const post = prices.postMarketPrice ?? null;

  switch (session) {
    case "pre":
      return pre;
    case "regular":
      return reg;
    case "afterHours":
      return post ?? reg;
    case "closed":
      return post ?? reg ?? pre;
  }
}

/** Full-day % vs previous close: (currentPrice - previousClose) / previousClose * 100. */
export function computeDailyChangeFromPrices(
  prices: DailyChangeQuotePrices,
  session: UsMarketSession = getUsMarketSession(),
): number | null {
  const { previousClose } = prices;
  if (previousClose == null) return null;

  const current = currentPriceForSession(prices, session);
  if (current == null) return null;

  return percentChange(current, previousClose);
}

/** Combined daily % from session fields, respecting active market session. */
export function computeDailyChange(
  preMarketChange: number | null,
  regularMarketChange: number | null,
  postMarketChange: number | null,
  prices?: DailyChangeQuotePrices,
): number | null {
  if (prices?.previousClose != null) {
    const fromPrices = computeDailyChangeFromPrices(prices);
    if (fromPrices != null) return fromPrices;
  }

  const filtered = filterSessionChangesForMarket({
    preMarketChange,
    regularMarketChange,
    postMarketChange,
  } satisfies SessionChanges);

  const session = getUsMarketSession();

  if (
    session === "afterHours" &&
    filtered.regularMarketChange != null &&
    filtered.postMarketChange != null
  ) {
    return (
      ((1 + filtered.regularMarketChange / 100) * (1 + filtered.postMarketChange / 100) -
        1) *
      100
    );
  }

  if (filtered.regularMarketChange != null) return filtered.regularMarketChange;
  if (filtered.preMarketChange != null) return filtered.preMarketChange;
  return null;
}
