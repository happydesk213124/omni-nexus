import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSettingsPreset, settingsPresetJson, applyPresetSettings } from '../.test-build/settings-preset.mjs';
import { settingsPresetExamples } from '../.test-build/settings-preset-examples.mjs';
const defaults = JSON.parse(readFileSync(new URL('../src/config/default-settings.json', import.meta.url)));

test('portable preset excludes styles, connections, keys and non-note prompts even from a full export', () => {
  const raw = {name:'test',card:{...defaults.card,image_min:1,presets:[{id:'foreign',positive:'FOREIGN STYLE'}],active_preset_id:'foreign',custom_pos:'FOREIGN STYLE',fixed_prompt_suffix:'FOREIGN STYLE',comic_author_note:'comic note'},llm:{api_key:'SECRET',service_account_json:'PRIVATE'},nai:{...defaults.nai,api_key:'SECRET',comfy_url:'PRIVATE'},prompts:{author_note:'author',asset_author_note:'asset',global_author_note:'global',tagger:'FOREIGN SYSTEM'}};
  const preset = normalizeSettingsPreset(raw,defaults);
  const json = settingsPresetJson(preset);
  assert.doesNotMatch(json,/FOREIGN|PRIVATE|SECRET|active_preset|presets/);
  assert.deepEqual(preset.prompts,{author_note:'author',asset_author_note:'asset',global_author_note:'global'});
  assert.equal(preset.settings.card.comic_author_note,'comic note');
  assert.deepEqual(normalizeSettingsPreset(JSON.parse(json),defaults),preset);
});

test('applying presets resets omitted general fields but preserves complete styles and connection setup', () => {
  const current=structuredClone(defaults);
  Object.assign(current.card,{image_min:6,presets:[{id:'mine',positive:'unchanged',look_hash:'look',vibe_configured:true}],active_preset_id:'mine',secondary_preset_id:'secondary',custom_pos:'keep',custom_neg:'keep neg',fixed_prompt_prefix:'keep prefix'});
  current.llm={source:'custom',api_key:'secret',service_account_json:'private',endpoint:'https://example.invalid'};
  current.llm_roles={comic:{api_key:'comic-secret'}};
  Object.assign(current.nai,{api_key:'nai-secret',api_keys_v5:[{token:'pooled'}],comfy_url:'keep-url',image_reference:'keep-ref'});
  const preset=normalizeSettingsPreset({name:'new',card:{image_max:2},prompts:{}},defaults);
  const next=applyPresetSettings(current,defaults,preset);
  for (const key of ['presets','active_preset_id','secondary_preset_id','custom_pos','custom_neg','fixed_prompt_prefix']) assert.deepEqual(next.card[key],current.card[key],key);
  assert.deepEqual(next.llm,current.llm); assert.deepEqual(next.llm_roles,current.llm_roles);
  for(const key of ['api_key','api_keys_v5','comfy_url','image_reference']) assert.deepEqual(next.nai[key],current.nai[key]);
  assert.equal(next.card.image_min,defaults.card.image_min);assert.equal(next.card.image_max,2);
  assert.equal(current.card.image_min,6,'input is not mutated');
});

test('examples contain supplied all-comic, ten alternatives and POV without inherited style data', () => {
  const rows=settingsPresetExamples();
  assert.equal(rows.length,12);assert.equal(new Set(rows.map(row=>row.id)).size,12);
  const supplied=rows.find(row=>row.id==='example-all-comic');
  assert.equal(supplied.settings.card.comic_gen_ratio,100);assert.equal(supplied.settings.card.comic_natural_supplement,true);
  assert.ok(supplied.prompts.author_note.length>100);assert.ok(supplied.settings.card.comic_author_note.length>100);
  assert.match(rows.find(row=>row.id==='example-pov').prompts.author_note,/pov/);
  for (const row of rows) {
    assert.equal(row.builtin,true);
    assert.ok(!('presets' in row.settings.card));assert.ok(!('active_preset_id' in row.settings.card));
    assert.deepEqual(Object.keys(row.prompts),['author_note','asset_author_note','global_author_note']);
  }
});

test('invalid imports fail instead of becoming an empty settings reset', () => {
  for(const raw of [null,[],{name:'empty'},{name:'bad',card:{}},{format:'wrong',version:1,name:'wrong',card:{image_min:1}},{format:'omni-nexus-settings-preset',version:2,name:'future',card:{image_min:1}}]) {
    assert.throws(()=>normalizeSettingsPreset(raw,defaults));
  }
});
