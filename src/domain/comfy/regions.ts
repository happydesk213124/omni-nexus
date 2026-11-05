/**
 * Character regions for ComfyUI, from the same centers NovelAI gets.
 *
 * NovelAI takes one center point per character and decides the extent itself.
 * ComfyUI's area nodes (Set Area, Set Mask, an IPAdapter attention mask) want a
 * rectangle, so each character is given the part of the canvas nearer to it than
 * to anyone else: start from the whole image and, for every other character,
 * cut at the midpoint along whichever axis they are further apart on. The boxes
 * then tile the image without overlapping, except for characters placed on the
 * very same point, who share theirs.
 */

export interface RegionCaption {
  center_x?: unknown;
  center_y?: unknown;
}

/** 0–1 fractions of the canvas. */
export interface FractionBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const COMFY_REGION_SLOTS = 6;

function unit(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

export function regionCenters(captions: readonly RegionCaption[]): Array<{ x: number; y: number }> {
  return captions.map(c => ({ x: unit(c.center_x, 0.5), y: unit(c.center_y, 0.5) }));
}

export function characterRegions(captions: readonly RegionCaption[]): FractionBox[] {
  const centers = regionCenters(captions);
  return centers.map((me, i) => {
    let left = 0, right = 1, top = 0, bottom = 1;
    centers.forEach((other, j) => {
      if (j === i) return;
      const dx = other.x - me.x, dy = other.y - me.y;
      if (dx === 0 && dy === 0) return;
      if (Math.abs(dx) >= Math.abs(dy)) {
        const mid = (me.x + other.x) / 2;
        if (dx > 0) right = Math.min(right, mid); else left = Math.max(left, mid);
      } else {
        const mid = (me.y + other.y) / 2;
        if (dy > 0) bottom = Math.min(bottom, mid); else top = Math.max(top, mid);
      }
    });
    return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
  });
}

/**
 * Pixel box on a multiple of 8, at least 64 wide and tall: ComfyUI's Set Area
 * works in latent cells (8 px) and will not take less than 64.
 */
export function pixelBox(box: FractionBox, width: number, height: number): FractionBox {
  const snap = (v: number) => Math.round(v / 8) * 8;
  const fit = (start: number, size: number, total: number) => {
    let a = Math.max(0, Math.min(total, snap(start * total)));
    let b = Math.max(0, Math.min(total, snap((start + size) * total)));
    if (b - a < 64) {
      const need = Math.min(total, 64);
      b = Math.min(total, a + need);
      a = Math.max(0, b - need);
    }
    return [a, b - a] as const;
  };
  const [x, w] = fit(box.x, box.w, width);
  const [y, h] = fit(box.y, box.h, height);
  return { x, y, w, h };
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * The numeric placeholders for `char1`…`char6`. A slot with no character gets
 * the whole canvas and `charN_on` 0, so a workflow built for more characters
 * than the shot has still validates and can wire `[[charN_on]]` into a strength.
 */
export function comfyRegionValues(
  captions: readonly RegionCaption[],
  width: number,
  height: number,
): Record<string, number> {
  const boxes = characterRegions(captions);
  const centers = regionCenters(captions);
  const values: Record<string, number> = { char_count: Math.min(captions.length, COMFY_REGION_SLOTS) };
  for (let i = 0; i < COMFY_REGION_SLOTS; i += 1) {
    const n = i + 1;
    const present = i < captions.length;
    const frac = present ? boxes[i]! : { x: 0, y: 0, w: 1, h: 1 };
    const px = pixelBox(frac, width, height);
    values[`char${n}_on`] = present ? 1 : 0;
    values[`char${n}_cx`] = present ? round4(centers[i]!.x) : 0.5;
    values[`char${n}_cy`] = present ? round4(centers[i]!.y) : 0.5;
    values[`char${n}_x`] = px.x;
    values[`char${n}_y`] = px.y;
    values[`char${n}_w`] = px.w;
    values[`char${n}_h`] = px.h;
    values[`char${n}_px`] = round4(frac.x);
    values[`char${n}_py`] = round4(frac.y);
    values[`char${n}_pw`] = round4(frac.w);
    values[`char${n}_ph`] = round4(frac.h);
  }
  return values;
}

/** Which image placeholders a workflow asks for, so only those are uploaded. */
export function comfyImageHoles(workflowJson: unknown): { masks: Set<number>; refs: Set<number>; vibe: boolean } {
  const text = String(workflowJson || '');
  const masks = new Set<number>(), refs = new Set<number>();
  for (const m of text.matchAll(/\[\[\s*char([1-6])_(mask|ref)\s*\]\]/gi)) {
    (m[2]!.toLowerCase() === 'mask' ? masks : refs).add(Number(m[1]));
  }
  return { masks, refs, vibe: /\[\[\s*vibe\s*\]\]/i.test(text) };
}
