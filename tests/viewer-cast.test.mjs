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
const within = reach => at => show(stageAt(lines, at, 3, reach));

test('a person comes on with a line and stays three lines after it; quiet longer, off until their next line', () => {
  const stage = within(3);
  assert.deepEqual(stage(0), [], 'nobody before their line');
  assert.deepEqual(stage(1), ['A*:0']);
  assert.deepEqual(stage(3), ['A:0'], 'a picture counts as the line before it');
  assert.deepEqual(stage(4), ['A:1', 'B*:0'], 'the last to speak in front');
  assert.deepEqual(stage(5), ['A:1', 'B:0'], 'narration: still the last to speak in front');
  assert.deepEqual(stage(6), ['A:1', 'B:0'], "A's third line since: still there");
  assert.deepEqual(stage(7), ['B:0'], 'four lines quiet: A steps off, though A speaks again two lines on');
  assert.deepEqual(stage(8), ['C*:0'], 'nobody stands ahead of their line (it told who would speak next)');
  assert.deepEqual(stage(9), ['A*:0', 'C:1'], 'A back with their line, in the spot of who came first');
});

test("the reach is 뷰어 설정's 말한 뒤 남는 줄: three unless set, Infinity for the reply's end", () => {
  assert.deepEqual(show(stageAt(lines, 6)), ['A:1', 'B:0'], 'three by default');
  assert.deepEqual(within(1)(5), ['B:0'], 'one line: A is gone once B has spoken and a line passed');
  assert.deepEqual(within(2)(6), ['B:0']);
  const quiet = [say('A'), narr, narr, narr, narr, narr];
  assert.deepEqual(show(stageAt(quiet, 5, 3, 3)), [], 'quiet five lines: off');
  assert.deepEqual(show(stageAt(quiet, 5, 3, Infinity)), ['A:0'], '답장 끝까지: nobody steps off');
});

test("a face is the latest line's, up to here", () => {
  assert.equal(stageAt(lines, 4).find(m => m.who === 'A').face, 'happy');
  assert.equal(stageAt(lines, 8).find(m => m.who === 'C').face, 'angry');
  assert.equal(stageAt(lines, 9).find(m => m.who === 'A').face, 'sad');
});

test('at most three: the latest to speak', () => {
  const crowd = ['A', 'B', 'C', 'D', 'A', 'B'].map(who => say(who));
  assert.deepEqual(show(stageAt(crowd, 4)), ['A*:0', 'C:2', 'D:1'], 'B spoke longest ago: B goes, though B speaks next');
  assert.deepEqual(show(stageAt(crowd, 2)), ['A:2', 'B:1', 'C*:0'], 'D has not spoken yet');
  assert.deepEqual(stageAt([narr, narr], 1), [], 'narration alone: nobody');
  assert.deepEqual(stageAt([], 0), []);
});
