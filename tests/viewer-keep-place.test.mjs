import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export {keptPlace} from './src/domain/viewer/keep-place';export {buildScenes} from './src/domain/viewer/scenes';export {parseTtsMessage} from './src/domain/tts/segment';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const scenesOf = text => api.buildScenes(text, api.parseTtsMessage(text));
const shot = `[[inx1]]{"place":"cafe, window","char1":{"name":"하린","pose":"sitting, holding cup","expression":"smile"},"situation":"two friends at a cafe table, afternoon light, ${'detail, '.repeat(30)}"}[[/inx1]]`;
// As the stream had it: the image block's JSON, and a status line the bot's regex will hide.
const streamed = ['문이 열렸다.', '하린: "왔어?"', shot, 'HP 3 · MP 2 · 호감 42', '하린: "그래."', '바람이 불었다.', '하린: "그래."', '오미선: "늦었네."'].join('\n');
// As it is saved and shown: the block baked to its token, the status line gone from the scenes.
const saved = ['문이 열렸다.', '하린: "왔어?"', '[[@inray::card1::inxshot_a::832::1216]]', '하린: "그래."', '바람이 불었다.', '하린: "그래."', '오미선: "늦었네."'].join('\n');
const label = s => s.kind === 'cg' ? 'picture' : `${s.speaker || '-'}:${s.text}`;

test('the place a stream left: the same line, its same occurrence, though the saved reply is shorter before it', () => {
  const before = scenesOf(streamed), after = scenesOf(saved);
  assert.deepEqual(before.map(label), ['-:문이 열렸다.', '하린:왔어?', 'picture', '-:HP 3 · MP 2 · 호감 42', '하린:그래.', '-:바람이 불었다.', '하린:그래.', '오미선:늦었네.']);
  assert.deepEqual(after.map(label), ['-:문이 열렸다.', '하린:왔어?', 'picture', '하린:그래.', '-:바람이 불었다.', '하린:그래.', '오미선:늦었네.']);
  const second = 6;
  assert.equal(api.keptPlace(before, second, after), 5, 'the second "그래.", not the first');
  // By its offset, as it was: the saved text is shorter before it, so that offset was a later line.
  const byOffset = after.findIndex(s => s.start >= before[second].start);
  assert.notEqual(byOffset, 5, `the old way landed on ${byOffset < 0 ? 'nothing' : label(after[byOffset])}`);
  assert.equal(api.keptPlace(before, 5, after), 4, 'narration too');
  assert.equal(api.keptPlace(before, 2, after), 2, 'a picture by its number');
  assert.equal(api.keptPlace(before, 7, after), 6);
});

test('a line no longer there: the one after the nearest earlier line that is, never one further on', () => {
  const before = scenesOf(streamed), after = scenesOf(saved);
  assert.equal(api.keptPlace(before, 3, after), 3, 'the hidden status line: on to the line after the picture before it');
  // Rewritten by a regex: the line after the one before it is its new form.
  const rewritten = scenesOf(saved.replace('바람이 불었다.', '바람이 세차게 불었다.'));
  assert.equal(label(rewritten[api.keptPlace(before, 5, rewritten)]), '-:바람이 세차게 불었다.');
  // Nothing before it stayed: just before the nearest later one.
  const headless = scenesOf(saved.replace('문이 열렸다.\n하린: "왔어?"\n', '새 첫 줄이다.\n'));
  assert.equal(label(headless[api.keptPlace(before, 1, headless)]), '-:새 첫 줄이다.');
  // Another reply altogether: nothing to go by.
  assert.equal(api.keptPlace(before, 6, scenesOf('전혀 다른 답장이다.\n하린: "안녕."')), -1);
  assert.equal(api.keptPlace([], 0, after), -1);
});

test('while it streams the reply only grows: every line keeps its place, the cast block arriving in front or not', () => {
  const early = scenesOf(streamed.split('\n').slice(0, 5).join('\n'));
  const later = scenesOf('[[inxc]]{"new_characters":[],"place":"cafe"}[[/inxc]]\n' + streamed);
  for (let i = 0; i < early.length; i++) assert.equal(label(later[api.keptPlace(early, i, later)]), label(early[i]));
});
