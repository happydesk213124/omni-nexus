import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: `export * from './src/services/tts-runtime';export * from './src/services/tts-characters';export * from './src/storage/tts-store';export * from './src/domain/tts/segment';export * from './src/providers/tts/irodori';export * from './src/providers/tts/speech';export * from './src/providers/tts/http';export * from './src/providers/tts/fish';export {audioMime} from './src/providers/tts/player';export * from './src/tts-ui/settings-transfer';export * from './src/config/tts-defaults';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text + '\n//# sourceURL=tts-irodori-check.mjs').toString('base64'));
const fishVoice = '4e118bfbb83e401c84699c09b5f08257';
const irodori = (over = {}) => ({ irodori: { ...api.ttsDefaults().irodori, voice: 'sample', ...over } });

test('Irodori speech: the OpenAI speech call on the user\'s own server, a key only when one is set, plain http allowed there alone', async () => {
  const calls = [];
  globalThis.risuai = { nativeFetch: async (url, options) => { calls.push([url, options]); return { ok: true, data: new Uint8Array(64) }; } };
  try {
    const bytes = await api.synthesizeIrodori('こんにちは。', '', irodori());
    assert.equal(bytes.byteLength, 64);
    const [url, options] = calls[0];
    assert.equal(url, 'http://127.0.0.1:8088/v1/audio/speech');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { model: 'irodori-tts', input: 'こんにちは。', voice: 'sample', response_format: 'mp3' });
    assert.equal(options.headers.Authorization, undefined, 'no key set: none is sent');
    // However the address was typed, the same path; a voice named outright wins over the settings' one.
    for (const typed of ['http://192.168.0.5:8088/', 'http://192.168.0.5:8088/v1', 'http://192.168.0.5:8088/v1/audio/speech']) {
      await api.synthesizeIrodori('はい。', 'alice', irodori({ url: typed, key: ' secret ', format: 'wav' }));
      const [u, o] = calls.at(-1);
      assert.equal(u, 'http://192.168.0.5:8088/v1/audio/speech', typed);
      assert.equal(o.headers.Authorization, 'Bearer secret');
      assert.deepEqual([JSON.parse(o.body).voice, JSON.parse(o.body).response_format], ['alice', 'wav']);
    }
    await assert.rejects(api.synthesizeIrodori('はい。', '', irodori({ voice: '' })), /Irodori 목소리/);
    await assert.rejects(api.synthesizeIrodori('はい。', '', irodori({ url: '' })), /서버 주소/);
    await assert.rejects(api.synthesizeIrodori('はい。', '', irodori({ url: 'http://user:pw@127.0.0.1:8088' })), /인증 정보가 없는/);
    // Every other TTS call stays HTTPS only.
    const before = calls.length;
    await assert.rejects(api.ttsFetch('http://127.0.0.1:8088/v1/audio/speech', { method: 'GET' }), /HTTPS/);
    assert.equal(calls.length, before, 'refused before the request');
  } finally { delete globalThis.risuai; }
});

test('Irodori failures are read as the user\'s server, not as Fish: a status hint, and "unreachable" when it is off', async () => {
  globalThis.risuai = { nativeFetch: async () => ({ ok: false, status: 404 }) };
  try {
    await assert.rejects(api.synthesizeIrodori('はい。', '', irodori()), error => error instanceof api.TtsHttpError && error.status === 404 && /Irodori 서버에 그 목소리가 없거나/.test(error.message));
    globalThis.risuai.nativeFetch = async () => { throw new TypeError('fetch failed'); };
    await assert.rejects(api.synthesizeIrodori('はい。', '', irodori()), error => error instanceof api.TtsHttpError && error.status === undefined && /Irodori 서버에 닿지 못했습니다/.test(error.message));
    globalThis.risuai.nativeFetch = async () => ({ ok: false, status: 402 });
    await assert.rejects(api.ttsFetch('https://api.fish.audio/v1/tts', { method: 'GET' }), /Fish API 잔액/, 'Fish keeps its own hints');
  } finally { delete globalThis.risuai; }
});

test('the server\'s voices are read from whatever shape it answers in', async () => {
  assert.deepEqual(api.irodoriVoiceIds(['a', 'b', 'a']), ['a', 'b']);
  assert.deepEqual(api.irodoriVoiceIds({ data: [{ id: 'a' }, { voice_id: 'b' }, { name: 'c' }, {}] }), ['a', 'b', 'c']);
  assert.deepEqual(api.irodoriVoiceIds({ voices: [{ id: 'x' }] }), ['x']);
  assert.deepEqual(api.irodoriVoiceIds({ voices: { alice: { ref_wavs: [] }, bob: {} } }), ['alice', 'bob'], 'voices.json as a map');
  assert.deepEqual(api.irodoriVoiceIds(null), []);
  let asked;
  globalThis.risuai = { nativeFetch: async (url, options) => { asked = [url, options.method]; return { ok: true, json: async () => ({ data: [{ id: 'sample' }] }) }; } };
  try { assert.deepEqual(await api.listIrodoriVoices(irodori({ url: 'http://127.0.0.1:8088/v1' })), ['sample']); assert.deepEqual(asked, ['http://127.0.0.1:8088/v1/audio/voices', 'GET']); }
  finally { delete globalThis.risuai; }
});

test('settings: Fish stays the engine of every existing save; Irodori\'s block is filled in and kept within bounds', () => {
  const old = api.normalizeTtsSettings({ fish: { key: 'k' } });
  assert.equal(old.engine, 'fish');
  assert.deepEqual(old.irodori, { url: 'http://127.0.0.1:8088', key: '', model: 'irodori-tts', voice: '', format: 'mp3', concurrency: 1 });
  const odd = api.normalizeTtsSettings({ engine: 'other', irodori: { voice: 7, format: 'flac', concurrency: 99 } });
  assert.deepEqual([odd.engine, odd.irodori.voice, odd.irodori.format, odd.irodori.concurrency], ['fish', '', 'mp3', 5]);
  const mine = api.normalizeTtsSettings({ engine: 'irodori', irodori: { voice: 'alice', format: 'wav', concurrency: 2 } });
  assert.deepEqual([mine.engine, mine.irodori.voice, mine.irodori.format, mine.irodori.concurrency, mine.irodori.url], ['irodori', 'alice', 'wav', 2, 'http://127.0.0.1:8088']);
  // What is ready to speak is the chosen engine's: an address and a voice for Irodori, a key for Fish.
  assert.equal(api.speechReady(mine), true); assert.equal(api.speechReady({ ...mine, irodori: { ...mine.irodori, voice: '' } }), false);
  assert.equal(api.speechReady(old), true); assert.equal(api.speechReady(api.normalizeTtsSettings({})), false);
});

test('cached audio is one engine\'s: the same line under Fish and Irodori never shares bytes, and Irodori ignores the delivery', () => {
  const fish = api.normalizeTtsSettings({}), iro = api.normalizeTtsSettings({ engine: 'irodori', irodori: { voice: 'sample' } });
  assert.notEqual(api.synthesisSignature('はい。', 'happy', 'sample', fish), api.synthesisSignature('はい。', 'happy', 'sample', iro));
  assert.equal(api.synthesisSignature('はい。', 'happy', 'sample', iro), api.synthesisSignature('はい。', 'sad', 'sample', iro), 'no delivery tags go to Irodori');
  assert.notEqual(api.synthesisSignature('はい。', '', 'sample', iro), api.synthesisSignature('はい。', '', 'alice', iro));
  assert.notEqual(api.synthesisSignature('はい。', '', 'sample', iro), api.synthesisSignature('はい。', '', 'sample', { ...iro, irodori: { ...iro.irodori, format: 'wav' } }));
});

test('a wav answer is played as wav', () => {
  const wav = new Uint8Array(64); wav.set([...'RIFF'].map(c => c.charCodeAt(0)), 0); wav.set([...'WAVE'].map(c => c.charCodeAt(0)), 8);
  assert.equal(api.audioMime(wav.buffer), 'audio/wav');
  assert.equal(api.audioMime(new Uint8Array([0xff, 0xfb, 0x90, 0x00]).buffer), 'audio/mpeg');
  assert.equal(api.audioMime(new ArrayBuffer(0)), 'audio/mpeg');
});

test('a shared settings file carries no Irodori key, and loading one keeps this device\'s server, key and voice', async () => {
  const saved = new Map();
  globalThis.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) } };
  try {
    const data = await api.loadTtsData();
    Object.assign(data.settings, { engine: 'irodori' }); Object.assign(data.settings.irodori, { url: 'http://192.168.0.9:8088', key: 'mine', voice: 'alice' });
    const file = api.exportableTtsSettings(data.settings);
    assert.equal(file.settings.irodori.key, '');
    await api.importTtsSettings({ type: api.TTS_SETTINGS_FILE, version: 1, settings: { engine: 'irodori', irodori: { url: 'http://127.0.0.1:8088', key: '', voice: 'theirs', format: 'wav', model: 'irodori-tts', concurrency: 1 } } });
    const now = api.ttsData().settings.irodori;
    assert.deepEqual([now.url, now.key, now.voice, now.format], ['http://192.168.0.9:8088', 'mine', 'alice', 'wav']);
  } finally { delete globalThis.risuai; }
});

test('playing with Irodori: every line speaks with the settings\' voice, in Japanese, with no Fish voice chosen; an auditioned Fish voice is still Fish\'s', async () => {
  const originalAudio = globalThis.Audio, originalContext = globalThis.AudioContext;
  const local = new Map(), saved = new Map(), speech = [], fish = [], translated = []; let models = 0, flying = 0, most = 0;
  const tick = () => new Promise(r => setImmediate(r));
  globalThis.Audio = class { src = ''; pause() {} load() {} removeAttribute() {} async play() {} };
  globalThis.AudioContext = class { state = 'running'; destination = {}; createGain() { return { gain: { value: 1 }, connect() { return this; } }; } createMediaElementSource() { return { connect(node) { return node; } }; } };
  globalThis.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) },
    getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k), keys: async () => [...local.keys()] }),
    getDatabase: async () => ({ modules: [], enabledModules: [], personas: [] }), setDatabase: async () => {}, getCurrentLorebookEntries: async () => [],
    runLLMModel: async () => { models++; return { success: true, content: '[]' }; },
    nativeFetch: async (url, options) => {
      if (String(url).includes('translate.googleapis.com')) { translated.push(String(url)); return { ok: true, json: async () => [[['訳:' + new URL(url).searchParams.get('q')]]] }; }
      const body = JSON.parse(options.body);
      if (String(url).startsWith('http://127.0.0.1:8088/')) { speech.push([String(url), body]); most = Math.max(most, ++flying); await tick(); await tick(); flying--; return { ok: true, data: new Uint8Array(64) }; }
      if (body.questions) { models++; return { ok: true, json: async () => ({ answers: {} }) }; }
      fish.push([String(url), body]); return { ok: true, data: new Uint8Array(64) };
    } };
  try {
    const data = await api.loadTtsData();
    Object.assign(data.settings, { enabled: true, autoAssign: true, selector: 'llm', continuous: false, engine: 'irodori', concurrency: 5, background: 5 });
    data.settings.translation.provider = 'off'; data.settings.fish.key = 'fake'; data.settings.irodori = { ...api.ttsDefaults().irodori, voice: 'sample' };
    data.voices = [{ key: 'voice', name: 'voice', fishId: fishVoice, gender: 'female', tags: [], folder: '' }]; data.characters = [];
    const runtime = new api.OmniTtsRuntime(); await runtime.init();
    const context = { scope: 'iro', rosterScope: 'bot:iro', characterId: 'iro', chatId: 'chat', sessionId: 's', character: {}, chat: {}, messages: [] };
    const line = (text, speaker, kind = 'dialogue') => ({ context, messageId: text, segment: { id: text, kind, speaker, tone: 'happy', text, start: 0, end: text.length } });
    await runtime.play([line('안녕하세요.', '처음 보는 사람')], 0);
    assert.equal(speech.length, 1, runtime.notice);
    assert.equal(speech[0][0], 'http://127.0.0.1:8088/v1/audio/speech');
    assert.deepEqual(speech[0][1], { model: 'irodori-tts', input: '訳:안녕하세요.', voice: 'sample', response_format: 'mp3' }, 'the one voice, the line in Japanese, no [happy] tag');
    assert.ok(translated.some(url => url.includes('tl=ja')), 'translation off still goes to Japanese: Irodori reads nothing else');
    assert.equal(models, 0, 'nobody new needs a Fish voice chosen');
    assert.equal(data.characters.length, 0);
    assert.equal(fish.length, 0);
    // Narration too, though its own language setting says 원문.
    await runtime.play([line('그는 웃었다.', '', 'narration')], 0);
    assert.equal(speech.length, 2); assert.equal(speech[1][1].input, '訳:그는 웃었다.');
    // A Fish voice auditioned in the library is asked of Fish.
    await runtime.play([{ ...line('안녕하세요, こんにちは', '', 'audition'), fishId: fishVoice }], 0);
    assert.equal(fish.length, 1); assert.equal(fish[0][1].reference_id, fishVoice); assert.equal(speech.length, 2);
    // Read ahead one line at a time, as the server makes them, though TTS 동시 생성 says five; more only once its own number says so.
    const wait = async count => { for (let i = 0; i < 200 && speech.length < count; i++) await tick(); for (let i = 0; i < 20; i++) await tick(); };
    most = 0; await runtime.prefetch(['하나입니다.', '둘입니다.', '셋입니다.'].map(text => line(text, '하린'))); await wait(5);
    assert.equal(speech.length, 5); assert.equal(most, 1, 'one request in flight at a time');
    data.settings.irodori.concurrency = 3; await api.saveTtsData();
    most = 0; await runtime.prefetch(['넷입니다.', '다섯입니다.', '여섯입니다.'].map(text => line(text, '하린'))); await wait(8);
    assert.equal(speech.length, 8); assert.ok(most > 1, `the server set up for more gets more at once (${most})`);
    // No voice chosen: said so, and nothing is asked of the server.
    data.settings.irodori.voice = ''; await api.saveTtsData();
    await runtime.play([line('또 왔어?', '하린')], 0).catch(() => {});
    assert.equal(speech.length, 8);
    assert.match(runtime.notice, /Irodori 목소리를 먼저 골라/);
  } finally { delete globalThis.risuai; globalThis.Audio = originalAudio; globalThis.AudioContext = originalContext; }
});
