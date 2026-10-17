import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// 메인 태거 작가의 노트 presets: examples ship read-only, saved rows round-trip, examples never get stored.
const bundle = await build({
  stdin: { contents: `export {listAuthorNotePresets,saveAuthorNotePresets} from './src/services/author-note-presets';
export {normalizeAuthorNotePresets,authorNotePresetExamples} from './src/domain/tagging/author-note-presets';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.txt': 'text' },
  define: { __PLUGIN_ID__: '"omni-nexus"', __PLUGIN_VERSION__: '"test"' },
});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const kv = new Map();
globalThis.risuai = { pluginStorage: { getItem: async k => kv.get(k), setItem: async (k, v) => kv.set(k, v), removeItem: async k => kv.delete(k) } };

test('examples carry the POV and cinematic tag rules the tagger needs', () => {
  const examples = api.authorNotePresetExamples();
  const pov = examples.find(row => row.id === 'example-pov');
  assert.ok(examples.every(row => row.builtin && row.id.startsWith('example-') && row.text.length > 100));
  for (const tag of ['pov hands', 'pov crotch', 'head out of frame', 'faceless male', 'faceless female', 'looking at viewer', 'muscular male', 'fat man', 'the viewer'])
    assert.ok(pov.text.includes(tag), tag);
  assert.match(pov.text, /안 보이는 샷\(보기만 함\): 넣지 마세요/,'an unseen viewer stays out of the cast');
  assert.match(examples.find(row => row.id === 'example-cinematic').text, /wide shot[\s\S]*close-up/);
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
  assert.deepEqual(saved.items.map(row => row.id), ['mine', ...examples.map(row => row.id)]);
  assert.deepEqual((await api.listAuthorNotePresets()).items, saved.items);
});
