export interface OhlcBar {
  date: Date;
  close: number;
}

export interface CrossoverInfo {
  date: Date;
  daysAgo: number;
}

/** Exponential moving average (SMA seed for first valid value) */
export function calculateEma(closes: number[], period: number): number[] {
  if (closes.length === 0) return [];

  const k = 2 / (period + 1);
  const result: number[] = new Array(closes.length).fill(NaN);

  if (closes.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  let ema = sum / period;
  result[period - 1] = ema;

  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result[i] = ema;
  }

  return result;
}

/**
 * Find the most recent bar where EMA(fast) crossed above EMA(slow).
 * Returns null if no bullish crossover in the series.
 */
export function findMostRecentBullishCrossover(
  bars: OhlcBar[],
  fastPeriod: number,
  slowPeriod: number,
): CrossoverInfo | null {
  const closes = bars.map((b) => b.close);
  const emaFast = calculateEma(closes, fastPeriod);
  const emaSlow = calculateEma(closes, slowPeriod);

  let latest: Date | null = null;

  for (let i = 1; i < bars.length; i++) {
    const prevFast = emaFast[i - 1];
    const prevSlow = emaSlow[i - 1];
    const currFast = emaFast[i];
    const currSlow = emaSlow[i];

    if (
      Number.isNaN(prevFast) ||
      Number.isNaN(prevSlow) ||
      Number.isNaN(currFast) ||
      Number.isNaN(currSlow)
    ) {
      continue;
    }

    if (prevFast <= prevSlow && currFast > currSlow) {
      latest = bars[i].date;
    }
  }

  if (!latest) return null;

  const today = bars[bars.length - 1]?.date ?? new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysAgo = Math.round((today.getTime() - latest.getTime()) / msPerDay);

  return { date: latest, daysAgo };
}

export function latestEmaValues(
  closes: number[],
  fastPeriod: number,
  slowPeriod: number,
): { emaFast: number | null; emaSlow: number | null; fastAboveSlow: boolean } {
  const emaFast = calculateEma(closes, fastPeriod);
  const emaSlow = calculateEma(closes, slowPeriod);

  const lastFast = emaFast.at(-1);
  const lastSlow = emaSlow.at(-1);

  if (lastFast == null || lastSlow == null || Number.isNaN(lastFast) || Number.isNaN(lastSlow)) {
    return { emaFast: null, emaSlow: null, fastAboveSlow: false };
  }

  return {
    emaFast: lastFast,
    emaSlow: lastSlow,
    fastAboveSlow: lastFast > lastSlow,
  };
}
