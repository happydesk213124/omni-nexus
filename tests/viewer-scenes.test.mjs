import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/domain/viewer/scenes';export {parseTtsMessage} from './src/domain/tts/segment';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

const reply = [
  '[3월 2일 ◆ 오후 4시 ◆ 카페]',
  '문이 열렸다.',
  '오미선 (cheerful): "왔어?"',
  '[[@inray::card1::inxshot_abc::832::1216]]',
  '하린: "응, 늦었지."',
  '오미선: "괜찮아."',
  '[[inx2]]{"characters":[]}[[/inx2]]',
  '오미선 (sobbing): "근데 보고 싶었어."',
].join('\n');

test('a reply becomes scenes in reading order: lines, narration and its images where they stand', () => {
  const scenes = api.buildScenes(reply, api.parseTtsMessage(reply));
  assert.deepEqual(scenes.map(s => s.kind + ':' + (s.speaker || s.cg?.kind || '')), ['narration:', 'line:오미선', 'cg:baked', 'line:하린', 'line:오미선', 'cg:slot', 'line:오미선']);
  assert.equal(scenes[0].text, '문이 열렸다.', 'the clock line is not a scene');
  assert.deepEqual(scenes.filter(s => s.speaker === '오미선').map(s => s.face), ['happy', 'happy', 'cry'], 'a line without a tone keeps the speaker\'s last face');
  assert.equal(scenes.find(s => s.speaker === '하린').face, null);
  assert.deepEqual(scenes[2].cg, { kind: 'baked', card: 'card1', asset: 'inxshot_abc' });
  assert.deepEqual(scenes[5].cg, { kind: 'slot', n: 2 });
  for (const s of scenes.filter(s => s.kind !== 'cg')) assert.equal(reply.slice(s.start, s.end).includes(s.text.slice(0, 3)), true, 'offsets point at the source');
});

test('the story clock is read from its own line; prose and dialogue are not clocks', () => {
  assert.equal(api.storyClock(reply), '3월 2일 · 오후 4시 · 카페');
  assert.equal(api.storyClock('📅 Day 3 | 08:10 | 교실\n본문'), 'Day 3 · 08:10 · 교실');
  assert.equal(api.storyClock('그는 오후 4시에 왔다.\n"3월 2일 | 오후"'), '', 'a sentence with a time is no clock, nor is a quote');
  assert.equal(api.storyClock('본문뿐'), '');
});

test("a reply's gist for its tile: the first line the reader sees, no clock, tags, cast block or status field", () => {
  assert.equal(api.replyGist('[[inxc]]{"place":"카페","new_characters":[]}[[/inxc]]\n[3월 2일 ◆ 오후 4시 ◆ 카페]\n- Main Storylines: 숨은 요약 줄\n<br>\n문이 열렸다.\n오미선: "왔어?"'), '문이 열렸다.');
  assert.equal(api.replyGist('[3월 2일 ◆ 오후 4시 ◆ 카페]\n- 위치: 카페\n**문이 열렸다.**\n[[@inray::card1::inxshot_abc::832::1216]]'), '문이 열렸다.');
  assert.equal(api.replyGist('- 그녀가 웃었다'), '- 그녀가 웃었다', 'a bulleted line without a field label is the story');
  assert.equal(api.replyGist('가'.repeat(60)).length, 44, 'long lines are cut, with an ellipsis');
  assert.equal(api.replyGist('[[inx1]]\n<style>.a{}</style>'), '');
});

test("a line batch's spinner is a picture still being drawn, in its place among the reply's pictures", () => {
  const raw = '문이 열렸다.\n[[@inrayspinner::job7_0::832::1216]]\n하린: "왔어?"\n[[@inray::card1::inxshot_abc::832::1216]]\n[[inx2]]{"shot":1}[[/inx2]]';
  assert.deepEqual(api.replyImages(raw).map(i => i.cg), [{ kind: 'spin', id: 'job7_0' }, { kind: 'baked', card: 'card1', asset: 'inxshot_abc' }, { kind: 'slot', n: 2 }]);
});
