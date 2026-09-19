/**
 * NovelAI request-body construction.
 *
 * Field names, defaults and numeric coercions here are dictated by the NAI
 * image API — it rejects bodies that differ even cosmetically, so nothing in
 * this file should be "tidied" without checking against a live request.
 */
import models from '../../config/models.json';
import type { ShotCharacter } from '../../core/types.ts';
import { bytesToBase64 } from '../../core/util/bytes.ts';
import { cleanText } from '../../core/util/text.ts';

const MODELS = models as Record<string, string>;

/** Compact aliases → short `naid*` keys. Official V5 ids live in models.json. */
const MODEL_ALIASES: Record<string, string> = {
  naiv5: 'naid5f',
  'nai-v5': 'naid5f',
  v5: 'naid5f',
  v5full: 'naid5f',
  'v5-full': 'naid5f',
  naiv5full: 'naid5f',
  'nai-v5-full': 'naid5f',
  v5curated: 'naid5c',
  'v5-curated': 'naid5c',
  naiv5curated: 'naid5c',
  'nai-v5-curated': 'naid5c',
  'nai-diffusion-5': 'naid5f',
};

function compactModelKey(model: unknown): string {
  return cleanText(model).toLowerCase().replace(/\s+/g, '');
}

/** A vibe-transfer reference, already base64-encoded by `encodeVibe`. */
export interface VibeReference {
  encoded: string;
  strength: number;
  information_extracted: number;
}

/** A Character Reference (NAID 4.5 "director reference") source image. */
export interface CharacterReference {
  image: Uint8Array | ArrayBuffer;
  type: string;
  strength: number;
  fidelity: number;
}

/** Everything needed to describe one text-to-image request. */
export interface T2iRequest {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg_scale: number;
  cfg_rescale: number;
  sampler: string;
  scheduler: string;
  model: string;
  var_plus?: boolean;
  characters?: ShotCharacter[];
  character_refs?: CharacterReference[];
  vibes?: VibeReference[];
  use_coords?: boolean;
}

interface V4Center {
  x?: number;
  y?: number;
}

interface V4CharCaption {
  char_caption?: string;
  centers: V4Center[];
}

/** The v4-only half of the parameters block. */
export interface V4PromptFields {
  autoSmea: boolean;
  prefer_brownian: boolean;
  ucPreset: number;
  use_coords: boolean;
  legacy_uc: boolean;
  add_original_image: boolean;
  v4_prompt: {
    caption: { base_caption: string; char_captions: V4CharCaption[] };
    use_coords: boolean;
    use_order: boolean;
  };
  v4_negative_prompt: {
    caption: { base_caption: string; char_captions: V4CharCaption[] };
    legacy_uc: boolean;
  };
}

/** Maps a model key, alias, or full model name to the name NAI expects. */
export function resolveModel(key: string, isInpaint = false): string {
  const compact = compactModelKey(key);
  const aliased = MODEL_ALIASES[compact];
  let name =
    (aliased && MODELS[aliased]) || MODELS[compact] || MODELS[String(key).toLowerCase()] || key;
  if (isInpaint && !name.endsWith('-inpainting')) name += '-inpainting';
  return name;
}

export function isNaiV5(model: unknown): boolean {
  return resolveModel(cleanText(model) || 'nai-diffusion-4-5-full').includes('nai-diffusion-5');
}

/** V4/V4.5/V5 all use the API `v4_prompt` character-caption block. */
export function usesCharCaptions(model: unknown): boolean {
  const name = resolveModel(cleanText(model) || 'nai-diffusion-4-5-full');
  return name.includes('nai-diffusion-4') || name.includes('nai-diffusion-5');
}

/** Precise Reference is V4.5-only. V5 launch has no director reference. */
export function supportsDirectorReference(model: unknown): boolean {
  return resolveModel(cleanText(model) || 'nai-diffusion-4-5-full').includes('4-5');
}

/** Vibe Transfer is not in the V5 launch. */
export function supportsVibeTransfer(model: unknown): boolean {
  const name = resolveModel(cleanText(model) || 'nai-diffusion-4-5-full');
  if (name.includes('nai-diffusion-5')) return false;
  return name.includes('nai-diffusion-4') || name.includes('nai-diffusion-3');
}

/** Builds the v4 caption / negative-caption block from the per-character prompts. */
export function buildV4Prompt(req: T2iRequest): V4PromptFields {
  const charCaptions: V4CharCaption[] = [];
  const negCharCaptions: V4CharCaption[] = [];
  for (const c of req.characters || []) {
    const center: V4Center = { x: c.center_x, y: c.center_y };
    charCaptions.push({ char_caption: c.prompt, centers: [center] });
    negCharCaptions.push({ char_caption: c.uc || '', centers: [center] });
  }
  return {
    autoSmea: true,
    prefer_brownian: true,
    ucPreset: 0,
    use_coords: Boolean(req.use_coords),
    legacy_uc: false,
    add_original_image: true,
    v4_prompt: {
      caption: { base_caption: req.prompt, char_captions: charCaptions },
      use_coords: Boolean(req.use_coords),
      use_order: true,
    },
    v4_negative_prompt: {
      caption: { base_caption: req.negative_prompt, char_captions: negCharCaptions },
      legacy_uc: false,
    },
  };
}

/** Builds the `parameters` object of a generate-image request. */
export function buildBaseParameters(req: T2iRequest): Record<string, unknown> {
  const modelName = resolveModel(req.model);
  const params: Record<string, unknown> = {
    width: req.width,
    height: req.height,
    n_samples: 1,
    seed: req.seed,
    extra_noise_seed: req.seed,
    sampler: req.sampler,
    steps: req.steps,
    scale: req.cfg_scale,
    negative_prompt: req.negative_prompt,
    cfg_rescale: req.cfg_rescale,
    noise_schedule: req.scheduler,
    params_version: modelName.includes('nai-diffusion-5') ? 4 : 3,
    legacy: false,
    legacy_v3_extend: false,
  };
  if (req.var_plus) {
    params.skip_cfg_above_sigma =
      modelName.includes('4-5') || modelName.includes('nai-diffusion-5') ? 58 : 19;
  } else params.skip_cfg_above_sigma = null;
  if (usesCharCaptions(modelName)) {
    const v4 = buildV4Prompt(req);
    if (modelName.includes('nai-diffusion-5')) v4.autoSmea = false;
    Object.assign(params, v4);
  }
  if (req.vibes?.length && supportsVibeTransfer(modelName)) {
    params.reference_image_multiple = req.vibes.map((v) => v.encoded);
    params.reference_strength_multiple = req.vibes.map((v) => v.strength);
    params.reference_information_extracted_multiple = req.vibes.map((v) => v.information_extracted);
    params.normalize_reference_strength_multiple = true;
  }
  if (req.character_refs?.length && supportsDirectorReference(modelName)) {
    // Precise Reference and Vibe Transfer are mutually exclusive — drop vibe fields.
    delete params.reference_image_multiple;
    delete params.reference_strength_multiple;
    delete params.reference_information_extracted_multiple;
    delete params.normalize_reference_strength_multiple;
    params.director_reference_images = req.character_refs.map((r) => bytesToBase64(r.image));
    params.director_reference_strength_values = req.character_refs.map((r) => r.strength);
    // NAIWeaver: secondary = 1 - fidelity (fidelity 1 → secondary 0).
    params.director_reference_secondary_strength_values = req.character_refs.map((r) => 1.0 - r.fidelity);
    params.director_reference_descriptions = req.character_refs.map((r) => ({
      caption: { base_caption: r.type, char_captions: [] },
      legacy_uc: false,
    }));
    params.director_reference_information_extracted = req.character_refs.map(() => 1.0);
    params.controlnet_strength = 1.0;
    params.inpaintImg2ImgStrength = 1.0;
    delete params.skip_cfg_above_sigma;
  }
  return params;
}

/** Normalises a model key, alias, or full model name to the short `naid*` key. */
export function modelToNaia(model: unknown): string {
  const name = cleanText(model) || 'nai-diffusion-4-5-full';
  const compact = compactModelKey(name);
  if (MODEL_ALIASES[compact]) return MODEL_ALIASES[compact];
  const reverse = Object.fromEntries(Object.entries(MODELS).map(([k, v]) => [v, k])) as Record<string, string>;
  if (MODELS[name]) return name;
  if (MODELS[compact]) return compact;
  if (reverse[name]) return reverse[name];
  if (reverse[compact]) return reverse[compact];
  if (compact.includes('nai-diffusion-5-curated')) return 'naid5c';
  if (compact.includes('nai-diffusion-5')) return 'naid5f';
  return 'naid4.5f';
}
