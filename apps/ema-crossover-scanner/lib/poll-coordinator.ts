/** Single tick dispatches at most one poll task — avoids parallel client intervals. */

export interface PollSlot {
  name: string;
  intervalMs: number;
  run: () => void | Promise<void>;
  enabled?: () => boolean;
}

export function createPollCoordinator(options: {
  tickMs?: number;
  isPaused?: () => boolean;
}) {
  const tickMs = options.tickMs ?? 20_000;
  const slots: Array<PollSlot & { lastRun: number }> = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let cursor = 0;

  function register(slot: PollSlot): void {
    slots.push({ ...slot, lastRun: 0 });
  }

  async function tick(): Promise<void> {
    if (options.isPaused?.()) return;
    if (slots.length === 0) return;

    const now = Date.now();
    for (let i = 0; i < slots.length; i += 1) {
      const idx = (cursor + i) % slots.length;
      const slot = slots[idx];
      if (slot.enabled && !slot.enabled()) continue;
      if (now - slot.lastRun < slot.intervalMs) continue;
      slot.lastRun = now;
      cursor = (idx + 1) % slots.length;
      await slot.run();
      return;
    }
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => {
      void tick();
    }, tickMs);
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { register, start, stop, tick };
}
