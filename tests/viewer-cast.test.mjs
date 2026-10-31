import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/domain/viewer/cast';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { stageAt } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

const say = (who, face = null) => ({ who, face });
const narr = say('');
// 0 narration · 1 A · 2 A · 3 picture · 4 B · 5–7 narration · 8 C · 9 A
const lines = [narr, say('A', 'happy'), say('A', 'happy'), null, say('B', 'neutral'), narr, narr, narr, say('C', 'angry'), say('A', 'sad')];
const show = members => members.map(m => `${m.who}${m.speaking ? '*' : ''}:${m.front}`);
const stage = at => show(stageAt(lines, at));

test('a person comes on with their first line and stands while they have a line within two lines, before or after', () => {
  assert.deepEqual(stage(0), [], 'nobody comes on before their first line');
  assert.deepEqual(stage(1), ['A*:0'], 'B speaks soon, but has not yet: not there');
  assert.deepEqual(stage(3), ['A:0'], 'a picture stands among the lines around it');
  assert.deepEqual(stage(4), ['A:1', 'B*:0'], 'the last to speak in front');
  assert.deepEqual(stage(5), ['A:1', 'B:0'], 'narration: still the last to speak in front');
  assert.deepEqual(stage(6), ['B:0'], 'A has been quiet two lines and speaks again only after two more: off the stage');
  assert.deepEqual(stage(7), ['A:0'], 'about to speak again, A is back for it; B, quiet since, gone');
  assert.deepEqual(stage(9), ['A*:0', 'C:1'], 'spots by who came into the reply first');
});

test("a face is the latest line's, up to here", () => {
  assert.equal(stageAt(lines, 4).find(m => m.who === 'A').face, 'happy');
  assert.equal(stageAt(lines, 8).find(m => m.who === 'C').face, 'angry');
  assert.equal(stageAt(lines, 9).find(m => m.who === 'A').face, 'sad');
});

test('at most three: the speaker, then the nearest, who spoke last winning a tie', () => {
  const crowd = ['A', 'B', 'C', 'D', 'A', 'B'].map(who => say(who));
  // B (line 1) speaks again next and D spoke just before: both a line away. D spoke last; C goes.
  assert.deepEqual(show(stageAt(crowd, 4)), ['A*:0', 'B:2', 'D:1']);
  assert.deepEqual(show(stageAt(crowd, 2)), ['A:2', 'B:1', 'C*:0'], 'D, two lines on, has not spoken yet');
  assert.deepEqual(stageAt([narr, narr], 1), [], 'narration alone: nobody');
  assert.deepEqual(stageAt([], 0), []);
});
