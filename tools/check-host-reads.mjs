/**
 * What the plugin asks of Risu, counted: at a start, and for one image job.
 *
 * A read through the plugin API is never small. `getCharacterFromIndex` is the whole bot (every chat of it, every
 * asset row) copied twice on Risu's side; `getDatabase(['characters'])` is every bot; `getDatabase(['modules'])`
 * every module; and on PocketRisu `getChatFromIndex` of a chat not opened yet downloads that chat whole. Parity
 * cannot see any of it (it compares answers, not the work behind them), and the answers were right while a start
 * read every chat of every bot twice and one picture cost twenty-six whole-bot reads.
 *
 *   node tools/check-host-reads.mjs          (= npm run reads)
 *
 * Runs the backend from source on the parity mock host, with a bot open the way it is in a real chat.
 */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { installHost } = await import(pathToFileURL(path.join(root, 'tools/parity/host.mjs')).href);

function sessionIdHash(raw) {
  const n = String(raw); let o = 2166136261, a = 2654435769;
  for (let r = 0; r < n.length; r += 1) { const i = n.charCodeAt(r); o ^= i; o = Math.imul(o, 16777619); a ^= i + ((o << 6) | (o >>> 26)); a = Math.imul(a, 2246822507); }
  return `${(o >>> 0).toString(16).padStart(8, '0')}${(a >>> 0).toString(16).padStart(8, '0')}`;
}

installHost({ promptsDir: path.join(root, 'prompts') });
const host = globalThis.risuai;
const reply = '하린은 창가에 기대어 서서 천천히 숨을 내쉬었다. 비가 그친 뒤의 공기는 차갑고 맑았다.\n\n하린 (soft tone): "오늘은 조금 늦었네. 그래도 와 줘서 고마워."\n\n그녀는 고개를 돌려 이쪽을 바라보았다.';
// The open bot, as a chat in use has it: an id of its own, a chat with its messages.
await host.setCharacterToIndex(0, { chaId: 'bot_real', name: '하린', desc: '카페에서 일하는 대학생.', type: 'character', chatPage: 0, additionalAssets: [], globalLore: [], customscript: [], triggerscript: [],
  chats: [{ id: 'chat_real', name: '첫 채팅', localLore: [], message: [{ role: 'user', data: '오늘 뭐 했어?', chatId: 'm1' }, { role: 'char', data: reply, chatId: 'm2', saying: 'bot_real' }] }] });
// Other bots with chats of their own. `loaded`: the list of bots shows each chat's lorebook (Risu itself).
// Otherwise each is a placeholder with no messages (PocketRisu, a chat not opened yet): only reading it tells.
const OTHER_BOTS = 12, CHATS_EACH = 5;
async function fillChats(loaded) {
  for (let i = 1; i <= OTHER_BOTS; i++) {
    const bot = await host.getCharacterFromIndex(i);
    if (!bot) throw new Error(`the mock host has no bot at ${i}`);
    bot.chats = Array.from({ length: CHATS_EACH }, (_, j) => loaded
      ? { id: `chat_${i}_${j}`, name: `chat ${j}`, localLore: [{ comment: 'someone else', content: 'kept' }], message: [{ role: 'char', data: 'hello' }] }
      : { id: `chat_${i}_${j}`, name: `chat ${j}`, localLore: [], message: [], _placeholder: true });
    await host.setCharacterToIndex(i, bot);
  }
}
// The real host has these; the parity mock leaves them out.
host.getCurrentChatIndex = async () => 0;
host.getCharacter = async () => host.getCharacterFromIndex(0);

let counts = {};
const label = (key, args) => key === 'getDatabase' ? `getDatabase(${Array.isArray(args[0]) ? args[0].join(',') : 'all'})` : key === 'setDatabase' ? `setDatabase(${Object.keys(args[0] || {}).join(',')})` : key;
for (const key of Object.keys(host)) {
  const fn = host[key];
  if (typeof fn !== 'function') continue;
  host[key] = function (...args) { const k = label(key, args); counts[k] = (counts[k] || 0) + 1; return fn.apply(this, args); };
}
const sum = (d, test) => Object.entries(d).filter(([k]) => test(k)).reduce((n, [, v]) => n + v, 0);
const tally = d => ({
  bots: d.getCharacterFromIndex || 0, chats: d.getChatFromIndex || 0,
  everyBot: sum(d, k => /^getDatabase\((all|.*\bcharacters\b.*)\)$/.test(k)), everyModule: sum(d, k => /^getDatabase\((all|.*\bmodules\b.*)\)$/.test(k)),
  botWrites: d.setCharacterToIndex || 0, chatWrites: d.setChatToIndex || 0, moduleWrites: sum(d, k => k.startsWith('setDatabase(')),
});
const show = (title, t) => console.log(`[reads] ${title}: whole bot ${t.bots} · chat ${t.chats} · every bot ${t.everyBot} · every module ${t.everyModule} · writes bot ${t.botWrites} chat ${t.chatWrites} modules ${t.moduleWrites}`);

const built = await build({
  entryPoints: [path.join(root, 'src/main.ts')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', write: false, minify: false,
  loader: { '.txt': 'text' }, define: { __PLUGIN_ID__: '"omni-nexus"', __PLUGIN_VERSION__: '"2.0.8"' }, logLevel: 'silent',
});
const code = built.outputFiles[0].text;
const log = console.log, quiet = () => {};
/** A start: the plugin loaded anew on the same save, its settings read, and whatever it began left to finish. */
async function boot() {
  console.log = quiet; console.info = quiet; console.warn = quiet;
  try {
    counts = {};
    vm.runInThisContext(code, { filename: 'omni.js' });
    const N = globalThis.__INLAY_NATIVE__;
    await N.ready();
    await N.fetch('/v1/settings', { method: 'GET' });
    await new Promise(r => setTimeout(r, 1500));
    return { N, t: tally(counts) };
  } finally { console.log = log; console.info = log; console.warn = log; }
}
/** Chats in the save, and how many of them the list of bots cannot speak for (no messages in hand). */
async function chatCounts() {
  const chats = ((await host.getDatabase(['characters']))?.characters || []).flatMap(bot => bot.chats || []);
  return { all: chats.length, unsure: chats.filter(chat => chat._placeholder === true || !Array.isArray(chat.localLore) || !chat.message?.length).length };
}

// ── a start ────────────────────────────────────────────────────────────────
await fillChats(true);
let chats = await chatCounts();
const first = await boot();
show(`first start, ${chats.all} chats, ${chats.all - chats.unsure} of them shown by the list of bots`, first.t);
assert.equal(first.t.bots, 0, 'the first look at a save reads no whole bot');
assert.ok(chats.all - chats.unsure >= OTHER_BOTS * CHATS_EACH);
assert.equal(first.t.chats, chats.unsure, 'a chat whose lorebook the list of bots already showed (nothing of ours in it) is not read');
assert.ok(first.t.everyBot <= 1, 'the bots are listed once');

host.pluginStorage.removeItem && await host.pluginStorage.removeItem('onx_session_slice_census');
await fillChats(false);
chats = await chatCounts();
const placeholders = await boot();
show(`first start, ${chats.all} chats, ${chats.unsure} of them not opened yet`, placeholders.t);
assert.equal(placeholders.t.bots, 0);
assert.ok(chats.unsure >= OTHER_BOTS * CHATS_EACH);
assert.equal(placeholders.t.chats, chats.unsure, 'a placeholder is not taken at its word: it is read once, alone, for both stores together');

const everyday = await boot();
show('every start after', everyday.t);
assert.equal(everyday.t.bots, 0, 'a start reads no whole bot');
assert.equal(everyday.t.chats, 0, 'a start reads no chat: the save says none holds rows of ours');
assert.equal(everyday.t.everyBot, 0, 'a start does not list every bot');
assert.equal(everyday.t.everyModule, 0, 'a start does not read every module: each of ours is marked as written, and still switched on');
assert.equal(everyday.t.botWrites + everyday.t.chatWrites + everyday.t.moduleWrites, 0);

// ── one image job ──────────────────────────────────────────────────────────
const N = everyday.N;
const get = p => N.fetch(p, { method: 'GET' }), post = (p, body) => N.fetch(p, { method: 'POST', body });
console.log = quiet; console.info = quiet; console.warn = quiet;
const sessionId = `risu_${sessionIdHash('bot_real|chat_real')}`, unified = `risu_${sessionIdHash('bot_real|__unified__')}`;
await N.fetch('/v1/settings', { method: 'PUT', body: {
  llm: { source: 'custom', provider: 'openai', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-test', api_key: 'sk-parity', temperature: 0.4, max_tokens: 2048, reasoning_effort: 'medium' },
  nai: { backend: 'nai', api_key: 'pst-parity', model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 23, cfg_scale: 5, sampler: 'k_euler_ancestral', apply_quality_tags: true },
  card: { power: true, image_max: 1, image_min: 1, character_max: 4, execute: 'auto' },
} });
await new Promise(r => setTimeout(r, 300));
await post('/v1/characters', { session_id: sessionId, characters: [{ id: 'char_harin', name: '하린', aliases: ['하린'], appearance: 'brown hair, long hair', attire: 'apron' }] });
await new Promise(r => setTimeout(r, 200));
async function job(n) {
  counts = {};
  const created = await post('/v1/jobs/create', {
    session_id: sessionId, character_id: 'bot_real', character_name: '하린', chat_id: 'chat_real', chat_name: '첫 채팅', unified_session_id: unified, source_session_ids: [sessionId],
    char_index: 0, chat_index: 0, assistant_text: reply, message_index: 1, message_role: 'char', content_hash: 'hash_real_' + n,
    recent_messages: [{ role: 'user', content: '오늘 뭐 했어?' }], lorebook: [], lore_trigger_keys: [], character_description: '카페에서 일하는 대학생.', persona_description: '', force: n > 1,
  });
  if (!created?.job_id) throw new Error('job not created: ' + JSON.stringify(created).slice(0, 300));
  let state = created;
  for (let i = 0; i < 400 && !['done', 'error', 'cancelled'].includes(String(state?.state)); i++) { await new Promise(r => setTimeout(r, 25)); state = await get(`/v1/jobs/${created.job_id}`); }
  // What the job left for its end (shots to register, a note) is written once it is over.
  await new Promise(r => setTimeout(r, 400));
  if (state?.state !== 'done') throw new Error(`job ended ${state?.state}: ${state?.error || ''}`);
  return tally(counts);
}
let warm, steady;
try {
  // The first job of a chat registers the people it meets; the second is every job after.
  warm = await job(1);
  steady = await job(2);
} finally { console.log = log; console.info = log; console.warn = log; }
show('the first image job of a chat', warm);
show('an image job after it', steady);
// One read of the bot, and one before and one after its single write (a write reads the bot itself, to write it whole).
assert.ok(steady.bots <= 4, `an image job read the whole bot ${steady.bots} times`);
assert.equal(steady.everyBot, 0, 'an image job in the open bot never lists every bot');
// One read of every module for the whole job: the shared roster (it lives in a module), the assets a look may be
// drawn from and the persona are all answered from it.
assert.ok(steady.everyModule <= 1, `an image job read every module ${steady.everyModule} times`);
assert.ok(steady.botWrites <= 1, 'the bot is written once, at the bake: a person saved again as they were is no write');
assert.ok(steady.chatWrites <= 2);
console.log('[reads] ok');
process.exit(0);
