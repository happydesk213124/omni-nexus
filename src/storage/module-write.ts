// Risu replaces the entire modules array. All plugin module writers share this queue.
let tail: Promise<unknown> = Promise.resolve();
export function serializeModuleWrite<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work);
  tail = result.catch(() => undefined);
  return result;
}
