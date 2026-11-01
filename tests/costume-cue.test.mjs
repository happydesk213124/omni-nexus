import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/domain/tts/costume-cue';export {parseTtsMessage} from './src/domain/tts/segment';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
// 하린 wears default [0], swimsuit [1], melony_form [2]; Dark_Knight is someone in their own right; 소라 has no costumes read.
const people = { 하린: ['default', 'swimsuit', 'melony_form'], Dark_Knight: ['default'], Dark: ['default', 'knight'], 소라: [] };
const costumesOf = name => people[name];

test('a cue naming the costume by its name: that person, that costume\'s number', () => {
  assert.deepEqual(api.costumeCue('하린_melony_form', costumesOf), { speaker: '하린', costume: 2 });
  assert.deepEqual(api.costumeCue('하린_Melony Form', costumesOf), { speaker: '하린', costume: 2 }, 'case and spaces aside');
  assert.deepEqual(api.costumeCue('하린_melony-form', costumesOf), { speaker: '하린', costume: 2 });
  assert.deepEqual(api.costumeCue('하린_swimsuit', costumesOf), { speaker: '하린', costume: 1 });
  assert.deepEqual(api.costumeCue('하린_default', costumesOf), { speaker: '하린', costume: 0 });
});

test('never split: a whole name that is someone, a rest that names none of their costumes, no one known', () => {
  assert.equal(api.costumeCue('Dark_Knight', costumesOf), null, 'Dark_Knight is someone: not Dark in a knight costume');
  assert.equal(api.costumeCue('하린_pajamas', costumesOf), null);
  assert.equal(api.costumeCue('소라_melony_form', costumesOf), null, 'no costume of theirs known');
  assert.equal(api.costumeCue('유나_melony_form', costumesOf), null);
  assert.equal(api.costumeCue('하린', costumesOf), null);
  assert.equal(api.costumeCue('_melony_form', costumesOf), null);
});

test('the lines of a reply: a named costume becomes its number; a numbered one and the rest are left as they are', () => {
  const lines = api.parseTtsMessage(['하린_melony_form (happy): "변신 완료!"', '하린_1 (calm): "수영복이야."', 'Dark_Knight: "물러서라."', '바람이 불었다.'].join('\n'));
  const named = api.namedCostumes(lines, costumesOf);
  assert.deepEqual(named.map(s => [s.speaker, s.costume ?? 0, s.text]), [['하린', 2, '변신 완료!'], ['하린', 1, '수영복이야.'], ['Dark_Knight', 0, '물러서라.'], ['', 0, '바람이 불었다.']]);
  assert.equal(named[0].tone, 'happy');
  assert.equal(named[2], lines[2], 'untouched lines are the same objects');
  assert.equal(named[3], lines[3]);
});
