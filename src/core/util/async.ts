/** Timing and concurrency helpers. */

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Races a promise against a timer.
 *
 * The timer is always cleared, including on the success path — 1.x leaked a
 * pending `setTimeout` per call, which kept Node/Electron timers alive.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 시간 초과 (${Math.round(ms / 1000)}초)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * Serialises async work behind a single lock.
 *
 * Image generation must never run concurrently: NovelAI rejects overlapping
 * requests and ComfyUI queues them unpredictably.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    // Swallow rejection on the chain so one failure cannot poison the queue.
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

/**
 * Runs tasks with bounded concurrency, preserving result order.
 * Used for image warming, where unbounded parallelism would stall the UI thread.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return out;
}
