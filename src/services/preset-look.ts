/**
 * Per-style-preset look shots: a picker preview, not vibe / director ref.
 * Bytes live in the character-ref module at the same webp cap; settings
 * store only `look_hash`.
 */

import { API_URL } from '../core/constants';
import type { ApiResult, StylePreset } from '../core/types';
import { PRESET_LOOK_WEBP_QUALITY } from '../core/util/char-ref-size';
import { pngToDataUrl } from '../storage/image-urls';
import { cleanText } from '../core/util/text';
import { sanitizeHash } from '../domain/character/char-ref-store';
import { tokensForFamily } from '../domain/nai/keys';
import { naiSamplerForFamily, naiStepsForFamily } from '../domain/nai/samplers';
import { findPresetById, modelForFamily, normalizeNaiFamily, type NaiFamily } from '../domain/nai/routing';
import { joinPresetLookPrompt } from '../domain/style-presets/look-prompt';
import { resolveGenerationCfgParams } from '../domain/style-preset-overrides';
import { generateViaComfy, imageBackendKind } from '../providers/comfy/client';
import { generateT2i } from '../providers/nai/client';
import { modelToNaia, type T2iRequest } from '../providers/nai/payload';
import { getCharRefAssetBytes, putCharRefAsset } from './char-ref-module';
import { getConfig, setPresetLookPreviewUrl } from './context';
import { saveConfig } from './settings';

const MIN_IMAGE_BYTES = 32;

function optionalBodyNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function requirePreset(presetId: string): StylePreset {
  const id = cleanText(presetId, 120);
  if (!id) throw new Error('preset_id required');
  const presets = getConfig().card?.presets;
  const row = Array.isArray(presets) ? findPresetById(presets, id) : null;
  if (!row) throw new Error('프리셋을 찾지 못했습니다');
  return row;
}

async function storeLookBytes(presetId: string, bytes: ArrayBuffer): Promise<ApiResult> {
  const id = cleanText(presetId, 120);
  const stored = await putCharRefAsset(bytes, { quality: PRESET_LOOK_WEBP_QUALITY });
  const row = requirePreset(id);
  row.look_hash = stored.hash;
  const preview = pngToDataUrl(stored.bytes);
  setPresetLookPreviewUrl(id, preview);
  await saveConfig();
  return {
    ok: true,
    preset_id: id,
    look_hash: stored.hash,
    configured: true,
    preview_url: preview,
    bytes: stored.bytes.byteLength,
  };
}

export async function setPresetLook(presetId: string, png: ArrayBuffer): Promise<ApiResult> {
  if (!png || png.byteLength < MIN_IMAGE_BYTES) throw new Error('참고 이미지가 비어 있습니다');
  requirePreset(presetId);
  return storeLookBytes(presetId, png);
}

export async function clearPresetLook(presetId: string): Promise<ApiResult> {
  const id = cleanText(presetId, 120);
  const row = requirePreset(id);
  delete row.look_hash;
  setPresetLookPreviewUrl(id, '');
  await saveConfig();
  return { ok: true, preset_id: id, configured: false, preview_url: '' };
}

export async function generatePresetLook(body: Record<string, unknown>): Promise<ApiResult> {
  const id = cleanText(body.preset_id || body.presetId || '', 120);
  const row = requirePreset(id);
  const positive = body.positive != null ? String(body.positive) : String(row.positive || '');
  const negative = body.negative != null ? String(body.negative) : String(row.negative || '');
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
    cfg_scale: optionalBodyNum(body.cfg_scale) ?? row.cfg_scale,
    cfg_rescale: optionalBodyNum(body.cfg_rescale) ?? row.cfg_rescale,
    steps: optionalBodyNum(body.steps) ?? row.steps,
    sampler: body.sampler != null && String(body.sampler).trim() ? String(body.sampler) : row.sampler,
    scheduler: body.scheduler != null && String(body.scheduler).trim() ? String(body.scheduler) : row.scheduler,
  });
  const model = modelToNaia(modelForFamily(nai, family));
  const req: T2iRequest = {
    prompt: joinPresetLookPrompt(positive),
    negative_prompt: negative,
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
      req.prompt,
      negative,
      [],
    );
    return storeLookBytes(id, bytes);
  }
  const apiUrl = cleanText(nai.request_url) || API_URL;
  const result = await generateT2i(token, req, apiUrl, { timeoutMs: 180000 });
  return storeLookBytes(id, result.raw_bytes);
}

export async function hydratePresetLookPreviews(): Promise<void> {
  const presets = getConfig().card?.presets;
  if (!Array.isArray(presets)) return;
  for (const raw of presets) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as StylePreset;
    const id = cleanText(p.id, 120);
    const hash = sanitizeHash(p.look_hash);
    if (!id || !hash) continue;
    const bytes = await getCharRefAssetBytes(hash);
    if (!bytes || bytes.byteLength < MIN_IMAGE_BYTES) continue;
    setPresetLookPreviewUrl(id, pngToDataUrl(bytes));
  }
}
