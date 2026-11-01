import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/domain/tts/base64-words';export {parseTtsMessage} from './src/domain/tts/segment';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const b64 = text => Buffer.from(text, 'utf8').toString('base64');

test('risu64: a bracketed base64 word reads as its word; base64-shaped words and tags stay', () => {
  assert.equal(api.revealBase64('[7IKs6rO8]를 먹었다'), '사과를 먹었다');
  assert.equal(api.revealBase64(`[${b64('딸기 맛')}] 사탕과 [${b64('candy')}]`), '딸기 맛 사탕과 candy');
  // Shaped like base64, but no UTF-8 once decoded: words, not hidden ones.
  for (const kept of ['[Date] 9월', '[TIME] 오후', '[Name]', '[ABCD]', '[Test]']) assert.equal(api.revealBase64(kept), kept);
  // No base64 at all: a status tag, a sound cue, a short bracket.
  for (const kept of ['[DD_STATUS]', '[[bgm:tense,scifi]]', '[HP]', '[1]']) assert.equal(api.revealBase64(kept), kept);
  // A control character inside is no word either.
  assert.equal(api.revealBase64(`[${b64('a\u0001b')}]`), `[${b64('a\u0001b')}]`);
  // Half streamed in: no closing bracket yet, nothing to read.
  assert.equal(api.revealBase64('[7IKs6r'), '[7IKs6r');
});

test('risu64: the voice reads the word; the line keeps the text the chat shows unless 옴니 뷰어 shows it', () => {
  const source = '맥스: "[7IKs6rO8] 먹어. 이 나갈라."';
  const parsed = api.parseTtsMessage(source);
  const line = parsed.find(s => s.kind === 'dialogue');
  assert.ok(line && line.text.includes('[7IKs6rO8]'), 'the bracket reaches the line: ' + JSON.stringify(parsed));
  const [voiced] = api.revealSegments([line]);
  assert.equal(voiced.text, line.text, 'matched against the chat as it is shown');
  assert.match(voiced.spoken, /^사과 먹어/);
  const [onScreen] = api.revealSegments([line], true);
  assert.match(onScreen.text, /^사과 먹어/);
  assert.equal(onScreen.start, line.start, 'its place in the reply unchanged');
  const plain = parsed.find(s => s !== line) ?? { ...line, text: '그냥 대사', spoken: undefined };
  assert.equal(api.revealSegments([plain])[0], plain, 'nothing hidden: the same segment');
});
