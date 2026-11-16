/**
 * 누끼: a sprite's plain background taken away, its pixels as they are (RGBA, in place). Only a background of one colour
 * (white or black, as NAI V4·V4.5 draw them, or a ComfyUI workflow that draws no alpha) is taken: from the picture's edge
 * inward, every pixel joined to the edge that is close to that colour goes. A white shirt or the whites of the eyes are
 * not joined to the edge through the background, so they stay, where a multiply blend would have taken them too.
 *
 * Done once, when the picture is made or put in, and kept as a PNG with its transparency: the viewer only shows it.
 */

export type CutoutResult = 'cut' | 'transparent' | 'mixed';
export type CutoutColor = 'auto' | 'white' | 'black';
export interface CutoutOptions {
  /** How far from the background colour a pixel may be and still go: the largest channel difference, 0–255. */
  tolerance?: number;
  /** The background's colour; auto, read off the edge. */
  color?: CutoutColor;
}

/** The tolerance an automatic pass uses: a drawn white is a few levels off pure, a saved JPEG's noise a little more. */
export const CUTOUT_TOLERANCE = 28;
// The share of the edge that must be that one colour for a background to be taken unasked.
const EDGE_SHARE = 0.8;
// The share of the edge already transparent that makes a picture one with a background taken already.
const CLEAR_SHARE = 0.3;

const WHITE: readonly [number, number, number] = [255, 255, 255];
const BLACK: readonly [number, number, number] = [0, 0, 0];
const off = (px: Uint8ClampedArray, i: number, bg: readonly number[]): number =>
  Math.max(Math.abs(px[i]! - bg[0]!), Math.abs(px[i + 1]! - bg[1]!), Math.abs(px[i + 2]! - bg[2]!));

/** The edge's pixels, each once (corners not twice), as pixel numbers. */
function edgeOf(w: number, h: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < w; x++) { out.push(x); if (h > 1) out.push((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { out.push(y * w); if (w > 1) out.push(y * w + w - 1); }
  return out;
}

/**
 * Takes the background away, in place. `transparent`: the edge is mostly see-through already (nothing done); `mixed`:
 * the edge is no one colour (a room behind them: nothing done, a hand-picked colour still takes it).
 */
export function cutoutPixels(px: Uint8ClampedArray, w: number, h: number, options: CutoutOptions = {}): { result: CutoutResult; color?: 'white' | 'black'; cleared: number } {
  const tolerance = Math.max(0, Math.min(255, Math.round(options.tolerance ?? CUTOUT_TOLERANCE))), wanted = options.color ?? 'auto';
  if (!(w > 0 && h > 0) || px.length < w * h * 4) return { result: 'mixed', cleared: 0 };
  const edge = edgeOf(w, h);
  if (wanted === 'auto' && edge.filter(p => px[p * 4 + 3]! < 250).length >= edge.length * CLEAR_SHARE) return { result: 'transparent', cleared: 0 };
  const near = (bg: readonly number[]) => edge.filter(p => px[p * 4 + 3]! >= 250 && off(px, p * 4, bg) <= tolerance).length;
  let color: 'white' | 'black';
  if (wanted === 'white' || wanted === 'black') color = wanted;
  else {
    const whites = near(WHITE), blacks = near(BLACK);
    if (Math.max(whites, blacks) < edge.length * EDGE_SHARE) return { result: 'mixed', cleared: 0 };
    color = whites >= blacks ? 'white' : 'black';
  }
  const bg = color === 'white' ? WHITE : BLACK;
  // From every edge pixel close to it, inward through its neighbours that are too.
  const gone = new Uint8Array(w * h), queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (const p of edge) if (!gone[p] && off(px, p * 4, bg) <= tolerance) { gone[p] = 1; queue[tail++] = p; }
  while (head < tail) {
    const p = queue[head++]!, x = p % w;
    const visit = (q: number) => { if (!gone[q] && off(px, q * 4, bg) <= tolerance) { gone[q] = 1; queue[tail++] = q; } };
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (p >= w) visit(p - w);
    if (p < w * (h - 1)) visit(p + w);
  }
  if (!tail) return { result: 'cut', color, cleared: 0 };
  // The ring just inside what went is the outline's blend with the background: see-through by how close to it it
  // is, its colour with the background's share taken out (no white or dark fringe around them on the stage).
  const soft = Math.max(48, tolerance * 3);
  for (let p = 0; p < w * h; p++) {
    if (gone[p]) { px[p * 4 + 3] = 0; continue; }
    const x = p % w, ring = (x > 0 && gone[p - 1]) || (x < w - 1 && gone[p + 1]) || (p >= w && gone[p - w]) || (p < w * (h - 1) && gone[p + w]);
    if (!ring) continue;
    const i = p * 4, a = Math.min(1, off(px, i, bg) / soft);
    if (a >= 1) continue;
    for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, Math.round((px[i + c]! - bg[c]! * (1 - a)) / Math.max(a, 0.05))));
    px[i + 3] = Math.round(px[i + 3]! * a);
  }
  return { result: 'cut', color, cleared: tail };
}
