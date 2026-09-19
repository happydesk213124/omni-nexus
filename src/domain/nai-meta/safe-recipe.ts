const record = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v)
  ? v as Record<string, unknown> : null;
const strings = new Set(['prompt', 'Prompt', 'input', 'uc', 'negative_prompt', 'model', 'sampler', 'scheduler',
  'noise_schedule', 'noiseSchedule', 'Source', 'source', 'Software', 'Description', 'description',
  'base_caption', 'baseCaption', 'char_caption', 'charCaption', 'name']);
const numbers = new Set(['seed', 'width', 'height', 'steps', 'scale', 'cfg_scale', 'cfg_rescale', 'cfgRescale',
  'strength', 'noise', 'center_x', 'center_y', 'x', 'y']);
const booleans = new Set(['var_plus', 'variety_plus', 'use_coords', 'use_order', 'sm', 'sm_dyn',
  'dynamic_thresholding', 'legacy', 'legacy_v3_extend', 'normalize_reference_strength']);
const objects = new Set(['parameters', 'v4_prompt', 'v4Prompt', 'v4_negative_prompt', 'v4NegativePrompt', 'caption']);
const arrays = new Set(['characters', 'char_captions', 'charCaptions', 'centers']);

/** Deliberately excludes credentials, endpoints, pixel/reference data and Comfy
 * workflow graphs. Unknown provider fields require an explicit schema addition.
 */
export function safeGenerationRecipe(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  const input = record(value);
  if (!input) return null;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(input)) {
    if (strings.has(key) && typeof v === 'string' && v.length <= 100_000) out[key] = v;
    else if (numbers.has(key) && typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (booleans.has(key) && typeof v === 'boolean') out[key] = v;
    else if (objects.has(key) && record(v)) out[key] = safeGenerationRecipe(v, depth + 1);
    else if (arrays.has(key) && Array.isArray(v)) out[key] = v.slice(0, 256).map(item => safeGenerationRecipe(item, depth + 1));
    else if (key === 'Comment' || key === 'comment') {
      let comment = v;
      if (typeof v === 'string') { try { comment = JSON.parse(v); } catch { continue; } }
      if (record(comment)) out[key] = safeGenerationRecipe(comment, depth + 1);
    }
  }
  return out;
}
