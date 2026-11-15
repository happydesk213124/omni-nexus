/**
 * The `[[moss_prompt]]` placeholder: a whole MOSS-Image prompt from the shot.
 *
 * MOSS-Image takes either plain prose or one JSON text with a box per element.
 * With character positions on, each character gets a box; with AI choice the
 * characters are only described, so the model places them itself (a corner, the
 * back, anywhere) the way NovelAI does when it is given no centers.
 */
import { characterRegions, COMFY_REGION_SLOTS, type FractionBox, type RegionCaption } from './regions.ts';

export interface MossCaption extends RegionCaption {
  /** The character's tags, already in ComfyUI's emphasis. Empty when they went into the main prompt. */
  positive: string;
}

/**
 * Regions that only meet at an edge are drawn as separate panels with a seam
 * between them, so every box reaches this far past its region on each side.
 */
const OVERLAP = 0.1;
/** A full-height region keeps a little head room, so a figure is not cropped at the top. */
const HEAD_ROOM = 0.05;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** A character region grown into the box MOSS gets, still as 0–1 fractions. */
export function mossBox(region: FractionBox): FractionBox {
  const x0 = clamp01(region.x - OVERLAP), x1 = clamp01(region.x + region.w + OVERLAP);
  let y0 = clamp01(region.y - OVERLAP);
  const y1 = clamp01(region.y + region.h + OVERLAP);
  if (region.y <= 0 && region.y + region.h >= 1) y0 = HEAD_ROOM;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Pixel edges around a 0–1 box as `[y0, x0, y1, x1]` with the canvas centre as
 * 0: the `abs_centralized` / `yxyx` space MOSS-Image was trained on, rounded
 * outward as ComfyUI's MOSSImageLayoutPrompt does.
 */
export function centredBox(box: FractionBox, width: number, height: number): [number, number, number, number] {
  const hw = Math.floor(width / 2), hh = Math.floor(height / 2);
  return [
    Math.floor(box.y * height) - hh,
    Math.floor(box.x * width) - hw,
    Math.ceil((box.y + box.h) * height) - hh,
    Math.ceil((box.x + box.w) * width) - hw,
  ];
}

export function mossPrompt(
  caption: string,
  captions: readonly MossCaption[],
  useCoords: boolean,
  width: number,
  height: number,
): string {
  const shown = captions.slice(0, COMFY_REGION_SLOTS);
  const regions = characterRegions(shown);
  const people = shown
    .map((c, i) => ({ tags: c.positive.trim(), region: regions[i]! }))
    .filter(p => p.tags);
  // One box would be the whole canvas, which says nothing about placement.
  if (useCoords && people.length >= 2) {
    const items = people.map(p => ({ label: 'character', caption: p.tags, bbox: centredBox(mossBox(p.region), width, height) }));
    return JSON.stringify({ summary: { caption }, items, bbox_coord_space: 'abs_centralized', bbox_format: 'yxyx' });
  }
  if (!people.length) return caption;
  const list = people.map((p, i) => `Character ${i + 1}: ${p.tags}.`).join('\n');
  return `${caption}\n\n${list}`;
}
