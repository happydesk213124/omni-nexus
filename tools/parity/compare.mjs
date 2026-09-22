/**
 * Normalises two transcripts and reports every behavioural difference.
 *
 *   node tools/parity/compare.mjs .parity/old.json .parity/new.json
 *
 * Normalisation exists so that *incidental* variation (generated ids, wall-clock
 * timestamps, blob payloads) does not mask *behavioural* variation. Ids are
 * rewritten to `<ID:n>` in order of first appearance, which still proves that the
 * same entity is referenced in the same places.
 */
import fs from 'node:fs';
import { FIXED_EPOCH } from './host.mjs';

/** 1.x defaulted nai.uc_preset to human_focus; 2.4.7 always uses none. */
const UC_HUMAN_FOCUS_TOKENS = new Set(
  Object.values(JSON.parse(fs.readFileSync(new URL('../../src/config/uc-presets.json', import.meta.url), 'utf8')))
    .flatMap((m) => String(m?.human_focus || '').split(','))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean),
);

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const TS_LOW = FIXED_EPOCH - 60_000;
const TS_HIGH = FIXED_EPOCH + 86_400_000;

/** Fields whose value is inherently timing- or environment-dependent. */
const VOLATILE_KEYS = new Set([
  'created_at', 'updated_at', 'started_at', 'finished_at', 'ts', 'time', 'at',
  'elapsed', 'elapsed_ms', 'duration', 'duration_ms', 'ms', 'took_ms',
  'uptime', 'uptime_ms', 'seed', 'version',
  // How many entries the diagnostics ring buffer happens to hold. It counts
  // storage writes among other things, and reducing those is a goal of 2.0.
  'debug_events', 'events',
]);

/**
 * Keys holding "whichever debug stage fired most recently".
 *
 * Under write-behind persistence a storage flush lands shortly *after* the
 * operation that dirtied the store, so whether one of these names the operation
 * or the flush depends on exactly when the value is read — it is not stable even
 * between two runs of the same build. The user-visible progress string uses
 * `focus_stage || last_stage`, and `focus_stage` already ignores background
 * events, so nothing the user reads depends on this.
 */
const STAGE_NAME_KEYS = new Set(['last_stage', 'focus_stage', 'debug_stage']);

/**
 * Epoch milliseconds embedded in a generated string, e.g. a ZIP filename. The
 * host pins `Date.now()` to a fixed base but it still advances during a run.
 */
const EMBEDDED_TS_RE = new RegExp(`\\b${String(FIXED_EPOCH).slice(0, 7)}\\d{6}\\b`, 'g');

/** The plugin's own version string. A 2.0 must report 2.0.0, not 1.3.0. */
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/**
 * True for the diagnostics ring buffer.
 *
 * Its exact contents are not behaviour: entries carry wall-clock timestamps, and
 * which entries survive the 80-event window depends on how many storage writes
 * occurred — the very thing 2.0 reduces. Comparing it element-wise reports the
 * intended optimisation as hundreds of failures.
 *
 * It is summarised rather than dropped, so the comparison still proves the same
 * *kinds* of work happened and that nothing newly errored. `storage.*` stages are
 * excluded from that summary for the same reason.
 */
const isDebugEventLog = (key, node) =>
  (key === 'events' || key === 'debug_tail' || key === 'errors') &&
  Array.isArray(node) &&
  node.length > 0 &&
  node.every((e) => e && typeof e === 'object' && 'stage' in e && 'iso' in e);

/** `by_stage` counts occurrences inside that same 80-event window. */
const isByStage = (key, node) =>
  key === 'by_stage' && node && typeof node === 'object' && !Array.isArray(node) &&
  Object.values(node).every((v) => typeof v === 'number');

const EVENT_LOG_MARKER = '__eventLog';

/** 2.x warms object URLs; the work is the same display-url stage 1.x logged as image.data_url. */
const aliasDebugStage = (stage) => (stage === 'image.blob_url' ? 'image.data_url' : stage);

const summarizeEventLog = (events) => ({
  [EVENT_LOG_MARKER]: true,
  stages: [...new Set(events.map((e) => aliasDebugStage(String(e.stage))))].filter((s) => !s.startsWith('storage.') && !s.startsWith('shot.module') && s !== 'job.roster.split').sort(),
  errors: events.filter((e) => e.level === 'error').map((e) => aliasDebugStage(String(e.stage))).sort(),
});

const normalize = (root) => {
  const ids = new Map();
  const idFor = (raw) => {
    if (!ids.has(raw)) ids.set(raw, `<ID:${ids.size + 1}>`);
    return ids.get(raw);
  };

  const walk = (node, key) => {
    // natural_base: 1.x boolean ↔ 2.0 off|short|detailed|supplement (same semantics).
    // Collapse the wire type so parity compares intent, not storage shape.
    // 2.4.7 always none (frozen UI has no UC preset control). 1.x defaulted
    // human_focus and appended that block on every gen. Schema + scenario assert none.
    if (key === 'uc_preset') return 'none';
    // Old floating viewer is gone with its mode vocabulary. Fresh installs
    // default to buttons (was icon); stored icon keeps its parked spot as
    // bubble (schema migrates it), toolbar/actions collapse to buttons.
    // The two migration steps below assert the new mapping sharply.
    if (key === 'viewer_minimize_mode' && (node === 'icon' || node === 'buttons')) return 'buttons';
    if (key === 'natural_base') {
      if (node === false || node === 'false' || node === 'off' || node === 'none') return 'off';
      if (node === true || node === 'true' || node === 'on' || node === 'short') return 'short';
      if (node === 'detailed' || node === 'detail') return 'detailed';
      if (node === 'supplement' || node === 'supp') return 'supplement';
      return String(node);
    }
    if (typeof node === 'number') {
      if (Number.isFinite(node) && node >= TS_LOW && node <= TS_HIGH) return '<TS>';
      if (key && VOLATILE_KEYS.has(key)) return '<NUM>';
      // Collapse sub-second float noise while keeping magnitude.
      return Number.isInteger(node) ? node : Math.round(node * 1000) / 1000;
    }
    if (typeof node === 'string') {
      // Display URLs are data:image (SafeDOM). Payload length is not behaviour.
      // scenario.mjs asserts the scheme on gallery.display_url_scheme.
      if (/^data:image\//i.test(node) || /^blob:/i.test(node)) return '<DISPLAY_URL>';
      if (key && VOLATILE_KEYS.has(key) && /^\d+$/.test(node)) return '<NUM>';
      if (key === 'version' && VERSION_RE.test(node)) return '<VERSION>';
      if (key && STAGE_NAME_KEYS.has(key)) return node ? '<STAGE>' : node;
      // Settings export/import payloads are JSON strings; walk the object so
      // intentional schema migrations (e.g. natural_base) can be normalised.
      if (key === 'json' && node.trimStart().startsWith('{')) {
        try {
          return walk(JSON.parse(node), 'json_object');
        } catch {
          /* keep as string */
        }
      }
      let out = node.replace(UUID_RE, (m) => idFor(m.toLowerCase())).replace(EMBEDDED_TS_RE, '<TS>');
      // 1.x used inx_* keys; this plugin's live prefix is onx_*.
      if (key === 'storage_key' || key === 'location_file') {
        out = out.replace(/\binx_/g, 'onx_');
      }
      // Wall-clock-ish NAI seeds appear inside probe messages as well as as fields.
      out = out.replace(/\bseed=\d+/gi, 'seed=<SEED>');
      // 2.0 wraps Inlay person-count tags as N::1girl, 1boy:: (person_tag_weight).
      // 1.x emitted plain tags; scenario asserts the wrap on the new side.
      if (key === 'main_prompt') {
        out = out.replace(
          /\b\d+(?:\.\d+)?::((?:\d+\+?(?:girls?|boys?|people|person)|1girl|1boy)(?:,\s*(?:\d+\+?(?:girls?|boys?|people|person)|1girl|1boy))*)::/gi,
          '$1',
        );
      }
      // Drop 1.x human_focus UC leftovers so style/fixed negatives still compare.
      if (key === 'negative_prompt') {
        out = out
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t && !UC_HUMAN_FOCUS_TOKENS.has(t.toLowerCase()))
          .join(', ');
      }
      // Long opaque payloads: keep the shape, drop the bytes.
      const dataUrl = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(out);
      if (dataUrl) return `data:${dataUrl[1]};base64,<${dataUrl[2].length}b>`;
      if (out.length > 400 && /^[A-Za-z0-9+/=\s]+$/.test(out)) return `<BLOB:${out.length}>`;
      return out;
    }
    if (isDebugEventLog(key, node)) return walk(summarizeEventLog(node), 'event_log_summary');
    if (isByStage(key, node)) {
      // Counts collapse to presence for the same window reason as the event log.
      return { [EVENT_LOG_MARKER]: true, stages: Object.keys(node).map(aliasDebugStage).filter((s) => !s.startsWith('storage.') && !s.startsWith('shot.module') && s !== 'job.roster.split').sort(), errors: [] };
    }
    if (Array.isArray(node)) {
      // 2.x writes new shots to the gallery module; 1.x used onx_nximg_* base64 keys.
      // The card + image *index* moved from two gallery-wide rows to one pack per
      // character-chat plus onx_nxrooms, so that group is folded into a single
      // token: which keys it consists of is asserted by `host.room_packs`, and
      // every other key here still has to match exactly.
      if (key === 'storageKeys' && node.every((v) => typeof v === 'string')) {
        const GALLERY_INDEX = /^(?:inx_|onx_)(?:nxstore_(?:cards|images)|nxcards_.*|nxrooms)$/;
        return [...new Set(
          node
            .map((k) => String(k).replace(/^inx_/, 'onx_'))
            .filter((k) => k !== 'onx_nximg_*' && k !== 'inx_nximg_*' && !String(k).startsWith('onx_nximg_') && !String(k).startsWith('inx_nximg_'))
            // 2.5.27 session note + command presets — no 1.x keys.
            .filter((k) => !String(k).startsWith('onx_session_author_note_') && !String(k).startsWith('inx_session_author_note_') && k !== 'onx_char_command_presets' && k !== 'inx_char_command_presets')
            // 2.5.33 boot stamp: a diagnostic written once per boot so the debug
            // dump can tell "iframe reloaded" from "shell failed to paint". No
            // 1.x key, and nothing reads it for behaviour.
            .filter((k) => k !== 'onx_boot_at' && k !== 'inx_boot_at' && k !== 'onx_ps_from_idb')
            .map((k) => (GALLERY_INDEX.test(String(k)) ? '<GALLERY_INDEX>' : k)),
        )].sort().map((v) => walk(v, key));
      }
      // New 2.0-only prompts have no 1.x equivalent; comparing list length/order fails.
      if (
        key === 'prompts'
        && node.length > 0
        && node.every((p) => p && typeof p === 'object' && 'key' in p)
      ) {
        return node
          .filter((p) => {
            const k = String(p.key);
            if (k === 'asset_tags_inject' || k === 'char_looks' || k === 'command_reroll' || k === 'command_char_edit' || k === 'lorefilter_scan' || k === 'asset_author_note' || k === 'global_author_note' || k === 'comic' || k === 'jailbreak' || k === 'prefill_user') return false;
            return true;
          })
          .map((v) => walk(v, key));
      }
      // Prompt key lists (`prompts.keys`): drop 2.0-only keys so length matches 1.x.
      if (
        Array.isArray(node)
        && node.length > 0
        && node.every((v) => typeof v === 'string')
        && node.includes('tagger')
        && node.includes('format')
      ) {
        return node
          .filter((k) => k !== 'asset_tags_inject' && k !== 'char_looks' && k !== 'command_reroll' && k !== 'command_char_edit' && k !== 'lorefilter_scan' && k !== 'asset_author_note' && k !== 'global_author_note' && k !== 'comic' && k !== 'jailbreak' && k !== 'prefill_user')
          .map((v) => walk(v, key));
      }
      return node.map((v) => walk(v, key));
    }
    if (node && typeof node === 'object') {
      const out = {};
      // 2.0 generation cast rows carry roster `id` + `scope` so char refs
      // load from `char_ref::<scope>::<id>` (session vs global). 1.x caption
      // objects had neither; unit tests assert the key helper, not this wire.
      const isGenCaption =
        'center_x' in node && 'prompt' in node && ('uc' in node || 'raw' in node);
      // 2.0 card rows no longer copy NAI main/neg or baked look tags. Those live
      // on the image file + roster. 1.x still echoed the last generate — the
      // strings are not comparable. GET /nai-prompt + reroll unit/scenario
      // assert the new source.
      const isCardShape =
        typeof node.id === 'string'
        && ('image_url' in node || 'png_bytes' in node)
        && ('shot_index' in node || 'paragraph' in node);
      // ZIP manifest `meta` still had 1.x main/neg + baked look tags.
      const isStoredCardMeta =
        Array.isArray(node.characters)
        && ('main_prompt' in node || 'negative_prompt' in node);
      for (const k of Object.keys(node).sort()) {
        if ((isCardShape || isStoredCardMeta) && (k === 'main_prompt' || k === 'negative_prompt' || k === 'setup')) continue;
        // 2.0 persists the actual canvas (aspect + width/height). 1.x left
        // those fields off the card row. Scenario asserts aspect is the trio.
        if (isCardShape && (k === 'aspect' || k === 'width' || k === 'height')) continue;
        // 2.5.33 listing rows (gallery / explore / job result cards) carry no
        // `image_url`. The UI resolves display URLs from the sync cache at paint
        // time; a copy on the row kept every evicted data URL alive for the
        // session. 1.x still attached it. Scenario asserts the new shape on
        // `gallery.rows_carry_no_display_url` / `gallery.explore_rows_carry_no_display_url`
        // and the scheme on `gallery.display_url_scheme` via `resolveImageUrl`.
        if (isCardShape && k === 'image_url') continue;
        if ((isCardShape || isStoredCardMeta) && k === 'characters' && Array.isArray(node.characters)) {
          // 2.0 persists shot staging (action/expression/…) on the card; 1.x
          // left those on the baked prompt only. Name is the comparable identity.
          out[k] = walk(
            node.characters.map((ch) => {
              if (!ch || typeof ch !== 'object') return ch;
              const name = typeof ch.name === 'string' ? ch.name : '';
              return name ? { name } : {};
            }),
            k,
          );
          continue;
        }
        if (isGenCaption && (k === 'id' || k === 'scope')) continue;
        // 2.5.33 debug snapshot sections with no 1.x equivalent: boot identity,
        // resident image-cache memory and the main-thread stall monitor. They
        // are diagnostics — counters and a clock — not behaviour; the unit test
        // on `debug` asserts their shape and that the monitor actually fires.
        if (key === 'debug' && (k === 'boot' || k === 'mem' || k === 'main_thread')) continue;
        // Retired curation pipeline: 2.0 drops the settings block outright and
        // pins legacy card.composition_curation false, so both keys would
        // otherwise spam diffs against 1.x. The retired behaviour is asserted
        // in unit tests (settings-schema), not on the wire.
        if (k === 'curation' || k === 'composition_curation') continue;
        // 2.0 person_tag_weight (NAI emphasis on Inlay person tags). No 1.x field;
        // wrap itself is normalised on main_prompt below; unit/scenario assert weight.
        if (k === 'person_tag_weight') continue;
        // Settings export embeds the prompts pack as a {key:text} map. 1.x
        // export has no such key; prompt bodies are versioned content, not
        // behaviour. The export/import round-trip is asserted on
        // `settings.prompts_in_export` / `settings.prompts_import_restores`
        // (NEW_ONLY). Array-shaped `prompts` (prompt-list routes) still compare.
        if (k === 'prompts' && node[k] && typeof node[k] === 'object' && !Array.isArray(node[k])) continue;
        // 2.0 roster gender (girl|boy|other) + one-shot tag backfill — no 1.x field.
        if (k === 'gender') continue;
        // 2.0 costumes[] / active_costume — wardrobe sets; 1.x had a single attire.
        // Seeded default from attire; unit tests assert resolve/merge/caption.
        if (k === 'costumes' || k === 'active_costume') continue;
        // 2.0 card.costume toggle (main-tagger catalog inject) — no 1.x field.
        if (k === 'costume') continue;
        // 2.0 asset NAI / auto aspect / person_tag_solo / llm_json_retry / focus_* —
        // no 1.x card fields; schema defaults + UI/unit tests assert behaviour.
        if (
          k === 'asset_nai_tags'
          || k === 'auto_aspect'
          || k === 'person_tag_solo'
          || k === 'no_humans_when_no_char'
          || k === 'llm_json_retry'
          || k === 'llm_reverse_bar'
          || k === 'llm_tag_cal'
          || k === 'focus_character'
          || k === 'focus_weight'
          || k === 'focus_prompt'
          || k === 'command_presets'
        ) continue;
        // 2.0 wear locks default ON (`!== false`). 1.x/legacy seeds stored false;
        // compose + unit tests assert lock behaviour — wire presence is not comparable.
        if (k === 'attire_locked' || k === 'bottoms_locked' || k === 'accessories_locked') continue;
        if (k === 'bottoms' || k === 'tts_on' || k === 'tts_rate' || k === 'tts_voice') continue;
        // Left-line overlay is retired. 1.x defaulted overlay_markers on; 2.0
        // forces it (and inline_previews) off so only the floating viewer paints.
        if (k === 'overlay_markers' || k === 'inline_previews') continue;
        // Floating-viewer pixel pin is the author's monitor coordinates, and
        // reset/import keep the previous pin (applySettingsResetKeeps merges
        // onto DEFAULT_CONFIG) — machine- and persistence-timing-dependent,
        // wall-clock class. Pct pins are still compared.
        if (k === 'overlay_x_offset' || k === 'overlay_y_offset') continue;
        // 2.0 bubble inline shots + progress toast — no 1.x card fields.
        // Defaults false; UI/schema + unit tests assert behaviour.
        // 2.0 inline chat on/off + text-side (before/after the line) — no 1.x fields.
        // scroll_hold is 2.0-only (keep bubble put after inject); no 1.x field.
        if (k === 'inline_chat_images' || k === 'inline_chat_text_side' || k === 'inline_msg_actions' || k === 'inline_msg_fan' || k === 'progress_toast' || k === 'toast_anchor' || k === 'image_press_inspect' || k === 'scroll_hold' || k === 'persist_chat_images' || k === 'persist_chat_images_folded') continue;
        // Omni Nexus keeps JSON in save-file pluginStorage. 1.x labeled the same
        // rows as device IndexedDB. The label is not behaviour we can compare.
        if (k === 'database_path' || k === 'images_dir' || k === 'storage_api' || k === 'storage_scope' || k === 'storage') continue;
        // 2.0 per-character NAI reference (dashboard mode + per-char image).
        // No 1.x fields; schema defaults + UI/unit tests assert behaviour.
        if (k === 'char_ref_mode' || k === 'char_ref_strength' || k === 'char_ref_fidelity' || k === 'char_ref_image_type') continue;
        if (k === 'ref_configured' || k === 'ref_preview_url') continue;
        // 2.0 always-on fixed prompt wrappers around style/scene. No 1.x fields;
        // empty-string defaults; generation + card UI assert merge behaviour.
        if (k === 'fixed_prompt_prefix' || k === 'fixed_prompt_suffix') continue;
        // 2.0 bubble inline sizing/window controls — no 1.x fields. Scenario
        // `settings.card_flags_2x` asserts the radius default instead.
        if (k === 'inline_chat_scale_pct' || k === 'inline_chat_dom_radius') continue;
        // 2.0 character-tab "승자만 보기". 1.x folded winners into unified_chat_priority;
        // unit tests + unify listing assert the split toggle.
        if (k === 'unified_winners_only') continue;
        // 2.5 style-preset from-image tag filter. 1.x has no field; default true
        // is the old artist/quality strip. Unit tests cover off = dump main.
        if (k === 'preset_from_image_filter') continue;
        // 2.0 dashboard stream-keyword autogen — no 1.x fields.
        // Toggle defaults false; missing + needles migrates true (schema unit test).
        if (k === 'stream_keywords' || k === 'stream_keywords_enabled') continue;
        // 2.4 NAI5/4 routing, 1st/2nd preset, multi-key lists. No 1.x fields;
        // schema + nai-routing unit tests assert defaults and family pick.
        // Legacy `api_key` / `api_key_configured` still compared.
        if (
          k === 'nai5_first'
          || k === 'nai5_only'
          || k === 'nai4_fallback'
          || k === 'nai5_speech'
          || k === 'studio_seed_lock'
          // Tag-studio section folds. 1.x had no overlay; schema + studio persist this.
          || k === 'studio_folds'
          || k === 'nai_use_coords'
          // NAI SDXL-style emphasis toggle (send-boundary N::/{}/[] → ()).
          // No 1.x field; default off preserves 1.x wire bytes. The scenario
          // asserts the on-state conversion; schema tests assert the default.
          || k === 'sdxl_emphasis'
          || k === 'v5_natural_lang'
          || k === 'secondary_preset_id'
          || k === 'model_family'
          || k === 'api_keys_v5'
          || k === 'api_keys_v4'
          || k === 'api_keys_v5_configured'
          || k === 'api_keys_v4_configured'
          || k === 'api_keys_v5_suffixes'
          || k === 'api_keys_v4_suffixes'
          // Per-family sampler/steps. 1.x had one shared pair; unit tests assert
          // migrate + family pick. Legacy `sampler` / `steps` still compared.
          || k === 'sampler_v5'
          || k === 'sampler_v4'
          || k === 'steps_v5'
          || k === 'steps_v4'
        ) continue;
        // Stream rematch keeps assistant_preview on the newest 20 card metas
        // only; the images index no longer copies the prose. 1.x wrote it on
        // every location, so listings/export/unlink sidecars are not comparable.
        // Retention + Dice gate are unit-tested.
        if (k === 'assistant_preview') continue;
        // 2.0 comic tab. Default off → same job path as 1.x; unit tests assert
        // kind/range/coords/schedule. Wire keys have no 1.x equivalent.
        if (
          k === 'comic_gen'
          || k === 'comic_author_note'
          || k === 'comic_llm_batch'
          || k === 'comic_schedule'
          || k === 'comic_max_pages'
          || k === 'comic_gen_ratio'
          || k === 'comic_coords'
          || k === 'comic_aspect'
          || k === 'comic_steps'
          || k === 'comic_sampler'
          || k === 'comic_prompt'
          || k === 'comic_uc'
          || k === 'comic_prompt_prefix'
          || k === 'comic_prompt_suffix'
          || k === 'comic_cfg_scale'
          || k === 'comic_cfg_rescale'
          || k === 'comic_page'
          || k === 'comic_line_end'
          || k === 'kind'
        ) continue;
        // Sticky pin hover preview removed in 2.0 (force-off + default false).
        // 1.x defaulted true; comparing the wire value only hides the deletion.
        if (k === 'hover_preview' || k === 'hover_preview_anchor') continue;
        // 2.0 per-role LLM endpoints (`llm_roles`) — no 1.x field; schema defaults
        // + models UI / unit tests assert behaviour.
        if (k === 'llm_roles') continue;
        // 2.0 card/gallery `line` (1-based chat line for inline placement). 1.x
        // has no field; unset serialises as null and would spam absent→null.
        if (k === 'line') continue;
        // 2.0 message-reroll soft-stop flag (`stopped`). 1.x has no field; idle
        // reroll returns false — unit/scenario assert stop behaviour, not wire.
        if (k === 'stopped') continue;
        // Writes go to the character unified id (`risu_<hash>`). The live chat
        // id is only the lookup key. `jobs.write_unified_session` asserts that.
        if (k === 'session_id' || k === 'unified_session_id') continue;
        // 2.0 /v1/gallery answers a window and names the hashes it needs, so it
        // reports the session card count and the window's oldest timestamp for
        // the caller to merge against. 1.x always listed the whole session and
        // had neither. Scoped to the session listing (session_id + items, no
        // folders) so the explorer payload's own `total` still compares.
        // gallery.window_* / gallery.hash_* assert the values.
        if (
          (k === 'total' || k === 'window_oldest_at')
          && 'session_id' in node && 'items' in node && !('folders' in node)
        ) continue;
        out[k] = walk(node[k], k);
      }
      return out;
    }
    return node;
  };

  return walk(root, null);
};

// These are intentional product changes, not volatile values. Validate their
// exact new contract, keep them visible in the report, and compare all other fields.
const expectedAssetChanges=[];
function expectedAssetChange(a,b,at) {
  // Retired positioning is an intentional contract, not normalization: retain
  // each difference in the report and reject any value other than disabled/null.
  // The scenario separately attempts to re-enable it and asserts L-number output.
  if (/\.value\.(?:settings|json)\.card\.llm_anchor_percent$/.test(at)) return a === true && b === false;
  if (/\.value\.(?:settings|json)\.card\.omni_helper_prompt$/.test(at)) return a === undefined && b === false;
  if (/^(?:job\.(?:wait|wait_busy_duplicate|wait_for_folder)|speech\.job_wait)\.value\.result\.cards\[0\]\.y_percent$/.test(at)
    || /^(?:gallery\.list\.value\.items\[0\]|images\.json\.value|cards\.(?:tags|reroll)\.value\.card)\.y_percent$/.test(at)) return typeof a === 'number' && b === null;
  if(/^gallery\.(list|explore)\.value\.items\[0\]\.png_bytes$/.test(at))return Number(b)>Number(a)&&Number(a)>0;
  if(at==='images.json.value.content_hash')return b==='';
  // Cast ids ride the image location (memory-only) so the fullscreen overlay
  // can stamp the `.c` filename segment: 1.x has no such field, 2.0 must.
  if(at==='images.json.value.cast_ids')return Array.isArray(b)&&b.length>0;  if(at==='images.json.value.message_index'||at==='cards.reroll.value.card.message_index')return b===-1;
  if(at==='host.traffic.value.storageKeys'){
    // Room packs are gone on purpose (memory + Risu assets only): the new
    // side must contain no <GALLERY_INDEX> token at all, and every other key
    // still has to match exactly.
    const want=a.filter(key=>key!=='onx_nxstore_jobs'&&key!=='<GALLERY_INDEX>');
    return b.every(key=>key!=='<GALLERY_INDEX>')&&JSON.stringify(b)===JSON.stringify(want);
  }
  // Stored card cast is gone on purpose (no gallery, no chips): rows persist
  // characters_json '[]' while the live API response still carries the cast.
  // Assert the new side is exactly empty rather than dropping the check.
  // (Matched on the array node itself: array length diffs bypass the check.)
  if(at==='gallery.list.value.items[0].characters')return Array.isArray(b)&&b.length===0;
  if(at==='cards.reroll.value.card.characters')return Array.isArray(b)&&b.length===0;
}
const diff = (a, b, at, into) => {
  if(expectedAssetChange(a,b,at)){expectedAssetChanges.push(at);return;}
  if (into.length > 400) return;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) {
    into.push({ at, old: `${ta}`, new: `${tb}`, note: 'type differs' });
    return;
  }
  if (ta === 'array') {
    if (a.length !== b.length) into.push({ at: `${at}.length`, old: a.length, new: b.length });
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) diff(a[i], b[i], `${at}[${i}]`, into);
    return;
  }
  if (ta === 'object' && a[EVENT_LOG_MARKER] && b[EVENT_LOG_MARKER]) {
    // Subset, not equality. The ring buffer keeps the last 80 events, and the old
    // backend flooded that window with storage writes — real diagnostic stages
    // were evicted there that survive here. So the assertion worth making is that
    // no stage the old run recorded went missing; extra stages are the win.
    // Known 2.0 renames/drops (not regressions): allow these to disappear.
    const ALLOW_GONE = new Set(['autotag.start', 'job.start', 'nai.read_bytes.done', 'nai.fetch.returned', 'nai.generate.dims']);
    const gone = a.stages.filter((s) => !b.stages.includes(s) && !ALLOW_GONE.has(s));
    if (gone.length) into.push({ at: `${at}.stages`, old: gone.join(', '), new: '(absent)', note: 'stage no longer logged' });
    // An error appearing or disappearing is behaviour, so those match exactly.
    diff(a.errors, b.errors, `${at}.errors`, into);
    return;
  }
  if (ta === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      // New-in-2.0 fields (old side absent) still go through the intentional
      // contract first: a genuinely new field must assert its new shape.
      if (!(k in a)) {
        if (expectedAssetChange(undefined, b[k], `${at}.${k}`)) { expectedAssetChanges.push(`${at}.${k}`); continue; }
        into.push({ at: `${at}.${k}`, old: '(absent)', new: JSON.stringify(b[k])?.slice(0, 160) }); continue;
      }
      if (!(k in b)) { into.push({ at: `${at}.${k}`, old: JSON.stringify(a[k])?.slice(0, 160), new: '(absent)' }); continue; }
      diff(a[k], b[k], `${at}.${k}`, into);
    }
    return;
  }
  if (a !== b) into.push({ at, old: String(a).slice(0, 200), new: String(b).slice(0, 200) });
};

const [oldPath, newPath] = process.argv.slice(2);
if (!oldPath || !newPath) {
  console.error('usage: node tools/parity/compare.mjs <old.json> <new.json>');
  process.exit(2);
}

const oldRun = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
const newRun = JSON.parse(fs.readFileSync(newPath, 'utf8'));

/**
 * Steps where 2.0 deliberately diverges from 1.x and the scenario already
 * records the sharper 2.0 assertion (e.g. `swapped: true`). We still require
 * the step to exist and succeed on both sides; we do not byte-compare values,
 * because that would force us to hide the new behaviour or break the suite.
 */
const INTENTIONAL_DIFF_STEPS = new Set([
  // Empty override characters[] no longer wipes the slim cast; 1.x sent zero chars.
  'cards.reroll_with_overrides',
  'presets.reroll_after_swap',
  'presets.reroll_swaps_style',
  // Same preset-rebuild divergence as reroll_after_swap, plus 2.4.16: the reroll
  // sends the family it built the prompt for. 1.x fell back to the model tab and
  // generated a V5-only prompt on V4.5.
  'presets.reroll_nai5_only',
  'presets.reroll_keeps_v5_model',
  'presets.nai5_first_on',
  'presets.first_simple_job',
  'presets.first_simple_wait',
  'presets.reroll_simple_complexity',
  'presets.reroll_keeps_v4_from_complexity',
  'presets.nai5_first_off',
  // 2.4.20: the V5 bubble sits at the end of the speaker's own character caption.
  // 1.x has no speech feature at all, so it sends no bubble anywhere. The check
  // below asserts the placement rather than accepting any difference.
  'speech.bubble_on_caption',
  // NAI SDXL emphasis reroll: with the flag on, 2.0 stores the converted input
  // in the recipe while 1.x stores the raw override. The sharp assertion is
  // `nai.sdxl_emphasis_converts` (NEW_ONLY); this skips the recipe diff itself.
  'nai.sdxl_reroll',
  // 2.0 wraps person tags (default weight 3); 1.x emits plain 1boy.
  'job.person_tag_emphasis',
  // 2.4.7 forces nai.uc_preset=none; 1.x defaulted human_focus.
  // Family registration is separate from generation's fallback credentials.
  // The explicit check below proves deleting one tab leaves the other registered.
  'settings.registered_keys',
  'settings.uc_preset_none',
  'job.uc_preset_none',
  // Old viewer minimize modes died with the viewer: stored icon migrates to
  // bubble, toolbar to buttons. Checks below assert the new mapping.
  'settings.minimize_migrate_icon',
  'settings.minimize_migrate_toolbar',
  // Short clothing hints use word boundaries ("hat" ≠ inside "chat"), so seed
  // markers stay in appearance instead of spilling into attire via "chat"⊃"hat".
  'chars.seed_sess_chat_a',
  'chars.seed_sess_chat_b',
  // Hashes are not unique when two messages have identical text. 2.0 makes a
  // stored message index authoritative so force-tag cannot unlink both bubbles.
  'gallery.unlink_duplicate_hash_isolated',
  // Stored-source tagger (P1+P2+P3): 2.0 strips bake/spinner tokens from
  // context, excludes the current message by construction, and numbers the
  // stored original instead of the request text. 1.x numbers the request
  // text and keeps tokens/duplicates. The sharp checks below assert the new
  // prompt and the stripped-basis spinner slot.
  'job.stored_source_tagger_input',
  'job.stored_source_chat',
  // Unified-id writes + busy lock: 1.x ran the duplicate sess_main job and grew
  // a second card. 2.x remaps both to the character id and keeps one.
  // `jobs.unified_no_duplicate_card` asserts the new count.
  'cards.gallery_after_tags',
  'messages.reroll',
  'gallery.before_rebind',
  'gallery.rebind_hash',
  'gallery.after_rebind',
  'gallery.unlink',
  'gallery.after_unlink',
  'gallery.import',
  'gallery.explore_after_import',
  'gallery.explore_for_delete',
  'gallery.before_card_delete',
  'gallery.explore_after_folder_delete',
  'presets.style_job_wait',
  'presets.style_before_swap',
  // 2.0 unified view is a live concat of root chats; 1.x wrote a cache row and
  // fanned patches/deletes to every linked session.
  'chars.unified_patch',
  'chars.chat_b_after_patch',
  'chars.unified_patch_single',
  'chars.delete_cascade',
  'chars.chat_b_after_delete',
  // 2.5.55 explorer ZIP: folder dirs + newest-first 000001_ names. 1.x used images/{id}.png.
  'gallery.export',
  // Boot pack is the user's recommended settings (not the 1.x extract), so the
  // raw boot GET differs by design. The sharper check is settings.boot_floor;
  // the scenario syncs both sides to tools/parity/floor.json right after.
  'settings.initial',
  // 2.5.9 reset applies the recommended pack (not 1.x extract) and resets prompts.
  // The sharper check is settings.reset_factory_floor.
  // 2.5.29: Comfy "연결 테스트" only persists; 1.x still hit /system_stats.
  'comfy.test',
  'settings.reset',
  'settings.after_reset',
]);

/**
 * Routes with no 1.x concept at all, so the old run is expected to fail
 * outright (unknown route) rather than merely return a different value.
 * We skip the wire diff entirely and assert only the new side's behaviour,
 * keyed by step name.
 */
const NEW_ONLY_STEPS = new Map([
  ['settings.stream_contract', v => v?.defaultOff === true && v.helperToggle === true && v.mandatoryOn === true && v.percentDisabled === true ? null : 'streaming settings contract failed'],
  ['job.commit_output_unknown', v => v?.ok === false && v.error?.code === 'not_pending' ? null : 'unknown stream attached'],
  ['job.line_placement_contract', v => v?.line === 1 && v.percent === null && v.count === 1 ? null : 'L-number placement contract failed'],
  // Intentional fix: 1.x requires a nonempty SA form for deletion and lacks role
  // credentials. Keep the difference visible and assert the corrected API contract.
  ['settings.vertex_credentials', v => v?.saved === true && v.redacted === true && v.cleared === true
    && v.otherKept === true && v.clearFlagGone === true ? null : 'Vertex credential save/clear contract failed: ' + JSON.stringify(v)],
  // Explorer now describes character-owned assets, not saved card rows. Preserve
  // the differences and assert the new inventory contract rather than normalize it.
  ['gallery.explore', v => v?.items?.length === 1 && v.folders.length === 1
    && v.items[0].character_id === 'char_main' && v.items[0].chat_id === 'chat_main'
    && v.items[0].asset_name.startsWith('inxshot_') && v.items[0].asset_path
    && v.items[0].asset_order === 0 && v.items[0].png_bytes === 0
    && v.items[0].main_prompt === '' && v.items[0].characters.length === 0
    && v.items[0].message_index === -1 && v.items[0].content_hash === ''
    ? null : 'Character asset inventory contract failed'],
  ['gallery.explore_folder_keys', v => JSON.stringify(v) === JSON.stringify(['char_folder|chat_folder','char_main|chat_main','smoke-character-save|unknown'])
    ? null : 'Unmatched imported session must remain in owner unknown-chat folder: '+JSON.stringify(v)],
  ['gallery.delete_folder', v => v?.ok === true && v.deleted === 1 && v.ids?.length === 1 && v.folder_key === 'char_main|chat_main'
    ? null : 'Folder delete must affect only assets classified in that owner/chat: '+JSON.stringify(v)],
  ['asset_only.contract',v=>v?.no_fabricated_message===true && v?.gallery_bytes_positive===true && v?.explorer_metadata_deferred===true ? null : 'Asset recipe/index contract failed: '+JSON.stringify(v)],
  [
    // 1.x counted the window, so this step reads 1 there. 2.5.23 counts the room.
    'gallery.explore_window_folder_counts',
    (v) => (v?.items === 1 && v?.full_items > 1 && v?.folder_total === v?.full_items
      ? null
      : '2.5.23 explorer folders must count every shot in the room, not the window'
        + ` — got ${JSON.stringify(v)}`),
  ],
  [
    'storage.savefile_only',
    (v) => (v?.storage === 'pluginStorage' && v?.storage_api === 'pluginStorage' && v?.storage_scope === 'save-file'
      ? null
      : `JSON must live in save-file pluginStorage, got ${JSON.stringify(v)}`),
  ],
  [
    'jobs.write_unified_session',
    (v) => (v?.job === true && v?.listed === true
      ? null
      : `jobs must write the character unified id and the live chat gallery must still list them, got ${JSON.stringify(v)}`),
  ],
  [
    'jobs.unified_no_duplicate_card',
    (v) => (Number(v?.count) === 1
      ? null
      : `a busy remapped job must not add a second card, got ${JSON.stringify(v)}`),
  ],
  [
    'gallery.display_url_scheme',
    (v) => (v === 'data'
      ? null
      : `2.x display URLs must be data:image — SafeDOM strips blob: and cannot setAttribute src, got ${JSON.stringify(v)}`),
  ],
  [
    'gallery.rows_carry_no_display_url',
    (v) => (v?.rows >= 1 && v?.keyed === 0
      ? null
      : `2.5.33 gallery rows must not carry image_url (UI resolves at paint time), got ${JSON.stringify(v)}`),
  ],
  [
    'gallery.explore_rows_carry_no_display_url',
    (v) => (v?.rows >= 1 && v?.keyed === 0
      ? null
      : `2.5.33 explorer rows must not carry image_url (UI resolves at paint time), got ${JSON.stringify(v)}`),
  ],
  [
    'gallery.card_aspect',
    (v) => (v?.first === 'portrait' && v?.all_canvas === true
      ? null
      : `2.0 cards persist the first-tagger canvas (portrait when the tagger omits it), got ${JSON.stringify(v)}`),
  ],
  [
    // NAI SDXL emphasis: flag on converts N::/{}/[] to () weights at the send
    // boundary only. 1.x has no flag, so only the new side is asserted here;
    // the flag key itself is skipped in the generic wire diff.
    'nai.sdxl_emphasis_converts',
    (v) => (v?.sent >= 1 && v?.converted === true && v?.kept_domain === true
      ? null
      : `sdxl_emphasis on must send (sdxlprobe:2), (sdxlbrace) with no N::/{}/[] residue, got ${JSON.stringify(v)}`),
  ],
  [
    // Comic cuts: per-cut base/kind tags reach NAI main, interaction keys land
    // as source#/target# on captions, person-count tags count each identity once
    // across repeated panels. 1.x never knew cut_kind, so only
    // the new side is asserted here.
    'comic.cuts_once',
    (v) => (v?.cards === 1 && v?.sent >= 1 && v?.koma3 === true && v?.layout === true
      && v?.closeup === true && v?.xray === true && v?.sourceTag === true
      && v?.targetTag === true && v?.person === true && v?.speech === true
      ? null
      : `comic cuts (once) must generate 1 card with 3koma, cut layout, kind tags, #-tags, deduplicated person tags, speech, got ${JSON.stringify(v)}`),
  ],
  [
    // Same contract via the main tagger (comic_page nested on the shot).
    'comic.with_main',
    (v) => (v?.cards === 1 && v?.sent >= 1 && v?.koma3 === true && v?.layout === true
      && v?.closeup === true && v?.xray === true && v?.sourceTag === true
      && v?.targetTag === true && v?.person === true && v?.speech === true
      ? null
      : `comic cuts (with_main) must generate 1 card with 3koma, cut layout, kind tags, #-tags, deduplicated person tags, speech, got ${JSON.stringify(v)}`),
  ],
  [
    // Settings EXPORT embeds the prompts pack as a top-level {key:text} map;
    // IMPORT restores it (known keys only). 1.x has neither, so only the new
    // side is asserted; the map key is skipped in the generic wire diff.
    'settings.prompts_in_export',
    (v) => (v?.embedded === true && typeof v?.tagger_text === 'string'
      ? null
      : `settings export must embed the prompts pack, got ${JSON.stringify(v)}`),
  ],
  [
    'settings.prompts_import_restores',
    (v) => (v?.restored === true && v?.marker_gone === true
      ? null
      : `settings import must restore embedded prompts, got ${JSON.stringify(v)}`),
  ],
  [
    'gallery.window_reports_total',
    (v) => (typeof v?.total === 'number' && v.total >= 1 && v.matches_items === true && v.window_oldest_at === null
      ? null
      : `2.0 /v1/gallery must report the session card count, and no window edge when the window covered it all, got ${JSON.stringify(v)}`),
  ],
  [
    'gallery.window_excludes_beyond_limit',
    (v) => (v?.window_capped === true && v?.edge_only_when_short === true
      ? null
      : `2.0 /v1/gallery must cap at the limit and report a window edge exactly when it stopped short of the session, got ${JSON.stringify(v)}`),
  ],
  [
    'gallery.hash_outside_window_still_ships',
    (v) => (Number(v?.hashed_rows) >= 1 && v?.all_match === true && Number(v?.unknown_hash_rows) === 0
      ? null
      : `2.0 must ship a named hash's cards with an empty window, and nothing for an unknown hash, got ${JSON.stringify(v)}`),
  ],
  [
    'host.room_packs',
    (v) => (Number(v?.packs) === 0 && v?.has_index === false
      && Number(v?.packed_cards) === 0 && Number(v?.monolith_cards) === 0 && v?.persisted_jobs===false
      ? null
      : `Omni stores new image recipes in assets, with no room packs or persisted jobs, got ${JSON.stringify(v)}`),
  ],
  [
    // Fullscreen chips resolve the webp filename `.c` cast segment to roster
    // names. Cast ids are issued at job completion, so at least one roster row
    // must carry one; unknown ids resolve to nothing.
    'shots.resolve_cast',
    (v) => (Number(v?.count) >= 1 && (v?.resolved || []).length === Number(v?.count)
      && (v?.resolved || []).every((n) => typeof n === 'string' && n.length > 0)
      && (v?.identities || []).length === Number(v?.count)
      && v.identities.every(row => row.id && row.scope && row.name && /^[0-9a-f]{4}$/.test(row.cast_id))
      && (v?.unknown_keys || []).length === 0
      ? null
      : `2.0 must resolve filename cast ids to roster names, got ${JSON.stringify(v)}`),
  ],
  [
    // Fullscreen chips look the cast up by card id from the module tuple
    // name; at least one generated card must carry ids. The tuple name rides
    // along so the ⛶ handler can fetch pixels + names by file name.
    'shots.cast',
    (v) => (Array.isArray(v?.ids) && v.ids.length >= 1 && v.ids.every((s) => /^[0-9a-f]{4}$/.test(s))
      && typeof v?.name === 'string' && v.name.length > 0
      ? null
      : `2.0 must return filename cast ids for a generated card, got ${JSON.stringify(v)}`),
  ],
  [
    // The ⛶ fullscreen path: div file name → base64 pixels + cast names in
    // one round trip. Risu owns the files, so the name is the reload-proof key.
    'shots.asset',
      (v) => (v?.has_image === true && v?.blob_pixels === true && Number(v?.names) >= 1 && v?.pixels_only === true && v?.ordered_ids === true
      ? null
      : `2.0 must serve shot pixels + cast names by file name, got ${JSON.stringify(v)}`),
  ],
  [
    'host.gallery_pixels',
    (v) => (v === 'module'
      ? null
      : `2.x must persist new shots as module assets, not onx_nximg_* keys, got ${JSON.stringify(v)}`),
  ],
  [
    'cards.command_rewrite',
    (v) => (v?.ok === true && v?.look_kept === true && v?.action === 'waving'
      ? null
      : `2.0 command-rewrite must keep look + apply action, got ${JSON.stringify(v)}`),
  ],
  [
    'session_note.put',
    (v) => (v?.ok === true && v?.text === 'parity session note' && v?.prefix === 'parity session note'
      ? null
      : `session-author-note PUT must persist text as prefix, got ${JSON.stringify(v)}`),
  ],
  [
    'session_note.get',
    (v) => (v?.ok === true && v?.text === 'parity session note' && v?.prefix === 'parity session note'
      ? null
      : `session-author-note GET must return the saved text as prefix, got ${JSON.stringify(v)}`),
  ],
  [
    'session_note.split_put',
    (v) => (v?.ok === true && v?.prefix === 'pre-note' && v?.suffix === 'post-note'
      ? null
      : `session-author-note split PUT must keep prefix/suffix, got ${JSON.stringify(v)}`),
  ],
  [
    'session_note.split_get',
    (v) => (v?.ok === true && v?.prefix === 'pre-note' && v?.suffix === 'post-note'
      ? null
      : `session-author-note split GET must return prefix/suffix, got ${JSON.stringify(v)}`),
  ],
  [
    'session_note.location_put',
    (v) => (v?.ok === true && v?.location === 'tatami, indoor' && v?.prefix === 'pre-note'
      ? null
      : `session-author-note location PUT must keep prefix and set location, got ${JSON.stringify(v)}`),
  ],
  [
    'session_note.location_get',
    (v) => (v?.ok === true && v?.location === 'tatami, indoor' && v?.suffix === 'post-note'
      ? null
      : `session-author-note location GET must return location, got ${JSON.stringify(v)}`),
  ],
  [
    'session_note.wear_put',
    (v) => (v?.ok === true && Array.isArray(v?.wear) && v.wear.length === 1
      && v.wear[0]?.id === 'char_a' && v.wear[0]?.name === 'A' && v.wear[0]?.wear === 'nude'
      ? null
      : `session-author-note wear PUT must keep id-keyed nude and drop bogus states, got ${JSON.stringify(v)}`),
  ],
  [
    'session_note.wear_get',
    (v) => (v?.ok === true && Array.isArray(v?.wear) && v.wear.length === 1 && v.wear[0]?.wear === 'nude'
      ? null
      : `session-author-note wear GET must return the remembered outfit, got ${JSON.stringify(v)}`),
  ],
  [
    'session_note.wear_clear',
    (v) => (v?.ok === true && !('wear' in (v || {})) && v?.location === 'tatami, indoor'
      ? null
      : `session-author-note wear clear must omit the empty map and keep location, got ${JSON.stringify(v)}`),
  ],
  [
    'char_example.get',
    (v) => (v?.ok === true && v?.configured === false && !v?.example_hash
      ? null
      : `example-shot GET on a new char must be empty, got ${JSON.stringify(v)}`),
  ],
  [
    'char_cmd_presets.put',
    (v) => (v?.ok === true && Array.isArray(v?.items) && v.items.length === 1
      ? null
      : `command presets PUT must keep items[], got ${JSON.stringify(v)}`),
  ],
  ['roster.bot_lore_contract', v => v?.stored && v?.disabled && v?.isolated ? null : 'bot lore must own independent disabled rosters; legacy root merging is forbidden'],
  // Intentional save change: aliases no longer merge rows; given-name chains do.
  ['chars.given_name_save_contract', v => v?.count === 3 && v?.merged === 1 && v?.triggersSeparate === true && JSON.stringify(v?.words) === '["yoona","yuna"]' ? null : 'Given-name save grouping failed: ' + JSON.stringify(v)],
  [
    'char_cmd_presets.get',
    (v) => (v?.ok === true && v?.items?.[0]?.id === 'p1'
      ? null
      : `command presets GET must return p1, got ${JSON.stringify(v)}`),
  ],
  [
    'chars.command_rewrite',
    (v) => (v?.ok === true && v?.mole === true && v?.costumes >= 2
      ? null
      : `character command-rewrite must apply add + new_costume, got ${JSON.stringify(v)}`),
  ],
  [
    'cards.studio_commit',
    (v) => (v?.ok === true && v?.card?.id
      ? null
      : `2.0 studio-commit must keep the card and write tags, got ${JSON.stringify(v)}`),
  ],
  [
    // Studio commit with canvas bytes publishes under a NEW card id at the
    // same place (reroll-style); 1.x overwrote the same id, so no legacy compare.
    'cards.studio_commit_bytes',
    (v) => (typeof v?.replaced === 'string' && v.replaced.length > 0
      && typeof v?.id === 'string' && v.id.length > 0 && v.id !== v.replaced
      && Number(v?.image_url_len) > 0 && typeof v?.message_index === 'number'
      ? null
      : `2.0 studio-commit with bytes must publish a new card at the same spot, got ${JSON.stringify(v)}`),
  ],
  [
    'cards.nai_prompt',
    (v) => (v?.ok === true && v?.matches_generated_input===true
      ? null
      : `Omni image recipe must match an actual generation request, got ${JSON.stringify(v)}`),
  ],
  [
    'cards.nai_from_image_empty',
    (v) => (v?.ok === false && v?.error?.code === 'bad_request'
      ? null
      : `2.0 nai-from-image without bytes must reject, got ${JSON.stringify(v)}`),
  ],
  [
    'job.stop_idle',
    (v) => (v?.ok === true && Number(v?.stopped) === 0 && v?.reroll_stop === true
      ? null
      : `2.0 soft-stop with no active jobs must return stopped:0 + reroll_stop, got ${JSON.stringify(v)}`),
  ],
  [
    'lorefilter.get_empty',
    (v) => (v?.ok === true && v.initialized === false && Array.isArray(v?.selected) && Array.isArray(v?.catalog)
      ? null
      : `2.0 lorefilter GET must return selected+catalog arrays, got ${JSON.stringify(v)}`),
  ],
  [
    'lorefilter.set',
    (v) => (v?.ok === true && Array.isArray(v?.selected) && v.selected.includes('t:alice')
      ? null
      : `2.0 lorefilter POST must persist selected, got ${JSON.stringify(v)}`),
  ],
  [
    'lorefilter.get_after_set',
    (v) => (v?.ok === true && v.initialized === true && Array.isArray(v?.selected) && v.selected.includes('t:alice')
      ? null
      : `2.0 lorefilter GET after set must keep selected, got ${JSON.stringify(v)}`),
  ],
  [
    'lorefilter.empty_is_initialized',
    (v) => (v?.ok === true && v.initialized === true && Array.isArray(v.selected) && v.selected.length === 0
      ? null : `An explicitly empty lore selection must remain initialized, got ${JSON.stringify(v)}`),
  ],
  [
    'presets.look_clear',
    (v) => (v?.ok === true && v?.configured === false
      ? null
      : `preset look clear must succeed without a stored shot, got ${JSON.stringify(v)}`),
  ],
  [
    'presets.look_empty',
    (v) => (v?.ok === false
      ? null
      : `preset look without image_b64 must fail, got ${JSON.stringify(v)}`),
  ],
  [
    'settings.boot_floor',
    // Boot pack is the user's recommended defaults (3/3/auto, 11 presets).
    (v) => (v?.image_min === 3 && v?.image_max === 3 && v?.execute === 'auto'
      && v?.lore_extra === 'full' && v?.asset_nai_tags === 'prepass'
      && v?.active_preset_id === '이미지_프리셋_8_8ohbu' && v?.presets === 11
      ? null
      : `boot must apply the user recommended pack, got ${JSON.stringify(v)}`),
  ],
  [
    'settings.reset_factory_floor',
    // Factory pack is the user's recommended settings (3/3/auto). lore_extra/asset_nai_tags
    // unchanged by the swap.
    (v) => (v?.image_min === 3 && v?.image_max === 3 && v?.execute === 'auto'
      && v?.lore_extra === 'full' && v?.asset_nai_tags === 'prepass' && v?.tagger_wiped === true
      ? null
      : `reset must apply the recommended pack and wipe dirty prompts, got ${JSON.stringify(v)}`),
  ],
  [
    'chars.import_picker_persona',
    (v) => (v?.ok === true && Array.isArray(v?.items)
      ? null
      : `import-picker must return items[], got ${JSON.stringify(v)}`),
  ],
  [
    'chars.import_fill_empty',
    (v) => (v?.ok === false
      ? null
      : `import-fill with no picks must be ok:false, got ${JSON.stringify(v)}`),
  ],
  [
    'chars.triggered',
    (v) => {
      const names = (Array.isArray(v?.characters) ? v.characters : []).map((c) => c?.name).filter(Boolean);
      return v?.ok === true && names.length === 0
        ? null
        : `a different bot must not borrow the identity fixture roster, got ${JSON.stringify(names)}`;
    },
  ],
  [
    'chat.restore_chrome',
    (v) => (v?.ok === true && typeof v?.remounted === 'boolean'
      ? null
      : `restore-chrome must return ok+remounted, got ${JSON.stringify(v)}`),
  ],
  // 2.5 storage migration. 1.x had no concept of moving pixels into a Risu
  // module, so the old run 404s on all three routes.
  [
    'storage.migrate_before',
    (v) => (v?.ok === true && v?.running === false
      ? null
      : `status must answer with an idle engine before the first run, got ${JSON.stringify(v)}`),
  ],
  [
    'storage.migrate_run',
    (v) => (v?.started === true && v?.phase === 'done' && v?.failed === 0 && v?.running === false
      ? null
      : `migrate must start, finish as done, and report no failures, got ${JSON.stringify(v)}`),
  ],
  [
    'storage.migrate_after',
    (v) => (v?.migrated_version === 3 && v?.pending_images === 0
      ? null
      : `a clean run must stamp version 3 and leave nothing pending, got ${JSON.stringify(v)}`),
  ],
  [
    'storage.migrate_cancel_idle',
    (v) => (v?.ok === true && v?.cancelling === false
      ? null
      : `cancel with nothing running must report cancelling:false, got ${JSON.stringify(v)}`),
  ],
  [
    'nai.quota',
    (v) => (v?.ok === true && Array.isArray(v?.keys)
      ? null
      : `2.4 /v1/nai/quota must return keys[], got ${JSON.stringify(v)}`),
  ],
]);

const byName = (run) => new Map(run.transcript.map((t) => [t.name, t]));
const oldSteps = byName(oldRun);
const newSteps = byName(newRun);

const findings = [];
// Omni intentionally replaces shared-global and root-chat fanout with bot-owned lore.
// These endpoint observations assert the new roster rather than normalizing away data.
const omniRosterExpected = new Map([
  ['chars.unify', [['HAN JINWOO','boy, black hair','suit'],['HAN MINA','girl, brown hair','dress']]],
  ['chars.create_global', [['HAN JINWOO','boy, black hair','suit'],['HAN MINA','girl, brown hair','dress'],['아리아','1girl, blonde hair','armor']]],
  ['chars.get_with_char_id', [['HAN JINWOO','boy, black hair','suit'],['HAN MINA','girl, brown hair','dress'],['아리아','1girl, blonde hair','armor']]],
  ['chars.chat_a_after_patch', [['니메리엘','old chat A marker','white dress']]],
  ['appearance.get', [['니메리엘','old chat A marker','white dress']]],
  ['chars.seed_chat_c', [['다른캐릭','1girl, brown hair','coat']]],
  ['chars.chat_c_untouched', [['다른캐릭','1girl, brown hair','coat']]],
  // Stored-source scenario character: bot-owned roster, no shared globals.
  ['job.stored_source_character', [['보관봇','1girl, brown hair','coat']]],
  ['appearance.get_after_post', [['테스트','1girl, red hair','']]],
  ['chars.chat_a_after_delete', []],
  ['chars.unified_patch', [['니메리엘','1girl, vivid violet eyes, long silver hair','blue dress']]],
  ['chars.unified_patch_single', [['니메리엘','1girl, vivid violet eyes, long silver hair','blue dress']]],
]);
for (const name of oldSteps.keys()) {
  if (!newSteps.has(name)) { findings.push({ at: name, old: '(step present)', new: '(step missing)' }); continue; }
  const oldStep = oldSteps.get(name);
  const newStep = newSteps.get(name);
  if (omniRosterExpected.has(name)) {
    const value=newStep.value;
    const got=(value?.characters || []).map(c=>[c.name,c.appearance,c.attire || '']).sort((a,b)=>a[0].localeCompare(b[0]));
    const expected=omniRosterExpected.get(name).slice().sort((a,b)=>a[0].localeCompare(b[0]));
    if(!newStep.ok || !Array.isArray(value?.global) || value.global.length || JSON.stringify(got)!==JSON.stringify(expected)) findings.push({at:name,old:'legacy shared/fanout roster',new:JSON.stringify(got),note:'expected bot roster '+JSON.stringify(expected)});
    continue;
  }
  if(name==='chars.global_toggles_set') {
    if(!newStep.ok || JSON.stringify(newStep.value?.disabled_globals)!=='[]')findings.push({at:name,old:'legacy toggle',new:JSON.stringify(newStep.value),note:'bot-local roster has no global toggles'});
    continue;
  }
  if (NEW_ONLY_STEPS.has(name)) {
    if (!newStep.ok) { findings.push({ at: name, old: '(no 1.x route)', new: 'failed', note: 'new step errored' }); continue; }
    const problem = NEW_ONLY_STEPS.get(name)(newStep.value);
    if (problem) findings.push({ at: name, old: '(no 1.x route)', new: JSON.stringify(newStep.value), note: problem });
    continue;
  }
  if (INTENTIONAL_DIFF_STEPS.has(name)) {
    if (!oldStep.ok) findings.push({ at: name, old: 'failed', new: '(intentional)', note: 'old step errored' });
    if (!newStep.ok) findings.push({ at: name, old: '(intentional)', new: 'failed', note: 'new step errored' });
    if (name === 'gallery.export') {
      const names = Array.isArray(newStep.value?.names) ? newStep.value.names : [];
      const shots = names.filter((n) => /\.(png|webp|jpe?g)$/i.test(String(n)));
      const numbered = shots.length >= 1 && shots.every((n) => /\/\d{6}_.+\.(png|webp|jpe?g)$/i.test(String(n)));
      const files = Array.isArray(newStep.value?.manifest?.items)
        ? newStep.value.manifest.items.map((it) => String(it?.file || ''))
        : [];
      if (!numbered || files.some((f) => !/\/\d{6}_/.test(f))) {
        findings.push({
          at: name,
          old: 'images/<id>.png',
          new: JSON.stringify({ names, files }).slice(0, 240),
          note: '2.5.55 export must be {folder}/000001_oldname.webp newest-first per room',
        });
      }
    }
    if (name === 'settings.minimize_migrate_icon'
      && String(newStep.value?.viewer_minimize_mode) !== 'bubble') {
      findings.push({
        at: name,
        old: '(1.x stores icon)',
        new: JSON.stringify(newStep.value),
        note: 'stored icon must migrate to bubble (parked spot kept)',
      });
    }
    if (name === 'settings.minimize_migrate_toolbar'
      && String(newStep.value?.viewer_minimize_mode) !== 'buttons') {
      findings.push({
        at: name,
        old: '(1.x stores toolbar)',
        new: JSON.stringify(newStep.value),
        note: 'stored toolbar must migrate to buttons',
      });
    }
    if (name === 'job.stored_source_tagger_input') {
      const v = newStep.value || {};
      if (v.has_tokens !== false || v.has_stored_l3 !== true) {
        findings.push({
          at: name,
          old: '(1.x numbers request text, keeps tokens/duplicates)',
          new: JSON.stringify(v).slice(0, 240),
          note: 'tagger context must strip bake/spinner tokens, drop the current message, and number the stored original',
        });
      }
    }
    if (name === 'job.stored_source_chat') {
      const lines = String(newStep.value?.body || '').split('\n');
      const oldIdx = lines.findIndex((l) => l.includes('old-card'));
      const fresh = lines
        .map((l, i) => (/\[\[@inray/.test(l) && !l.includes('old-card') ? i : -1))
        .filter((i) => i >= 0);
      const oath = lines.findIndex((l) => l.includes('맹약도'));
      const sun = lines.findIndex((l) => l.includes('태양은'));
      if (!(oldIdx === 0 && fresh.length === 1 && oath >= 0 && sun >= 0 && fresh[0] > oath && fresh[0] < sun)) {
        findings.push({
          at: name,
          old: '(1.x slots at the raw line)',
          new: JSON.stringify(lines).slice(0, 240),
          note: 'spinner slot must sit on the stripped-basis line with the old bake row preserved',
        });
      }
    }
    if (name === 'comfy.test'
      && (newStep.value?.ok !== true || !String(newStep.value?.message || '').includes('연결 테스트 생략'))) {
      findings.push({
        at: name,
        old: JSON.stringify(oldStep.value),
        new: JSON.stringify(newStep.value),
        note: '2.5.29 Comfy test must persist without /system_stats',
      });
    }
    // Reroll replays the image file. Settings presets must not rewrite base.
    if (name === 'presets.reroll_swaps_style' && newStep.value?.kept_file !== true) {
      findings.push({
        at: name,
        old: String(oldStep.value?.swapped),
        new: JSON.stringify(newStep.value),
        note: '2.0 reroll must keep the file base and ignore the active preset',
      });
    }
    if (name === 'gallery.unlink_duplicate_hash_isolated'
      && (newStep.value?.kept !== true || Number(newStep.value?.unlinked) !== 0)) {
      findings.push({
        at: name,
        old: JSON.stringify(oldStep.value),
        new: JSON.stringify(newStep.value),
        note: 'duplicate hashes must not override a mismatched stored message index',
      });
    }
    if (name === 'presets.reroll_keeps_v4_from_complexity'
      && (newStep.value?.v4 !== true || !(newStep.value?.sent >= 1))) {
      findings.push({
        at: name,
        old: String(oldStep.value?.model),
        new: JSON.stringify(newStep.value),
        note: 'with nai5_first on, a simple-complexity reroll must stay on V4',
      });
    }
    if (name === 'presets.reroll_keeps_v5_model'
      && (newStep.value?.keeps_file !== true || !(newStep.value?.sent >= 1))) {
      findings.push({
        at: name,
        old: String(oldStep.value?.model),
        new: JSON.stringify(newStep.value),
        note: 'reroll must send the file model, not nai5_only from settings',
      });
    }
    if (name === 'speech.bubble_on_caption'
      && (newStep.value?.char1_ends_with_bubble !== true
        || newStep.value?.bubbles !== 1
        || newStep.value?.main_has_bubble !== false)) {
      findings.push({
        at: name,
        old: JSON.stringify(oldStep.value),
        new: JSON.stringify(newStep.value),
        note: 'the speaking character\'s caption must end with the bubble, and only theirs; main carries none',
      });
    }
    if (name === 'job.person_tag_emphasis' && newStep.value?.emphasized !== true) {
      findings.push({
        at: name,
        old: String(oldStep.value?.emphasized),
        new: String(newStep.value?.emphasized),
        note: '2.0 must wrap person tags with default weight 3',
      });
    }
    if (name === 'settings.registered_keys' && (newStep.value?.ownCleared !== true || newStep.value?.otherKept !== true)) {
      findings.push({at:name, old:JSON.stringify(oldStep.value),new:JSON.stringify(newStep.value),note:'deleting one NAI family must not borrow or remove the other family registration'});
    }
    if (name === 'settings.uc_preset_none' && newStep.value?.none !== true) {
      findings.push({
        at: name,
        old: String(oldStep.value?.none),
        new: String(newStep.value?.none),
        note: '2.4.7 must persist nai.uc_preset=none',
      });
    }
    if (name === 'job.uc_preset_none' && newStep.value?.clean !== true) {
      findings.push({
        at: name,
        old: String(oldStep.value?.clean),
        new: String(newStep.value?.clean),
        note: '2.4.7 must not append human_focus UC leftovers on generate',
      });
    }
    if (
      (name === 'chars.seed_sess_chat_a' || name === 'chars.seed_sess_chat_b')
      && newStep.value?.wear_ok !== true
    ) {
      findings.push({
        at: name,
        old: '(legacy hat⊂chat spill)',
        new: String(newStep.value?.wear_ok),
        note: '2.0 must keep seed marker in appearance, white dress in attire',
      });
    }
    if (name === 'chars.unified_patch') {
      const chars = Array.isArray(newStep.value?.characters) ? newStep.value.characters : [];
      const patched = chars.find((c) => c?.id === 'chat-a-nim');
      const other = chars.find((c) => c?.id === 'chat-b-nim');
      if (chars.length !== 2 || !String(patched?.appearance || '').includes('vivid violet') || !String(other?.appearance || '').includes('old chat B')) {
        findings.push({
          at: name,
          old: '(1.x cache row)',
          new: JSON.stringify({ length: chars.length, a: patched?.appearance, b: other?.appearance }).slice(0, 240),
          note: '2.0 unify POST must return live concat: patched A + original B',
        });
      }
    }
    if (name === 'chars.chat_b_after_patch') {
      const app = String(newStep.value?.characters?.[0]?.appearance || '');
      if (!app.includes('old chat B')) {
        findings.push({
          at: name,
          old: '(1.x fan-out)',
          new: app.slice(0, 160),
          note: '2.0 must leave chat B looks unchanged after an A-origin unified patch',
        });
      }
    }
    if (name === 'chars.unified_patch_single') {
      const chars = Array.isArray(newStep.value?.characters) ? newStep.value.characters : [];
      if (chars.length !== 3) {
        findings.push({
          at: name,
          old: '(1.x cache)',
          new: String(chars.length),
          note: '2.0 unify POST must list all three root-chat rows',
        });
      }
    }
    if (name === 'chars.chat_b_after_delete') {
      const n = Array.isArray(newStep.value?.characters) ? newStep.value.characters.length : -1;
      if (n !== 1) {
        findings.push({
          at: name,
          old: '(1.x fan-out delete)',
          new: String(n),
          note: '2.0 must keep chat B after deleting the A-origin unified row',
        });
      }
    }
    continue;
  }
  const a = normalize(oldStep);
  const b = normalize(newStep);
  delete a.step; delete b.step;
  diff(a, b, name, findings);
}
for (const name of newSteps.keys()) {
  if (NEW_ONLY_STEPS.has(name)) continue;
  if (!oldSteps.has(name)) findings.push({ at: name, old: '(step missing)', new: '(step present)' });
}

if (findings.length === 0) {
  console.log(`[parity] PASS — ${oldSteps.size} legacy steps checked; ${expectedAssetChanges.length} asserted asset-storage changes`);
  for(const at of expectedAssetChanges)console.log('  intentional: '+at);
  process.exit(0);
}

console.log(`[parity] ${findings.length} difference(s) across ${oldSteps.size} steps:\n`);
for (const f of findings.slice(0, 200)) {
  console.log(`  ${f.at}`);
  console.log(`    old: ${f.old}`);
  console.log(`    new: ${f.new}${f.note ? `  (${f.note})` : ''}`);
}
if (findings.length > 200) console.log(`  ... and ${findings.length - 200} more`);
process.exit(1);
