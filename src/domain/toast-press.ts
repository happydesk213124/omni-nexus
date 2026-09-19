export type ToastAnchor = 'tl' | 'bl' | 'tr' | 'br' | 'tc';
export type ImagePressInspect = 'off' | 'hold' | 'two' | 'three' | 'both';

export function normalizeToastAnchor(value: unknown): ToastAnchor {
  const v = String(value ?? '').toLowerCase().trim();
  if (v === 'tl' || v === 'top-left' || v === 'left-top') return 'tl';
  if (v === 'bl' || v === 'bottom-left' || v === 'left-bottom') return 'bl';
  if (v === 'tr' || v === 'top-right' || v === 'right-top') return 'tr';
  if (v === 'br' || v === 'bottom-right' || v === 'right-bottom') return 'br';
  if (v === 'tc' || v === 'top-center' || v === 'center-top' || v === 'top') return 'tc';
  return 'tc';
}

export function normalizeImagePressInspect(value: unknown): ImagePressInspect {
  const v = String(value ?? '').toLowerCase().trim();
  if (v === 'off' || v === 'none' || v === '0' || v === 'false') return 'off';
  if (
    v === 'two' || v === 'twohand' || v === 'two-hand' || v === '2'
    || v === 'dbl' || v === 'double' || v === 'doubletap' || v === 'double-tap' || v === 'tap'
  ) return 'two';
  if (
    v === 'three' || v === 'triple' || v === 'tripletap' || v === 'triple-tap' || v === '3'
  ) return 'three';
  if (v === 'both' || v === 'all' || v === 'any') return 'both';
  return 'hold';
}

/** Saved `two` is double-tap (it used to mean two fingers). `both` = hold + double-tap. */
export function imagePressAllowsHold(mode: unknown): boolean {
  const m = normalizeImagePressInspect(mode);
  return m === 'hold' || m === 'both';
}

export function imagePressAllowsDoubleTap(mode: unknown): boolean {
  const m = normalizeImagePressInspect(mode);
  return m === 'two' || m === 'both';
}

export function imagePressAllowsTripleTap(mode: unknown): boolean {
  return normalizeImagePressInspect(mode) === 'three';
}

/** How many fast taps on the same shot open enlarge. 0 = tap is not a gesture. */
export function imagePressTapNeed(mode: unknown): 0 | 2 | 3 {
  const m = normalizeImagePressInspect(mode);
  if (m === 'three') return 3;
  if (m === 'two' || m === 'both') return 2;
  return 0;
}

/** Second simultaneous finger is not a gesture anymore. */
export function imagePressAllowsSecondPointer(_mode: unknown): boolean {
  void _mode;
  return false;
}

/**
 * Live image-press pointer bookkeeping.
 *
 * Counting by `pointerId` looked right and never worked on mobile: the host
 * forwards a plain object, so `pointerId` can be missing or repeated and two
 * fingers collapse into one entry. These helpers count *pointerdown events that
 * landed on a shot* instead, so identity never matters. `windowMs` exists
 * because a lost `pointerup` would otherwise leave the count high forever and
 * make one finger pass as two.
 */
export const IMAGE_PRESS_WINDOW_MS = 4000;

export function pruneImagePressDowns(
  downs: unknown,
  now: unknown,
  windowMs: unknown = IMAGE_PRESS_WINDOW_MS,
): number[] {
  const at = Number(now);
  const nowMs = Number.isFinite(at) ? at : 0;
  const raw = Number(windowMs);
  const win = Number.isFinite(raw) && raw > 0 ? raw : IMAGE_PRESS_WINDOW_MS;
  if (!Array.isArray(downs)) return [];
  return downs
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && nowMs - v <= win);
}

export function noteImagePressDown(
  downs: unknown,
  now: unknown,
  windowMs: unknown = IMAGE_PRESS_WINDOW_MS,
): number[] {
  const at = Number(now);
  const kept = pruneImagePressDowns(downs, now, windowMs);
  kept.push(Number.isFinite(at) ? at : 0);
  return kept;
}

/** One lifted finger drops one entry — oldest, so a stale row cannot outlive the gesture. */
export function noteImagePressUp(downs: unknown): number[] {
  if (!Array.isArray(downs) || !downs.length) return [];
  return downs.slice(1).map((v) => Number(v)).filter((v) => Number.isFinite(v));
}

export function imagePressDownCount(
  downs: unknown,
  now: unknown,
  windowMs: unknown = IMAGE_PRESS_WINDOW_MS,
): number {
  return pruneImagePressDowns(downs, now, windowMs).length;
}

/**
 * Move of a *different* finger must not kill the first image press, and neither
 * may the jitter of a two-finger hold: with both fingers down the reported point
 * jumps between them, which read as a drag and cancelled every attempt.
 */
export function imagePressMoveCancels(opts: {
  pressPointerId?: unknown;
  eventPointerId?: unknown;
  mode?: unknown;
  pressCount?: unknown;
  fromX?: unknown;
  fromY?: unknown;
  toX?: unknown;
  toY?: unknown;
  slopPx?: unknown;
} = {}): boolean {
  const ev = opts.eventPointerId;
  const pr = opts.pressPointerId;
  if (ev != null && pr != null && ev !== pr) return false;
  if (imagePressAllowsSecondPointer(opts.mode)) {
    const held = Number(opts.pressCount);
    if (Number.isFinite(held) && held >= 2) return false;
  }
  const slop = Number(opts.slopPx);
  const s = Number.isFinite(slop) ? Math.max(0, slop) : 8;
  const dx = Number(opts.toX) - Number(opts.fromX);
  const dy = Number(opts.toY) - Number(opts.fromY);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  return Math.hypot(dx, dy) > s;
}

export const IMAGE_DOUBLE_TAP_WINDOW_MS = 450;
export const IMAGE_DOUBLE_TAP_SLOP_PX = 28;

/** Same card, same spot, second down inside the window — not a drag and not a new shot. */
export function imagePressDoubleTapHits(opts: {
  prevAt?: unknown;
  prevX?: unknown;
  prevY?: unknown;
  prevCardId?: unknown;
  now?: unknown;
  x?: unknown;
  y?: unknown;
  cardId?: unknown;
  windowMs?: unknown;
  slopPx?: unknown;
} = {}): boolean {
  const id = String(opts.cardId ?? '');
  const prevId = String(opts.prevCardId ?? '');
  if (!id || prevId !== id) return false;
  const prevAt = Number(opts.prevAt);
  const now = Number(opts.now);
  const rawWin = Number(opts.windowMs);
  const win = Number.isFinite(rawWin) && rawWin > 0 ? rawWin : IMAGE_DOUBLE_TAP_WINDOW_MS;
  if (!Number.isFinite(prevAt) || !Number.isFinite(now) || now < prevAt || now - prevAt > win) return false;
  const rawSlop = Number(opts.slopPx);
  const slop = Number.isFinite(rawSlop) ? Math.max(0, rawSlop) : IMAGE_DOUBLE_TAP_SLOP_PX;
  const dx = Number(opts.x) - Number(opts.prevX);
  const dy = Number(opts.y) - Number(opts.prevY);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  return Math.hypot(dx, dy) <= slop;
}

/**
 * Consecutive taps on the same shot. Each gap must itself be a double-tap hit
 * so a slow third tap starts over instead of riding the first two.
 */
export function imagePressTapHits(opts: {
  prevAt?: unknown;
  prevX?: unknown;
  prevY?: unknown;
  prevCardId?: unknown;
  prevCount?: unknown;
  now?: unknown;
  x?: unknown;
  y?: unknown;
  cardId?: unknown;
  need?: unknown;
  windowMs?: unknown;
  slopPx?: unknown;
} = {}): { hit: boolean; count: number } {
  const linked = imagePressDoubleTapHits(opts);
  const count = linked ? Math.max(1, Math.floor(Number(opts.prevCount) || 0) + 1) : 1;
  const rawNeed = Math.floor(Number(opts.need));
  const need = rawNeed === 3 ? 3 : rawNeed === 2 ? 2 : 0;
  return { hit: Boolean(need) && count >= need, count };
}

/** Mobile pinch often pointercancel's the first finger — keep an in-progress hold. */
export function imagePressIgnorePointerCancel(mode: unknown, source: unknown): boolean {
  if (!imagePressAllowsHold(mode)) return false;
  const src = String(source || '');
  return src === 'inline-shot' || src === 'sticky-thumb';
}

export function imagePressOtherPointerUp(opts: {
  pressPointerId?: unknown;
  eventPointerId?: unknown;
} = {}): boolean {
  const ev = opts.eventPointerId;
  const pr = opts.pressPointerId;
  return ev != null && pr != null && ev !== pr;
}
