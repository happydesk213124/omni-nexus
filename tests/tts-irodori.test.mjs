import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: `export * from './src/services/tts-runtime';export * from './src/services/tts-characters';export * from './src/storage/tts-store';export * from './src/domain/tts/segment';export * from './src/providers/tts/irodori';export * from './src/providers/tts/speech';export * from './src/providers/tts/http';export * from './src/providers/tts/fish';export {audioMime} from './src/providers/tts/player';export * from './src/tts-ui/settings-transfer';export * from './src/domain/tts/irodori-emoji';export * from './src/domain/tts/irodori-starter';export * from './src/domain/tts/irodori-voice-draft';export * from './src/domain/tts/irodori-presets';export * from './src/services/irodori-voice-writer';export { englishVoiceWord } from './src/domain/tts/voice-words';export * from './src/config/tts-defaults';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm' });
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
    // No default voice chosen: the server's own voice with no reference, so a server holding no voice yet reads.
    await api.synthesizeIrodori('はい。', '', irodori({ voice: ' ' }));
    assert.equal(JSON.parse(calls.at(-1)[1].body).voice, 'none');
    assert.deepEqual(['none', ' None ', 'no_ref', 'text-only', 'alice', ''].map(api.irodoriNoRef), [true, true, true, true, false, false]);
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
  // What is ready to speak is the chosen engine's: an address for Irodori (a voice left empty is the server's own), a key for Fish.
  assert.equal(api.speechReady(mine), true); assert.equal(api.speechReady({ ...mine, irodori: { ...mine.irodori, voice: '' } }), true);
  assert.equal(api.speechReady({ ...mine, irodori: { ...mine.irodori, url: '' } }), false);
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
    const line = (text, speaker, kind = 'dialogue') => ({ context, messageId: text, segment: { id: text, kind, speaker, tone: kind === 'narration' ? '' : 'happy', text, start: 0, end: text.length } });
    await runtime.play([line('안녕하세요.', '처음 보는 사람')], 0);
    assert.equal(speech.length, 1, runtime.notice);
    assert.equal(speech[0][0], 'http://127.0.0.1:8088/v1/audio/speech');
    assert.deepEqual(speech[0][1], { model: 'irodori-tts', input: '😆訳:안녕하세요.', voice: 'sample', response_format: 'mp3' }, 'the one voice, the line in Japanese, no [happy] tag: its delivery as the emoji Irodori reads');
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
    // No default voice chosen: the line is read all the same, with the server's own voice that needs no recording.
    data.settings.irodori.voice = ''; await api.saveTtsData();
    await runtime.play([line('또 왔어?', '하린')], 0);
    assert.equal(speech.length, 9, runtime.notice);
    assert.equal(speech[8][1].voice, 'none');
  } finally { delete globalThis.risuai; globalThis.Audio = originalAudio; globalThis.AudioContext = originalContext; }
});

test("a designed voice: no reference, the description as the caption, answered in wav; kept by sending the recording up as a multipart form", async () => {
  const calls = [];
  globalThis.risuai = { nativeFetch: async (url, options) => { calls.push([url, options]); return String(url).endsWith('/voices') ? { ok: true, json: async () => ({ id: 'aoi' }) } : { ok: true, data: new Uint8Array(64).fill(7) }; } };
  try {
    const sample = await api.designIrodoriVoice(' 落ち着いた若い女性 ', irodori({ voice: '', key: 'k' }));
    assert.equal(sample.byteLength, 64);
    assert.equal(calls[0][0], 'http://127.0.0.1:8088/v1/audio/speech');
    assert.deepEqual(JSON.parse(calls[0][1].body), { model: 'irodori-tts', input: api.IRODORI_SAMPLE_TEXT, voice: 'none', response_format: 'wav', irodori: { caption: '落ち着いた若い女性' } });
    await assert.rejects(api.designIrodoriVoice('  ', irodori()), /목소리 설명/);
    // Kept: the bytes go up whole, between the form's parts, under the id asked for.
    assert.equal(await api.uploadIrodoriVoice(sample, 'design.wav', 'aoi', irodori({ key: 'k' })), 'aoi');
    const [url, options] = calls.at(-1), type = options.headers['Content-Type'];
    assert.equal(url, 'http://127.0.0.1:8088/v1/audio/voices'); assert.equal(options.method, 'POST'); assert.equal(options.headers.Authorization, 'Bearer k');
    const boundary = /^multipart\/form-data; boundary=(.+)$/.exec(type)?.[1];
    assert.ok(boundary, type); assert.ok(options.body instanceof Uint8Array, 'bytes, not a FormData: nativeFetch takes no other');
    const form = Buffer.from(options.body).toString('latin1');
    assert.ok(form.startsWith(`--${boundary}\r\nContent-Disposition: form-data; name="voice_id"\r\n\r\naoi\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="design.wav"\r\n`), form.slice(0, 200));
    assert.ok(form.endsWith(`\r\n--${boundary}--\r\n`));
    const start = form.indexOf('\r\n\r\n', form.indexOf('name="file"')) + 4;
    assert.deepEqual([...options.body.slice(start, start + 64)], Array(64).fill(7), 'the recording, untouched');
    assert.equal(options.body.length, start + 64 + `\r\n--${boundary}--\r\n`.length);
    // An answer naming no id: the id asked for is the one it has.
    globalThis.risuai.nativeFetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
    assert.equal(await api.uploadIrodoriVoice(sample, '목소리.wav', 'ken_01', irodori()), 'ken_01');
    globalThis.risuai.nativeFetch = async () => ({ ok: false, status: 400 });
    await assert.rejects(api.uploadIrodoriVoice(sample, 'a.wav', 'x', irodori()), error => error instanceof api.TtsHttpError && error.status === 400);
    // An id the server already lists goes straight up as PUT to that voice, replacing it. Risu can hand back a
    // refused POST with no status at all, which once read as an unreachable server.
    let tries = [];
    const server = (held, refusal) => async (u, o) => {
      tries.push([o.method, u, o.body]);
      if (o.method === 'GET') return { ok: true, json: async () => ({ data: held.map(id => ({ id })) }) };
      if (o.method === 'POST') return held.includes('aoi') ? refusal : { ok: true, json: async () => ({ id: 'aoi' }) };
      return held.includes('aoi') ? { ok: true, json: async () => ({ id: 'aoi' }) } : { ok: false, status: 404 };
    };
    globalThis.risuai.nativeFetch = server(['none', 'aoi'], { ok: false });
    assert.equal(await api.uploadIrodoriVoice(sample, 'design.wav', 'aoi', irodori()), 'aoi');
    assert.deepEqual(tries.map(([method, u]) => [method, u]), [['GET', 'http://127.0.0.1:8088/v1/audio/voices'], ['PUT', 'http://127.0.0.1:8088/v1/audio/voices/aoi']]);
    // A new id is a POST, as before.
    tries = [];
    globalThis.risuai.nativeFetch = server(['none'], { ok: false });
    assert.equal(await api.uploadIrodoriVoice(sample, 'design.wav', 'aoi', irodori()), 'aoi');
    assert.deepEqual(tries.map(([method]) => method), ['GET', 'POST']);
    // The list unreadable and the POST refused with its 409: the same form goes again as PUT.
    tries = [];
    globalThis.risuai.nativeFetch = async (u, o) => { tries.push([o.method, u, o.body]); return o.method === 'GET' ? { ok: false, status: 500 } : o.method === 'POST' ? { ok: false, status: 409 } : { ok: true, json: async () => ({ id: 'aoi' }) }; };
    assert.equal(await api.uploadIrodoriVoice(sample, 'design.wav', 'aoi', irodori()), 'aoi');
    assert.deepEqual(tries.map(([method]) => method), ['GET', 'POST', 'PUT']);
    assert.equal(tries[1][2], tries[2][2], 'the same form');
    // Refused there too: the failure is the caller's to show, with no further try.
    tries = [];
    globalThis.risuai.nativeFetch = async (u, o) => { tries.push([o.method]); return { ok: false, status: o.method === 'POST' ? 409 : 404 }; };
    await assert.rejects(api.uploadIrodoriVoice(sample, 'design.wav', 'aoi', irodori()), error => error instanceof api.TtsHttpError && error.status === 404);
    assert.deepEqual(tries.map(([method]) => method), ['GET', 'POST', 'PUT']);
    // A server names a voice's file by its id: letters, digits, - and _ only; a name with none of them is dated.
    assert.equal(api.irodoriVoiceSlug(' Aoi (calm) v2 '), 'Aoi-calm-v2');
    assert.equal(api.irodoriVoiceSlug('아오이', 1700000000000), `voice-${(1700000000000).toString(36)}`);
  } finally { delete globalThis.risuai; }
});

test("a save's Irodori presets and each card's Irodori voice are read back beside Fish's; a broken preset row is dropped, not the save", async () => {
  const fresh = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text + '\n//# sourceURL=tts-irodori-load.mjs').toString('base64'));
  const card = { id: 'c1', scope: 'global', name: '하린', surname: '', givenName: '', surnameAliases: [], givenAliases: [], triggers: ['하린'], tags: [], gender: 'female', voiceKey: 'fv', fishId: fishVoice, irodoriKey: 'p1', fixed: false, gain: 0 };
  const stored = { version: 1, settings: { ...fresh.ttsDefaults(), engine: 'irodori' }, folders: [], characters: [card],
    voices: [{ key: 'fv', name: 'Fish voice', fishId: fishVoice, tags: [], gender: 'female', folder: '' }],
    irodoriVoices: [{ key: 'p1', name: '아오이', fishId: 'aoi', tags: ['차분한'], gender: 'female', folder: 'x', caption: '落ち着いた声' }, { key: 'p2', name: 'ken', fishId: 'ken', tags: 'nope', gender: 'robot' }, { name: 'no key' }, null] };
  const saved = new Map([['omnitts.data', JSON.stringify(stored)]]), local = new Map();
  globalThis.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) },
    getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k), keys: async () => [...local.keys()] }) };
  try {
    assert.equal(fresh.ttsEngine(), 'fish', 'before the save is read: Fish');
    const data = await fresh.loadTtsData();
    assert.equal(fresh.ttsEngine(), 'irodori');
    assert.deepEqual(data.irodoriVoices, [{ key: 'p1', name: '아오이', fishId: 'aoi', tags: ['차분한'], gender: 'female', folder: '', caption: '落ち着いた声' }, { key: 'p2', name: 'ken', fishId: 'ken', tags: [], gender: 'unknown', folder: '' }]);
    const read = data.characters.find(c => c.id === 'c1');
    assert.deepEqual([read.voiceKey, read.fishId, read.irodoriKey], ['fv', fishVoice, 'p1'], 'one voice per engine, both kept');
    assert.deepEqual(fresh.ttsCandidateVoices().map(v => v.key), ['p1', 'p2'], 'the engine in use chooses among its own presets');
    data.settings.engine = 'fish';
    assert.deepEqual(fresh.ttsCandidateVoices().map(v => v.key), ['fv']);
  } finally { delete globalThis.risuai; }
});

test("Irodori presets: a card speaks with its own preset and the rest with the default voice; a new speaker is given a preset of her gender; Fish's voices come back with Fish", async () => {
  const originalAudio = globalThis.Audio, originalContext = globalThis.AudioContext;
  const local = new Map(), saved = new Map(), speech = [], fish = [], picks = [];
  globalThis.Audio = class { src = ''; pause() {} load() {} removeAttribute() {} async play() {} };
  globalThis.AudioContext = class { state = 'running'; destination = {}; createGain() { return { gain: { value: 1 }, connect() { return this; } }; } createMediaElementSource() { return { connect(node) { return node; } }; } };
  globalThis.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) },
    getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k), keys: async () => [...local.keys()] }),
    getDatabase: async () => ({ modules: [], enabledModules: [], personas: [] }), setDatabase: async () => {}, getCurrentLorebookEntries: async () => [],
    runLLMModel: async () => ({ success: true, content: '[]' }),
    nativeFetch: async (url, options) => {
      if (String(url).includes('translate.googleapis.com')) return { ok: true, json: async () => [[['訳:' + new URL(url).searchParams.get('q')]]] };
      const body = JSON.parse(options.body);
      if (String(url).startsWith('http://127.0.0.1:8088/')) { speech.push(body); return { ok: true, data: new Uint8Array(64) }; }
      // JEV: the first voice it was offered, so the test sees which ones those were.
      if (body.questions) { picks.push(body.questions); return { ok: true, json: async () => ({ answers: Object.fromEntries(Object.entries(body.questions).map(([i, q]) => [i, { choice: Object.keys(q.criteria)[0], probabilities: {} }])) }) }; }
      fish.push(body); return { ok: true, data: new Uint8Array(64) };
    } };
  try {
    const data = await api.loadTtsData();
    Object.assign(data.settings, { enabled: true, autoAssign: true, cueEmoji: true, selector: 'jev', continuous: false, engine: 'irodori' });
    data.settings.translation.provider = 'off'; data.settings.fish.key = 'fake'; data.settings.jev.key = 'fake';
    data.settings.irodori = { ...api.ttsDefaults().irodori, voice: 'sample' };
    data.voices = [{ key: 'fv', name: 'Fish voice', fishId: fishVoice, gender: 'female', tags: [], folder: '' }];
    data.irodoriVoices = [{ key: 'p-aoi', name: '아오이', fishId: 'aoi', gender: 'female', tags: ['차분한'], folder: '' }, { key: 'p-ken', name: '켄', fishId: 'ken', gender: 'male', tags: [], folder: '' }];
    const card = (name, more) => ({ ...api.blankTtsCharacter('bot:preset', name), ...more });
    data.characters = [card('하린', { voiceKey: 'fv', fishId: fishVoice, irodoriKey: 'p-aoi' }), card('민수', { fixed: true }), card('사라', { fixed: true, irodoriKey: 'gone' })];
    await api.saveTtsData();
    const runtime = new api.OmniTtsRuntime(); await runtime.init();
    const context = { scope: 'preset', rosterScope: 'bot:preset', characterId: 'preset', chatId: 'chat', sessionId: 's', character: {}, chat: {}, messages: [] };
    const line = (text, speaker, more = {}) => ({ context, messageId: text, segment: { id: text, kind: speaker ? 'dialogue' : 'narration', speaker, tone: '', text, start: 0, end: text.length, ...more } });
    const voiceOf = async request => { await runtime.play([request], 0); return speech.at(-1)?.voice; };
    assert.equal(await voiceOf(line('안녕.', '하린')), 'aoi', runtime.notice);
    assert.equal(await voiceOf(line('왔어?', '민수')), 'sample', 'no preset of his own: the default voice');
    assert.equal(await voiceOf(line('응.', '사라')), 'sample', 'a preset since deleted: the default voice');
    assert.equal(await voiceOf(line('비가 내렸다.', '')), 'sample', 'narration: the default voice');
    assert.equal(picks.length, 0, 'nobody needed a voice chosen');
    // An Irodori voice auditioned by its id is asked of Irodori, as named.
    await runtime.play([{ ...line('こんにちは。', '', { kind: 'audition' }), fishId: 'ken', engine: 'irodori' }], 0);
    assert.equal(speech.at(-1).voice, 'ken'); assert.equal(speech.at(-1).input, 'こんにちは。'); assert.equal(fish.length, 0);
    // Someone new, a woman by her first line's emoji: a card of her own, and a preset among the women's.
    assert.equal(await voiceOf(line('처음 뵙겠습니다.', '유나', { marks: '👩🥺' })), 'aoi', runtime.notice);
    assert.equal(picks.length, 1); assert.equal(Object.keys(picks[0]['0'].criteria).length, 1, 'only the female preset was offered');
    const yuna = data.characters.find(c => c.name === '유나');
    assert.deepEqual([yuna.irodoriKey, yuna.voiceKey, yuna.fishId, yuna.gender], ['p-aoi', '', '', 'female'], 'her Irodori voice alone was chosen');
    assert.equal(fish.length, 0);
    // A man, with no male preset left: a card of his own and the default voice, with no pick asked and nothing reported.
    data.irodoriVoices = data.irodoriVoices.filter(v => v.gender !== 'male'); await api.saveTtsData();
    for (const text of ['누구세요?', '저는 처음입니다.']) assert.equal(await voiceOf(line(text, '도윤', { marks: '👨😠' })), 'sample', runtime.notice);
    assert.equal(picks.length, 1, 'no preset suits him: none is asked for, on his first line or his next');
    assert.equal(runtime.notice, '');
    assert.deepEqual([data.characters.find(c => c.name === '도윤').gender, data.characters.find(c => c.name === '도윤').irodoriKey], ['male', undefined]);
    // Back on Fish: each card's Fish voice, as it was left; the Irodori choice stays for the next switch.
    data.settings.engine = 'fish'; await api.saveTtsData();
    await runtime.play([line('다시 안녕.', '하린')], 0);
    assert.equal(fish.length, 1, runtime.notice); assert.equal(fish[0].reference_id, fishVoice);
    assert.equal(data.characters.find(c => c.name === '하린').irodoriKey, 'p-aoi');
  } finally { delete globalThis.risuai; globalThis.Audio = originalAudio; globalThis.AudioContext = originalContext; }
});

test("voice emoji: Irodori's 39 in its own form, any other emoji out; one a translation lost goes back; a Fish delivery becomes its nearest emoji", () => {
  const PAUSE = '\u23F8', WIND = '\u{1F32C}', VS = '\uFE0F';
  assert.equal(api.IRODORI_EMOJI.length, 39);
  assert.deepEqual(api.IRODORI_EMOJI.filter(row => row.emoji.includes(VS)).map(row => row.label), ['pause', 'heavy breathing'], 'as its own list writes them');
  // Either form a reply wrote is sent in the form Irodori knows; a sigh is one emoji, not a gasp and a puff.
  assert.equal(api.irodoriSpeech(`はい${PAUSE}そう${WIND}ね😊${VS}。`), `はい${PAUSE}${VS}そう${WIND}${VS}ね😊。`);
  assert.equal(api.irodoriSpeech('まぁ😮‍💨いいよ😮'), 'まぁ😮‍💨いいよ😮');
  assert.deepEqual(api.irodoriEmojiIn('まぁ😮‍💨いいよ😮🤭🤭'), ['😮‍💨', '😮', '🤭', '🤭']);
  assert.equal(api.irodoriSpeech('好き ❤️ だよ 👩‍🦰 ねえ 👍🏽 ほんと🤭'), '好き だよ ねえ ほんと🤭', 'what it was never trained on is not sent');
  // A translator that kept them: as it left them. One that dropped some: those, back at the start.
  assert.equal(api.keepIrodoriEmoji('하하🤭, 정말? 😮‍💨', 'あはは🤭、本当？😮‍💨'), 'あはは🤭、本当？😮‍💨');
  assert.equal(api.keepIrodoriEmoji('하하🤭, 정말? 😮‍💨 응🤭', 'あはは🤭、本当？うん'), '😮‍💨🤭あはは🤭、本当？うん');
  assert.equal(api.keepIrodoriEmoji('그래.', 'そう。'), 'そう。');
  // A line written for Fish: its delivery, as the nearest emoji, two at most; calm has none; its own emoji win.
  assert.equal(api.irodoriToneEmoji('whispering'), '👂'); assert.equal(api.irodoriToneEmoji('soft tone, sad, angry'), '🫶😭');
  assert.equal(api.irodoriToneEmoji('calm'), ''); assert.equal(api.irodoriToneEmoji('languid'), '😪'); assert.equal(api.irodoriToneEmoji('angry'), '😠');
  assert.equal(api.irodoriLine('안녕.', 'こんにちは。', 'whispering'), '👂こんにちは。');
  assert.equal(api.irodoriLine('안녕🤭', 'こんにちは🤭', 'whispering'), 'こんにちは🤭');
  assert.equal(api.irodoriLine('안녕.', 'こんにちは。'), 'こんにちは。');
});

test("Irodori is sent a line's voice emoji through the translation; the lorebook entry follows the engine", async () => {
  const originalAudio = globalThis.Audio, originalContext = globalThis.AudioContext;
  const local = new Map(), saved = new Map(), speech = [], written = []; let drop = false;
  globalThis.Audio = class { src = ''; pause() {} load() {} removeAttribute() {} async play() {} };
  globalThis.AudioContext = class { state = 'running'; destination = {}; createGain() { return { gain: { value: 1 }, connect() { return this; } }; } createMediaElementSource() { return { connect(node) { return node; } }; } };
  globalThis.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) },
    getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k), keys: async () => [...local.keys()] }),
    getDatabase: async () => ({ modules: [], enabledModules: [], personas: [] }), setDatabase: async patch => { written.push(JSON.stringify(patch)); }, getCurrentLorebookEntries: async () => [],
    runLLMModel: async () => ({ success: true, content: '[]' }),
    nativeFetch: async (url, options) => {
      // A translator that keeps emoji where they are, or (drop) one that loses them all.
      if (String(url).includes('translate.googleapis.com')) { const q = new URL(url).searchParams.get('q'); return { ok: true, json: async () => [[['訳:' + (drop ? q.replace(/\p{Extended_Pictographic}\u200D?/gu, '') : q)]]] }; }
      speech.push(JSON.parse(options.body)); return { ok: true, data: new Uint8Array(64) };
    } };
  try {
    const data = await api.loadTtsData();
    Object.assign(data.settings, { enabled: true, autoAssign: false, continuous: false, engine: 'irodori' });
    data.settings.translation.provider = 'off'; data.settings.irodori = { ...api.ttsDefaults().irodori, voice: 'sample' };
    data.irodoriVoices = []; data.characters = []; await api.saveTtsData();
    const runtime = new api.OmniTtsRuntime(); await runtime.init();
    const cues = () => written.filter(patch => patch.includes('omnitts-cues')).at(-1) || '';
    assert.ok(cues().includes('Voice emoji go inside the quotes'), 'the entry Irodori needs, once it is the engine');
    const context = { scope: 'emoji', rosterScope: 'bot:emoji', characterId: 'emoji', chatId: 'chat', sessionId: 's', character: {}, chat: {}, messages: [] };
    const said = async (text, tone = '') => { await runtime.play([{ context, messageId: text, segment: { id: text, kind: 'dialogue', speaker: '하린', tone, text, start: 0, end: text.length } }], 0); return speech.at(-1).input; };
    assert.equal(await said('하하🤭, 정말? ❤️ …😮‍💨 알았어.'), '訳:하하🤭, 정말? …😮‍💨 알았어.', runtime.notice);
    drop = true;
    assert.equal(await said('뭐라고? 😠 다시 말해 봐 😮‍💨'), '😠😮‍💨訳:뭐라고? 다시 말해 봐', 'lost in translation: back at the start');
    drop = false;
    assert.equal(await said('여기야.', 'whispering'), '👂訳:여기야.', 'a line still written for Fish');
    assert.equal(await said('그래.', 'calm'), '訳:그래.');
    // Back on Fish the entry is Fish's again.
    data.settings.engine = 'fish'; data.settings.fish.key = 'fake'; await api.saveTtsData();
    // 대사 중간 감정 태그 is on by default: Fish's entry is the one asking for [tags].
    for (let i = 0; i < 50 && !cues().includes('Voice tags go inside the quotes'); i++) await new Promise(r => setImmediate(r));
    assert.ok(cues().includes('Voice tags go inside the quotes') && !cues().includes('Voice emoji'), 'the entry follows the engine');
  } finally { delete globalThis.risuai; globalThis.Audio = originalAudio; globalThis.AudioContext = originalContext; }
});

test("the starter voices: twenty, both genders at every age, each a server-safe id, a Japanese description and tags the assignment engines know", () => {
  const rows = api.IRODORI_STARTERS;
  assert.equal(rows.length, 33);
  assert.equal(new Set(rows.map(row => row.id)).size, 33); assert.equal(new Set(rows.map(row => row.name)).size, 33);
  const ages = ['어린이', '청년', '중년', '노인'];
  for (const row of rows) {
    // The id is the file's name on the server, and what the upload asks for is what it is found by afterwards.
    assert.equal(api.irodoriVoiceSlug(row.id), row.id, row.id); assert.ok(row.id.startsWith('omni-'), row.id);
    assert.ok(row.gender === 'female' || row.gender === 'male', row.id);
    assert.match(row.caption, /[\u3040-\u30ff]/, `${row.id}: described in Japanese, the language the model was taught in`);
    assert.ok(!/[\uac00-\ud7a3]/.test(row.caption), row.id);
    // A tag outside the vocabulary would go to the engines in Korean, read less sharply than every other voice's.
    for (const tag of row.tags) assert.notEqual(api.englishVoiceWord(tag), tag, `${row.id}: ${tag}`);
    assert.equal(row.tags.filter(tag => [...ages, '10대', '성인'].includes(tag)).length, 1, `${row.id}: one age`);
  }
  for (const gender of ['female', 'male']) for (const age of ages) assert.ok(rows.some(row => row.gender === gender && row.tags.includes(age)), `${gender} ${age}`);
  // Made again, only what no preset stands for yet.
  assert.equal(api.missingIrodoriStarters([]).length, 33);
  assert.deepEqual(api.missingIrodoriStarters(rows.slice(1).map(row => ({ fishId: row.id }))).map(row => row.id), [rows[0].id]);
  assert.equal(api.missingIrodoriStarters([{ fishId: 'alice' }]).length, 33);
});

test("a voice written by the model: the character's own lore first and a few rows of it, the answer read as a preset; a request alone reads no source", async () => {
  // The sources, cut down: rows naming the character before the rest, eight at most, each and all within a budget.
  const long = 'あ'.repeat(5000);
  const lore = [['세계관', long], ['민수', '민수는 과묵하다.'], ['하린 설정', '하린은 고등학생이고 까칠하다.'], ...Array.from({ length: 12 }, (_, i) => [`기타 ${i}`, `기타 설정 ${i} ${long}`])];
  const cut = api.voiceDraftSources({ lore, character: ['하린 봇', 'x'.repeat(9000)], illustration: Array.from({ length: 30 }, (_, i) => [`c${i}`]), persona: ['me', 'secret'] }, ['하린']);
  assert.equal(cut.lore[0][0], '하린 설정', 'the entry naming her comes first, wherever it stood');
  assert.ok(cut.lore.length <= 8); assert.ok(cut.lore.every(row => row[1].length <= 1500));
  assert.ok(cut.lore.reduce((sum, row) => sum + row[1].length, 0) <= 6000, 'a lorebook is not sent whole');
  assert.equal(cut.bot[1].length, 3000); assert.equal(cut.illustration.length, 10); assert.equal(cut.persona, undefined);
  assert.deepEqual(api.voiceDraftSources({}, ['하린']), {});
  // The answer: tags back in the words shown, a gender it knows or unknown, and no preset without a description.
  assert.deepEqual(api.parseVoiceDraft({ name: ' 하린 ', gender: 'female', tags: ['young adult', 'tsundere', 'tsundere', 'high-pitched', 7], caption: ' 素直になれない若い女性の声。 ' }),
    { name: '하린', gender: 'female', tags: ['청년', '츤데레', '높음'], caption: '素直になれない若い女性の声。' });
  assert.deepEqual(api.parseVoiceDraft({ gender: 'robot', caption: '声' }), { name: '', gender: 'unknown', tags: [], caption: '声' });
  for (const bad of [null, [], {}, { caption: '  ' }, { caption: 3 }]) assert.throws(() => api.parseVoiceDraft(bad), /목소리 설명/);
  const asked = []; let loreReads = 0;
  globalThis.risuai = { getDatabase: async () => ({ personas: [] }),
    getCurrentLorebookEntries: async () => { loreReads++; return [
      { comment: '하린 설정', key: '하린, harin', content: '하린은 고등학생이고 까칠하다.' }, { comment: '민수', key: '민수', content: '민수는 과묵하다.' },
      { comment: '세계관', key: '', alwaysActive: true, content: '마법 학원이 배경이다.' }, { comment: 'omni.nexus.tts.cues', key: '', alwaysActive: true, content: 'internal' }]; },
    runLLMModel: async options => { asked.push(options.messages); return { success: true, content: '```json\n{"name":"하린","gender":"female","tags":["young adult","tsundere"],"caption":"素直になれない若い女性の声。"}\n```' }; } };
  try {
    const context = { scope: 's', rosterScope: 'bot:c', characterId: 'c', chatId: 'chat', sessionId: 's', character: { name: '하린 봇', desc: '츤데레 소꿉친구.' }, chat: {}, messages: [] };
    const llm = api.ttsDefaults().llm;
    const draft = await api.writeIrodoriVoice(context, ['하린', 'harin'], '', llm);
    assert.deepEqual(draft, { name: '하린', gender: 'female', tags: ['청년', '츤데레'], caption: '素直になれない若い女性の声。' });
    const [system, user] = asked[0], sent = JSON.parse(user.content);
    assert.match(system.content, /untrusted data/); assert.match(system.content, /若い女性/, 'high-school age and older is a young adult');
    assert.deepEqual([sent.character, sent.request], ['하린', '']);
    assert.ok(sent.vocabulary.includes('tsundere') && sent.vocabulary.includes('young adult'));
    assert.deepEqual(sent.sources.lore.map(row => row[0]), ['하린 설정', '세계관'], 'her entry and what is always in play: not Minsu\'s, not the plugin\'s own');
    assert.deepEqual(sent.sources.bot, ['하린 봇', '츤데레 소꿉친구.']);
    // A request alone: written from it, with no source read; nothing at all to go by is refused before any call.
    const before = loreReads;
    await api.writeIrodoriVoice(context, [], '차분한 30대 여성', llm);
    assert.deepEqual(JSON.parse(asked[1][1].content).sources, {}); assert.equal(JSON.parse(asked[1][1].content).character, null);
    assert.equal(loreReads, before);
    await api.writeIrodoriVoice(null, ['하린'], '', llm);
    assert.deepEqual(JSON.parse(asked[2][1].content).sources, {}, 'no chat open: the name alone');
    await assert.rejects(api.writeIrodoriVoice(context, [' '], '  ', llm), /캐릭터를 고르거나/);
    assert.equal(asked.length, 3);
  } finally { delete globalThis.risuai; }
});

test("presets from a file: those not here are added with their keys; one already here by key or by server voice stays as it is", () => {
  const mine = [{ key: 'a', name: '내 이름', fishId: 'aoi', tags: ['차분함'], gender: 'female', folder: '' }];
  const file = { irodoriVoices: [{ key: 'a', name: '남의 이름', fishId: 'other', tags: [], gender: 'male' }, { key: 'b', name: '같은 서버 목소리', fishId: 'aoi', tags: [] },
    { key: 'c', name: 'Ken', fishId: 'ken', tags: ['낮음', 3], gender: 'male', folder: 'x', caption: '低い声' }, { key: 'c', name: 'Ken again', fishId: 'ken2' }, { key: 'd', name: 'no voice', fishId: ' ' }, { name: 'no key', fishId: 'z' }, null] };
  const fresh = api.newIrodoriPresets(mine, file);
  assert.deepEqual(fresh, [{ key: 'c', name: 'Ken', fishId: 'ken', tags: ['낮음'], gender: 'male', folder: '', caption: '低い声' }]);
  assert.deepEqual(api.newIrodoriPresets(mine, file.irodoriVoices), fresh, 'a bare list too');
  for (const other of [null, 'x', {}, { voices: [{ key: 'k', name: 'Fish voice', fishId: 'f' }] }]) assert.deepEqual(api.newIrodoriPresets(mine, other), []);
});
