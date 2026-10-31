import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// The LLM is a stand-in: it answers what the test sets, and keeps what it was asked.
const built = await build({ stdin: { contents: "export {chooseBgm} from './src/providers/sound/choose';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'llm', setup(b) { b.onLoad({ filter: /[\\/]providers[\\/]llm[\\/]client\.ts$/ }, () => ({ loader: 'ts', contents: 'export async function callLlm(_s, messages) { globalThis.asked = messages; return globalThis.answer; }' })); } }] });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const item = key => ({ key, kind: 'bgm', name: key, tags: [], folder: '', source: 'url', url: `https://x.test/${key}.mp3` });
const items = ['rain', 'storm', 'cafe', 'night'].map(item), settings = { jev: { key: '' }, llm: {} };

test('BGM by the LLM: it ranks three tracks, best first; an older one-number answer is a ranking of one', async () => {
  globalThis.answer = '{"n":[2,4,2,1]}';
  assert.deepEqual(await api.chooseBgm('비가 내린다', items, 'llm', settings), ['storm', 'night', 'rain'], 'listed once each, three at most');
  assert.match(globalThis.asked[0].content, /three tracks/);
  globalThis.answer = '{"n":3}';
  assert.deepEqual(await api.chooseBgm('카페', items, 'llm', settings), ['cafe']);
  globalThis.answer = '{"n":[9]}';
  assert.deepEqual(await api.chooseBgm('카페', items, 'llm', settings), [], 'a number that names no track: none');
});
