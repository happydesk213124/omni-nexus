/**
 * Shared data shapes.
 *
 * These describe what is *persisted* and what crosses the UI boundary, so they
 * double as documentation for `docs/UI-CONTRACT.md`. Fields are intentionally
 * permissive (`?`, `unknown`) where 1.x was permissive — tightening them would
 * reject data that real installs already contain.
 */

// ── settings ──────────────────────────────────────────────────────────────

export type ExecuteMode = 'auto' | 'manual';
export type CardMode = 'illustration' | 'asset';
export type PersonTagMode = 'gender' | 'girls' | 'people' | 'off';
/** Soft bias for optional per-shot focus cast (out of frame on others). */
export type FocusCharacterMode = 'off' | 'female' | 'male' | 'auto';
/** How strongly / whether the tagger is told to emit shot.focus (manual = code path). */
export type FocusPromptMode = 'default' | 'strong' | 'always' | 'manual';
export type LoreExtraMode = 'tags' | 'full' | 'off';
export type LlmSource = 'custom' | 'main' | 'aux' | 'memory' | 'translate' | 'emotion' | 'other';
/** Secondary chat-LLM roles (main tagging stays on `settings.llm`). */
export type LlmRoleId = 'autotag' | 'asset_char' | 'comic';
export type ImageBackend = 'nai' | 'comfy';

export interface CommandPreset {
  id: string;
  name: string;
  cmd: string;
  cmd_post?: string;
}

export interface StylePreset {
  id: string;
  name: string;
  positive: string;
  negative: string;
  /** Empty / null → use NAI model-settings cfg_scale. */
  cfg_scale?: number | null;
  /** Empty / null → use NAI model-settings cfg_rescale. */
  cfg_rescale?: number | null;
  /** Empty / null → use NAI model-settings steps. */
  steps?: number | null;
  /** Empty / null → use NAI model-settings sampler for that family. */
  sampler?: string | null;
  /** Empty / null → use NAI model-settings noise schedule. */
  scheduler?: string | null;
  /** Which NovelAI family this preset is for. Missing → v4. */
  model_family?: 'v5' | 'v4';
  /**
   * Ephemeral / UI: true when this preset has its own vibe image on device.
   * Not a mode select — upload/clear only. Missing → fall back to NAI vibe.
   */
  vibe_configured?: boolean;
  /** Ephemeral preview data URL for the card-settings UI. */
  vibe_preview_url?: string;
  /** SHA-256 of the module-stored look webp. Empty → no preview shot. */
  look_hash?: string;
  /** Ephemeral / UI: true when this preset has a look shot. */
  look_configured?: boolean;
  /** Ephemeral preview data URL for the look thumb. */
  look_preview_url?: string;
}

/** Everything under `settings.card` — mostly UI behaviour plus prompt assembly. */
export interface CardSettings {
  image_analysis_separate?: boolean;
  power: boolean;
  execute: ExecuteMode;
  mode: CardMode;
  image_min: number;
  image_max: number;
  character_max: number;
  include_min: number;
  include_max: number;
  preset: number;
  lorebook: boolean;
  lore_extra: LoreExtraMode;
  /**
   * Matched Risu asset NAI tags for new_characters:
   * off | inline | prepass (legacy bool / prepass_vision migrated in schema).
   */
  asset_nai_tags: 'off' | 'inline' | 'prepass';
  /**
   * When true, tagger picks per-shot aspect (portrait/square/landscape) and
   * generation uses 832×1216 / 1024×1024 / 1216×832 instead of nai.width/height.
   */
  auto_aspect: boolean;
  /**
   * When true, main-tagger JSON parse failure appends the error and retries the
   * LLM once before failing the job.
   */
  llm_json_retry: boolean;
  /** Role-lock + already-accepted prefill turns on every LLM call. */
  llm_reverse_bar: boolean;
  /** Mid-tag `%%` instruct + strip `%` / restore wfsn→nsfw on every LLM reply. */
  llm_tag_cal: boolean;
  char_info: boolean;
  user_info: boolean;
  char_appearance: boolean;
  /** Unused legacy flag — UI removed; keep so old saves do not break. */
  preprocessing: boolean;
  person_tag_mode: PersonTagMode;
  auto_person_tags: boolean;
  /**
   * When true and the shot has exactly one character, put `solo` instead of
   * `1girl`/`1boy` (still emphasized by person_tag_weight). Also applies when
   * person_tag_mode is `off`.
   */
  person_tag_solo: boolean;
  /**
   * When true and the shot has zero characters, append `no humans` at the end
   * of the NAI positive. Independent of person_tag_mode.
   */
  no_humans_when_no_char: boolean;
  /**
   * When true, main tagger injects costume catalogs and may pick/create
   * costumes per shot. Asset char_looks always builds costumes[] regardless.
   */
  costume: boolean;
  /**
   * Optional focus cast: off | female | male | auto.
   * When not off, tagger may set shot `focus`; non-focus captions get out of frame.
   */
  focus_character: FocusCharacterMode;
  /**
   * NAI emphasis on non-focus `out of frame` (0–5, one decimal). Default 2.
   * ≤1 → bare `out of frame`; >1 → `N::out of frame::`.
   */
  focus_weight: number;
  /**
   * Tagger focus instruction: default | strong | always | manual.
   * `manual` skips LLM focus and applies out of frame by gender (female/male mode).
   */
  focus_prompt: FocusPromptMode;
  /**
   * NAI emphasis on Inlay person-count tags (`1girl`, `1boy`, `solo`, …).
   * 0 = plain tags; 1–5 = `N::1girl, 1boy::`. Default 3.
   */
  person_tag_weight: number;
  /**
   * Per-character NAI reference mode (dashboard). Applied to every shot character
   * that has a reference image: off | vibe | image.
   */
  char_ref_mode: string;
  /** 0.01–1 — vibe strength or image Reference Strength. */
  char_ref_strength: number;
  /** 0.01–1 — vibe information_extracted or image Reference Fidelity. */
  char_ref_fidelity: number;
  /** When char_ref_mode is image: character | style | character&style. */
  char_ref_image_type: string;
  /**
   * Always prepended to the assembled positive (after person-count tags, before
   * style preset / scene). Empty = unused.
   */
  fixed_prompt_prefix: string;
  /**
   * Always appended to the assembled positive (before NAI quality tags).
   * Empty = unused.
   */
  fixed_prompt_suffix: string;
  original_text: string;
  custom_pos: string;
  custom_neg: string;
  presets: StylePreset[];
  active_preset_id: string;
  /** 2nd-priority style preset (green). Empty = none. */
  secondary_preset_id: string;
  /** Shot-studio LLM command presets (name + instruction + trailing note). */
  command_presets: CommandPreset[];
  /** When true, simple→V4 and dynamic→V5. Off → selected model for every shot. */
  nai5_first: boolean;
  /** When true, every shot uses V5. Wins over nai5_first and the model-tab pick. */
  nai5_only: boolean;
  /** Per-shot: V5 quota gone → that shot only uses V4.5 + NAI4 preset. */
  nai4_fallback: boolean;
  /** V5 shots: speech → main tags. */
  nai5_speech: boolean;
  /** Tag studio seed-lock toggle. Persists across opens; seed number does not. */
  studio_seed_lock: boolean;
  /** Tag studio section folds. `true` = collapsed. Stable ids: preset, post, gset, … */
  studio_folds: Record<string, boolean>;
  /** Language for V5 natural (always on for V5 shots). */
  v5_natural_lang: 'en' | 'ja';
  /** Send v4_prompt centers when 2+ chars all have valid 0–1 coords. */
  nai_use_coords: boolean;
  /** off | on — comic tab. Off → identical to today. */
  comic_gen?: 'off' | 'on' | boolean;
  /** Tone / world for the comic LLM. Not an artist stack. */
  comic_author_note?: string;
  /** one JSON for all comic shots, one call per shot, or page JSON on the main tagger. */
  comic_llm_batch?: 'once' | 'per_shot' | 'with_main';
  /** illustration NAI while comic LLM runs, or wait for both taggers. */
  comic_schedule?: 'overlap' | 'wait_taggers';
  /** Legacy page cap. Kept so old saves are not orphaned. */
  comic_max_pages?: number;
  /** 0–100: share of this message's shots that may be comic. */
  comic_gen_ratio?: number;
  /** Tab: AI choice / LLM per page / always position. */
  comic_coords?: 'ai_choice' | 'llm' | 'position';
  /** Comic canvas: tagger aspect, or lock landscape/portrait/square. */
  comic_aspect?: 'llm' | 'landscape' | 'portrait' | 'square';
  /** Empty → NAI V5 steps. */
  comic_steps?: number | null | '';
  /** Empty → NAI V5 sampler. */
  comic_sampler?: string | null;
  /** Extra positive joined into the comic main. Legacy; prefix is the UI field. */
  comic_prompt?: string;
  /** Extra UC joined into the comic negative. Legacy; no longer in the tab. */
  comic_uc?: string;
  /** Comic main: after person tags, before style / koma. */
  comic_prompt_prefix?: string;
  /** Comic main: after layout, before quality tags. */
  comic_prompt_suffix?: string;
  /** Empty → existing CFG. */
  comic_cfg_scale?: number | null | '';
  /** Empty → existing rescale. */
  comic_cfg_rescale?: number | null | '';
  userchat: boolean;
  unified_chat_priority: boolean;
  /** Unified character tab: keep one row per name (priority, then newest). */
  unified_winners_only: boolean;
  /** Style-preset from-image: keep artist/quality only. Off = dump meta main as-is. */
  preset_from_image_filter?: boolean;
  generate_all_roles: boolean;
  /** off | legacy (2.4.7 parent mount) | compat (body hosts only). */
  inline_msg_actions?: 'off' | 'legacy' | 'compat' | boolean;
  /** Circle at message end; tap fans out tag/regen/stop/char/preset/refresh. */
  inline_msg_fan?: boolean;
  /** Insert shot images into chat bubbles at LLM `line`. */
  inline_chat_images?: boolean;
  /** After a shot is ready, merge it into the saved Risu message. */
  persist_chat_images?: boolean;
  /** Display-module checkbox starts checked (baked shots folded). */
  persist_chat_images_folded?: boolean;
  /** Keep the on-screen bubble put when inline inject changes height. */
  scroll_hold?: boolean;
  /** Spinner/photo before the line text, or after it. */
  inline_chat_text_side?: 'before' | 'after';
  /** Eligible message bubbles retained on each side of the selection. */
  inline_chat_dom_radius?: number;
  /** Screen corner for progress / selection / host / attach toasts. */
  toast_anchor?: 'tl' | 'bl' | 'tr' | 'br' | 'tc';
  /** How a long-press on an inline/sticky shot opens the enlarge sheet. */
  image_press_inspect?: 'off' | 'hold' | 'two' | 'three' | 'both';
  auto_gen_on_reply: boolean;
  /** Master switch for stream-keyword gen. Independent of execute / auto_gen_on_reply. */
  stream_keywords_enabled: boolean;
  /** Comma-separated stream needles (≥3 chars). Empty = off even if the toggle is on. */
  stream_keywords: string;
  /** Speak the character line after bake. Stored under existing onx_* card blob. */
  tts_on?: boolean;
  /** speechSynthesis rate, typically 0.5–2. */
  tts_rate?: number;
  /** Browser/host voice URI or name. Empty = default. */
  tts_voice?: string;
  [key: string]: unknown;
}

export interface LlmSettings {
  source: LlmSource;
  provider: string;
  endpoint: string;
  model: string;
  api_key: string;
  service_account_json: string;
  temperature: number;
  max_tokens: number;
  timeout_seconds: number;
  reasoning_effort: string;
  vertex_region: string;
  anthropic_version: string;
  [key: string]: unknown;
}

/**
 * Per-role LLM profile. `follow_main: true` (default) → use `settings.llm`.
 * When false, the rest of the fields are a full LlmSettings replacement (no merge).
 */
export interface LlmRoleSettings extends LlmSettings {
  follow_main: boolean;
}

export type LlmRolesSettings = Record<Exclude<LlmRoleId, 'comic'>, LlmRoleSettings> & { comic?: LlmRoleSettings };

export interface NaiSettings {
  provider: string;
  backend: ImageBackend;
  request_url: string;
  api_key: string;
  /** Extra NovelAI tokens for V5 generations (unique by string). */
  api_keys_v5: string[];
  /** Extra NovelAI tokens for V4/V4.5 generations. */
  api_keys_v4: string[];
  model: string;
  width: number;
  height: number;
  sampler: string;
  /** Last sampler used on the NAI5 tab. Falls back to `sampler`. */
  sampler_v5: string;
  /** Last sampler used on the NAI4 tab. Falls back to `sampler`. */
  sampler_v4: string;
  scheduler: string;
  steps: number;
  /** Last step count on the NAI5 tab. Falls back to `steps`. */
  steps_v5: number;
  /** Last step count on the NAI4 tab. Falls back to `steps`. */
  steps_v4: number;
  cfg_scale: number;
  cfg_rescale: number;
  seed: number;
  variety_plus: boolean;
  enable_i2i: boolean;
  image_reference: string;
  image_reference_strength: number;
  image_reference_fidelity: number;
  image_reference_type: string;
  vibe_transfer: string;
  vibe_transfer_strength: number;
  vibe_transfer_information_extracted: number;
  uc_preset: string;
  apply_quality_tags: boolean;
  /** NAI 전송 직전에 N::/{}/[] 강조를 SDXL식 () 가중치로 변환. Domain 저장값은 그대로. */
  sdxl_emphasis: boolean;
  comfy_url: string;
  comfy_workflow_json: string;
  backend_timeout_seconds: number;
  [key: string]: unknown;
}

export interface Settings {
  auth_token: string;
  card: CardSettings;
  /** Main tagging LLM (also default for command_reroll / preprocess). */
  llm: LlmSettings;
  /** Autotag / asset char_looks. Missing → follow main. */
  llm_roles?: LlmRolesSettings;
  nai: NaiSettings;
  /** Legacy Python-era fields the UI still displays. */
  database_path: string;
  images_dir: string;
  prompts_dir: string;
  storage: Record<string, unknown>;
  [key: string]: unknown;
}

// ── characters ────────────────────────────────────────────────────────────

/** `"__global__"` or a session id. */
export type Scope = string;

/** One wardrobe set: tops (`attire`) + bottoms + weapons/props. */
export interface CharacterCostume {
  appearance?: string;
  hair_color?: string;
  hair_style?: string;
  eye_color?: string;
  height?: string;
  age?: string;
  penis_size?: string;
  /** LLM-facing id, e.g. `default`, `swimsuit`. */
  name: string;
  /** Short outfit summary for the tagger (what it is), e.g. `bunny costume, fishnet stockings`. */
  note?: string;
  /** Tops + jewelry. */
  attire: string;
  /** Bottoms. Missing on old saves → empty (do not split attire). */
  bottoms?: string;
  accessories: string;
}

export interface CharacterRecord {
  id: string;
  name: string;
  original: string;
  aliases: string[];
  surname: string;
  given_name: string;
  surname_variants: string[];
  given_name_variants: string[];
  appearance: string;
  attire: string;
  bottoms?: string;
  accessories: string;
  /** Named wardrobe sets; index 0 is the generation default. */
  costumes?: CharacterCostume[];
  /** UI select index into `costumes` (editing mirror). */
  active_costume?: number;
  attire_locked?: boolean;
  bottoms_locked?: boolean;
  accessories_locked?: boolean;
  priority?: number;
  /**
   * Explicit sex for person tags / settings UI.
   * `"girl"` | `"boy"` | `"other"` | `""`. Prefer this over guessing from tags.
   */
  gender?: string;
  hair_color?: string;
  hair_style?: string;
  eye_color?: string;
  /** cm and/or tall|short|petite, e.g. `170` or `170cm, tall`. */
  height?: string;
  /** Integer years. Caption uses `24 years old`. */
  age?: number | string;
  /** `small penis` | `penis` | `huge penis` | `gigantic penis`. Male only. */
  penis_size?: string;
  /**
   * Last clothing state in this chat: clothed | torn | topless | bottomless | nude | completely.
   * Tagger omits when unchanged; generation uses this until the next change.
   */
  wear_state?: string;
  scope?: Scope;
  schema_version?: number;
  /** SHA-256 hex of the module-stored image. Empty → no reference. */
  ref_hash?: string;
  /** True when a per-character reference image is stored (UI). */
  ref_configured?: boolean;
  /** Data URL preview when available in-memory. */
  ref_preview_url?: string;
  /** Shared 예제샷 (not ref_hash). */
  example_hash?: string;
  example_configured?: boolean;
  example_preview_url?: string;
  /**
   * Immutable 4-hex id baked into shot asset filenames (`...c<id>.webp`).
   * Assigned once from name+aliases+original; a rename never changes it.
   */
  cast_id?: string;
  /** Convenience field the UI reads: original + appearance + attire + bottoms + accessories. */
  tags?: string;
  [key: string]: unknown;
}

// ── cards / images ────────────────────────────────────────────────────────

export interface ShotCharacter {
  name: string;
  prompt?: string;
  uc?: string;
  action?: string;
  expression?: string;
  eye_expression?: string;
  mouth_expression?: string;
  emotion?: string;
  gaze?: string;
  pose?: string;
  left_hand?: string;
  right_hand?: string;
  /**
   * Interaction verbs for body contact (comma-separated each). Doer → source,
   * receiver → target, shared → mutual. Generation translates them to NAI
   * action tags; omit all three when no contact.
   */
  source?: string;
  target?: string;
  mutual?: string;
  appearance?: string;
  attire?: string;
  bottoms?: string;
  accessories?: string;
  /**
   * Costume pick: index, name, or `name[index]`. Empty → previous shot, else
   * roster `active_costume`.
   */
  costume?: string | number;
  /**
   * Clothing state for this shot. Omit when unchanged from the previous shot /
   * roster `wear_state`. clothed | torn | topless | bottomless | nude | completely.
   */
  wear_state?: string;
  /** @deprecated prefer wear_state; still read when wear_state is omitted. */
  nude?: boolean | string | number;
  /** When on: include accessories (weapons/props) in the caption. */
  weapon?: boolean | string | number;
  /** Spoken line for V5 speech (main tags). */
  speech?: string;
  speech_lang?: string;
  sex?: string;
  center_x?: number;
  center_y?: number;
  [key: string]: unknown;
}

/** One generated image plus its placement and prompt metadata. */
export interface CardRow {
  id: string;
  job_id: string;
  session_id: string;
  folder_key?: string;
  shot_index: number;
  paragraph: number;
  y_percent: number;
  message_index: number;
  message_role?: string;
  host_message_id?: string;
  content_hash: string;
  character_id?: string;
  character_name?: string;
  chat_id?: string;
  chat_name?: string;
  char_index?: number;
  chat_index?: number;
  assistant_preview?: string;
  main_prompt: string;
  negative_prompt: string;
  characters: ShotCharacter[];
  /** Serialised columns kept for on-disk compatibility with 1.x rows. */
  characters_json?: string;
  meta_json?: string;
  image_url?: string;
  created_at?: number;
  [key: string]: unknown;
}

export interface ImageRow {
  id: string;
  mime: string;
  bytes: number;
  location_file?: string;
  location?: Record<string, unknown>;
  created_at?: number;
  [key: string]: unknown;
}

// ── meta ──────────────────────────────────────────────────────────────────

/**
 * Singleton rows keyed by name rather than id. `reference_image` and
 * `vibe_transfer` keep their PNG bytes in dedicated storage keys, so the row
 * itself carries the decoded buffer plus whatever fields that key needs.
 */
export interface MetaRow {
  key: string;
  png?: ArrayBuffer | null;
  encoded?: string;
  model?: string;
  information_extracted?: number;
  updated_at?: number;
  [key: string]: unknown;
}

/** The five row stores, in the order they are loaded at boot. */
export type StoreName = 'meta' | 'cards' | 'characters' | 'jobs' | 'images';

// ── jobs ──────────────────────────────────────────────────────────────────

export type JobState = 'queued' | 'tagging' | 'generating' | 'done' | 'cancelled' | 'error';

export interface JobRequest {
  session_id: string;
  character_id?: string;
  character_name?: string;
  chat_id?: string;
  chat_name?: string;
  unified_session_id?: string;
  source_session_ids?: string[];
  char_index?: number;
  chat_index?: number;
  assistant_text?: string;
  message_index?: number;
  message_role?: string;
  host_message_id?: string;
  content_hash?: string;
  recent_messages?: Array<{ role: string; content: string }>;
  lorebook?: LoreEntry[];
  lore_trigger_keys?: string[];
  character_description?: string;
  persona_description?: string;
  force?: boolean;
  [key: string]: unknown;
}

export interface JobRow {
  id: string;
  state: JobState;
  request_json?: string;
  result_json?: string;
  error?: string;
  progress?: Record<string, unknown>;
  created_at?: number;
  updated_at?: number;
  [key: string]: unknown;
}

// ── lorebook ──────────────────────────────────────────────────────────────

export interface LoreEntry {
  comment?: string;
  content?: string;
  key?: string | string[];
  keys?: string | string[];
  always?: boolean;
  alwaysActive?: boolean;
  [key: string]: unknown;
}

// ── tagger output ─────────────────────────────────────────────────────────

export interface TaggedShot {
  paragraph?: number;
  y_percent?: number;
  /** 1-based newline index for beta inline chat illustrations. */
  line?: number;
  /** illustration | comic. Dropped when the comic tab is off. */
  kind?: 'illustration' | 'comic' | string;
  /** Inclusive end line for the comic LLM range. Start is `line`. */
  comic_line_end?: number;
  camera?: string;
  situation?: string;
  place?: string;
  /** Session place tags (Danbooru). Omit to inherit. Last token indoor|outdoor. */
  location?: string;
  /**
   * Optional focus cast indexes (1-based / charN / list). Empty or invalid → no focus.
   * Generation puts `2::out of frame::` on non-focus character captions.
   */
  focus?: unknown;
  /** simple → V4 when NAI5-first is on; dynamic → V5. Omit → V5. */
  complexity?: string;
  /** Optional shot-level line `{ speaker, text }` when characters[].speech is empty. */
  speech?: string | { speaker?: string; text?: string; lang?: string; speech_lang?: string };
  natural?: string;
  action?: string;
  characters?: ShotCharacter[];
  [key: string]: unknown;
}

export interface TaggedScene {
  place?: string;
  shots?: TaggedShot[];
  [key: string]: unknown;
}

export interface TaggerResult {
  scenes?: TaggedScene[];
  new_characters?: Partial<CharacterRecord>[];
  /** Costume appends keyed by character name (main tagger when card.costume). */
  new_costumes?: Array<{ name?: string; costumes?: CharacterCostume[] } & Record<string, unknown>>;
  [key: string]: unknown;
}

// ── api ───────────────────────────────────────────────────────────────────

export interface RawApiResult {
  /** Marks a raw byte response (images) rather than JSON. */
  raw: true;
  status: number;
  bytes: ArrayBuffer | Uint8Array;
  mime: string;
}

export type ApiResult = Record<string, unknown> | RawApiResult;

export interface RequestContext {
  pathname: string;
  query: URLSearchParams;
  method: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  /** Path segments captured by the route pattern. */
  params: Record<string, string>;
}
