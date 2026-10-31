/**
 * SafeElement helpers for the viewer. Every call is a bridge round trip, so these
 * read as little as they can: a list is never walked whole when one row will do.
 */

// Risu's SafeElement methods may answer synchronously (release() returns nothing there):
// never chain on their result, wrap it.
export const quiet = (value: unknown): Promise<unknown> => Promise.resolve(value).catch(() => undefined);
export async function release(value: unknown): Promise<void> {
  const r = value && typeof value === 'object' ? Reflect.get(value, 'release') : null;
  if (typeof r === 'function') await quiet((() => { try { return r.call(value); } catch { return undefined; } })());
}

/** Scrolls a row to the middle of its list; a host without scrollIntoView leaves it where it is. */
export async function centerIn(node: SafeElement): Promise<void> {
  const scroll = Reflect.get(node, 'scrollIntoView');
  if (typeof scroll === 'function') await quiet((() => { try { return scroll.call(node, { block: 'center' }); } catch { return undefined; } })());
}

export async function unwrap<T>(list: SafeClassArray<T> | T[]): Promise<T[]> {
  if (Array.isArray(list)) return list;
  const n = await list.length(), out: T[] = [];
  for (let i = 0; i < n; i++) { const item = await list.at(i); if (item) out.push(item); }
  return out;
}

/**
 * The row under `y` among a container's rows (in reading order, top to bottom):
 * a binary search that fetches only the rows it looks at, so a list of hundreds
 * costs a handful of calls. -1 when `y` falls on no row.
 */
export async function rowAt(container: SafeElement, selector: string, y: number): Promise<number> {
  const list = await container.querySelectorAll(selector) as SafeClassArray<SafeElement> | SafeElement[];
  const n = Array.isArray(list) ? list.length : await list.length();
  let lo = 0, hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, node = Array.isArray(list) ? list[mid] : await list.at(mid);
    if (!node) return -1;
    let r: DOMRect;
    try { r = await node.getBoundingClientRect(); } finally { await release(node); }
    if (y < r.top) hi = mid - 1; else if (y > r.bottom) lo = mid + 1; else return mid;
  }
  return -1;
}
