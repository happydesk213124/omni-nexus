/**
 * Bounded display-URL cache for explorer / gallery / sticky / inline thumbs.
 *
 * Explorer entries are `blob:` object URLs. Overlay still keeps a separate
 * `data:` map. The budget is source bytes, passed at `set`, not character
 * length: a `blob:` URL is a short string standing for a large buffer, so
 * charging by string length would let an unbounded amount of image data stay
 * resident. Eviction revokes object URLs.
 */

function revokeDisplayUrl(url: string): void {
  if (typeof url !== 'string' || !url.startsWith('blob:')) return;
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* already revoked */
  }
}

export interface BlobUrlCacheStats {
  entries: number;
  bytes: number;
  budget: number;
  pinned: number;
  pin_cap: number;
}

export class BlobUrlCache {
  private readonly urls = new Map<string, string>();
  private readonly costs = new Map<string, number>();
  private readonly pinned = new Set<string>();
  private bytes = 0;

  /**
   * `pinCap` bounds how many ids `pin()` protects. Pinned entries sit outside
   * the budget, so without a cap a wide enough pin set (a reroll-heavy message
   * and its ±2 neighbours) quietly turns the 64MB limit into no limit at all.
   * Callers pass ids focus-first, so truncating the tail keeps what matters.
   */
  constructor(
    private readonly budgetChars: number,
    private readonly pinCap: number = Number.POSITIVE_INFINITY,
  ) {}

  stats(): BlobUrlCacheStats {
    return {
      entries: this.urls.size,
      bytes: this.bytes,
      budget: this.budgetChars,
      pinned: this.pinned.size,
      pin_cap: this.pinCap,
    };
  }

  get size(): number {
    return this.urls.size;
  }

  get byteLength(): number {
    return this.bytes;
  }

  get(id: string): string | undefined {
    const key = String(id || '');
    if (!key) return undefined;
    const url = this.urls.get(key);
    if (url === undefined) return undefined;
    // Map insertion order = LRU; re-insert on read.
    this.urls.delete(key);
    this.urls.set(key, url);
    return url;
  }

  set(id: string, url: string, byteLen?: number): void {
    const key = String(id || '');
    if (!key || typeof url !== 'string' || !url) return;
    const prev = this.urls.get(key);
    const prevCost = this.costs.get(key);
    if (prev !== undefined && prev !== url) revokeDisplayUrl(prev);
    if (prev !== undefined) this.bytes -= prevCost ?? prev.length;
    this.urls.delete(key);
    this.urls.set(key, url);
    const cost = Number(byteLen) > 0 ? Math.round(Number(byteLen)) : url.length;
    this.costs.set(key, cost);
    this.bytes += cost;
    this.evict();
  }

  drop(id: string): void {
    const key = String(id || '');
    const prev = this.urls.get(key);
    if (prev === undefined) return;
    revokeDisplayUrl(prev);
    this.bytes -= this.costs.get(key) ?? prev.length;
    this.urls.delete(key);
    this.costs.delete(key);
    this.pinned.delete(key);
  }

  /**
   * Replace the protected id set (first `pinCap` ids only). Pinned entries are
   * never evicted for budget.
   */
  pin(ids: Iterable<unknown>): void {
    this.pinned.clear();
    for (const raw of ids) {
      if (this.pinned.size >= this.pinCap) break;
      const key = String(raw || '');
      if (!key) continue;
      this.pinned.add(key);
      const url = this.urls.get(key);
      if (url !== undefined) {
        this.urls.delete(key);
        this.urls.set(key, url);
      }
    }
    this.evict();
  }

  /**
   * Pin `ids` and drop every other cached URL immediately (not only when
   * over budget). Used when the explorer leaves a folder so prior thumbs do
   * not stay resident and re-lag the next visit.
   */
  retainOnly(ids: Iterable<unknown>): void {
    // Keep the whole set; only its head is pinned. The explorer's visible window
    // is wider than the pin cap, and it must not lose thumbs it just asked for.
    const keep = new Set<string>();
    for (const raw of ids) {
      const key = String(raw || '');
      if (key) keep.add(key);
    }
    this.pin(keep);
    for (const id of [...this.urls.keys()]) {
      if (keep.has(id)) continue;
      const url = this.urls.get(id);
      if (url !== undefined) revokeDisplayUrl(url);
      this.urls.delete(id);
      this.bytes -= this.costs.get(id) ?? url?.length ?? 0;
      this.costs.delete(id);
      this.pinned.delete(id);
    }
  }

  pinnedIds(): string[] {
    return [...this.pinned];
  }

  clear(): void {
    for (const url of this.urls.values()) revokeDisplayUrl(url);
    this.urls.clear();
    this.costs.clear();
    this.pinned.clear();
    this.bytes = 0;
  }

  private evict(): void {
    if (this.bytes <= this.budgetChars) return;
    for (const [id, url] of this.urls) {
      if (this.bytes <= this.budgetChars) break;
      if (this.pinned.has(id)) continue;
      revokeDisplayUrl(url);
      this.urls.delete(id);
      this.bytes -= this.costs.get(id) ?? url.length;
      this.costs.delete(id);
    }
  }
}

/**
 * 64MB of source image bytes — sticky window plus recent browsing without
 * re-baking as often after a first load. A bigger resident set trades encode
 * work for main-thread memory pressure.
 */
export const BLOB_URL_BUDGET_CHARS = 64 * 1024 * 1024;

/**
 * Sticky pins the focus message ±2 (every shot of each), inline focus pins the
 * selection's cards. Two dozen full-size data URLs is already ~30–70MB of
 * strings; past that the pin is protecting browsing history, not the screen.
 */
export const BLOB_URL_PIN_CAP = 24;

export const blobUrlCache = new BlobUrlCache(BLOB_URL_BUDGET_CHARS, BLOB_URL_PIN_CAP);

/** Explorer grid only — object URLs, never data URLs. */
export const explorerThumbCache = new BlobUrlCache(BLOB_URL_BUDGET_CHARS);
