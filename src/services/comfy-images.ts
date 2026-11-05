/**
 * Gathers the pictures a ComfyUI workflow can ask for per shot: each character's
 * reference picture and the vibe picture. Nothing is read unless the workflow has
 * the matching `[[charN_ref]]` / `[[vibe]]` hole, so a workflow without them costs
 * nothing extra.
 */
import type { NaiSettings } from '../core/types';
import { cleanText } from '../core/util/text';
import { comfyImageHoles } from '../domain/comfy/regions';
import type { ComfyRegionImages } from '../providers/comfy/region-images';
import { getConfig } from './context';
import { getCharRefImageBytes, getPresetVibeImageBytes, getVibeImageBytes } from './nai-assets';

interface CastEntry { id?: string; scope?: string }

export async function comfyRegionImageSources(
  nai: NaiSettings,
  plan: { characters?: readonly CastEntry[] },
  presetId: unknown,
): Promise<ComfyRegionImages> {
  const holes = comfyImageHoles(nai.comfy_workflow_json);
  const card = getConfig().card;
  const out: ComfyRegionImages = {
    refWeight: Number(card.char_ref_strength ?? 0.6),
    vibeWeight: Number(nai.vibe_transfer_strength ?? 0.6),
  };
  if (holes.refs.size) {
    // The cast is in caption order (both are built in one loop), so index N-1 is charN.
    const cast = plan.characters || [];
    out.charRefs = await Promise.all(cast.slice(0, 6).map(async (c, i) => {
      const id = cleanText(c?.id, 200), scope = cleanText(c?.scope, 200);
      if (!holes.refs.has(i + 1) || !id || !scope) return null;
      return getCharRefImageBytes(scope, id).catch(() => null);
    }));
  }
  if (holes.vibe) {
    // Same order NovelAI uses: the preset's own vibe picture, else Omni's when vibe is on.
    const id = cleanText(presetId, 120);
    let vibe = id ? await getPresetVibeImageBytes(id).catch(() => null) : null;
    const mode = cleanText(nai.vibe_transfer || 'none').toLowerCase();
    if (!vibe && !['', 'none', 'off', 'false', '0'].includes(mode)) vibe = await getVibeImageBytes().catch(() => null);
    out.vibe = vibe;
  }
  return out;
}
