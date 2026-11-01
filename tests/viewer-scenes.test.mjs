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

test('the story clock reads every way a date or a time is written, cut at its separators and never inside a date', () => {
  const clocks = {
    '2020-05-04': '2020-05-04', '[2020-05-04]': '2020-05-04', '[2020-05-04 ◆ 카페]': '2020-05-04 · 카페',
    '[2020/05/04 ◆ 오후 3시]': '2020/05/04 · 오후 3시', '2020. 5. 4.': '2020. 5. 4.', '05/04/2020 | Seoul': '05/04/2020 · Seoul',
    '5/4(월) 14:30 | 카페': '5/4(월) 14:30 · 카페', '[2024년 3월 2일 (토) | 오후 4:30 | 카페]': '2024년 3월 2일 (토) · 오후 4:30 · 카페',
    '📅 3월 2일 토요일 | ⏰ 오후 4시 | 📍 카페': '3월 2일 토요일 · 오후 4시 · 카페', '<time>2024.03.02 SAT 16:30</time>': '2024.03.02 SAT 16:30',
    '**[Day 3 - Morning - Classroom]**': 'Day 3 · Morning · Classroom', '[May 4th, 2020 - Evening - Rooftop]': 'May 4th, 2020 · Evening · Rooftop',
    'the 4th of May': 'the 4th of May', 'Time: 16:30 / Date: 2024-03-02 / Location: Café': '16:30 · 2024-03-02 · Café',
    '[3월 2일] [오후 4시] [카페]': '3월 2일 · 오후 4시 · 카페', '【2020年5月4日（月）・午後3時・東京】': '2020年5月4日（月） · 午後3時 · 東京',
    '星期一 · 下午3点 · 北京': '星期一 · 下午3点 · 北京', '[제국력 312년 3월 ◆ 수도]': '제국력 312년 3월 · 수도', '[D+3 | 밤 | 숲]': 'D+3 · 밤 · 숲',
    '3일차 · 아침 · 집': '3일차 · 아침 · 집', '1日目 · 朝 · 学校': '1日目 · 朝 · 学校', '[늦은 밤 ◆ 집]': '늦은 밤 · 집', '[봄 ◆ 벚꽃길]': '봄 · 벚꽃길',
    '[밤 ◆ 바다]': '밤 · 바다', '오후 3시.': '오후 3시', '- 날짜: 2020-05-04': '2020-05-04', '12:00~13:00 | 회의실': '12:00~13:00 · 회의실',
    '3 p.m. | Park': '3 p.m. · Park', 'AM 9:00 | 출근길': 'AM 9:00 · 출근길', '── 3월 2일 ──': '3월 2일', '2020년 5월 4일 월요일': '2020년 5월 4일 월요일',
  };
  for (const [line, clock] of Object.entries(clocks)) assert.equal(api.clockOf(line), clock, line);
  // A score, a sentence, a pause in prose, a cue: none of them a clock.
  for (const line of ['HP 4/5 | MP 3/10', '밤.', '3일 후.', '그날 밤 — 모든 것이 바뀌었다', '오후 4시 — 그녀가 왔다', '오후 4시 · 그녀가 왔다.',
    '하린(cheerful): 오늘 밤 · 같이 가자', '[[@inray::card1::inxshot_abc::832::1216]]', '[학교 ◆ 교실]']) assert.equal(api.clockOf(line), '', line);
});

test("a reply's clock lines stand where they are: a time skip mid-reply is its own mark, no scene, and the reply leaves the last", () => {
  const raw = '[3월 2일 ◆ 오후 4시 ◆ 카페]\n오미선: "왔어?"\n[오후 9시 ◆ 집]\n하린: "늦었네."';
  assert.deepEqual(api.clockLines(raw).map(m => [raw.slice(m.start, m.end), m.text]), [['[3월 2일 ◆ 오후 4시 ◆ 카페]', '3월 2일 · 오후 4시 · 카페'], ['[오후 9시 ◆ 집]', '오후 9시 · 집']]);
  assert.deepEqual(api.buildScenes(raw, api.parseTtsMessage(raw)).map(s => s.text), ['왔어?', '늦었네.'], 'neither clock line is a scene');
  assert.equal(api.storyClock(raw), '3월 2일 · 오후 4시 · 카페');
  assert.equal(api.lastClock(raw), '오후 9시 · 집');
  assert.equal(api.lastClock('본문뿐'), '');
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

test("a redrawn picture is one scene, as the chat draws it: the newest of its run, the draws before it never shown", () => {
  const raw = '문이 열렸다.\n[[@inray::card1::inxshot_abc::832::1216]][[@inray::card1_r1::inxshot_new::832::1216_r1]]\n[[@inray::card1_r2::inxshot_newer::832::1216_r2_pin]]\n하린: "왔어?"\n[[@inray::card9::inxshot_other::832::1216]]';
  assert.deepEqual(api.replyImages(raw).map(i => i.cg), [{ kind: 'baked', card: 'card1_r2', asset: 'inxshot_newer' }, { kind: 'baked', card: 'card9', asset: 'inxshot_other' }]);
  // Apart in the reply (a line between them), the same picture twice is two scenes: the chat draws both.
  const apart = '[[@inray::card1::inxshot_abc::832::1216]]\n하린: "왔어?"\n[[@inray::card1_r1::inxshot_new::832::1216_r1_pin]]';
  assert.deepEqual(api.replyImages(apart).map(i => i.cg.card), ['card1', 'card1_r1']);
  assert.equal(api.buildScenes(raw, api.parseTtsMessage(raw)).filter(s => s.kind === 'cg').length, 2);
  // A line batch's finished picture keeps its spinner as its frame: one picture, the image.
  const framed = '[[@inrayspinner::job7_0::832::1216]]\n[[@inray::card1::inxshot_abc::832::1216]][[@inray::card1_r1::inxshot_new::832::1216_r1_pin]]\n하린: "왔어?"\n[[@inrayspinner::job7_1::832::1216]]';
  assert.deepEqual(api.replyImages(framed).map(i => i.cg), [{ kind: 'baked', card: 'card1_r1', asset: 'inxshot_new' }, { kind: 'spin', id: 'job7_1' }], 'a spinner with no image after it is still being drawn');
});

test("a line's costume (이름_2) rides on its scene; the stage dresses each person in their latest line's, never carried over", async () => {
  const raw = '하린_2 (happy): "수영하자."\n오미선: "좋아."\n하린: "옷 갈아입고 왔어."';
  const scenes = api.buildScenes(raw, api.parseTtsMessage(raw));
  assert.deepEqual(scenes.map(s => [s.speaker, s.costume]), [['하린', 2], ['오미선', undefined], ['하린', undefined]]);
  const cast = await build({ stdin: { contents: "export * from './src/domain/viewer/cast';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
  const { stageAt } = await import('data:text/javascript;base64,' + Buffer.from(cast.outputFiles[0].text).toString('base64'));
  const lines = scenes.map(s => ({ who: s.speaker, face: s.face, costume: s.costume }));
  assert.deepEqual(stageAt(lines, 1).map(m => [m.who, m.costume]), [['하린', 2], ['오미선', 0]]);
  assert.deepEqual(stageAt(lines, 2).map(m => [m.who, m.costume]), [['하린', 0], ['오미선', 0]], 'a line without a number is the default costume');
});
