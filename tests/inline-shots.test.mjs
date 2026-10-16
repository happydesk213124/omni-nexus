import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/domain/prompt/inline-shots';export {analysisBody,insertAtAnalysisLine} from './src/domain/prompt/message-body';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

const reply = [
  '하린이 문을 열었다.',
  '[[inx1]]{"place":"hallway, night, indoor","aspect":"portrait","camera":"from side","characters":[{"name":"하린","action":"opening door"}],"new_characters":[{"name":"민수","gender":"boy","hair_color":"black hair"}]}[[/inx1]]',
  '하린 (calm): "누구야?"',
  '복도는 조용했다.',
  '[[inx2]]',
  '{"scenes":[{"place":"hallway","shots":[{"aspect":"landscape","characters":[]}]}]}',
  '[[/inx2]]',
  '그리고',
].join('\n');

test('blocks are found in order; each sits after the line it illustrates', () => {
  const blocks = api.inlineShotBlocks(reply);
  assert.deepEqual(blocks.map(b => b.n), [1, 2]);
  assert.deepEqual(blocks.map(b => api.inlineShotLine(reply, b)), [1, 3], 'L numbers count prose only, never block lines');
  assert.equal(api.inlineShotBlocks('[[inx1]]{"a":1}[[/inx1]] [[inx1]]{"b":2}[[/inx1]]').length, 1, 'a repeated number is the model restarting: the first one owns it');
});

test('a shot drafted in <Thoughts>/<think> is never a slot, and never takes a story block\'s number', () => {
  const draft = '<Thoughts>\nplan: [[inx1]]{"place":"draft"}[[/inx1]]\n</Thoughts>\n본문 첫 줄.\n[[inx1]]{"place":"story","characters":[]}[[/inx1]]\n<think>[[inx2]]{"x":1}[[/inx2]]</think>\n끝.';
  const blocks = api.inlineShotBlocks(draft);
  assert.deepEqual(blocks.map(b => [b.n, JSON.parse(b.body).place]), [[1, 'story']]);
  const streaming = '<Thoughts>\n아직 생각 중 [[inx1]]{"place":"draft"}[[/inx1]]';
  assert.equal(api.inlineShotBlocks(streaming, { live: true }).length, 0, 'while streaming, an unclosed <Thoughts> is reasoning');
  assert.equal(api.inlineShotBlocks(streaming).length, 1, 'a finished reply that never closed it keeps the analysis rule');
  assert.ok(api.replaceInlineShotBlock(draft, 1, 'SLOT').includes('본문 첫 줄.\nSLOT'), 'the slot replaces the story block, not the draft');
});

test('a block is never prose: L lines, analysis text and a still-streaming block', () => {
  assert.equal(api.analysisBody(reply), '하린이 문을 열었다.\n하린 (calm): "누구야?"\n복도는 조용했다.\n그리고');
  assert.equal(api.analysisBody('본문\n[[inx1]]{"place":"ro'), '본문', 'an unfinished block never leaks JSON into L lines');
  assert.equal(api.inlineShotBlocks('본문\n[[inx1]]{"place":"ro').length, 0, 'only closed blocks start work');
});

test('both block shapes become one tagged shot at its line', () => {
  const [first, second] = api.inlineShotBlocks(reply);
  const one = api.inlineShotTagged(first.body, 1);
  assert.equal(one.scenes.length, 1); assert.equal(one.scenes[0].place, 'hallway, night, indoor');
  assert.deepEqual(one.scenes[0].shots, [{ aspect: 'portrait', camera: 'from side', characters: [{ name: '하린', action: 'opening door' }], line: 1, paragraph: 0 }]);
  assert.equal(one.new_characters[0].name, '민수', 'a new person is registered from the block that first shows them');
  const two = api.inlineShotTagged(second.body, 3);
  assert.equal(two.scenes[0].shots[0].line, 3); assert.equal(two.scenes[0].shots[0].aspect, 'landscape'); assert.deepEqual(two.new_characters, []);
  assert.equal(api.inlineShotTagged('{"place":"x"', 1), null, 'broken JSON: the caller falls back to the tagger for this slot');
  assert.equal(api.inlineShotTagged('{"place":"only place"}', 1), null, 'a block with no shot fields is not a shot');
  // Parses, but would draw an empty prompt: broken, so it is fixed or waits pink.
  assert.equal(api.inlineShotTagged('{"aspect":"portrait","camera":"from side"}', 1), null, 'framing alone is nothing to draw');
  assert.equal(api.inlineShotTagged('{"x":1,"y":""}', 1), null);
  assert.equal(api.inlineShotTagged('{"scenes":[{"place":"p","shots":[{"aspect":"square"}]}]}', 1), null);
  assert.ok(api.inlineShotTagged('{"place":"p","aspect":"portrait","characters":[]}', 1), 'an empty cast is a scenery shot');
  assert.ok(api.inlineShotTagged('{"composition":"flowers"}', 1));
});

test('the block itself becomes the slot; stripping keeps the prose as written', () => {
  const placed = api.replaceInlineShotBlock(reply, 1, '[[@inrayspinner::job_0::832::1216]]');
  assert.match(placed, /열었다\.\n\[\[@inrayspinner::job_0::832::1216\]\]\n하린 \(calm\)/);
  assert.equal(api.stripInlineShotBlocks(reply), '하린이 문을 열었다.\n하린 (calm): "누구야?"\n복도는 조용했다.\n그리고');
  assert.equal(api.stripInlineShotBlocks('본문\n[[inx3]]{"pla'), '본문\n', 'an unfinished block at the end goes too');
});
