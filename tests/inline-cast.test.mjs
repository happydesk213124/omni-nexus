import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// 「새 캐릭터를 맨 앞에 쓰기」: the reply opens with [[inxc]]{"new_characters":[…]}[[/inxc]].
const built = await build({ stdin: { contents: [
  "export * from './src/domain/prompt/inline-shots';",
  "export {analysisBody} from './src/domain/prompt/message-body';",
  "export {parseTtsMessage} from './src/domain/tts/segment';",
  "export {inlineShotDisplayScripts,inlineCastRequestScript,tokenGuardScripts} from './src/domain/inray-display';",
].join(''), resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

const cast = '[[inxc]]{"new_characters":[{"name":"민수","gender":"boy","hair_color":"black hair"},{"gender":"girl"}]}[[/inxc]]';
const reply = [cast, '민수가 들어왔다.', '민수 (happy): "안녕!"', '[[inx1]]{"characters":[{"name":"민수"}],"place":"room"}[[/inx1]]', '하린은 웃었다.'].join('\n');

test('the cast block is found outside reasoning only, and its people are the named rows', () => {
  const block = api.inlineCastBlock(reply);
  assert.equal(block.start, 0);
  assert.deepEqual(api.inlineCastCharacters(block.body).map(p => p.name), ['민수']);
  assert.deepEqual(api.inlineCastCharacters('[{"name":"하린"}]').map(p => p.name), ['하린'], 'a bare array works too');
  assert.equal(api.inlineCastPlace('{"place":"cafe, indoors, day","new_characters":[]}'), 'cafe, indoors, day');
  assert.equal(api.inlineCastPlace('{"new_characters":[]}'), '');
  assert.equal(api.inlineCastCharacters('{"new_characters":'), null, 'broken JSON is not an empty cast');
  assert.equal(api.inlineCastBlock('<think>' + cast + '</think>\n본문'), null, 'a draft in the thoughts registers no one');
  assert.equal(api.inlineCastBlock('<think>' + cast + '\n아직 생각 중', { live: true }), null, 'an open thought counts while streaming');
  assert.equal(api.inlineCastBlock('[[inxc]]{"new_characters":[]}'), null, 'unclosed is not sent');
  // Shot blocks are untouched by it, and it takes no shot number.
  assert.deepEqual(api.inlineShotBlocks(reply).map(b => b.n), [1]);
});

test('a cast block is no prose: line numbers, TTS and the bake all skip it', () => {
  assert.equal(api.analysisBody(reply).split('\n')[0], '민수가 들어왔다.', 'L1 is the first story line');
  assert.equal(api.inlineShotLine(reply, api.inlineShotBlocks(reply)[0]), 2, 'the shot still sits after L2');
  const read = api.parseTtsMessage(reply).map(s => s.text).join('|');
  assert.doesNotMatch(read, /new_characters|inxc/, 'TTS never reads the JSON');
  assert.match(read, /안녕!/);
  assert.equal(api.stripInlineCastBlocks(reply).startsWith('민수가 들어왔다.'), true);
  assert.equal(api.stripInlineCastBlocks('[[inxc]]{"new_characters":[{"name":"민"\n본문'), '본문', 'an unclosed block loses only its own line');
  assert.equal(api.stripInlineCastBlocks('본문만'), '본문만');
});

test('display hides it, requests drop it, and the token guard protects its brackets', () => {
  const run = (script, text) => text.replace(new RegExp(script.in, script.flag.replace(/<[^>]*>/g, '')), script.out);
  const hide = api.inlineShotDisplayScripts(100).find(s => /-cast$/.test(s.comment));
  assert.ok(hide, 'the display module has a cast rule');
  assert.equal(run(hide, reply).startsWith('민수가 들어왔다.'), true);
  assert.equal(run(hide, '[[inxc]]{"new_characters":[{"na\n'), '', 'while it streams, only its line is hidden');
  assert.equal(run(hide, '[[inxc]]{"new_char\n잊고 안 닫음\n본문'), '잊고 안 닫음\n본문', 'a forgotten close never hides the story');
  assert.equal(run(api.inlineCastRequestScript(), reply).startsWith('민수가 들어왔다.'), true);
  assert.match(api.inlineCastRequestScript().comment, /^omni-inline-shot-/, 'the module rewrites it as one of ours');
  const guard = api.tokenGuardScripts()[0];
  assert.equal((cast.match(new RegExp(guard.in, 'g')) || []).length, 2, 'both [[inxc]] and [[/inxc]] are masked from other modules');
});

test('the prompt asks for the cast block only when the option is on', async () => {
  const rules = await build({ stdin: { contents: "export {blockRules} from './src/services/inline-tagging';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
  const { blockRules } = await import('data:text/javascript;base64,' + Buffer.from(rules.outputFiles[0].text).toString('base64'));
  const on = blockRules(1, 3, true), off = blockRules(1, 3, false);
  assert.match(on, /\[\[inxc\]\]\{"place":"\.\.\.","new_characters":\[\.\.\.\]\}\[\[\/inxc\]\]/);
  assert.match(on, /Open every reply/, 'every reply: the viewer stages its place');
  assert.match(on, /unless the cast block already has them/);
  assert.doesNotMatch(off, /inxc|cast block/, 'off: the prompt is exactly as before');
});
