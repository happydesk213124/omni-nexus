import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

/**
 * The chat's watchers read the context every time the chat screen changes. Only the open chat can have changed for
 * them, and a copy of the whole bot (every chat, every message) over Risu's bridge each time was what they paid.
 */
const bundle = await build({ stdin: { contents: `export { currentTtsContext, noteStreamText, streamEnded } from './src/services/tts-context';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const chatOnly = { chatOnly: true };
let bots, open, reads;
const message = (data, role = 'char') => ({ role, chatId: data, data });
beforeEach(() => {
  api.streamEnded();
  bots = [
    { chaId: 'c', name: '하린', desc: '설명', chatPage: 0, globalLore: [{ comment: 'big', content: 'x' }], chats: [{ id: 'one', message: [message('첫')] }, { id: 'two', message: [] }] },
    { chaId: 'd', name: '미선', desc: '다른 봇', chatPage: 0, globalLore: [], chats: [{ id: 'other', message: [message('딴 봇')] }] },
  ];
  open = 0; reads = { whole: 0, chat: 0 };
  const saved = new Map(), local = new Map();
  const store = map => ({ getItem: async k => map.get(k), setItem: async (k, v) => { map.set(k, v); }, removeItem: async k => { map.delete(k); }, keys: async () => [...map.keys()] });
  globalThis.risuai = {
    pluginStorage: store(saved), getLocalPluginStorage: async () => store(local),
    getCurrentCharacterIndex: async () => open, getCurrentChatIndex: async () => bots[open].chatPage,
    getCharacter: async () => { reads.whole++; return structuredClone(bots[open]); },
    getCharacterFromIndex: async i => structuredClone(bots[i]),
    getChatFromIndex: async (i, j) => { reads.chat++; return structuredClone(bots[i].chats[j]); },
    getDatabase: async () => ({ characters: structuredClone(bots) }),
  };
});

test('after one whole read, the chat alone: fresh messages, the same bot, none of its other chats', async () => {
  assert.equal((await api.currentTtsContext(chatOnly)).messages.length, 1, 'nothing known yet: the whole bot');
  assert.deepEqual(reads, { whole: 1, chat: 0 });
  bots[0].chats[0].message.push(message('새 답장'));
  const context = await api.currentTtsContext(chatOnly);
  assert.deepEqual(reads, { whole: 1, chat: 1 });
  assert.deepEqual(context.messages.map(m => m.data), ['첫', '새 답장']);
  assert.equal(context.characterId, 'c'); assert.equal(context.chatId, 'one');
  assert.deepEqual(context.character, { chaId: 'c', id: undefined, name: '하린', desc: '설명' }, 'who the bot is, for a voice pick; no copy of it kept');
  assert.equal(JSON.stringify(context.character).includes('새 답장'), false);
});

test('those who need the bot still read all of it', async () => {
  await api.currentTtsContext(); await api.currentTtsContext();
  assert.deepEqual(reads, { whole: 2, chat: 0 });
  assert.equal((await api.currentTtsContext()).character.globalLore.length, 1);
});

test('a chat the bot did not have, another bot, a long while: the whole bot again', async () => {
  await api.currentTtsContext(chatOnly);
  bots[0].chats.push({ id: 'new', message: [message('새 챗')] }); bots[0].chatPage = 2;
  assert.equal((await api.currentTtsContext(chatOnly)).chatId, 'new');
  assert.equal(reads.whole, 2, 'a new chat');
  await api.currentTtsContext(chatOnly);
  assert.equal(reads.whole, 2, 'known now');

  open = 1;
  const other = await api.currentTtsContext(chatOnly);
  assert.equal(reads.whole, 3, 'another bot');
  assert.equal(other.characterId, 'd');

  // Another bot in the list at the same place: the chat is not one of the bot it knows.
  bots[1] = { chaId: 'e', name: '새 봇', desc: '', chatPage: 0, globalLore: [], chats: [{ id: 'elsewhere', message: [] }] };
  assert.equal((await api.currentTtsContext(chatOnly)).characterId, 'e');
  assert.equal(reads.whole, 4, 'the list moved under it');

  const realNow = Date.now;
  try {
    const later = realNow() + 301_000; Date.now = () => later;
    await api.currentTtsContext(chatOnly);
    assert.equal(reads.whole, 5, 'an edited description is not kept from a voice pick for long');
  } finally { Date.now = realNow; }
});

test('a host without the small reads is read whole, as before', async () => {
  delete globalThis.risuai.getChatFromIndex;
  await api.currentTtsContext(chatOnly); await api.currentTtsContext(chatOnly);
  assert.deepEqual(reads, { whole: 2, chat: 0 });
  const host = globalThis.risuai;
  globalThis.risuai = { ...host, getChatFromIndex: async () => { reads.chat++; return null; } };
  await api.currentTtsContext(chatOnly); await api.currentTtsContext(chatOnly);
  assert.equal(reads.whole, 4, 'a chat it cannot give: read whole');
  assert.equal((await api.currentTtsContext(chatOnly)).chatId, 'one');
});

test('while a reply streams, a read of the chat alone stands for the chat\'s watchers; it never stands in for the whole bot', async () => {
  await api.currentTtsContext(chatOnly);
  bots[0].chats[0].isStreaming = true; bots[0].chats[0].message.push(message(''));
  api.noteStreamText('쓰는');
  assert.equal((await api.currentTtsContext(chatOnly)).messages.at(-1).data, '');
  const before = { ...reads };
  api.noteStreamText('쓰는 중');
  assert.equal((await api.currentTtsContext(chatOnly)).messages.at(-1).data, '쓰는 중');
  assert.deepEqual(reads, before, 'held: nothing read');
  const whole = await api.currentTtsContext();
  assert.equal(reads.whole, before.whole + 1);
  assert.equal(whole.character.globalLore.length, 1, 'the viewer needs the bot itself');
  api.noteStreamText('쓰는 중이다');
  assert.equal((await api.currentTtsContext()).messages.at(-1).data, '쓰는 중이다', 'the whole read stands from there, for both');
  assert.equal(reads.whole, before.whole + 1);
});
