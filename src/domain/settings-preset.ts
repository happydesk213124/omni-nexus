import { deepcopy } from '../core/util/object';

export const SETTINGS_PRESET_FORMAT = 'omni-nexus-settings-preset';
export const NOTE_KEYS = ['author_note', 'asset_author_note', 'global_author_note'] as const;
export type NoteKey = typeof NOTE_KEYS[number];
type Bag = Record<string, unknown>;
export interface SettingsPreset {
  id: string;
  name: string;
  description: string;
  settings: { card: Bag; nai: Bag };
  prompts: Record<NoteKey, string>;
  builtin?: boolean;
}

const STYLE_KEYS = new Set(['presets', 'active_preset_id', 'secondary_preset_id', 'custom_pos', 'custom_neg', 'preset', 'preset_from_image_filter', 'fixed_prompt_prefix', 'fixed_prompt_suffix']);
const LOCAL_KEYS = /^(?:overlay_pin_|viewer_(?:left|top|width|height|icon|geo)|studio_|command_presets$|client_direction$|client_focus$|original_text$)/;
const NAI_KEYS = ['model', 'width', 'height', 'sampler', 'sampler_v4', 'sampler_v5', 'scheduler', 'steps', 'steps_v4', 'steps_v5', 'cfg_scale', 'cfg_rescale', 'seed', 'variety_plus', 'uc_preset', 'apply_quality_tags', 'sdxl_emphasis'] as const;
export function record(raw: unknown): Bag {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Bag : {};
}
const scalar = (value: unknown): boolean => typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));

/** A positive field list keeps connection credentials and style collections out of portable files. */
export function portableSettings(raw: unknown, defaults: unknown): SettingsPreset['settings'] {
  const source = record(raw), floor = record(defaults), card: Bag = {}, nai: Bag = {};
  for (const key of Object.keys(record(floor.card))) {
    if (STYLE_KEYS.has(key) || LOCAL_KEYS.test(key)) continue;
    const value = record(source.card)[key];
    if (scalar(value)) card[key] = value;
  }
  for (const key of NAI_KEYS) {
    const value = record(source.nai)[key];
    if (scalar(value)) nai[key] = value;
  }
  return { card, nai };
}

export function normalizeSettingsPreset(raw: unknown, defaults: unknown, fallbackName = ''): SettingsPreset {
  const doc = record(raw);
  if (doc.format != null && doc.format !== SETTINGS_PRESET_FORMAT) throw new Error('설정 프리셋 JSON이 아닙니다.');
  if (doc.format && doc.version !== 1) throw new Error('지원하지 않는 프리셋 버전입니다.');
  const settings = record(doc.settings ?? doc);
  if (!Object.keys(record(settings.card)).length) throw new Error('일반 설정(card)이 없는 JSON입니다.');
  const name = String(doc.name || fallbackName).trim().slice(0, 80);
  if (!name) throw new Error('프리셋 이름을 입력하세요.');
  const prompts = record(doc.prompts ?? settings.prompts);
  const notes = Object.fromEntries(NOTE_KEYS.map(key => [key, typeof prompts[key] === 'string' ? prompts[key] : ''])) as Record<NoteKey, string>;
  if (NOTE_KEYS.some(key => notes[key].length > 100_000)) throw new Error('작가의 노트가 너무 깁니다.');
  const portable = portableSettings(settings, defaults);
  if (!Object.keys(portable.card).length) throw new Error('불러올 일반 설정이 없는 JSON입니다.');
  if (typeof portable.card.comic_author_note !== 'string') portable.card.comic_author_note = '';
  return { id: String(doc.id || '').slice(0, 100), name, description: String(doc.description || '').slice(0, 400), settings: portable, prompts: notes };
}

export function settingsPresetJson(preset: SettingsPreset): string {
  return JSON.stringify({ format: SETTINGS_PRESET_FORMAT, version: 1, name: preset.name, description: preset.description, settings: preset.settings, prompts: preset.prompts }, null, 2);
}

export function applyPresetSettings(current: unknown, defaults: unknown, preset: SettingsPreset): Bag {
  const next = deepcopy(record(current));
  const floor = portableSettings(defaults, defaults);
  const values = portableSettings(preset.settings, defaults);
  next.card = { ...record(next.card), ...floor.card, ...values.card };
  next.nai = { ...record(next.nai), ...floor.nai, ...values.nai };
  return next;
}
