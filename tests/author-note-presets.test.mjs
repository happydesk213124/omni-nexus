import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

// 메인 태거 작가의 노트 presets: examples ship read-only, saved rows round-trip, examples never get stored.
const bundle = await build({
  stdin: { contents: `export {listAuthorNotePresets,saveAuthorNotePresets} from './src/services/author-note-presets';
export {normalizeAuthorNotePresets,authorNotePresetExamples} from './src/domain/tagging/author-note-presets';
export {setPrompt} from './src/services/settings';
export {promptText} from './src/config/prompts';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.txt': 'text' },
  define: { __PLUGIN_ID__: '"omni-nexus"', __PLUGIN_VERSION__: '"test"' },
});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const kv = new Map();
// The shipped pack, as the build injects it.
globalThis.__INLAY_NATIVE_PROMPTS__ = { author_note: readFileSync('prompts/author_note.txt', 'utf8') };
globalThis.risuai = { pluginStorage: { getItem: async k => kv.get(k), setItem: async (k, v) => kv.set(k, v), removeItem: async k => kv.delete(k) } };

test('examples carry the POV and cinematic tag rules the tagger needs', () => {
  const examples = api.authorNotePresetExamples();
  const pov = examples.find(row => row.id === 'example-pov');
  assert.ok(examples.every(row => row.builtin && row.id.startsWith('example-') && row.text.length > 100));
  for (const tag of ['pov hands', 'pov crotch', 'looking at viewer', 'muscular male', 'fat man', 'dark-skinned female', 'the viewer'])
    assert.ok(pov.text.includes(tag), tag);
  // A cast entry would bring the persona's whole registered look (hair, face) into the picture.
  for (const row of examples.filter(item => item.id.startsWith('example-pov')))
    assert.match(row.text, /Never put them in characters\[\] or new_characters, not even when their hands or body are in frame/, row.id + ': the persona is never a character');
  assert.doesNotMatch(examples.map(row => row.text).join('\n'), /source: headpat|target: headpat/, 'no contact pair with a viewer who is not in the cast');
  assert.match(examples.find(row => row.id === 'example-cinematic').text, /wide shot[\s\S]*close-up/);
});

test('직접 입력 holds the hand-written note: picking a preset never touches it', async () => {
  await api.setPrompt('author_note', 'my own rules');
  const first = await api.listAuthorNotePresets();
  assert.equal(first.custom, 'my own rules', 'the note written before the update is 직접 입력');
  assert.equal(first.selected, 'custom');
  assert.deepEqual(first.items.filter(row => !row.builtin), [], 'no extra preset is made for it');
  // A pick: the note shows the example, the selection is saved, 직접 입력 stays.
  const pov = first.items.find(row => row.id === 'example-pov');
  await api.setPrompt('author_note', pov.text);
  const picked = await api.saveAuthorNotePresets({ selected: 'example-pov' });
  assert.equal(picked.custom, 'my own rules');assert.equal(picked.selected, 'example-pov');
  const again = await api.listAuthorNotePresets();
  assert.equal(again.custom, 'my own rules', 'going back to 직접 입력 brings the writing back');
  // Typing in 직접 입력 is what changes it.
  assert.equal((await api.saveAuthorNotePresets({ custom: 'edited rules' })).custom, 'edited rules');
  const shipped = first.items.find(row => row.id === 'example-default');
  assert.ok(shipped?.builtin && shipped.name === '기존 노트 (기본값)' && shipped.text === api.promptText('author_note') && shipped.text.length > 0, 'the shipped note is always pickable');
  kv.clear();
});

test('an older save (before 직접 입력) moves 「내 기존 노트」 into 직접 입력 when the note is now an example', async () => {
  const pov = api.authorNotePresetExamples().find(row => row.id === 'example-pov');
  await api.saveAuthorNotePresets([{ id: 'kept-x', name: '내 기존 노트', text: 'the note before the update' }]);
  // Simulate the older shape: items only.
  for (const [key, value] of kv) if (value && typeof value === 'object') kv.set(key, { items: value.items });
  await api.setPrompt('author_note', pov.text);
  const listed = await api.listAuthorNotePresets();
  assert.equal(listed.custom, 'the note before the update');
  assert.equal(listed.selected, 'example-pov', 'the note on screen is still the example it is');
  kv.clear();
});

test('first run with the untouched shipped note: empty 직접 입력, the shipped note picked', async () => {
  await api.setPrompt('author_note', api.promptText('author_note'));
  const listed = await api.listAuthorNotePresets();
  assert.deepEqual(listed.items.filter(row => !row.builtin), []);
  assert.equal(listed.custom, '');assert.equal(listed.selected, 'example-default');
  kv.clear();
});

test('saved presets round-trip; examples and example ids are never stored', async () => {
  const examples = api.authorNotePresetExamples();
  const saved = await api.saveAuthorNotePresets([
    { id: 'mine', name: '  내   POV ', text: 'a\r\nb' },
    { id: 'example-pov', name: 'shadow', text: 'x' },
    { id: 'mine', name: 'dupe', text: 'y' },
    { name: 'no id', text: 'z' },
    ...examples,
  ]);
  const stored = [...kv.values()].find(value => Array.isArray(value?.items));
  assert.equal(typeof stored.custom, 'string', '직접 입력 is kept beside the presets');
  assert.deepEqual(stored.items, [{ id: 'mine', name: '내 POV', text: 'a\nb' }]);
  assert.deepEqual(saved.items.map(row => row.id), ['mine', 'example-default', ...examples.map(row => row.id)]);
  assert.deepEqual((await api.listAuthorNotePresets()).items, saved.items);
});
