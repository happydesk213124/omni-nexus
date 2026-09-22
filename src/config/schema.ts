/** Settings migration + export/import. Pure: no storage, no I/O. */

import type { FocusCharacterMode, FocusPromptMode } from '../core/types.ts';
import { parseStreamKeywords } from '../domain/prompt/stream-keywords.ts';
import { normalizeLlmRolesSettings } from '../domain/llm/roles.ts';
import { naiStepsForFamily, normalizeNaiSampler, optionalNaiSampler } from '../domain/nai/samplers.ts';
import { normalizeComicCoordsMode } from '../domain/comic/coords.ts';
import { comicGenOn } from '../domain/comic/kind.ts';
import { normalizeComicAspect } from '../domain/comic/aspect.ts';
import { normalizeComicGenRatio, normalizeComicLlmBatch, normalizeComicMaxPages, normalizeComicSchedule } from '../domain/comic/params.ts';
import { normalizeInlineChatTextSide } from '../domain/inline-chat.ts';
import { normalizeInlineMsgActions } from '../domain/inline-msg-actions.ts';
import { normalizeImagePressInspect, normalizeToastAnchor } from '../domain/toast-press.ts';

/** NovelAI base natural-language mode (replaces the old boolean toggle). */
export type NaturalBaseMode = 'off' | 'short' | 'detailed' | 'supplement';

export type { FocusCharacterMode, FocusPromptMode };

const FOCUS_CHARACTER_MODES = new Set<FocusCharacterMode>(['off', 'female', 'male', 'auto']);
const FOCUS_PROMPT_MODES = new Set<FocusPromptMode>(['default', 'strong', 'always', 'manual']);

/** Clamp card.focus_weight to 0–5, one decimal (missing/NaN → 2). */
export function normalizeFocusWeight(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 2;
  return Math.max(0, Math.min(5, Math.round(n * 10) / 10));
}

/** Normalize `card.focus_prompt`. Missing/unknown → `default`. */
export function normalizeFocusPromptMode(value: unknown): FocusPromptMode {
  const s = String(value ?? '').toLowerCase().trim();
  if (s === 'stronger' || s === 'hard' || s === 'push') return 'strong';
  if (s === 'force' || s === 'forced' || s === 'must' || s === 'required') return 'always';
  if (s === 'code' || s === 'gender' || s === 'auto_gender') return 'manual';
  if (FOCUS_PROMPT_MODES.has(s as FocusPromptMode)) return s as FocusPromptMode;
  return 'default';
}

/** Normalize `card.focus_character`. Missing/unknown → `off`. */
export function normalizeFocusCharacterMode(value: unknown): FocusCharacterMode {
  if (value === false || value === 'false' || value === 0 || value === '0' || value === 'none') return 'off';
  if (value === true || value === 'true' || value === 1 || value === '1' || value === 'on') return 'auto';
  const s = String(value ?? '').toLowerCase().trim();
  if (s === 'woman' || s === 'women' || s === 'girl' || s === 'girls') return 'female';
  if (s === 'man' || s === 'men' || s === 'boy' || s === 'boys') return 'male';
  if (s === 'llm' || s === 'any' || s === 'free') return 'auto';
  if (FOCUS_CHARACTER_MODES.has(s as FocusCharacterMode)) return s as FocusCharacterMode;
  return 'off';
}

/** How matched Risu asset NAI tags are fed to the tagger. */
export type AssetNaiTagsMode = 'off' | 'inline' | 'prepass';

const NATURAL_BASE_MODES = new Set<NaturalBaseMode>(['off', 'short', 'detailed', 'supplement']);
const ASSET_NAI_TAGS_MODES = new Set<AssetNaiTagsMode>(['off', 'inline', 'prepass']);

/** Clamp card.person_tag_weight to 0–5 (missing/NaN → 3). */
export function normalizePersonTagWeight(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.max(0, Math.min(5, Math.round(n)));
}

/**
 * Normalize `card.asset_nai_tags` from legacy booleans / unknown strings.
 * Legacy true / `prepass_vision` → `prepass` (vision-on-looks-LLM was removed).
 */
export function normalizeAssetNaiTagsMode(value: unknown): AssetNaiTagsMode {
  if (value === true || value === 'true' || value === 1 || value === '1' || value === 'on') {
    return 'prepass';
  }
  if (
    value === false
    || value === 'false'
    || value === 0
    || value === '0'
    || value === 'off'
    || value === 'none'
    || value == null
    || value === ''
  ) {
    return 'off';
  }
  const s = String(value).toLowerCase().trim();
  if (s === 'legacy' || s === 'together' || s === 'single') return 'inline';
  if (s === 'split' || s === 'looks') return 'prepass';
  if (s === 'vision' || s === 'split_vision' || s === 'prepass+vision' || s === 'prepass_vision') return 'prepass';
  if (ASSET_NAI_TAGS_MODES.has(s as AssetNaiTagsMode)) return s as AssetNaiTagsMode;
  return 'off';
}

export type MessageSelectGesture = 'single' | 'double' | 'context' | 'longpress';

/** Normalize `card.message_select_gesture`. Missing/unknown → `single`. */
export function normalizeMessageSelectGesture(value: unknown): MessageSelectGesture {
  const v = String(value ?? '').toLowerCase().trim();
  if (v === 'double' || v === 'dbl' || v === '2' || v === 'dblclick') return 'double';
  if (v === 'context' || v === 'right' || v === 'contextmenu' || v === 'rightclick') return 'context';
  if (v === 'longpress' || v === 'long' || v === 'press' || v === 'hold') return 'longpress';
  return 'single';
}

/**
 * Normalize `card.natural_base` from legacy booleans / unknown strings.
 * Missing or unknown → `short` (matches the old default of `true`).
 */
export function normalizeNaturalBaseMode(value: unknown): NaturalBaseMode {
  if (value === false || value === 'false' || value === 'off' || value === 'none') return 'off';
  if (value === true || value === 'true' || value === 'on') return 'short';
  if (value === 'detailed' || value === 'detail') return 'detailed';
  if (value === 'supplement' || value === 'supp') return 'supplement';
  if (typeof value === 'string' && NATURAL_BASE_MODES.has(value as NaturalBaseMode)) {
    return value as NaturalBaseMode;
  }
  return 'short';
}

/** What `migrateSettings` guarantees on the way out — everything else stays as found. */
export interface MigratedSettings {
  card: Record<string, unknown>;
  settings_schema_version: number;
  [key: string]: unknown;
}

/**
 * JSON round trip on purpose: it drops functions, symbols and `undefined`, which
 * is what keeps a live settings object safe to hand to `JSON.stringify` later.
 */
const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? {})) as T;

/**
 * Keys dropped from an exported settings file, compared lowercase so `API_KEY`
 * is caught too.
 *
 * Note that `service_account_json` is deliberately NOT in this set, matching the
 * deployed behaviour: exports are also how users move settings between devices,
 * and dropping the Vertex credential would silently break Vertex on the target
 * machine. It does mean an exported file can carry a Google service-account
 * private key, so treat exports as secrets.
 */
const SECRET_KEYS = new Set(['api_key', 'api_keys_v5', 'api_keys_v4', 'auth_token', 'password', 'secret']);

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(name.toLowerCase())) continue;
    out[name] = redactSecrets(child);
  }
  return out;
}

/** Drop in-memory preset/NAI preview data URLs. They are rebuilt on GET, not stored. */
export function stripEphemeralPreviewUrls(settings: unknown): void {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
  const s = settings as Record<string, unknown>;
  const card = s.card && typeof s.card === 'object' && !Array.isArray(s.card)
    ? s.card as Record<string, unknown>
    : null;
  if (Array.isArray(card?.presets)) {
    for (const raw of card.presets) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const p = raw as Record<string, unknown>;
      delete p.vibe_preview_url;
      delete p.look_preview_url;
    }
  }
  const nai = s.nai && typeof s.nai === 'object' && !Array.isArray(s.nai)
    ? s.nai as Record<string, unknown>
    : null;
  if (nai) {
    delete nai.vibe_preview_url;
    delete nai.reference_preview_url;
  }
}

/** Bring any stored settings blob up to the current schema (clone in, clone out). */
export function migrateSettings(input: unknown = {}): MigratedSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Settings must be an object');
  const settings = jsonClone(input) as Record<string, unknown>;
  const card = settings.card && typeof settings.card === 'object' && !Array.isArray(settings.card)
    ? settings.card as Record<string, unknown>
    : {};
  settings.card = card;
  if (Number(card.scale_semantics_version || 0) < 2) {
    const legacy = Number(card.inline_thumb_pct);
    // 0% is valid (hide always-image by size); only coerce non-finite → 100.
    card.inline_thumb_pct = Number.isFinite(legacy) ? Math.max(0, legacy / 6) : 100;
    card.scale_semantics_version = 2;
  }
  // Sticky pin: prefer stored %; mark unit/origin so clients and future merges stay consistent.
  const hasPinPct =
    Number.isFinite(Number(card.overlay_x_pct)) ||
    Number.isFinite(Number(card.overlay_y_pct));
  if (hasPinPct || card.overlay_pin_unit === 'pct') {
    card.overlay_pin_unit = 'pct';
    const origin = String(card.overlay_pin_origin || '');
    if (!origin || origin === 'bottom-left') card.overlay_pin_origin = 'bl';
  }
  // lore_extra: boolean → "tags" | "full" | "off"
  const loreExtra = card.lore_extra;
  if (loreExtra === true || loreExtra === 'true' || loreExtra === 'sections') card.lore_extra = 'tags';
  else if (loreExtra === false || loreExtra === 'false' || loreExtra === 'none') card.lore_extra = 'off';
  else if (loreExtra === 'full' || loreExtra === 'tags' || loreExtra === 'off') card.lore_extra = loreExtra;
  else card.lore_extra = 'tags';
  // asset_nai_tags: off | inline | prepass (legacy bool / prepass_vision → prepass)
  card.asset_nai_tags = normalizeAssetNaiTagsMode(card.asset_nai_tags);
  card.image_analysis_separate = card.image_analysis_separate === true;
  card.auto_aspect = card.auto_aspect === true || card.auto_aspect === 'true' || card.auto_aspect === 1 || card.auto_aspect === '1';
  card.llm_json_retry =
    card.llm_json_retry === true
    || card.llm_json_retry === 'true'
    || card.llm_json_retry === 1
    || card.llm_json_retry === '1'
    || card.llm_json_retry === 'on';
  card.llm_reverse_bar =
    card.llm_reverse_bar === true
    || card.llm_reverse_bar === 'true'
    || card.llm_reverse_bar === 1
    || card.llm_reverse_bar === '1'
    || card.llm_reverse_bar === 'on';
  card.llm_tag_cal =
    card.llm_tag_cal === true
    || card.llm_tag_cal === 'true'
    || card.llm_tag_cal === 1
    || card.llm_tag_cal === '1'
    || card.llm_tag_cal === 'on';
  // natural_base: legacy boolean → "off" | "short" | "detailed" | "supplement"
  card.natural_base = normalizeNaturalBaseMode(card.natural_base);
  // person_tag_solo: one-character shots use `solo` instead of 1girl/1boy
  card.person_tag_solo =
    card.person_tag_solo === true
    || card.person_tag_solo === 'true'
    || card.person_tag_solo === 1
    || card.person_tag_solo === '1'
    || card.person_tag_solo === 'on';
  card.no_humans_when_no_char =
    card.no_humans_when_no_char === true
    || card.no_humans_when_no_char === 'true'
    || card.no_humans_when_no_char === 1
    || card.no_humans_when_no_char === '1'
    || card.no_humans_when_no_char === 'on';
  // person_tag_weight: NAI emphasis on Inlay person-count tags (0 = plain, 1–5 = N::…::)
  card.person_tag_weight = normalizePersonTagWeight(card.person_tag_weight);
  card.message_select_gesture = normalizeMessageSelectGesture(card.message_select_gesture);
  // costume: main-tagger catalog inject (char_looks always builds costumes[])
  card.costume =
    card.costume === true
    || card.costume === 'true'
    || card.costume === 1
    || card.costume === '1'
    || card.costume === 'on';
  card.focus_character = normalizeFocusCharacterMode(card.focus_character);
  card.focus_weight = normalizeFocusWeight(card.focus_weight);
  card.focus_prompt = normalizeFocusPromptMode(card.focus_prompt);
  // Retired curation pipeline: drop the settings block, pin the legacy card flag off.
  // Stored catalog/embedding rows and shot-level curation fields are left inert.
  delete (settings as Record<string, unknown>).curation;
  card.composition_curation = false;
  // llm_roles: autotag / asset_char — missing → follow_main true
  settings.llm_roles = normalizeLlmRolesSettings(settings.llm_roles);
  // Overlay pins are retired: keep sync keys but never paint left-line sticky.
  card.overlay_markers = false;
  card.inline_previews = false;
  card.floating_viewer = card.floating_viewer !== false;
  card.tts_on = card.tts_on === true || card.tts_on === 'true' || card.tts_on === 1 || card.tts_on === '1' || card.tts_on === 'on';
  {
    const rate = Number(card.tts_rate);
    card.tts_rate = Number.isFinite(rate) ? Math.max(0.5, Math.min(2, rate)) : 1;
  }
  card.tts_voice = String(card.tts_voice ?? '').trim().slice(0, 200);
  card.inline_chat_images = true;
  card.persist_chat_images = true;
  card.llm_anchor_percent = false;
  card.omni_helper_prompt = card.omni_helper_prompt === true;
  if (card.persist_chat_images_folded == null) card.persist_chat_images_folded = false;
  else card.persist_chat_images_folded = card.persist_chat_images_folded === true || card.persist_chat_images_folded === 'true' || card.persist_chat_images_folded === 1 || card.persist_chat_images_folded === '1';
  if (card.scroll_hold == null) card.scroll_hold = false;
  else card.scroll_hold = card.scroll_hold === true || card.scroll_hold === 'true' || card.scroll_hold === 1 || card.scroll_hold === '1';
  card.inline_chat_text_side = normalizeInlineChatTextSide(card.inline_chat_text_side);
  card.inline_msg_actions = normalizeInlineMsgActions(card.inline_msg_actions);
  if (card.inline_msg_fan == null) card.inline_msg_fan = false;
  else card.inline_msg_fan = card.inline_msg_fan === true || card.inline_msg_fan === 'true' || card.inline_msg_fan === 1 || card.inline_msg_fan === '1' || card.inline_msg_fan === 'on';
  {
    const raw = Number(card.inline_chat_scale_pct);
    card.inline_chat_scale_pct = Number.isFinite(raw) && raw > 0
      ? Math.max(25, Math.min(200, Math.round(raw)))
      : 100;
  }
  {
    const raw = Number(card.inline_chat_dom_radius);
    card.inline_chat_dom_radius = Number.isFinite(raw) && raw > 0
      ? Math.max(3, Math.min(20, Math.round(raw)))
      : 4;
  }
  if (card.progress_toast == null) card.progress_toast = false;
  else card.progress_toast = card.progress_toast === true || card.progress_toast === 'true' || card.progress_toast === 1 || card.progress_toast === '1';
  card.toast_anchor = normalizeToastAnchor(card.toast_anchor);
  card.image_press_inspect = normalizeImagePressInspect(card.image_press_inspect);
  {
    const mode = String(card.char_ref_mode || 'off').toLowerCase();
    card.char_ref_mode = mode === 'vibe' || mode === 'image' ? mode : 'off';
    const clamp01 = (raw: unknown, fallback: number) => {
      const n = Number(raw);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(0.01, Math.min(1, n));
    };
    card.char_ref_strength = clamp01(card.char_ref_strength, 0.6);
    card.char_ref_fidelity = clamp01(card.char_ref_fidelity, 1);
    {
      const t = String(card.char_ref_image_type || 'character&style').toLowerCase();
      card.char_ref_image_type =
        t === 'character' || t === 'style' || t === 'character&style' ? t : 'character&style';
    }
  }
  card.unified_winners_only =
    card.unified_winners_only === true
    || card.unified_winners_only === 'true'
    || card.unified_winners_only === 1
    || card.unified_winners_only === '1'
    || card.unified_winners_only === 'on';
  card.stream_keywords = String(card.stream_keywords ?? '').slice(0, 4000);
  if (Object.prototype.hasOwnProperty.call(card, 'stream_keywords_enabled')) {
    card.stream_keywords_enabled =
      card.stream_keywords_enabled === true
      || card.stream_keywords_enabled === 'true'
      || card.stream_keywords_enabled === 1
      || card.stream_keywords_enabled === '1'
      || card.stream_keywords_enabled === 'on';
  } else {
    // Pre-toggle saves: non-empty usable needles meant on.
    card.stream_keywords_enabled = parseStreamKeywords(card.stream_keywords).length > 0;
  }
  // Always-on fixed prompt wrappers (empty = unused). Cap keeps settings JSON lean.
  card.fixed_prompt_prefix = String(card.fixed_prompt_prefix ?? '').trim().slice(0, 8000);
  card.fixed_prompt_suffix = String(card.fixed_prompt_suffix ?? '').trim().slice(0, 8000);
  card.secondary_preset_id = String(card.secondary_preset_id ?? '').trim().slice(0, 120);
  const flagOn = (raw: unknown, fallback: boolean): boolean => {
    if (raw == null || raw === '') return fallback;
    return raw === true || raw === 'true' || raw === 1 || raw === '1' || raw === 'on';
  };
  card.nai5_first = flagOn(card.nai5_first, false);
  card.nai5_only = flagOn(card.nai5_only, false);
  card.preset_from_image_filter = flagOn(card.preset_from_image_filter, true);
  card.nai4_fallback = flagOn(card.nai4_fallback, false);
  card.nai5_speech = flagOn(card.nai5_speech, false);
  card.studio_seed_lock = flagOn(card.studio_seed_lock, false);
  {
    const raw = card.studio_folds && typeof card.studio_folds === 'object' && !Array.isArray(card.studio_folds)
      ? card.studio_folds as Record<string, unknown>
      : {};
    const folds: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(raw)) {
      const id = String(key || '').trim().slice(0, 80);
      if (!id) continue;
      folds[id] = value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
    }
    card.studio_folds = folds;
  }
  {
    const lang = String(card.v5_natural_lang || 'en').toLowerCase().trim();
    card.v5_natural_lang = lang === 'ja' || lang === 'jp' || lang === 'japanese' ? 'ja' : 'en';
  }
  // Missing → on (new toggle; no legacy off).
  card.nai_use_coords = card.nai_use_coords == null || card.nai_use_coords === ''
    ? true
    : flagOn(card.nai_use_coords, true);
  card.comic_gen = comicGenOn(card) ? 'on' : 'off';
  card.comic_natural_supplement = flagOn(card.comic_natural_supplement, false);
  card.comic_author_note = String(card.comic_author_note ?? '').trim().slice(0, 8000);
  card.comic_llm_batch = normalizeComicLlmBatch(card.comic_llm_batch);
  card.comic_schedule = normalizeComicSchedule(card.comic_schedule);
  card.comic_max_pages = normalizeComicMaxPages(card.comic_max_pages);
  if (card.comic_gen_ratio == null || card.comic_gen_ratio === '') {
    card.comic_gen_ratio = card.comic_max_pages === 0 ? 0 : 50;
  } else {
    card.comic_gen_ratio = normalizeComicGenRatio(card.comic_gen_ratio);
  }
  card.comic_coords = normalizeComicCoordsMode(card.comic_coords);
  card.comic_aspect = normalizeComicAspect(card.comic_aspect);
  card.comic_prompt = String(card.comic_prompt ?? '').trim().slice(0, 8000);
  card.comic_uc = String(card.comic_uc ?? '').trim().slice(0, 8000);
  if (card.comic_prompt_prefix == null) {
    card.comic_prompt_prefix = card.comic_prompt;
  } else {
    card.comic_prompt_prefix = String(card.comic_prompt_prefix).trim().slice(0, 8000);
  }
  card.comic_prompt_suffix = String(card.comic_prompt_suffix ?? '').trim().slice(0, 8000);
  {
    const optNum = (v: unknown): number | '' => {
      if (v == null || v === '') return '';
      const n = Number(v);
      return Number.isFinite(n) ? n : '';
    };
    card.comic_steps = optNum(card.comic_steps);
    card.comic_cfg_scale = optNum(card.comic_cfg_scale);
    card.comic_cfg_rescale = optNum(card.comic_cfg_rescale);
    card.comic_sampler = optionalNaiSampler(card.comic_sampler) || '';
  }
  if (!Array.isArray(card.command_presets)) card.command_presets = [];
  else {
    const out: Array<{ id: string; name: string; cmd: string; cmd_post?: string }> = [];
    for (const raw of card.command_presets) {
      if (!raw || typeof raw !== 'object') continue;
      const p = raw as Record<string, unknown>;
      const id = String(p.id || '').trim().slice(0, 120);
      const name = String(p.name || '').trim().slice(0, 200);
      const cmd = String(p.cmd || p.instruction || '').trim().slice(0, 4000);
      const cmdPost = String(p.cmd_post || p.cmdPost || '').trim().slice(0, 2000);
      if (!id && !name && !cmd) continue;
      out.push({
        id: id || `cmd_${out.length}`,
        name: name || `명령 ${out.length + 1}`,
        cmd,
        ...(cmdPost ? { cmd_post: cmdPost } : {}),
      });
    }
    card.command_presets = out;
  }
  if (Array.isArray(card.presets)) {
    for (const raw of card.presets) {
      if (!raw || typeof raw !== 'object') continue;
      const p = raw as Record<string, unknown>;
      const fam = String(p.model_family || '').toLowerCase();
      p.model_family = fam === 'v5' || fam === '5' || fam === 'nai5' ? 'v5' : 'v4';
      const optNum = (v: unknown): number | null => {
        if (v == null || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      if ('steps' in p) p.steps = optNum(p.steps);
      if ('sampler' in p) p.sampler = optionalNaiSampler(p.sampler);
      if ('scheduler' in p) {
        const s = String(p.scheduler || '').trim();
        p.scheduler = s || null;
      }
    }
  }
  stripEphemeralPreviewUrls(settings);
  {
    const nai = settings.nai && typeof settings.nai === 'object' && !Array.isArray(settings.nai)
      ? settings.nai as Record<string, unknown>
      : {};
    settings.nai = nai;
    const list = (raw: unknown): string[] => {
      if (!Array.isArray(raw)) return [];
      const seen = new Set<string>();
      const out: string[] = [];
      for (const item of raw) {
        const t = String(item || '').trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
      }
      return out;
    };
    nai.api_keys_v5 = list(nai.api_keys_v5);
    nai.api_keys_v4 = list(nai.api_keys_v4);
    // SDXL식 강조 변환 토글. 없는 저장값 → off(기존 동작 유지).
    {
      const v = nai.sdxl_emphasis;
      nai.sdxl_emphasis = v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
    }
    // Frozen UI has no UC preset control; leftover human_focus appended a long UC block.
    nai.uc_preset = 'none';
    const sharedSteps = naiStepsForFamily({ steps: nai.steps }, 'v4');
    const sharedSampler = normalizeNaiSampler(nai.sampler);
    nai.sampler = sharedSampler;
    nai.sampler_v5 = normalizeNaiSampler(nai.sampler_v5 || sharedSampler);
    nai.sampler_v4 = normalizeNaiSampler(nai.sampler_v4 || sharedSampler);
    nai.steps = sharedSteps;
    nai.steps_v5 = nai.steps_v5 == null || nai.steps_v5 === ''
      ? sharedSteps
      : naiStepsForFamily({ steps_v5: nai.steps_v5, steps: sharedSteps }, 'v5');
    nai.steps_v4 = nai.steps_v4 == null || nai.steps_v4 === ''
      ? sharedSteps
      : naiStepsForFamily({ steps_v4: nai.steps_v4, steps: sharedSteps }, 'v4');
  }
  // sticky_layout_v2 was a temporary toggle; v2 is always-on — drop leftover saves.
  if (card && typeof card === 'object' && 'sticky_layout_v2' in card) delete card.sticky_layout_v2;
  {
    const mm = String(card.viewer_minimize_mode || 'buttons');
    // Old modes retired with the galleryUi window: icon → bubble, toolbar/actions → buttons.
    card.viewer_minimize_mode = mm === 'bubble' || mm === 'icon' ? 'bubble' : 'buttons';
  }
  settings.settings_schema_version = 2;
  return settings as MigratedSettings;
}

/** Viewer pin + style presets the user asked reset not to wipe. */
const RESET_WINDOW_KEYS = [
  'overlay_x_offset',
  'overlay_y_offset',
  'overlay_x_pct',
  'overlay_y_pct',
  'overlay_pin_unit',
  'overlay_pin_origin',
] as const;

/**
 * Copy the window pin and card presets onto a factory-reset blob.
 * Secrets stay in the settings service.
 */
export function applySettingsResetKeeps(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): void {
  const prevCard = previous.card && typeof previous.card === 'object' && !Array.isArray(previous.card)
    ? previous.card as Record<string, unknown>
    : undefined;
  const nextCard = next.card && typeof next.card === 'object' && !Array.isArray(next.card)
    ? next.card as Record<string, unknown>
    : undefined;
  if (!prevCard || !nextCard) return;
  for (const key of RESET_WINDOW_KEYS) {
    if (key === 'overlay_pin_unit' || key === 'overlay_pin_origin') {
      if (typeof prevCard[key] === 'string' && prevCard[key]) nextCard[key] = prevCard[key];
      continue;
    }
    if (Number.isFinite(Number(prevCard[key]))) nextCard[key] = Number(prevCard[key]);
  }
  if (Array.isArray(prevCard.presets)) nextCard.presets = jsonClone(prevCard.presets);
  if ('active_preset_id' in prevCard) nextCard.active_preset_id = prevCard.active_preset_id;
  if ('secondary_preset_id' in prevCard) nextCard.secondary_preset_id = prevCard.secondary_preset_id;
}

/** Migrated settings as pretty JSON, minus `SECRET_KEYS` — read its note first. */
export function exportSettings(input: unknown): string {
  return JSON.stringify(redactSecrets(migrateSettings(input)), null, 2);
}

/**
 * Settings export/import carries the prompts pack as a top-level `prompts`
 * map (`{ key: text }`). Split it off before `importSettings`/`deepMerge` so
 * prompt text can never land in the live config — and from there into the
 * settings blob. Prompts live as `meta` rows because they are too large for
 * that blob; the settings pack only ferries them for backup/restore.
 */
export function splitSettingsDocPrompts(doc: unknown): {
  settings: Record<string, unknown>;
  prompts: Record<string, string> | null;
} {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { settings: {}, prompts: null };
  const { prompts, ...rest } = doc as Record<string, unknown>;
  if (!prompts || typeof prompts !== 'object' || Array.isArray(prompts)) {
    return { settings: rest, prompts: null };
  }
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(prompts as Record<string, unknown>)) {
    if (typeof k === 'string' && typeof v === 'string') map[k] = v;
  }
  return { settings: rest, prompts: map };
}

/** Parse and migrate a settings JSON document, rejecting anything that is not an object. */
export function importSettings(text: unknown): MigratedSettings {
  if (typeof text !== 'string') throw new TypeError('Settings JSON must be text');
  if (text.length > 2_000_000) throw new RangeError('Settings JSON is too large');
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('Settings JSON must contain an object');
  return migrateSettings(parsed);
}
