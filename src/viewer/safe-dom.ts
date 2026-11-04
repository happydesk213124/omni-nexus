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

/**
 * How a row is scrolled into its list. A plain scroll into view moves every scroller it is
 * in, the page and a phone's visible viewport too: the whole screen slid up under the
 * finger. `container: 'nearest'` keeps it to the list (Chromium 140+); an engine without it
 * gets the least move instead, none at all when the row is already in sight. Risu passes
 * the options through as they are.
 */
let listOnly: boolean | undefined;
export function scrollOptions(): ScrollIntoViewOptions {
  if (listOnly === undefined) {
    listOnly = false;
    // The engine reads every option it knows: the getter runs only where `container` is one.
    try { document.createElement('div').scrollIntoView({ get container() { listOnly = true; return 'nearest'; } } as ScrollIntoViewOptions); } catch { /* an engine without it */ }
  }
  return listOnly ? { block: 'center', container: 'nearest' } as ScrollIntoViewOptions : { block: 'nearest' };
}
/** Scrolls a row to the middle of its list, and only its list; a host without scrollIntoView leaves it where it is. */
export async function centerIn(node: SafeElement): Promise<void> {
  const scroll = Reflect.get(node, 'scrollIntoView');
  if (typeof scroll === 'function') await quiet((() => { try { return scroll.call(node, scrollOptions()); } catch { return undefined; } })());
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

/**
 * The row at `y`, or the nearest when `y` falls between rows, among rows drawn top to
 * bottom or bottom to top (`upward`: a column-reverse list, as Risu's chat, newest first).
 * A binary search, a few calls for hundreds. The node is the caller's to release; null
 * when there are no rows.
 */
export async function nearestRow(container: SafeElement | SafeDocument, selector: string, y: number, upward = false): Promise<SafeElement | null> {
  const list = await container.querySelectorAll(selector) as SafeClassArray<SafeElement> | SafeElement[];
  const n = Array.isArray(list) ? list.length : await list.length();
  let lo = 0, hi = n - 1, best: SafeElement | null = null, gapOfBest = Infinity;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, node = Array.isArray(list) ? list[mid] : await list.at(mid);
    if (!node) break;
    const r = await node.getBoundingClientRect();
    const gap = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (gap < gapOfBest) { await release(best); best = node; gapOfBest = gap; } else await release(node);
    if (!gap) break;
    // Above this row: earlier in a list drawn downward, later in one drawn upward.
    if ((y < r.top) !== upward) hi = mid - 1; else lo = mid + 1;
  }
  return best;
}
