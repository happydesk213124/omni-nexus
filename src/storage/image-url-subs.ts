/**
 * Per-id notification for display URLs.
 *
 * Inline shots insert their markers before the bytes exist and then wait on
 * their own id, rather than re-running the whole paint pass until the image
 * happens to be ready. `onWarmProgress` cannot serve this: the frozen UI owns
 * that single callback, and it reports wave totals rather than which id landed.
 */

export type ImageUrlListener = (id: string, url: string) => void;

const subs = new Map<string, Set<ImageUrlListener>>();

function idList(ids: unknown): string[] {
  const raw = Array.isArray(ids) ? ids : [ids];
  return [...new Set(raw.map((v) => String(v ?? '')).filter(Boolean))];
}

/** Fans out to everyone waiting on `id`. A throwing painter must not stall the encode pump. */
export function notifyImageUrl(id: unknown, url: unknown): void {
  const key = String(id ?? '');
  const src = String(url ?? '');
  if (!key || !src) return;
  const set = subs.get(key);
  if (!set?.size) return;
  // Copied because a listener is allowed to unsubscribe itself once painted.
  for (const cb of [...set]) {
    try {
      cb(key, src);
    } catch {
      /* one bad painter must not cancel the others */
    }
  }
}

/**
 * Watches `ids` until the returned function runs.
 *
 * `cached` replays ids that already resolved, so a subscriber that arrives
 * after the encode finished still paints instead of waiting for an event that
 * will never come again.
 */
export function subscribeImageUrl(
  ids: unknown,
  cb: ImageUrlListener,
  cached?: (id: string) => string,
): () => void {
  if (typeof cb !== 'function') return () => {};
  const list = idList(ids);
  if (!list.length) return () => {};

  for (const id of list) {
    let set = subs.get(id);
    if (!set) {
      set = new Set();
      subs.set(id, set);
    }
    set.add(cb);
  }

  let live = true;
  const stop = (): void => {
    if (!live) return;
    live = false;
    for (const id of list) {
      const set = subs.get(id);
      if (!set) continue;
      set.delete(cb);
      if (!set.size) subs.delete(id);
    }
  };

  if (typeof cached === 'function') {
    for (const id of list) {
      let url = '';
      try {
        url = String(cached(id) || '');
      } catch {
        url = '';
      }
      if (!url) continue;
      try {
        cb(id, url);
      } catch {
        /* replay must not throw out of subscribe */
      }
    }
  }

  return stop;
}

/** Live watcher count. Guards assert this returns to zero so paints cannot leak listeners. */
export function imageUrlSubCount(): number {
  let n = 0;
  for (const set of subs.values()) n += set.size;
  return n;
}

/** Test seam only — production never drops watchers wholesale. */
export function resetImageUrlSubs(): void {
  subs.clear();
}
