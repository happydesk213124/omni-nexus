/**
 * Per-character images for a ComfyUI workflow: a region mask and a reference
 * picture for each character, plus the shared vibe picture.
 *
 * Only the holes the workflow actually contains are uploaded. A hole whose image
 * does not exist (no character in that slot, no reference stored for it) still
 * gets a real file — a black one — because LoadImage fails validation on an empty
 * name, and a workflow built for three characters must still run for one. Its
 * `_weight` is then 0, which is what a workflow wires into the IPAdapter weight.
 */
import { u8ToArrayBuffer } from '../../core/util/bytes.ts';
import { encodeMaskPng } from '../../core/util/png-mask.ts';
import { characterRegions, comfyImageHoles, COMFY_REGION_SLOTS, pixelBox, type RegionCaption } from '../../domain/comfy/regions.ts';

export interface ComfyRegionImages {
  /** Reference picture per caption index; null where the character has none. */
  charRefs?: ReadonlyArray<ArrayBuffer | null>;
  vibe?: ArrayBuffer | null;
  /** What `[[charN_ref_weight]]` holds when that character's reference exists. */
  refWeight?: number;
  /** What `[[vibe_weight]]` holds when a vibe picture exists. */
  vibeWeight?: number;
}

/** Puts one file into ComfyUI's input folder and returns the name LoadImage takes. */
export type ComfyUpload = (bytes: ArrayBuffer, label: string) => Promise<string>;

const clamp01 = (n: unknown, fallback: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
};

/** Uploads what the workflow asks for and returns the placeholder values naming them. */
export async function comfyRegionImageValues(
  workflowJson: unknown,
  captions: readonly RegionCaption[],
  width: number,
  height: number,
  images: ComfyRegionImages,
  upload: ComfyUpload,
): Promise<Record<string, string | number>> {
  const holes = comfyImageHoles(workflowJson);
  const values: Record<string, string | number> = {};
  let blank = '';
  const blankName = async () => {
    blank ||= await upload(u8ToArrayBuffer(encodeMaskPng(64, 64, null)), 'blank');
    return blank;
  };
  const boxes = characterRegions(captions);
  for (let n = 1; n <= COMFY_REGION_SLOTS; n += 1) {
    const i = n - 1;
    if (holes.masks.has(n)) {
      values[`char${n}_mask`] = i < captions.length
        ? await upload(u8ToArrayBuffer(encodeMaskPng(width, height, pixelBox(boxes[i]!, width, height))), `char${n}-mask`)
        : await upload(u8ToArrayBuffer(encodeMaskPng(width, height, null)), `char${n}-mask`);
    }
    const ref = i < captions.length ? images.charRefs?.[i] : null;
    const hasRef = Boolean(ref && ref.byteLength > 0);
    values[`char${n}_ref_weight`] = hasRef ? clamp01(images.refWeight, 0.6) : 0;
    if (holes.refs.has(n)) values[`char${n}_ref`] = hasRef ? await upload(ref!, `char${n}-ref`) : await blankName();
  }
  const hasVibe = Boolean(images.vibe && images.vibe.byteLength > 0);
  values.vibe_weight = hasVibe ? clamp01(images.vibeWeight, 0.6) : 0;
  if (holes.vibe) values.vibe = hasVibe ? await upload(images.vibe!, 'vibe') : await blankName();
  return values;
}
