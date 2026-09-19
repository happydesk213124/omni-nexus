/** Payload-free, memory-only counters. Never persist boot diagnostics. */
type Metric = { calls: number; failures: number; totalMs: number };
const metrics = new Map<string, Metric>();
export async function measureWrite<T>(kind: string, cause: string, write: () => Promise<T>): Promise<T> {
  const key = `${kind}:${cause}`;
  const metric = metrics.get(key) || { calls: 0, failures: 0, totalMs: 0 };
  metrics.set(key, metric);
  metric.calls++;
  const start = performance.now();
  try { return await write(); }
  catch (error) { metric.failures++; throw error; }
  finally { metric.totalMs += performance.now() - start; }
}
export function writeMetrics(): Record<string, Metric> {
  return Object.fromEntries([...metrics].map(([key,value])=>[key,{...value}]));
}
