import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const load = async entry => import('data:text/javascript;base64,' + Buffer.from((await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm' })).outputFiles[0].text).toString('base64'));
const binding = await load('src/domain/style-presets/binding.ts');
const note = await load('src/domain/tagging/character-note.ts');
const ids = new Set(['omni', 'water', 'anime']);   // a preset may itself be named "omni"
const presets = new Set(['p-omni', 'p-water', 'p-anime']);

test('a session follows its bot, the bot follows Omni; each level overrides the one above', () => {
  const e = (character, session) => binding.effectivePreset(presets, 'p-omni', character, session);
  assert.deepEqual(e('', ''), { id: 'p-omni', source: 'omni' }, 'nothing bound: Omni');
  assert.deepEqual(e('p-water', ''), { id: 'p-water', source: 'character' }, 'the session follows its bot');
  assert.deepEqual(e('p-water', 'p-anime'), { id: 'p-anime', source: 'session' }, 'the session picks its own');
  assert.deepEqual(e('p-water', 'omni'), { id: 'p-omni', source: 'omni' }, 'the session follows Omni past its bot');
  assert.deepEqual(binding.characterPreset(presets, 'p-omni', 'p-water'), { id: 'p-water', source: 'character' });
  assert.deepEqual(binding.characterPreset(presets, 'p-omni', ''), { id: 'p-omni', source: 'omni' });
  void ids;
});

test('a choice naming a preset that is gone falls through as if unset', () => {
  assert.deepEqual(binding.effectivePreset(presets, 'p-omni', 'deleted', ''), { id: 'p-omni', source: 'omni' });
  assert.deepEqual(binding.effectivePreset(presets, 'p-omni', 'p-water', 'deleted'), { id: 'p-water', source: 'character' });
});

test('the bound preset takes first place; the secondary steps aside when it is the same one', () => {
  const card = { active_preset_id: 'p-omni', secondary_preset_id: 'p-water', other: 1 };
  assert.equal(binding.cardWithPreset(card, ''), card, 'unbound: the settings as they are');
  assert.equal(binding.cardWithPreset(card, 'p-omni'), card);
  assert.deepEqual(binding.cardWithPreset(card, 'p-anime'), { active_preset_id: 'p-anime', secondary_preset_id: 'p-water', other: 1 });
  assert.deepEqual(binding.cardWithPreset(card, 'p-water'), { active_preset_id: 'p-water', secondary_preset_id: '', other: 1 });
});

test('stored bindings keep only string choices under sane keys', () => {
  assert.deepEqual(binding.normalizePresetBindings({ characters: { c: 'p-water', bad: 3, '': 'x' }, sessions: { s: 'omni', t: 'has space' } }),
    { characters: { c: 'p-water' }, sessions: { s: 'omni' } });
  assert.deepEqual(binding.normalizePresetBindings(null), { characters: {}, sessions: {} });
});

test('the bot note: JSON round trip, hand-typed text leads, empty means no entry, session wins in the prompt', () => {
  assert.deepEqual(note.parseCharacterNote(note.serializeCharacterNote({ prefix: 'soft light', suffix: 'film grain', preset_id: 'np-1' })), { prefix: 'soft light', suffix: 'film grain', preset_id: 'np-1' });
  assert.deepEqual(note.parseCharacterNote('typed in the lorebook'), { prefix: 'typed in the lorebook', suffix: '', preset_id: '' });
  assert.equal(note.serializeCharacterNote({ prefix: '', suffix: '', preset_id: 'np-1' }), '', 'a picked preset alone keeps no entry');
  assert.equal(note.serializeCharacterNote({ prefix: '  ', suffix: '' }), '');
  const content = note.characterNoteSystemContent({ prefix: 'soft light', suffix: '' });
  assert.match(content, /^# 캐릭터 작가의 노트\n## 선행\nsoft light\n> .*session's own instructions below take precedence/);
  assert.equal(note.characterNoteSystemContent({ prefix: '', suffix: '' }), '');
  assert.equal(note.CHARACTER_NOTE_LORE, 'omni.nexus.note.character');
});
