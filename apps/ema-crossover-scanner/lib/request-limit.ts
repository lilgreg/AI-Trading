/** Shared concurrency + stagger for external market-data APIs. */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ConcurrencyLimiter {
  private active = 0;
  private queue: Array<() => void> = [];
  private lastStartMs = 0;

  constructor(
    private readonly maxConcurrent: number,
    private readonly minGapMs: number,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      await this.waitForGap();
      this.active += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.queue.push(() => {
        void this.waitForGap().then(() => {
          this.active += 1;
          resolve();
        });
      });
    });
  }

  private async waitForGap(): Promise<void> {
    const elapsed = Date.now() - this.lastStartMs;
    if (elapsed < this.minGapMs) {
      await sleep(this.minGapMs - elapsed);
    }
    this.lastStartMs = Date.now();
  }

  private release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

/** Yahoo chart/quote requests — keep low to avoid 429/timeouts after ~120 symbols. */
export const yahooLimiter = new ConcurrencyLimiter(4, 300);

/** Optional paid/backup APIs — slightly higher concurrency. */
export const backupLimiter = new ConcurrencyLimiter(3, 400);

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    attempts?: number;
    baseDelayMs?: number;
    label?: string;
    shouldRetry?: (err: unknown) => boolean;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 800;
  const label = options.label ?? "request";
  const shouldRetry =
    options.shouldRetry ??
    ((err: unknown) => {
      const message = err instanceof Error ? err.message.toLowerCase() : String(err);
      return (
        message.includes("timed out") ||
        message.includes("timeout") ||
        message.includes("429") ||
        message.includes("rate") ||
        message.includes("too many") ||
        message.includes("econnreset") ||
        message.includes("socket hang up") ||
        message.includes("503") ||
        message.includes("502")
      );
    });

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !shouldRetry(err)) break;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${label} failed after ${attempts} attempts`);
}
