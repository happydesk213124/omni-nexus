/**
 * Frozen identifiers and storage keys.
 *
 * WARNING: every key in this file is load-bearing for existing installs. Risu
 * namespaces plugin storage by the plugin id, and these keys address rows inside
 * that namespace. Renaming any of them orphans user data with no way back.
 */

declare const __PLUGIN_VERSION__: string;

export const VERSION: string = typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : '0.1.1';

/**
 * Bumping this re-seeds the prompt pack over user edits for FORCE_PROMPT_KEYS.
 * Only bump it when a prompt change is mandatory for correctness.
 */
export const PROMPT_PACK = '2026-09-19-v35-base-token-teach';

export const PROMPT_KEYS = [
  'author_note', 'asset_author_note', 'global_author_note', 'tagger', 'format', 'prefill', 'prefill_user', 'jailbreak', 'preprocess',
  'preset_1', 'lore_inject', 'char_inject', 'appearance_inject', 'asset_tags_inject', 'char_looks', 'autotag',
  'command_reroll', 'command_char_edit', 'lorefilter_scan',
  'comic',
] as const;

export type PromptKey = (typeof PROMPT_KEYS)[number];

/** Prompts that must track the shipped pack even if the user edited them. */
export const FORCE_PROMPT_KEYS: readonly PromptKey[] = [
  'tagger', 'format', 'appearance_inject', 'lore_inject', 'asset_tags_inject', 'char_looks', 'autotag',
  'command_reroll', 'command_char_edit', 'comic',
];

export const GLOBAL_SCOPE = '__global__';

// --- save-file keys (`risuai.pluginStorage`). Device IDB is one-time migrate. ---
// Image pixels stay in the shot module, not these rows.
export const SETTINGS_KEY = 'onx_native_settings';
export const STORE_KEY = (name: string): string => `onx_nxstore_${name}`;
/**
 * One character-chat's cards and image address book.
 *
 * `onx_nxstore_cards` held every room in one row, so opening any chat read the
 * whole gallery's metadata. These are read one room at a time. The old keys stay
 * readable — see `stores.ts` for the per-room move.
 */
export const CARD_PACK_KEY = (sessionId: string): string =>
  `onx_nxcards_${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)}`;
/**
 * Which rooms exist, and enough about each to draw the explorer's folder list
 * without opening a single pack.
 */
export const ROOM_INDEX_KEY = 'onx_nxrooms';
/** Per-Risu-session author's note (not `author_note` / `global_author_note`). */
export const SESSION_AUTHOR_NOTE_KEY = (sessionId: string): string =>
  `onx_session_author_note_${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)}`;
/** LLM 명령수정 phrase presets (legacy device row; live list is card.command_presets). */
export const CHAR_COMMAND_PRESETS_KEY = 'onx_char_command_presets';
/** Reusable session-author-note phrases (not the per-session current text). */
export const SESSION_AUTHOR_NOTE_PRESETS_KEY = 'onx_session_author_note_presets';
export const IMAGE_KEY = (id: string): string => `onx_nximg_${String(id).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
/** Wall-clock of the previous boot — a diagnostic stamp, never read for behaviour. */
export const BOOT_STAMP_KEY = 'onx_boot_at';
export const REF_IMAGE_KEY = 'onx_nxref_image';
export const VIBE_IMAGE_KEY = 'onx_nxvibe_image';
export const VIBE_DATA_KEY = 'onx_nxvibe_data';
/** Per-style-preset vibe PNG (device store). */
export const VIBE_PRESET_IMAGE_KEY = (presetId: string): string =>
  `onx_nxvibe_p_${String(presetId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}`;
/** Per-style-preset vibe encode sidecar. */
export const VIBE_PRESET_DATA_KEY = (presetId: string): string =>
  `onx_nxvibe_pd_${String(presetId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}`;
/** Meta row key for a preset's vibe blob. */
export const vibePresetMetaKey = (presetId: string): string => `vibe_preset_${String(presetId)}`;
export const isVibePresetMetaKey = (key: unknown): boolean =>
  typeof key === 'string' && key.startsWith('vibe_preset_');
export const presetIdFromVibeMetaKey = (key: string): string => key.slice('vibe_preset_'.length);

/** Per-character reference image (webp/png/jpeg bytes as-is — no re-encode). */
const CHAR_REF_SCOPED_PREFIX = 'char_ref::';
const CHAR_REF_LEGACY_PREFIX = 'char_ref_';

function sanitizeCharRefPart(raw: unknown): string {
  return String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

/** UI sends `global`/`session`; storage uses `__global__` or the chat session id. */
export function normalizeCharRefScope(scope: unknown, sessionId: unknown = ''): string {
  const raw = String(scope || '').trim();
  if (raw === 'global' || raw === GLOBAL_SCOPE) return GLOBAL_SCOPE;
  if (raw === 'session') return String(sessionId || '').trim().slice(0, 200);
  return raw.slice(0, 200);
}

/**
 * Storage scope for a character's reference image.
 * The roster row's `scope` wins — unified view lists root-chat rows while
 * `lastScope.sessionId` is the unified id, and writing to that id made every
 * card show "없음" after reload.
 */
export function charRefScopeForCharacter(
  recordScope: unknown,
  uiScope: unknown = '',
  sessionId: unknown = '',
): string {
  const rec = String(recordScope || '').trim();
  if (rec && rec !== 'session') return normalizeCharRefScope(rec, sessionId);
  const ui = String(uiScope || '').trim() || (sessionId ? 'session' : '');
  return normalizeCharRefScope(ui, sessionId);
}

export function charRefMetaKey(scope: unknown, characterId: string): string {
  const id = String(characterId || '');
  return `${CHAR_REF_SCOPED_PREFIX}${normalizeCharRefScope(scope)}::${id}`;
}

export const isCharRefMetaKey = (key: unknown): boolean => {
  const k = String(key || '');
  return k.startsWith(CHAR_REF_SCOPED_PREFIX) || k.startsWith(CHAR_REF_LEGACY_PREFIX);
};

export function parseCharRefMetaKey(key: string): { scope: string; characterId: string; legacy: boolean } {
  const k = String(key || '');
  if (k.startsWith(CHAR_REF_SCOPED_PREFIX)) {
    const rest = k.slice(CHAR_REF_SCOPED_PREFIX.length);
    const sep = rest.indexOf('::');
    if (sep >= 0) {
      return { scope: rest.slice(0, sep), characterId: rest.slice(sep + 2), legacy: false };
    }
    return { scope: GLOBAL_SCOPE, characterId: rest, legacy: false };
  }
  // Old `char_ref_<id>` rows were effectively global (id-only).
  if (k.startsWith(CHAR_REF_LEGACY_PREFIX)) {
    return { scope: GLOBAL_SCOPE, characterId: k.slice(CHAR_REF_LEGACY_PREFIX.length), legacy: true };
  }
  return { scope: GLOBAL_SCOPE, characterId: '', legacy: false };
}

export const characterIdFromCharRefMetaKey = (key: string): string =>
  parseCharRefMetaKey(key).characterId;

export function charRefDiskImageKey(metaKey: string): string {
  const p = parseCharRefMetaKey(metaKey);
  if (p.legacy) return `onx_nxcref_${sanitizeCharRefPart(p.characterId)}`;
  return `onx_nxcref_${sanitizeCharRefPart(p.scope)}_${sanitizeCharRefPart(p.characterId)}`;
}

export function charRefDiskDataKey(metaKey: string): string {
  const p = parseCharRefMetaKey(metaKey);
  if (p.legacy) return `onx_nxcrefd_${sanitizeCharRefPart(p.characterId)}`;
  return `onx_nxcrefd_${sanitizeCharRefPart(p.scope)}_${sanitizeCharRefPart(p.characterId)}`;
}

/** @deprecated Use charRefDiskImageKey(metaKey). Legacy id-only disk key. */
export const CHAR_REF_IMAGE_KEY = (characterId: string): string =>
  `onx_nxcref_${sanitizeCharRefPart(characterId)}`;
/** @deprecated Use charRefDiskDataKey(metaKey). */
export const CHAR_REF_DATA_KEY = (characterId: string): string =>
  `onx_nxcrefd_${sanitizeCharRefPart(characterId)}`;

/**
 * Meta row recording that the one-time storage migration ran.
 *
 * Its presence is what lets boot skip the full-store scans that only ever find
 * pre-2.5 data. Absent means "not migrated yet", so boot keeps the old
 * behaviour and a user who never presses the button loses nothing.
 */
export const MIGRATION_META_KEY = 'storage:__migrated__';
export const MIGRATION_VERSION = 3;

/** Dead Inlay Nexus rows and the retired IDB→save copy stamp. Live keys are `onx_*`. */
export function isRetiredStorageKey(key: string): boolean {
  return key.startsWith('inx_') || key === 'onx_ps_from_idb';
}

// --- legacy save-file keys (one-time migration source) ---
export const LEGACY_SETTINGS_KEY = 'native_settings';
export const LEGACY_STORE_KEY = (name: string): string => `nxstore_${name}`;
export const LEGACY_IMAGE_KEY = (id: string): string => `nximg_${String(id).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
export const LEGACY_REF_IMAGE_KEY = 'nxref_image';

// --- external endpoints ---
export const API_URL = 'https://image.novelai.net/ai/generate-image';

/** Empty / default URL is official NAI. Mirrors (Square1, 서브챈) are not. */
export function isOfficialNaiGenerateUrl(url: string | null | undefined): boolean {
  const raw = String(url || '').trim();
  if (!raw) return true;
  try {
    const parsed = new URL(raw);
    return parsed.hostname.toLowerCase() === 'image.novelai.net'
      && /\/ai\/generate-image\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}
export const ENCODE_URL = 'https://image.novelai.net/ai/encode-vibe';
/** July 2026: NovelAI moved /user/* off api.novelai.net (old host returns HTTP 400). */
export const ANLAS_URL = 'https://image.novelai.net/user/subscription';
export const USER_DATA_URL = 'https://image.novelai.net/user/data';
export const USER_PRIORITY_URL = 'https://image.novelai.net/user/priority';

export const STORE_NAMES = ['meta', 'cards', 'characters', 'jobs', 'images'] as const;
export type StoreName = (typeof STORE_NAMES)[number];

export const DEBUG_MAX = 240;

/**
 * How much assistant text a card stores for display and for message rematching.
 * Long enough that the prefix-similarity matcher stays reliable, short enough
 * that a folder of cards does not carry a copy of the whole chat.
 */
export const ASSISTANT_PREVIEW_LIMIT = 4000;
