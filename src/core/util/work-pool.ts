/** Bound expensive byte work without making unrelated jobs await one global tail. */
export function workPool(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(work: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>(resolve => waiting.push(resolve));
    else active++;
    try { return await work(); }
    finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
