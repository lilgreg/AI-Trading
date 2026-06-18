export interface OhlcBar {
  date: Date;
  open?: number;
  high?: number;
  low?: number;
  close: number;
}

export interface CrossoverInfo {
  date: Date;
  msAgo: number;
}

function isBullishCross(
  emaFast: number[],
  emaSlow: number[],
  index: number,
): boolean {
  const prevFast = emaFast[index - 1];
  const prevSlow = emaSlow[index - 1];
  const currFast = emaFast[index];
  const currSlow = emaSlow[index];

  if (
    Number.isNaN(prevFast) ||
    Number.isNaN(prevSlow) ||
    Number.isNaN(currFast) ||
    Number.isNaN(currSlow)
  ) {
    return false;
  }

  return prevFast <= prevSlow && currFast > currSlow;
}

function isBearishCross(
  emaFast: number[],
  emaSlow: number[],
  index: number,
): boolean {
  const prevFast = emaFast[index - 1];
  const prevSlow = emaSlow[index - 1];
  const currFast = emaFast[index];
  const currSlow = emaSlow[index];

  if (
    Number.isNaN(prevFast) ||
    Number.isNaN(prevSlow) ||
    Number.isNaN(currFast) ||
    Number.isNaN(currSlow)
  ) {
    return false;
  }

  return prevFast >= prevSlow && currFast < currSlow;
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
 * Most recent bullish cross where 20 EMA crossed back above 50 EMA
 * after a prior bearish cross (full under → over cycle).
 */
export function findMostRecentBullishCrossover(
  bars: OhlcBar[],
  fastPeriod: number,
  slowPeriod: number,
): CrossoverInfo | null {
  const closes = bars.map((b) => b.close);
  const emaFast = calculateEma(closes, fastPeriod);
  const emaSlow = calculateEma(closes, slowPeriod);

  for (let i = bars.length - 1; i >= 1; i--) {
    if (!isBullishCross(emaFast, emaSlow, i)) continue;

    for (let j = i - 1; j >= 1; j--) {
      if (isBullishCross(emaFast, emaSlow, j)) break;
      if (isBearishCross(emaFast, emaSlow, j)) {
        return crossoverAtBar(bars, i);
      }
    }
  }

  // Fallback: most recent simple 20/50 bullish cross (no prior bearish cycle required).
  for (let i = bars.length - 1; i >= 1; i--) {
    if (isBullishCross(emaFast, emaSlow, i)) {
      return crossoverAtBar(bars, i);
    }
  }

  return null;
}

/**
 * When EMA20 is currently below EMA50, find the start of the most recent historical
 * stretch where fast was above slow (discrete cross preferred, else period start).
 */
export function findLastAbovePeriodStart(
  bars: OhlcBar[],
  fastPeriod: number,
  slowPeriod: number,
): CrossoverInfo | null {
  const closes = bars.map((b) => b.close);
  const emaFast = calculateEma(closes, fastPeriod);
  const emaSlow = calculateEma(closes, slowPeriod);

  for (let i = bars.length - 1; i >= slowPeriod; i -= 1) {
    const fast = emaFast[i];
    const slow = emaSlow[i];
    if (Number.isNaN(fast) || Number.isNaN(slow) || fast <= slow) continue;

    let periodStart = i;
    for (let j = i - 1; j >= slowPeriod; j -= 1) {
      const prevFast = emaFast[j];
      const prevSlow = emaSlow[j];
      if (Number.isNaN(prevFast) || Number.isNaN(prevSlow) || prevFast <= prevSlow) break;
      periodStart = j;
    }

    for (let j = periodStart; j <= i && j >= 1; j += 1) {
      if (isBullishCross(emaFast, emaSlow, j)) {
        return crossoverAtBar(bars, j);
      }
    }

    return crossoverAtBar(bars, periodStart);
  }

  return null;
}

/**
 * When EMA20 has stayed above EMA50 for the entire lookback (no discrete cross bar),
 * return the first bar in the window where fast > slow.
 */
export function findEarliestBullishAbove(
  bars: OhlcBar[],
  fastPeriod: number,
  slowPeriod: number,
): CrossoverInfo | null {
  const closes = bars.map((b) => b.close);
  const emaFast = calculateEma(closes, fastPeriod);
  const emaSlow = calculateEma(closes, slowPeriod);

  for (let i = slowPeriod; i < bars.length; i += 1) {
    const fast = emaFast[i];
    const slow = emaSlow[i];
    if (!Number.isNaN(fast) && !Number.isNaN(slow) && fast > slow) {
      return crossoverAtBar(bars, i);
    }
  }

  return null;
}

/** Most recent bullish cross, or earliest bar above when still above with no discrete cross. */
export function resolveBullishCrossover(
  bars: OhlcBar[],
  fastPeriod: number,
  slowPeriod: number,
  fastAboveSlow: boolean,
): CrossoverInfo | null {
  return (
    findMostRecentBullishCrossover(bars, fastPeriod, slowPeriod) ??
    (fastAboveSlow
      ? findEarliestBullishAbove(bars, fastPeriod, slowPeriod)
      : findLastAbovePeriodStart(bars, fastPeriod, slowPeriod))
  );
}

function crossoverAtBar(bars: OhlcBar[], index: number): CrossoverInfo {
  const ref = bars[bars.length - 1]?.date ?? new Date();
  return {
    date: bars[index].date,
    msAgo: ref.getTime() - bars[index].date.getTime(),
  };
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

export function formatCrossoverDateTime(date: Date): {
  crossoverDate: string;
  crossoverTime: string;
} {
  return {
    crossoverDate: date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    crossoverTime: date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }),
  };
}

export function formatMsAgo(msAgo: number): string {
  const minutes = Math.floor(msAgo / 60000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (remHours === 0) return `${days}d ago`;
  return `${days}d ${remHours}h ago`;
}
