import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// The tap watcher alone: services are stand-ins, the save store and host are fakes.
const stubs = { name: 'stubs', setup(b) {
  b.onResolve({ filter: /services\/(inline-waits|tts-context)$/ }, args => ({ path: args.path, namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: args.path.endsWith('inline-waits')
    ? 'export async function generateInlineWait(body){globalThis.generated.push(body);return {ok:true,accepted:true,job_id:"job-1"};}'
    : 'export async function currentTtsContext(){return globalThis.ctx;}' }));
} };
const built = await build({ stdin: { contents: "export * from './src/image-ui/wait-taps';export {putInlineWaits,dropInlineWait} from './src/storage/inline-wait-store';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', plugins: [stubs] });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

function node(html, box, parent = null, classes = []) {
  return { html, box, parent, classes,
    async getOuterHTML() { return this.html; }, async getParent() { return this.parent; },
    async matches(selector) { return selector === '.risu-chat' && this.classes.includes('risu-chat'); },
    async getBoundingClientRect() { return this.box; } };
}

test('a tap on a pink slot generates that slot in its message; nothing listens while no slot waits', async () => {
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
  assert.equal(listeners.size, 1, 'a waiting slot: one click listener');
  const click = async (x, y) => { for (const { fn } of listeners.values()) fn({ clientX: x, clientY: y }); await new Promise(r => setTimeout(r, 20)); };
  await click(10, 10);
  assert.equal(globalThis.generated.length, 0, 'a click beside the slot does nothing');
  await click(150, 200);
  assert.equal(globalThis.generated.length, 1);
  assert.deepEqual({ ...globalThis.generated[0] }, { wait_id: 'w123', session_id: 'risu_s', character_id: 'c', chat_id: 'chat', char_index: 4, chat_index: 1, host_message_id: 'm2', message_index: 2 });
  assert.deepEqual(globalThis.tracked, [['risu_s', 'job-1']], 'the frozen UI follows the job with its usual toast');
  await api.dropInlineWait('w123');
  await api.syncWaitTaps();
  assert.equal(listeners.size, 0, 'the last slot drawn: the listener goes away');
  assert.ok(queries <= 2, 'slots are looked up only on a click');
});
