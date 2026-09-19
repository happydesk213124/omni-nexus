/**
 * Next NAI seat: smallest ready index that is not done or in-flight.
 */
export function pickNextReadyShot(args: {
  order: readonly number[];
  done: ReadonlySet<number>;
  inflight: ReadonlySet<number>;
  ready: ReadonlySet<number>;
}): number | null {
  const { order, done, inflight, ready } = args;
  let best: number | null = null;
  for (const idx of order) {
    if (done.has(idx) || inflight.has(idx) || !ready.has(idx)) continue;
    if (best == null || idx < best) best = idx;
  }
  return best;
}
