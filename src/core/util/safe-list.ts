/**
 * A SafeDOM list (a SafeClassArray) as a plain array, its items asked for together.
 *
 * Risu's own `unwarpSafeArray` (apiV3/factory.ts) asks for the length and then for each item in turn, every one
 * its own round trip across the plugin bridge: a list of n costs n + 1 waits, one after another (a TTS scan over
 * a chat's line buttons waited hundreds of times). Asked together, the requests are in flight at once and the
 * host answers them back to back: two waits. A long list goes in waves, so one list never fills the host's queue
 * ahead of Risu's own work for long.
 */
export const SAFE_LIST_WAVE = 64;

export async function safeList<T>(list: SafeClassArray<T> | T[] | null | undefined): Promise<T[]> {
  if (!list) return [];
  // PocketRisu can return an ordinary array from SafeDOM and observer callbacks.
  if (Array.isArray(list)) return list;
  const n = Number(await list.length()) || 0, out: T[] = [];
  for (let start = 0; start < n; start += SAFE_LIST_WAVE) {
    const wave = await Promise.all(Array.from({ length: Math.min(SAFE_LIST_WAVE, n - start) }, (_, i) => list.at(start + i)));
    for (const item of wave) if (item !== undefined && item !== null) out.push(item);
  }
  return out;
}
