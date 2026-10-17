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

test('first run keeps a hand-written note as 내 기존 노트, once', async () => {
  await api.setPrompt('author_note', 'my own rules');
  const first = await api.listAuthorNotePresets();
  const kept = first.items.filter(row => !row.builtin);
  assert.deepEqual(kept.map(row => [row.name, row.text]), [['내 기존 노트', 'my own rules']]);
  // A later pick changes the note; the kept copy stays and is not made twice.
  await api.setPrompt('author_note', 'something else');
  assert.deepEqual((await api.listAuthorNotePresets()).items.filter(row => !row.builtin).map(row => row.id), [kept[0].id]);
  const shipped = first.items.find(row => row.id === 'example-default');
  assert.ok(shipped?.builtin && shipped.name === '기존 노트 (기본값)' && shipped.text === api.promptText('author_note') && shipped.text.length > 0, 'the shipped note is always pickable');
  kv.clear();
});

test('first run with the untouched shipped note saves nothing extra', async () => {
  await api.setPrompt('author_note', api.promptText('author_note'));
  assert.deepEqual((await api.listAuthorNotePresets()).items.filter(row => !row.builtin), []);
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
  assert.deepEqual(stored.items, [{ id: 'mine', name: '내 POV', text: 'a\nb' }]);
  assert.deepEqual(saved.items.map(row => row.id), ['mine', 'example-default', ...examples.map(row => row.id)]);
  assert.deepEqual((await api.listAuthorNotePresets()).items, saved.items);
});
