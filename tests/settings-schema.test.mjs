import test from "node:test";
import assert from "node:assert/strict";

import {
  migrateSettings,
  exportSettings,
  importSettings,
  splitSettingsDocPrompts,
  applySettingsResetKeeps,
} from "../.test-build/settings-schema.mjs";

test("inline chat overlay and persist-bake cannot be disabled", () => {
  const card = migrateSettings({ card: {} }).card;
  assert.equal(card.inline_chat_images, true);
  assert.equal(card.persist_chat_images, true);
  assert.equal(migrateSettings({ card: { persist_chat_images: false } }).card.persist_chat_images, true);
  assert.equal(migrateSettings({ card: { inline_chat_images: false } }).card.inline_chat_images, true);
});

test("scroll_hold defaults off and accepts truthy flags", () => {
  assert.equal(migrateSettings({ card: {} }).card.scroll_hold, false);
  assert.equal(migrateSettings({ card: { scroll_hold: true } }).card.scroll_hold, true);
  assert.equal(migrateSettings({ card: { scroll_hold: "true" } }).card.scroll_hold, true);
  assert.equal(migrateSettings({ card: { scroll_hold: 0 } }).card.scroll_hold, false);
});

test("person_tag_weight migrates to 0–5 (default 3)", () => {
  assert.equal(migrateSettings({ card: {} }).card.person_tag_weight, 3);
  assert.equal(migrateSettings({ card: { person_tag_weight: 0 } }).card.person_tag_weight, 0);
  assert.equal(migrateSettings({ card: { person_tag_weight: 4.6 } }).card.person_tag_weight, 5);
  assert.equal(migrateSettings({ card: { person_tag_weight: 99 } }).card.person_tag_weight, 5);
  assert.equal(migrateSettings({ card: { person_tag_weight: "2" } }).card.person_tag_weight, 2);
});

test("settings export omits API keys and auth tokens", () => {
  const exported = JSON.parse(exportSettings({
    auth_token: "secret",
    llm: { api_key: "llm-secret", model: "model" },
    nai: { api_key: "nai-secret", model: "nai" },
    card: { inline_thumb_pct: 100 },
  }));

  assert.equal(exported.auth_token, undefined);
  assert.equal(exported.llm.api_key, undefined);
  assert.equal(exported.nai.api_key, undefined);
  assert.equal(exported.llm.model, "model");
  assert.equal(exported.nai.model, "nai");
});

test("malformed import rejects without producing replacement settings", () => {
  assert.throws(() => importSettings("{ nope"), /JSON/);
  assert.throws(() => importSettings("[]"), /object/i);
});

test("valid import migrates legacy scale", () => {
  const imported = importSettings(JSON.stringify({ card: { inline_thumb_pct: 300 } }));
  assert.equal(imported.card.inline_thumb_pct, 50);
  assert.equal(imported.settings_schema_version, 2);
});

test("focus_character migrates to off|female|male|auto", () => {
  assert.equal(migrateSettings({ card: {} }).card.focus_character, "off");
  assert.equal(migrateSettings({ card: { focus_character: "female" } }).card.focus_character, "female");
  assert.equal(migrateSettings({ card: { focus_character: "male" } }).card.focus_character, "male");
  assert.equal(migrateSettings({ card: { focus_character: "auto" } }).card.focus_character, "auto");
  assert.equal(migrateSettings({ card: { focus_character: true } }).card.focus_character, "auto");
  assert.equal(migrateSettings({ card: { focus_character: "women" } }).card.focus_character, "female");
  assert.equal(migrateSettings({ card: { focus_character: "nope" } }).card.focus_character, "off");
});

test("focus_weight migrates to 0–5 one decimal (default 2)", () => {
  assert.equal(migrateSettings({ card: {} }).card.focus_weight, 2);
  assert.equal(migrateSettings({ card: { focus_weight: 0 } }).card.focus_weight, 0);
  assert.equal(migrateSettings({ card: { focus_weight: 2.5 } }).card.focus_weight, 2.5);
  assert.equal(migrateSettings({ card: { focus_weight: 4.66 } }).card.focus_weight, 4.7);
  assert.equal(migrateSettings({ card: { focus_weight: 99 } }).card.focus_weight, 5);
  assert.equal(migrateSettings({ card: { focus_weight: "3.1" } }).card.focus_weight, 3.1);
});

test("focus_prompt migrates to default|strong|always|manual", () => {
  assert.equal(migrateSettings({ card: {} }).card.focus_prompt, "default");
  assert.equal(migrateSettings({ card: { focus_prompt: "strong" } }).card.focus_prompt, "strong");
  assert.equal(migrateSettings({ card: { focus_prompt: "always" } }).card.focus_prompt, "always");
  assert.equal(migrateSettings({ card: { focus_prompt: "manual" } }).card.focus_prompt, "manual");
  assert.equal(migrateSettings({ card: { focus_prompt: "force" } }).card.focus_prompt, "always");
  assert.equal(migrateSettings({ card: { focus_prompt: "nope" } }).card.focus_prompt, "default");
});

test("natural_base migrates boolean and aliases to mode enum", () => {
  assert.equal(migrateSettings({ card: { natural_base: true } }).card.natural_base, "short");
  assert.equal(migrateSettings({ card: { natural_base: false } }).card.natural_base, "off");
  assert.equal(migrateSettings({ card: { natural_base: "detailed" } }).card.natural_base, "detailed");
  assert.equal(migrateSettings({ card: { natural_base: "supplement" } }).card.natural_base, "supplement");
  assert.equal(migrateSettings({ card: {} }).card.natural_base, "short");
});

test("retired curation pipeline is dropped: settings block removed, legacy card flag pinned off", () => {
  const migrated = migrateSettings({ card: { composition_curation: true } });
  assert.equal(migrated.card.composition_curation, false);
  assert.equal('curation' in migrated, false);
  assert.equal('curation' in migrateSettings({ curation: { mode: "embed_snap" } }), false);
  assert.equal('curation' in migrateSettings({ curation: { mode: "two_stage" } }), false);
});

test("stream_keywords defaults to empty string", () => {
  assert.equal(migrateSettings({ card: {} }).card.stream_keywords, "");
  assert.equal(migrateSettings({ card: { stream_keywords: "future plan" } }).card.stream_keywords, "future plan");
});

test("stream_keywords_enabled migrates from needles when missing", () => {
  assert.equal(migrateSettings({ card: {} }).card.stream_keywords_enabled, false);
  assert.equal(migrateSettings({ card: { stream_keywords: "ab" } }).card.stream_keywords_enabled, false);
  assert.equal(migrateSettings({ card: { stream_keywords: "future plan" } }).card.stream_keywords_enabled, true);
  assert.equal(migrateSettings({ card: { stream_keywords: "future plan", stream_keywords_enabled: false } }).card.stream_keywords_enabled, false);
  assert.equal(migrateSettings({ card: { stream_keywords_enabled: "true" } }).card.stream_keywords_enabled, true);
});

test("asset_nai_tags migrates prepass_vision to prepass", () => {
  assert.equal(migrateSettings({ card: { asset_nai_tags: "prepass_vision" } }).card.asset_nai_tags, "prepass");
  assert.equal(migrateSettings({ card: { asset_nai_tags: true } }).card.asset_nai_tags, "prepass");
  assert.equal(migrateSettings({ card: { asset_nai_tags: false } }).card.asset_nai_tags, "off");
});

test("nai5 / coords / key lists migrate with safe defaults", () => {
  const empty = migrateSettings({ card: {}, nai: {} });
  assert.equal(empty.card.nai5_first, false);
  assert.equal(empty.card.nai5_only, false);
  assert.equal(empty.card.nai4_fallback, false);
  assert.equal(empty.card.nai5_speech, false);
  assert.equal(empty.card.studio_seed_lock, false);
  assert.deepEqual(empty.card.studio_folds, {});
  assert.deepEqual(
    migrateSettings({ card: { studio_folds: { preset: true, post: "true", junk: 0 } } }).card.studio_folds,
    { preset: true, post: true, junk: false },
  );
  assert.equal(empty.card.v5_natural_lang, "en");
  assert.equal(empty.card.nai_use_coords, true);
  assert.equal(empty.card.secondary_preset_id, "");
  assert.deepEqual(empty.nai.api_keys_v5, []);
  assert.deepEqual(empty.nai.api_keys_v4, []);
  assert.equal(empty.nai.sampler_v5, "k_euler_ancestral");
  assert.equal(empty.nai.sampler_v4, "k_euler_ancestral");
  assert.equal(empty.nai.steps_v5, 28);
  assert.equal(empty.nai.steps_v4, 28);
  assert.equal(empty.nai.sdxl_emphasis, false);
  const on = migrateSettings({
    card: { nai5_first: "true", v5_natural_lang: "ja", nai_use_coords: false },
    nai: { api_keys_v5: [" pst-a ", "pst-a", ""], sdxl_emphasis: "on" },
  });
  assert.equal(on.card.nai5_first, true);
  assert.equal(on.card.v5_natural_lang, "ja");
  assert.equal(on.card.nai_use_coords, false);
  assert.deepEqual(on.nai.api_keys_v5, ["pst-a"]);
  assert.equal(on.nai.sdxl_emphasis, true);
  const copied = migrateSettings({ nai: { sampler: "k_euler", steps: 23 } });
  assert.equal(copied.nai.sampler_v5, "k_euler");
  assert.equal(copied.nai.sampler_v4, "k_euler");
  assert.equal(copied.nai.steps_v5, 23);
  assert.equal(copied.nai.steps_v4, 23);
  const split = migrateSettings({
    nai: { sampler: "k_euler_ancestral", sampler_v5: "k_euler", sampler_v4: "k_dpmpp_2m", steps: 28, steps_v5: 20, steps_v4: 23 },
  });
  assert.equal(split.nai.sampler_v5, "k_euler");
  assert.equal(split.nai.sampler_v4, "k_dpmpp_2m");
  assert.equal(split.nai.steps_v5, 20);
  assert.equal(split.nai.steps_v4, 23);
});

test("uc_preset is always none (no leftover human_focus UC block)", () => {
  assert.equal(migrateSettings({ nai: {} }).nai.uc_preset, "none");
  assert.equal(migrateSettings({ nai: { uc_preset: "human_focus" } }).nai.uc_preset, "none");
  assert.equal(migrateSettings({ nai: { uc_preset: "heavy" } }).nai.uc_preset, "none");
});

test("inline_msg_actions migrates checkbox and aliases", () => {
  assert.equal(migrateSettings({ card: {} }).card.inline_msg_actions, "off");
  assert.equal(migrateSettings({ card: { inline_msg_actions: false } }).card.inline_msg_actions, "off");
  assert.equal(migrateSettings({ card: { inline_msg_actions: true } }).card.inline_msg_actions, "compat");
  assert.equal(migrateSettings({ card: { inline_msg_actions: "legacy" } }).card.inline_msg_actions, "legacy");
  assert.equal(migrateSettings({ card: { inline_msg_actions: "compat" } }).card.inline_msg_actions, "compat");
  assert.equal(migrateSettings({ card: { inline_msg_actions: "2.4.7" } }).card.inline_msg_actions, "legacy");
  assert.equal(migrateSettings({ card: { inline_msg_actions: "2.4.9" } }).card.inline_msg_actions, "compat");
});

test("inline_msg_fan defaults off and accepts on aliases", () => {
  assert.equal(migrateSettings({ card: {} }).card.inline_msg_fan, false);
  assert.equal(migrateSettings({ card: { inline_msg_fan: true } }).card.inline_msg_fan, true);
  assert.equal(migrateSettings({ card: { inline_msg_fan: "on" } }).card.inline_msg_fan, true);
  assert.equal(migrateSettings({ card: { inline_msg_fan: "1" } }).card.inline_msg_fan, true);
  assert.equal(migrateSettings({ card: { inline_msg_fan: "nope" } }).card.inline_msg_fan, false);
});

test("inline_chat_text_side defaults to before and accepts after", () => {
  assert.equal(migrateSettings({ card: {} }).card.inline_chat_text_side, "before");
  assert.equal(migrateSettings({ card: { inline_chat_text_side: "after" } }).card.inline_chat_text_side, "after");
  assert.equal(migrateSettings({ card: { inline_chat_text_side: "end" } }).card.inline_chat_text_side, "after");
  assert.equal(migrateSettings({ card: { inline_chat_text_side: "nope" } }).card.inline_chat_text_side, "before");
});

test("inline_chat_dom_radius defaults to 4 and clamps to 3–20", () => {
  assert.equal(migrateSettings({ card: {} }).card.inline_chat_dom_radius, 4);
  assert.equal(migrateSettings({ card: { inline_chat_dom_radius: 2 } }).card.inline_chat_dom_radius, 3);
  assert.equal(migrateSettings({ card: { inline_chat_dom_radius: "5" } }).card.inline_chat_dom_radius, 5);
  assert.equal(migrateSettings({ card: { inline_chat_dom_radius: 8.6 } }).card.inline_chat_dom_radius, 9);
  assert.equal(migrateSettings({ card: { inline_chat_dom_radius: 99 } }).card.inline_chat_dom_radius, 20);
});

test("toast_anchor and image_press_inspect migrate with safe defaults", () => {
  const empty = migrateSettings({ card: {} });
  assert.equal(empty.card.toast_anchor, "tc");
  assert.equal(empty.card.image_press_inspect, "hold");
  assert.equal(migrateSettings({ card: { toast_anchor: "bottom-right" } }).card.toast_anchor, "br");
  assert.equal(migrateSettings({ card: { toast_anchor: "nope" } }).card.toast_anchor, "tc");
  assert.equal(migrateSettings({ card: { image_press_inspect: "two-hand" } }).card.image_press_inspect, "two");
  assert.equal(migrateSettings({ card: { image_press_inspect: "double-tap" } }).card.image_press_inspect, "two");
  assert.equal(migrateSettings({ card: { image_press_inspect: "off" } }).card.image_press_inspect, "off");
  assert.equal(migrateSettings({ card: { image_press_inspect: "both" } }).card.image_press_inspect, "both");
  assert.equal(migrateSettings({ card: { image_press_inspect: "triple-tap" } }).card.image_press_inspect, "three");
});

test("comic tab defaults off and migrates enums", () => {
  const empty = migrateSettings({ card: {} });
  assert.equal(empty.card.comic_gen, "off");
  assert.equal(empty.card.comic_llm_batch, "once");
  assert.equal(empty.card.comic_schedule, "overlap");
  assert.equal(empty.card.comic_max_pages, 2);
  assert.equal(empty.card.comic_gen_ratio, 50);
  assert.equal(empty.card.comic_coords, "llm");
  assert.equal(empty.card.comic_author_note, "");
  assert.equal(empty.card.comic_steps, "");
  assert.equal(empty.card.comic_sampler, "");
  assert.equal(empty.card.comic_prompt_prefix, "");
  assert.equal(empty.card.comic_prompt_suffix, "");
  const on = migrateSettings({
    card: {
      comic_gen: true,
      comic_llm_batch: "per-shot",
      comic_schedule: "serial",
      comic_max_pages: 9,
      comic_coords: "coords",
      comic_steps: 23,
      comic_sampler: "k_euler",
    },
  });
  assert.equal(on.card.comic_gen, "on");
  assert.equal(on.card.comic_llm_batch, "per_shot");
  assert.equal(migrateSettings({ card: { comic_llm_batch: "with-main" } }).card.comic_llm_batch, "with_main");
  assert.equal(on.card.comic_schedule, "wait_taggers");
  assert.equal(on.card.comic_max_pages, 9);
  assert.equal(on.card.comic_gen_ratio, 50);
  assert.equal(on.card.comic_coords, "position");
  assert.equal(on.card.comic_steps, 23);
  assert.equal(on.card.comic_sampler, "k_euler");
  const zero = migrateSettings({ card: { comic_max_pages: 0 } });
  assert.equal(zero.card.comic_gen_ratio, 0);
  const copied = migrateSettings({ card: { comic_prompt: "wet ink" } });
  assert.equal(copied.card.comic_prompt_prefix, "wet ink");
  const kept = migrateSettings({ card: { comic_prompt: "old", comic_prompt_prefix: "" } });
  assert.equal(kept.card.comic_prompt_prefix, "");
});

test("settings reset keeps window pin and card presets on the factory blob", () => {
  const next = {
    card: {
      overlay_x_pct: 10,
      overlay_y_pct: 20,
      overlay_pin_unit: "pct",
      overlay_pin_origin: "bl",
      presets: [{ id: "factory", name: "팩" }],
      active_preset_id: "factory",
    },
  };
  applySettingsResetKeeps({
    card: {
      overlay_x_pct: 77,
      overlay_y_pct: 12,
      overlay_x_offset: 652,
      overlay_y_offset: 238,
      overlay_pin_unit: "pct",
      overlay_pin_origin: "tr",
      presets: [{ id: "mine", name: "내꺼" }],
      active_preset_id: "mine",
      secondary_preset_id: "other",
    },
  }, next);
  assert.equal(next.card.overlay_x_pct, 77);
  assert.equal(next.card.overlay_y_pct, 12);
  assert.equal(next.card.overlay_x_offset, 652);
  assert.equal(next.card.overlay_y_offset, 238);
  assert.equal(next.card.overlay_pin_origin, "tr");
  assert.equal(next.card.active_preset_id, "mine");
  assert.equal(next.card.secondary_preset_id, "other");
  assert.deepEqual(next.card.presets, [{ id: "mine", name: "내꺼" }]);
});

test("comic_aspect migrates to llm|landscape|portrait|square", () => {
  assert.equal(migrateSettings({ card: {} }).card.comic_aspect, "llm");
  assert.equal(migrateSettings({ card: { comic_aspect: "square" } }).card.comic_aspect, "square");
  assert.equal(migrateSettings({ card: { comic_aspect: "가로" } }).card.comic_aspect, "landscape");
  assert.equal(migrateSettings({ card: { comic_aspect: "nope" } }).card.comic_aspect, "llm");
});

test("llm reverse-bar migrates boolean toggle to off|memo|authority", () => {
  assert.equal(migrateSettings({ card: {} }).card.llm_reverse_bar, "off");
  assert.equal(migrateSettings({ card: { llm_reverse_bar: true } }).card.llm_reverse_bar, "authority");
  assert.equal(migrateSettings({ card: { llm_reverse_bar: "on" } }).card.llm_reverse_bar, "authority");
  assert.equal(migrateSettings({ card: { llm_reverse_bar: 1 } }).card.llm_reverse_bar, "authority");
  assert.equal(migrateSettings({ card: { llm_reverse_bar: "memo" } }).card.llm_reverse_bar, "memo");
  assert.equal(migrateSettings({ card: { llm_reverse_bar: "authority" } }).card.llm_reverse_bar, "authority");
  assert.equal(migrateSettings({ card: { llm_reverse_bar: "nope" } }).card.llm_reverse_bar, "off");
  assert.equal(migrateSettings({ card: {} }).card.llm_tag_cal, false);
  assert.equal(migrateSettings({ card: { llm_tag_cal: 1 } }).card.llm_tag_cal, true);
});

test("client direction/focus default empty and trim to text", () => {
  const empty = migrateSettings({ card: {} }).card;
  assert.equal(empty.client_direction, "");
  assert.equal(empty.client_focus, "");
  const filled = migrateSettings({ card: { client_direction: "  밤  ", client_focus: 42 } }).card;
  assert.equal(filled.client_direction, "밤");
  assert.equal(filled.client_focus, "42");
});

test("image completion sound defaults off and normalizes persisted booleans", () => {
  assert.equal(migrateSettings({ card: {} }).card.image_done_sound, false);
  assert.equal(migrateSettings({ card: { image_done_sound: true } }).card.image_done_sound, true);
  assert.equal(migrateSettings({ card: { image_done_sound: "true" } }).card.image_done_sound, true);
  assert.equal(migrateSettings({ card: { image_done_sound: "false" } }).card.image_done_sound, false);
});

test("overlay_markers is retired: left-line overlay stays off", () => {
  const on = migrateSettings({ card: { overlay_markers: true, inline_previews: false } });
  assert.equal(on.card.overlay_markers, false);
  assert.equal(on.card.inline_previews, false);

  const off = migrateSettings({ card: { overlay_markers: false, inline_previews: true } });
  assert.equal(off.card.overlay_markers, false);
  assert.equal(off.card.inline_previews, false);
  assert.equal(off.card.floating_viewer, true);
});

test("tts settings default off and clamp rate", () => {
  const empty = migrateSettings({ card: {} });
  assert.equal(empty.card.tts_on, false);
  assert.equal(empty.card.tts_rate, 1);
  assert.equal(empty.card.tts_voice, "");
  const on = migrateSettings({ card: { tts_on: "on", tts_rate: 9, tts_voice: "ko-KR" } });
  assert.equal(on.card.tts_on, true);
  assert.equal(on.card.tts_rate, 2);
  assert.equal(on.card.tts_voice, "ko-KR");
});

test("migrate drops ephemeral preview data URLs from presets and NAI", () => {
  const migrated = migrateSettings({
    nai: {
      vibe_preview_url: "data:image/png;base64,AAA",
      reference_preview_url: "data:image/png;base64,BBB",
    },
    card: {
      presets: [{
        id: "p1",
        name: "스타일",
        look_hash: "abc",
        vibe_configured: true,
        look_configured: true,
        vibe_preview_url: "data:image/webp;base64,CCC",
        look_preview_url: "data:image/webp;base64,DDD",
      }],
    },
  });
  const preset = migrated.card.presets[0];
  assert.equal(preset.id, "p1");
  assert.equal(preset.look_hash, "abc");
  assert.equal(preset.vibe_configured, true);
  assert.equal(preset.look_configured, true);
  assert.equal(preset.vibe_preview_url, undefined);
  assert.equal(preset.look_preview_url, undefined);
  assert.equal(migrated.nai.vibe_preview_url, undefined);
  assert.equal(migrated.nai.reference_preview_url, undefined);
});

test("settings export also omits ephemeral preview data URLs", () => {
  const exported = JSON.parse(exportSettings({
    nai: { vibe_preview_url: "data:image/png;base64,AAA" },
    card: { presets: [{ id: "p1", look_preview_url: "data:image/webp;base64,DDD" }] },
  }));
  assert.equal(exported.nai.vibe_preview_url, undefined);
  assert.equal(exported.card.presets[0].look_preview_url, undefined);
});


test("floating viewer switch can actually be disabled", () => {
  assert.equal(migrateSettings({card:{floating_viewer:false}}).card.floating_viewer,false);
});

test("splitSettingsDocPrompts separates the embedded prompts pack", () => {
  const split = splitSettingsDocPrompts({ card: { a: 1 }, prompts: { tagger: "T", format: "F" } });
  assert.deepEqual(split.settings, { card: { a: 1 } });
  assert.deepEqual(split.prompts, { tagger: "T", format: "F" });
});

test("splitSettingsDocPrompts keeps non-string prompt values out", () => {
  const split = splitSettingsDocPrompts({ prompts: { tagger: "T", n: 3, o: { x: 1 }, a: ["x"] } });
  assert.deepEqual(split.prompts, { tagger: "T" });
});

test("splitSettingsDocPrompts returns null prompts when absent or malformed", () => {
  assert.equal(splitSettingsDocPrompts({ card: {} }).prompts, null);
  assert.equal(splitSettingsDocPrompts({ prompts: "nope" }).prompts, null);
  assert.equal(splitSettingsDocPrompts({ prompts: ["tagger"] }).prompts, null);
  assert.equal(splitSettingsDocPrompts(null).prompts, null);
  assert.equal(splitSettingsDocPrompts("str").prompts, null);
  assert.deepEqual(splitSettingsDocPrompts(null).settings, {});
});
