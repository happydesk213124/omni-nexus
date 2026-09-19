/**
 * Per-shot NAI model + style-preset pick (V5 first, 1st/2nd preset, fallback).
 */
import type { CardSettings, NaiSettings, StylePreset, TaggedShot } from '../../core/types.ts';
import { isNaiV5, resolveModel } from '../../providers/nai/payload.ts';
import { cleanText } from '../../core/util/text.ts';
import { normalizeShotKind } from '../comic/kind.ts';

export type NaiFamily = 'v5' | 'v4';

export const V5_DEFAULT_MODEL = 'nai-diffusion-5-full';
export const V4_DEFAULT_MODEL = 'nai-diffusion-4-5-full';

export interface CharacterReferenceCandidate {
  id: string;
  scope: string;
}

export function characterReferenceCandidates(cast: readonly unknown[]): CharacterReferenceCandidate[] {
  const candidates: CharacterReferenceCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of cast) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const id = cleanText(row.id, 200);
    const scope = cleanText(row.scope, 200);
    const key = `${scope}\0${id}`;
    if (id && scope && !seen.has(key)) {
      seen.add(key);
      candidates.push({ id, scope });
    }
  }
  return candidates;
}

export function effectiveCharacterReferenceMode(
  model: unknown,
  configuredMode: unknown,
): 'off' | 'vibe' | 'image' {
  const resolved = resolveModel(cleanText(model) || V4_DEFAULT_MODEL);
  if (!resolved.includes('nai-diffusion-4-5')) return 'off';
  const mode = cleanText(configuredMode).toLowerCase();
  if (mode === 'vibe') return 'vibe';
  if (mode === 'image') return 'image';
  return 'off';
}

export function shouldPrepareSharedVibe(collectedDirectorReferenceCount: number): boolean {
  return collectedDirectorReferenceCount === 0;
}

export function naiFamilyOfModel(model: unknown): NaiFamily {
  return isNaiV5(model) ? 'v5' : 'v4';
}

export function normalizeNaiFamily(raw: unknown): NaiFamily {
  const s = String(raw || '').toLowerCase().trim();
  if (s === 'v5' || s === '5' || s === 'nai5' || s === 'naiv5') return 'v5';
  return 'v4';
}

export function normalizeShotComplexity(raw: unknown): 'simple' | 'dynamic' | '' {
  const s = String(raw || '').toLowerCase().trim();
  if (s === 'simple' || s === 'static' || s === 'easy') return 'simple';
  if (s === 'dynamic' || s === 'complex' || s === 'hard') return 'dynamic';
  return '';
}

export function cardFlagOn(raw: unknown, fallback = false): boolean {
  if (raw == null || raw === '') return fallback;
  return raw === true || raw === 'true' || raw === 1 || raw === '1' || raw === 'on';
}

export function normalizeV5NaturalLang(raw: unknown): 'en' | 'ja' {
  const s = String(raw || '').toLowerCase().trim();
  if (s === 'ja' || s === 'jp' || s === 'japanese' || s === '日本語') return 'ja';
  return 'en';
}

export function findPresetById(
  presets: readonly unknown[],
  id: string,
): StylePreset | null {
  const want = cleanText(id, 120);
  if (!want) return null;
  for (const item of presets) {
    if (!item || typeof item !== 'object') continue;
    const row = item as StylePreset;
    if (cleanText(row.id, 120) === want) return row;
  }
  return null;
}

export function presetFamily(preset: StylePreset | null | undefined): NaiFamily {
  if (!preset) return 'v4';
  return normalizeNaiFamily(preset.model_family);
}

/** Which model family this shot should generate with (before quota fallback). */
export function resolveShotFamily(
  card: Pick<CardSettings, 'nai5_first' | 'nai5_only'> & Record<string, unknown>,
  nai: Pick<NaiSettings, 'model'>,
  shot: Pick<TaggedShot, 'complexity'> & Record<string, unknown>,
): NaiFamily {
  if (normalizeShotKind((shot as { kind?: unknown }).kind) === 'comic') return 'v5';
  if (cardFlagOn(card.nai5_only, false)) return 'v5';
  if (!cardFlagOn(card.nai5_first, false)) {
    return naiFamilyOfModel(nai.model);
  }
  const complexity = normalizeShotComplexity(shot.complexity);
  if (complexity === 'simple') return 'v4';
  return 'v5';
}

export function modelForFamily(
  nai: Pick<NaiSettings, 'model'>,
  family: NaiFamily,
): string {
  const selected = cleanText(nai.model) || V4_DEFAULT_MODEL;
  if (family === 'v5') {
    return naiFamilyOfModel(selected) === 'v5' ? resolveModel(selected) : V5_DEFAULT_MODEL;
  }
  return naiFamilyOfModel(selected) === 'v4' ? resolveModel(selected) : V4_DEFAULT_MODEL;
}

/**
 * 1st = active_preset_id. 2nd = secondary_preset_id (exclusive in UI).
 * Prefer the preset whose model_family matches the shot; both match → 1st;
 * neither matches → 1st.
 */
export function pickPresetForFamily(
  card: Pick<CardSettings, 'presets' | 'active_preset_id' | 'secondary_preset_id'>,
  family: NaiFamily,
): StylePreset | null {
  const presets = Array.isArray(card.presets) ? card.presets : [];
  if (!presets.length) return null;
  const first = findPresetById(presets, cleanText(card.active_preset_id, 120))
    || (typeof presets[0] === 'object' ? (presets[0] as StylePreset) : null);
  const second = findPresetById(presets, cleanText(card.secondary_preset_id, 120));
  if (first && presetFamily(first) === family) return first;
  if (second && presetFamily(second) === family) return second;
  return first;
}

export interface ShotNaiRoute {
  family: NaiFamily;
  model: string;
  preset: StylePreset | null;
  useV5Natural: boolean;
  useSpeech: boolean;
}

export function resolveShotRoute(
  card: CardSettings,
  nai: NaiSettings,
  shot: TaggedShot,
): ShotNaiRoute {
  const family = resolveShotFamily(card, nai, shot);
  const preset = pickPresetForFamily(card, family);
  const speechOn = cardFlagOn(card.nai5_speech, false);
  return {
    family,
    model: modelForFamily(nai, family),
    preset,
    useV5Natural: family === 'v5',
    useSpeech: speechOn && family === 'v5' && normalizeShotKind(shot.kind) !== 'comic',
  };
}

/** Tagger should emit V5 natural rules when any upcoming shot may go V5. */
export function taggerShouldUseV5Rules(
  card: CardSettings,
  nai: NaiSettings,
): boolean {
  if (cardFlagOn(card.nai5_only, false)) return true;
  if (cardFlagOn(card.nai5_first, false)) return true;
  if (naiFamilyOfModel(nai.model) === 'v5') return true;
  const first = findPresetById(card.presets || [], cleanText(card.active_preset_id, 120));
  const second = findPresetById(card.presets || [], cleanText(card.secondary_preset_id, 120));
  return presetFamily(first) === 'v5' || presetFamily(second) === 'v5';
}

export function isNaiQuotaError(err: unknown): boolean {
  const msg = String((err as Error)?.message || err || '');
  return /HTTP 402\b/i.test(msg) || /anlas|quota|out of points/i.test(msg);
}

export function isNaiRetryableKeyError(err: unknown): boolean {
  const msg = String((err as Error)?.message || err || '');
  if (isNaiQuotaError(err)) return true;
  return /인증 실패|HTTP 401\b|HTTP 429\b|Rate limited/i.test(msg);
}
