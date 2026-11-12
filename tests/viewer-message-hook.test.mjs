import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 옴니 뷰어's 태그 tab runs the chat's message controls in Omni's own window (tools/vendor-patches/message-runtime.js,
// put into the UI's closure as written). Its toasts are under the viewer, so it answers true or why not.
const source = readFileSync(new URL('../tools/vendor-patches/message-runtime.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const OPEN = 'globalThis.__OMNI_MESSAGE_ACTION__ = ';
const start = source.indexOf(OPEN), end = source.indexOf('\n};\n', start);
assert.ok(start >= 0 && end > start, 'the hook is where it was');
const body = source.slice(start + OPEN.length, end + 3);

const reply = '하린: "그림이야."\n[[@inray::card1::inxshot_abc.webp]]';
function hook({ rows = [{ role: 'user', chatId: 'u0', data: '보여 줘.' }, { role: 'char', chatId: 'r1', data: reply }], job = { job_id: 'j1' }, fail = null } = {}) {
  const calls = [], t = { backendSettings: { card: {} } };
  const scope = { sessionId: 'sess', characterId: 'bot', chatId: 'chat', charIndex: 0, chatIndex: 0, chat: { message: rows } };
  const Z = async () => scope;
  const run = new Function('t', 'Z', 'y', 'optimisticStopJobs', 'openSettingsTab', 'Be', 'omniMessageId', 'omniMessageToken', 'omniMessageCardIds', 'omniMessageAction', 'openOmniNote', `return ${body}`)(
    t, Z, () => {},
    async () => { calls.push(['stop']); },
    async tab => { calls.push(['tab', tab]); },
    async (s, text, force) => { calls.push(['tag', s.actionMessageIndex, s.actionMessageRole, s.actionMessageId, text === reply, force]); return job; },
    row => String(row?.chatId || ''),
    (index, text) => `${index}:${text.length}`,
    text => [...String(text).matchAll(/\[\[@inray::([^:\]]+)::/g)].map(m => m[1]),
    async (kind, target) => { if (fail) throw new Error(fail); calls.push([kind, target.index, target.hostId, target.token]); },
    async msg => { calls.push(['chat note', msg]); });
  return { run, calls };
}

test('a stop and 생성 장수 need no reply; 프리셋 and 캐릭터 open with none too', async () => {
  const { run, calls } = hook();
  assert.equal(await run('stop', -1), true);
  assert.equal(await run('counts', -1), true);
  assert.equal(await run('preset', 1), true);
  assert.equal(await run('char', -1), true, 'still streaming: the roster, with no search');
  assert.deepEqual(calls, [['stop'], ['tab', 'gen_options'], ['tab', 'style_presets'], ['tab', 'characters']]);
});

test('⚛️ queues a tag job on that very reply; one already running is said, not queued twice', async () => {
  const { run, calls } = hook();
  assert.equal(await run('tag', 1), true);
  assert.deepEqual(calls, [['tag', 1, 'char', 'r1', true, true]]);
  const busy = hook({ job: null });
  assert.match(String(await busy.run('tag', 1)), /이미 작업 중/);
});

test('🔃 ✒️ 👨‍👩‍👧‍👦 go through the chat row\'s own checks, on the reply at that place; a reply with no picture has nothing to reroll', async () => {
  const { run, calls } = hook();
  assert.equal(await run('regen', 1), true);
  assert.equal(await run('note', 1), true);
  assert.equal(await run('char', 1), true);
  assert.deepEqual(calls, [['regen', 1, 'r1', `1:${reply.length}`], ['note', 1, 'r1', `1:${reply.length}`], ['char', 1, 'r1', `1:${reply.length}`]]);
  const bare = hook({ rows: [{ role: 'char', chatId: 'r0', data: '하린: "그림은 없어."' }] });
  assert.match(String(await bare.run('regen', 0)), /리롤할 이미지가 없습니다/);
  assert.deepEqual(bare.calls, []);
});

test('no such reply, or one that failed: why, for the viewer to say', async () => {
  const { run, calls } = hook();
  assert.match(String(await run('tag', 0)), /찾지 못했습니다/, "the reader's own message is not a reply");
  assert.deepEqual(calls, []);
  // ✒️ is the chat's 세션 작가의 노트: with no reply there (a first chat, the reader's own message) it opens for the chat.
  assert.equal(await run('note', 7), true);
  assert.equal(await run('note', 0), true);
  const chat = { sessionId: 'sess', characterId: 'bot', chatId: 'chat' };
  assert.deepEqual(calls, [['chat note', chat], ['chat note', chat]]);
  const changed = hook({ fail: '메시지가 바뀌었습니다. 다시 눌러 주세요.' });
  assert.equal(await changed.run('note', 1), '메시지가 바뀌었습니다. 다시 눌러 주세요.');
});
