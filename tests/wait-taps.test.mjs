import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// The tap watcher alone: services are stand-ins, the save store and host are fakes.
const stubs = { name: 'stubs', setup(b) {
  b.onResolve({ filter: /services\/(inline-waits|tts-context)$/ }, args => ({ path: args.path, namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: args.path.endsWith('inline-waits')
    ? 'export async function generateInlineWait(body){globalThis.generated.push(body);return {ok:true,accepted:true,job_id:"job-1"};}'
      + 'export async function generateAllInlineWaits(body,progress){globalThis.bulk.push(body);progress({done:0,total:2,made:0,jobId:"job-a"});progress({done:2,total:2,made:2,jobId:"job-b",finished:true});return {ok:true,total:2,ids:["w123","w9"]};}'
    : 'export async function currentTtsContext(){return globalThis.ctx;}' }));
} };
const built = await build({ stdin: { contents: "export * from './src/image-ui/wait-taps';export {putInlineWaits,dropInlineWait} from './src/storage/inline-wait-store';export {getConfig} from './src/services/context';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', plugins: [stubs] });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

function node(html, box, parent = null, classes = []) {
  return { html, box, parent, classes,
    async getOuterHTML() { return this.html; }, async getParent() { return this.parent; },
    async matches(selector) { return selector === '.risu-chat' && this.classes.includes('risu-chat'); },
    async getBoundingClientRect() { return this.box; } };
}

test('a double tap on a pink slot generates that slot in its message; a single tap never does; nothing listens while no slot waits', async () => {
  const kv = new Map(), listeners = new Map();
  globalThis.generated = []; globalThis.tracked = [];
  const chat = node('<div class="risu-chat" data-chat-index="2" data-chat-id="m2">…</div>', { left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500 }, null, ['risu-chat']);
  const wrap = node('<div class="x-risu-wrap">', { left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500 }, chat);
  const slot = node('<div class="omni-spinner" data-inray-wait="w123" data-inray-preview-slot="wait_w123" role="button">', { left: 100, top: 100, right: 300, bottom: 400, width: 200, height: 300 }, wrap);
  let queries = 0;
  const doc = {
    async querySelectorAll() { queries++; return [slot]; },
    async addEventListener(type, fn) { const id = 'l' + (listeners.size + 1); listeners.set(id, { type, fn }); return id; },
    async removeEventListener(_type, id) { listeners.delete(id); },
  };
  globalThis.risuai = { pluginStorage: { getItem: async k => kv.get(k), setItem: async (k, v) => kv.set(k, v) }, getRootDocument: async () => doc,
    getCurrentCharacterIndex: async () => 4, getCurrentChatIndex: async () => 1 };
  globalThis.ctx = { sessionId: 'risu_s', characterId: 'c', chatId: 'chat', messages: [{}, {}, { chatId: 'm2', data: 'reply' }] };
  globalThis.__OMNI_TRACK_JOB__ = (session, job) => globalThis.tracked.push([session, job]);
  api.installWaitTaps();
  await api.syncWaitTaps();
  assert.equal(listeners.size, 0, 'no waiting slot: chat clicks are not watched at all');
  await api.putInlineWaits([{ id: 'w123', tagged: null, line: 2, characterId: 'c', chatId: 'chat', hostMessageId: 'm2', createdAt: 1 }]);
  await api.syncWaitTaps();
  assert.deepEqual([...listeners.values()].map(l => l.type).sort(), ['click', 'pointercancel', 'pointerdown', 'pointerup'], 'a waiting slot: taps and presses are heard');
  const click = async (x, y) => { for (const { type, fn } of listeners.values()) if (type === 'click') fn({ clientX: x, clientY: y }); await new Promise(r => setTimeout(r, 20)); };
  await click(10, 10); await click(10, 10);
  assert.equal(globalThis.generated.length, 0, 'clicks beside the slot do nothing');
  await click(150, 200);
  assert.equal(globalThis.generated.length, 0, 'one tap is not enough: no stray request');
  await new Promise(r => setTimeout(r, api.DOUBLE_TAP_MS + 50)); await click(150, 200);
  assert.equal(globalThis.generated.length, 0, 'two taps too far apart are two single taps');
  await click(150, 200);
  assert.equal(globalThis.generated.length, 1, 'a double tap makes it');
  assert.deepEqual({ ...globalThis.generated[0] }, { wait_id: 'w123', session_id: 'risu_s', character_id: 'c', chat_id: 'chat', char_index: 4, chat_index: 1, host_message_id: 'm2', message_index: 2 });
  assert.deepEqual(globalThis.tracked, [['risu_s', 'job-1']], 'the frozen UI follows the job with its usual toast');
  await api.dropInlineWait('w123');
  await api.syncWaitTaps();
  assert.equal(listeners.size, 0, 'the last slot drawn: the listener goes away');
  assert.equal(queries, 5, 'slots are looked up only on a click, once per click');
  // A waiting block lives in the message, from this session or an earlier one: with
  // streaming tags on, clicks are watched from the start, store or no store.
  api.getConfig().card.stream_inline_tags = true;
  await api.syncWaitTaps();
  assert.equal(listeners.size, 4, 'streaming tags on: a block slot is tappable after a restart');
  slot.html = '<div class="omni-spinner" data-inray-wait="b3" data-inray-preview-slot="wait_b3" role="button">';
  await click(150, 200); await click(150, 200);
  assert.equal(globalThis.generated.at(-1).wait_id, 'b3', 'a double tap on block 3 generates block 3');
  api.getConfig().card.stream_inline_tags = false;
  await api.syncWaitTaps();
  assert.equal(listeners.size, 0, 'off again: nothing listens');
});

// 꾹 누르기: held 1.5 s on a pink slot, every pink slot of the message is made, from that
// one down and then from the top; a notice shows at the top while it is held and runs.
test('a press held 1.5 s on a pink slot makes every pink slot of its message; a lift before that is a tap', async () => {
  const kv = new Map(), listeners = new Map(), toasts = [];
  globalThis.generated = []; globalThis.tracked = []; globalThis.bulk = [];
  const chat = node('<div class="risu-chat" data-chat-index="2">', { left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500 }, null, ['risu-chat']);
  const slot = node('<div class="omni-spinner" data-inray-wait="w123" role="button">', { left: 100, top: 100, right: 300, bottom: 400, width: 200, height: 300 }, chat);
  const doc = {
    async querySelectorAll() { return [slot]; },
    async querySelector(selector) { return selector === 'body' ? { async appendChild(n) { n.attached = true; } } : null; },
    async createElement() { const n = { text: '', removed: false, async setAttribute() {}, async setStyleAttribute(css) { n.css = css; }, async setTextContent(t) { n.text = t; n.texts.push(t); }, async remove() { n.removed = true; }, texts: [] }; toasts.push(n); return n; },
    async addEventListener(type, fn) { const id = 'p' + (listeners.size + 1); listeners.set(id, { type, fn }); return id; },
    async removeEventListener(_type, id) { listeners.delete(id); },
  };
  globalThis.risuai = { pluginStorage: { getItem: async k => kv.get(k), setItem: async (k, v) => kv.set(k, v) }, getRootDocument: async () => doc,
    getCurrentCharacterIndex: async () => 4, getCurrentChatIndex: async () => 1 };
  globalThis.ctx = { sessionId: 'risu_s', characterId: 'c', chatId: 'chat', messages: [{}, {}, { chatId: 'm2', data: 'reply' }] };
  globalThis.__OMNI_TRACK_JOB__ = (session, job) => globalThis.tracked.push([session, job]);
  // A fresh copy: the first test's watcher holds its own fake document.
  const fresh = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text + '\n//fresh').toString('base64'));
  fresh.installWaitTaps();
  await fresh.putInlineWaits([{ id: 'w123', tagged: null, line: 2, characterId: 'c', chatId: 'chat', hostMessageId: 'm2', createdAt: 1 }]);
  await fresh.syncWaitTaps();
  const fire = (type, x = 150, y = 200) => { for (const l of listeners.values()) if (l.type === type) l.fn({ clientX: x, clientY: y, button: 0 }); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Lifted after half a second: no run, the notice goes.
  fire('pointerdown'); await sleep(500); fire('pointerup'); await sleep(50);
  assert.equal(toasts.length, 1); assert.match(toasts[0].texts[0], /꾹 누르는 중/);
  assert.equal(toasts[0].removed, true, 'the notice goes with the finger');
  await sleep(fresh.LONG_PRESS_MS); assert.equal(globalThis.bulk.length, 0, 'a short press makes nothing');
  // A scroll cancels the pointer: no run either.
  fire('pointerdown'); await sleep(300); fire('pointercancel'); await sleep(fresh.LONG_PRESS_MS);
  assert.equal(globalThis.bulk.length, 0, 'a press that became a scroll makes nothing');
  // Held: the whole message, from the pressed slot.
  fire('pointerdown'); await sleep(fresh.LONG_PRESS_MS + 150);
  assert.equal(globalThis.bulk.length, 1, 'held 1.5 s: every slot of the message');
  assert.deepEqual({ ...globalThis.bulk[0] }, { wait_id: 'w123', session_id: 'risu_s', character_id: 'c', chat_id: 'chat', char_index: 4, chat_index: 1, host_message_id: 'm2', message_index: 2 });
  assert.deepEqual(globalThis.tracked, [['risu_s', 'job-a'], ['risu_s', 'job-b']], 'each slot\'s job gets the usual progress toast');
  const notice = toasts.at(-1);
  assert.ok(notice.texts.some(t => /분홍 칸 만드는 중 1\/2/.test(t)), notice.texts.join(' | '));
  assert.ok(notice.texts.some(t => /2\/2개 만들기 끝/.test(t)), notice.texts.join(' | '));
  // The finger lifting after the run started is not a tap of its own.
  fire('pointerup'); fire('click'); await sleep(30); fire('click'); await sleep(30);
  assert.equal(globalThis.generated.length, 0, 'the lift after a press does not count as a double tap');
  await fresh.dropInlineWait('w123'); await fresh.syncWaitTaps();
});
