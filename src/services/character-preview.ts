/**
 * One NAI shot for 예제샷 / 헤더 참고 생성. Does not write vibe or look_hash.
 */

import { API_URL } from '../core/constants';
import type { ApiResult, CharacterRecord, StylePreset } from '../core/types';
import { bytesToBase64 } from '../core/util/bytes';
import { cleanText, joinTags } from '../core/util/text';
import { ensureCostumes, resolveCostumeFields } from '../domain/character/costume';
import { formatAgeCaption, formatHeightCaption } from '../domain/character/looks-fields';
import { tokensForFamily } from '../domain/nai/keys';
import { naiSamplerForFamily, naiStepsForFamily } from '../domain/nai/samplers';
import { findPresetById, modelForFamily, normalizeNaiFamily, type NaiFamily } from '../domain/nai/routing';
import { joinCharacterPreviewPrompt, joinExampleShotPrompt } from '../domain/style-presets/look-prompt';
import { resolveGenerationCfgParams } from '../domain/style-preset-overrides';
import { generateViaComfy, imageBackendKind } from '../providers/comfy/client';
import { generateT2i } from '../providers/nai/client';
import { modelToNaia, type T2iRequest } from '../providers/nai/payload';
import { pngToDataUrl } from '../storage/image-urls';
import { getConfig } from './context';

function asChar(raw: unknown): Partial<CharacterRecord> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Partial<CharacterRecord>
    : {};
}

function requirePreset(presetId: string): StylePreset {
  const presets = getConfig().card?.presets;
  const row = Array.isArray(presets) ? findPresetById(presets, presetId) : null;
  if (!row) throw new Error('프리셋을 찾지 못했습니다');
  return row;
}

function activePresetId(want: string): string {
  const card = getConfig().card || {};
  const presets = Array.isArray(card.presets) ? card.presets : [];
  if (want && findPresetById(presets, want)) return want;
  const active = cleanText(card.active_preset_id, 120);
  if (active && findPresetById(presets, active)) return active;
  const first = presets[0] as { id?: unknown } | undefined;
  return cleanText(first?.id, 120);
}

export function characterPreviewTags(rec: Partial<CharacterRecord>): string {
  const { costumes, active_costume } = ensureCostumes(rec);
  const wear = costumes[active_costume] || costumes[0];
  const look = resolveCostumeFields(wear, costumes[0]);
  const gender = cleanText(rec.gender, 20);
  return joinTags(
    rec.original,
    look.appearance,
    look.hair_color,
    look.hair_style,
    look.eye_color,
    formatHeightCaption(look.height, gender === 'girl' || gender === 'boy' || gender === 'other' ? gender : ''),
    formatAgeCaption(look.age),
    look.penis_size,
    look.attire,
    look.bottoms,
    look.accessories,
  );
}

export async function generateCharacterPreview(body: Record<string, unknown>): Promise<ApiResult> {
  const id = activePresetId(cleanText(body.preset_id || body.presetId || '', 120));
  if (!id) throw new Error('preset_id required');
  const row = requirePreset(id);
  const rec = asChar(body.character || body.form);
  const family: NaiFamily = normalizeNaiFamily(body.model_family ?? row.model_family);
  const cfg = getConfig();
  const nai = cfg.nai;
  const token = tokensForFamily(nai, family)[0] || '';
  if (imageBackendKind(nai) !== 'comfy' && !token) throw new Error('NAI API 키가 설정되지 않았습니다.');
  const familyNai = {
    ...nai,
    steps: naiStepsForFamily(nai, family),
    sampler: naiSamplerForFamily(nai, family),
  };
  const params = resolveGenerationCfgParams(familyNai, {
    cfg_scale: row.cfg_scale,
    cfg_rescale: row.cfg_rescale,
    steps: row.steps,
    sampler: row.sampler,
    scheduler: row.scheduler,
  });
  const model = modelToNaia(modelForFamily(nai, family));
  const rawPrompt = joinCharacterPreviewPrompt(joinTags(row.positive, characterPreviewTags(rec)));
  // preview-shot (vibe/참고용) and example-shot share one framing. The frozen
  // UI never sends an opt-out, so default to the example tail; pass
  // framing:'none' or example_shot:false only for an unframed raw prompt.
  const wantExample = body.framing !== 'none' && body.example_shot !== false;
  const prompt = wantExample ? joinExampleShotPrompt(rawPrompt) : rawPrompt;
  const req: T2iRequest = {
    prompt,
    negative_prompt: String(row.negative || ''),
    width: 1024,
    height: 1024,
    seed: Math.floor(Math.random() * 4294967295) || 1,
    steps: params.steps,
    cfg_scale: params.cfg_scale,
    cfg_rescale: params.cfg_rescale,
    sampler: params.sampler,
    scheduler: params.scheduler,
    model,
    var_plus: false,
    characters: [],
  };
  if (imageBackendKind(nai) === 'comfy') {
    const [bytes] = await generateViaComfy(
      { ...nai, width: req.width, height: req.height, seed: req.seed, steps: req.steps, sampler: req.sampler },
      prompt,
      String(row.negative || ''),
      [],
    );
    const preview = pngToDataUrl(bytes);
    return {
      ok: true,
      preset_id: id,
      preview_url: preview,
      image_b64: bytesToBase64(bytes),
      bytes: bytes.byteLength,
    };
  }
  const apiUrl = cleanText(nai.request_url) || API_URL;
  const result = await generateT2i(token, req, apiUrl, { timeoutMs: 180000 });
  const preview = pngToDataUrl(result.raw_bytes);
  return {
    ok: true,
    preset_id: id,
    preview_url: preview,
    image_b64: bytesToBase64(result.raw_bytes),
    bytes: result.raw_bytes.byteLength,
  };
}
