import YahooFinance from "yahoo-finance2";
import type { OhlcBar } from "./ema";

const yahooFinance = new YahooFinance();

export async function fetchHistoricalBars(
  symbol: string,
  days: number,
): Promise<OhlcBar[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days - 30);

  const rows = await yahooFinance.historical(symbol, {
    period1: start,
    period2: end,
    interval: "1d",
  });

  return rows
    .filter((row) => row.close != null)
    .map((row) => ({
      date: row.date,
      close: row.close as number,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export async function fetchQuoteMeta(symbol: string): Promise<{
  name: string | null;
  price: number | null;
  exchange: string | null;
}> {
  try {
    const quote = await yahooFinance.quote(symbol);
    return {
      name: quote.longName ?? quote.shortName ?? null,
      price: quote.regularMarketPrice ?? null,
      exchange: quote.fullExchangeName ?? quote.exchange ?? null,
    };
  } catch {
    return { name: null, price: null, exchange: null };
  }
}
