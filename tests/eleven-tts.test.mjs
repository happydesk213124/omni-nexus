import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// ElevenLabs as a TTS engine: one line a request by an API key, the account's own voices as presets (a card keeps one
// per engine), [audio tags] sent only to the models that act on them.
const built = await build({ stdin: { contents: "export * from './src/providers/tts/eleven';export * from './src/domain/tts/eleven-voices';export {normalizeTtsSettings,loadTtsData,ttsData,ttsCandidateVoices,ttsEngineVoices} from './src/storage/tts-store';export {ttsDefaults} from './src/config/tts-defaults';export {synthesisSignature,parseTtsMessage} from './src/domain/tts/segment';export {boundVoiceKey,bindVoice,ownVoiceEngine,ownVoices} from './src/domain/tts/engine-voice';export {synthesizeSpeech,speechReady} from './src/providers/tts/speech';export {TtsHttpError} from './src/providers/tts/http';export {exportableTtsSettings} from './src/tts-ui/settings-transfer';export {loadElevenVoiceList,addElevenVoice,removeElevenVoice,ensureElevenVoiceList} from './src/services/eleven-voices';export {OmniTtsRuntime} from './src/services/tts-runtime';export {blankTtsCharacter} from './src/services/tts-characters';export {voiceTagsOn} from './src/domain/tts/voice-tags';export {engineTabs} from './src/tts-ui/irodori-markup';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const tick = () => new Promise(r => setImmediate(r));
const VOICE = '21m00Tcm4TlvDq8ikWAM', OTHER = 'EXAVITQu4vr4xnSDxMaL';
const eleven = (over = {}) => ({ ...api.ttsDefaults(), engine: 'elevenlabs', eleven: { ...api.ttsDefaults().eleven, key: 'sk_test', voice: VOICE, ...over } });

/** Risu's nativeFetch, answering each call by `reply(url, init)` and keeping what was asked. */
function host(reply) {
  const calls = [];
  globalThis.risuai = { nativeFetch: async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers ?? {}, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
    const r = await reply(url, init, calls.length);
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.json, ...(r.bytes ? { arrayBuffer: async () => r.bytes } : {}) };
  } };
  return calls;
}
const audio = { bytes: new Uint8Array(64).buffer };

test('settings: defaults, an older save filled in, the engine kept, the key out of a shared file', () => {
  assert.deepEqual(api.ttsDefaults().eleven, { key: '', model: 'eleven_v3', voice: '', concurrency: 3, listed: false });
  const old = api.normalizeTtsSettings({ engine: 'elevenlabs' });
  assert.equal(old.engine, 'elevenlabs');
  assert.deepEqual(old.eleven, api.ttsDefaults().eleven, 'a save from before ElevenLabs');
  const odd = api.normalizeTtsSettings({ eleven: { key: 5, model: '  ', voice: null, concurrency: 99, listed: 'yes' } });
  assert.deepEqual(odd.eleven, { key: '', model: 'eleven_v3', voice: '', concurrency: 5, listed: false });
  assert.equal(api.normalizeTtsSettings({ engine: 'elevenlab' }).engine, 'fish', 'an unknown engine is Fish');
  assert.equal(api.exportableTtsSettings(eleven()).settings.eleven.key, '');
  assert.equal(api.speechReady(eleven()), true); assert.equal(api.speechReady(eleven({ key: ' ' })), false);
  assert.deepEqual(api.engineTabs(['tts-settings', 'tts-voices'], 'elevenlabs'), ['tts-settings', 'tts-eleven-voices']);
});

test('a card keeps a voice per engine; ElevenLabs is an engine of its own voices', () => {
  const card = { voiceKey: 'fish-key', fishId: 'f'.repeat(32) };
  assert.equal(api.ownVoiceEngine('elevenlabs'), true); assert.equal(api.ownVoiceEngine('fish'), false);
  api.bindVoice(card, { key: `eleven:${VOICE}`, fishId: VOICE }, 'elevenlabs');
  assert.equal(card.elevenKey, `eleven:${VOICE}`); assert.equal(card.voiceKey, 'fish-key', 'its Fish voice is left as it was');
  assert.equal(api.boundVoiceKey(card, 'elevenlabs'), `eleven:${VOICE}`); assert.equal(api.boundVoiceKey(card, 'fish'), 'fish-key'); assert.equal(api.boundVoiceKey(card, 'gemini'), '');
  api.bindVoice(card, null, 'elevenlabs'); assert.equal('elevenKey' in card, false);
  const data = { irodoriVoices: [1], geminiVoices: [2], elevenVoices: [3] };
  assert.deepEqual(api.ownVoices(data, 'elevenlabs'), [3]); assert.deepEqual(api.ownVoices(data, 'gemini'), [2]);
});

test('which models act on tags, and what a line may hold', () => {
  for (const model of ['eleven_v3', 'eleven_v3_conversational', 'eleven_v4', 'eleven_v4_turbo', 'eleven_v5']) assert.equal(api.elevenTagModel(model), true, model);
  for (const model of ['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_flash_v2', 'my-model']) assert.equal(api.elevenTagModel(model), false, model);
  assert.equal(api.elevenTextLimit('eleven_v3'), 5000); assert.equal(api.elevenTextLimit('eleven_v4'), 8000); assert.equal(api.elevenTextLimit('eleven_multilingual_v2'), 8000);
});

test('the request: the voice in the path, the key in xi-api-key, mp3 asked for; tags as written on a tag model, none on the others', async () => {
  let calls = host(() => audio);
  const bytes = await api.synthesizeSpeech('[sad] 괜찮아… [sobbing] 정말', 'soft tone, slow', VOICE, eleven());
  assert.equal(bytes.byteLength, 64);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`);
  assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].headers['xi-api-key'], 'sk_test'); assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(calls[0].body, { text: '[soft tone][slow][sad] 괜찮아… [sobbing] 정말', model_id: 'eleven_v3' }, "the card's base delivery in front, the line's own tags as written; no voice settings (the voice keeps its own)");
  // Japanese tags (the TTS translation going to Japanese) go as written too.
  calls = host(() => audio);
  await api.synthesizeSpeech('[ため息] 大丈夫', '', VOICE, eleven({ model: 'eleven_v4_turbo' }));
  assert.deepEqual(calls[0].body, { text: '[ため息] 大丈夫', model_id: 'eleven_v4_turbo' });
  // A model that reads brackets aloud gets the words alone: no tag of either language, no delivery cue.
  calls = host(() => audio);
  await api.synthesizeSpeech('[sad] 괜찮아… [ため息] 정말 [giggle].', 'soft tone', VOICE, eleven({ model: 'eleven_multilingual_v2' }));
  assert.deepEqual(calls[0].body, { text: '괜찮아… 정말.', model_id: 'eleven_multilingual_v2' }, 'and never a language_code for multilingual_v2');
  // A 2.5 model is told the language when the script says it.
  calls = host(() => audio);
  await api.synthesizeSpeech('안녕하세요', '', VOICE, eleven({ model: 'eleven_flash_v2_5' }));
  assert.deepEqual(calls[0].body, { text: '안녕하세요', model_id: 'eleven_flash_v2_5', language_code: 'ko' });
  calls = host(() => audio);
  await api.synthesizeSpeech('こんにちは', '', VOICE, eleven({ model: 'eleven_flash_v2_5' }));
  assert.equal(calls[0].body.language_code, 'ja');
  calls = host(() => audio);
  await api.synthesizeSpeech('Hello', '', '', eleven({ model: 'eleven_flash_v2_5' }));
  assert.equal('language_code' in calls[0].body, false);
  assert.match(calls[0].url, new RegExp(`/text-to-speech/${VOICE}\\?`), 'no voice named: the default voice');
});

test('refused before it is sent: no key, no voice, too long for the model, nothing left to read', async () => {
  const calls = host(() => audio);
  await assert.rejects(api.synthesizeSpeech('안녕', '', VOICE, eleven({ key: '' })), /ElevenLabs API 키/);
  await assert.rejects(api.synthesizeSpeech('안녕', '', '', eleven({ voice: '' })), /목소리를 먼저 골라/);
  await assert.rejects(api.synthesizeSpeech('가'.repeat(5001), '', VOICE, eleven()), /5,000자/);
  await assert.rejects(api.synthesizeSpeech('[sad]', '', VOICE, eleven({ model: 'eleven_multilingual_v2' })), /읽을 내용이 없습니다/);
  assert.equal(calls.length, 0);
});

test('a refusal says what to fix, with what ElevenLabs said', async () => {
  const refusal = async (status, json) => { host(() => ({ status, json })); try { await api.synthesizeSpeech('안녕', '', VOICE, eleven()); } catch (error) { return error; } };
  const bad = await refusal(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
  assert.ok(bad instanceof api.TtsHttpError); assert.equal(bad.status, 401); assert.equal(bad.service, 'elevenlabs');
  assert.match(bad.message, /ElevenLabs API 키를 확인/); assert.match(bad.message, /invalid_api_key: Invalid API key/);
  const field = await refusal(422, { detail: [{ loc: ['body', 'model_id'], msg: 'unknown model', type: 'value_error' }] });
  assert.match(field.message, /요청 내용을 받아들이지 않았습니다/); assert.match(field.message, /unknown model/);
  assert.match((await refusal(429, { detail: { status: 'too_many_concurrent_requests', message: 'Too many' } })).message, /요청 한도/);
  assert.match((await refusal(404, { detail: { status: 'voice_not_found', message: 'A voice was not found' } })).message, /이 계정에 없습니다/);
  // A body in no shape it knows is no reason to fail twice.
  assert.match((await refusal(500, 'oops')).message, /ElevenLabs 서버 오류/);
});

const row = (id, name, labels = {}, extra = {}) => ({ voice_id: id, name, labels, ...extra });
test("a listed voice as a preset: its id, name, gender, the labels as tags, the description apart, its languages", () => {
  const voice = api.elevenListedVoice(row(VOICE, 'Rachel', { gender: 'female', age: 'middle_aged', accent: 'american', description: 'calm', use_case: 'narrative_story' }, { description: 'A calm  narrator.', verified_languages: [{ language: 'ko' }, { language: 'ja-JP' }, { language: 'ko' }] }));
  assert.deepEqual(voice, { key: `eleven:${VOICE}`, name: 'Rachel', fishId: VOICE, tags: ['middle aged', 'calm', 'american', 'narrative story'], folder: '', gender: 'female', caption: 'A calm narrator.', languages: ['ko', 'ja'] });
  assert.equal(api.elevenListedVoice(row(OTHER, 'Bella', { gender: 'Male', descriptive: 'husky' })).gender, 'male');
  assert.deepEqual(api.elevenListedVoice(row(OTHER, '', {})), { key: `eleven:${OTHER}`, name: OTHER, fishId: OTHER, tags: [], folder: '', gender: 'unknown' });
  assert.equal(api.elevenListedVoice({ name: 'no id' }), null);
  assert.equal(api.elevenVoiceId(` ${VOICE} `), VOICE);
  assert.equal(api.elevenVoiceId(`https://elevenlabs.io/app/voice-library?voiceId=${VOICE}`), VOICE);
  assert.equal(api.elevenVoiceId('rachel!'), ''); assert.equal(api.elevenVoiceId('short'), '');
});

test('the list is read a hundred a page until it says there is no more; one voice by its id', async () => {
  const calls = host((url) => {
    if (url.includes('/v1/voices/')) return { json: row(OTHER, 'Bella', { gender: 'female' }) };
    const page = new URL(url).searchParams.get('next_page_token');
    return page === 'p2' ? { json: { voices: [row(OTHER, 'Bella'), row(VOICE, 'Rachel again')], has_more: false, next_page_token: null } } : { json: { voices: [row(VOICE, 'Rachel')], has_more: true, next_page_token: 'p2' } };
  });
  const voices = await api.listElevenVoices(eleven());
  assert.deepEqual(voices.map(v => v.name), ['Rachel', 'Bella'], 'each voice once, in the order listed');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=false');
  assert.equal(calls[1].url, 'https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=false&next_page_token=p2');
  assert.equal(calls[0].method, 'GET'); assert.equal(calls[0].headers['xi-api-key'], 'sk_test');
  const one = await api.fetchElevenVoice(OTHER, eleven());
  assert.equal(one.key, `eleven:${OTHER}`); assert.equal(calls.at(-1).url, `https://api.elevenlabs.io/v1/voices/${OTHER}`);
  await assert.rejects(api.fetchElevenVoice('??', eleven()), /voice|목소리 ID/);
});

test('the cache key: the model, the voice, the delivery and the words; nothing of another engine', () => {
  const s = eleven(), sign = (text, tone, voice, settings = s) => api.synthesisSignature(text, tone, voice, settings);
  assert.equal(sign('안녕', 'Soft Tone ', VOICE), JSON.stringify([1, 'elevenlabs', 'eleven_v3', VOICE, 'soft tone', '안녕']));
  assert.notEqual(sign('안녕', '', VOICE), sign('안녕', '', OTHER));
  assert.notEqual(sign('안녕', '', VOICE), sign('안녕', '', VOICE, eleven({ model: 'eleven_v4' })));
  assert.equal(sign('안녕', '', VOICE), sign('안녕', '', VOICE, { ...s, fish: { ...s.fish, model: 'other' }, eleven: { ...s.eleven, key: 'another', voice: OTHER, listed: true } }), 'the key, the default voice and Fish change no audio');
  assert.equal(api.voiceTagsOn({ inlineTags: true, engine: 'elevenlabs' }), true, '대사 중간 감정 태그 is asked for as with Fish');
});

function world() {
  const saved = new Map(), local = new Map(), asked = [];
  globalThis.Audio = class { src = ''; pause() {} load() {} removeAttribute() {} async play() {} };
  globalThis.AudioContext = class { state = 'running'; destination = {}; createGain() { return { gain: { value: 1 }, connect() { return this; } }; } createMediaElementSource() { return { connect(node) { return node; } }; } };
  globalThis.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) },
    getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k), keys: async () => [...local.keys()] }),
    getDatabase: async () => ({ modules: [], enabledModules: [], personas: [] }), setDatabase: async () => {}, getCurrentLorebookEntries: async () => [],
    nativeFetch: async (url, options) => {
      asked.push({ url: String(url), key: options.headers?.['xi-api-key'], body: options.body ? JSON.parse(options.body) : null });
      if (String(url).includes('/v2/voices')) return { ok: true, status: 200, json: async () => ({ voices: world.voices, has_more: false }) };
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(64).buffer };
    } };
  return asked;
}
world.voices = [row(VOICE, 'Rachel', { gender: 'female', age: 'young' }), row(OTHER, 'Bella', { gender: 'female' })];

test('the runtime: a card speaks with its ElevenLabs voice, anyone else with the default; the list reads itself once and what was kept here stays', async () => {
  const asked = world();
  try {
    const data = await api.loadTtsData();
    assert.deepEqual(data.elevenVoices, [], 'none until the list is read');
    Object.assign(data.settings, { enabled: true, autoAssign: false, continuous: false, engine: 'elevenlabs' });
    data.settings.translation.provider = 'off'; data.settings.eleven.key = 'sk_test';
    data.characters = [...data.characters, { ...api.blankTtsCharacter('global', '하린'), elevenKey: `eleven:${OTHER}`, tone: 'husky' }, api.blankTtsCharacter('global', '민수')];
    data.elevenVoices = [{ key: `eleven:${OTHER}`, name: '내가 고친 이름', fishId: OTHER, tags: ['허스키'], gender: 'female', folder: '' }];
    const runtime = new api.OmniTtsRuntime(); await runtime.init();
    const context = { scope: 'eleven', rosterScope: 'global', characterId: 'c', chatId: 'chat', sessionId: 's', character: {}, chat: {}, messages: [] };
    const say = async text => { const [segment] = api.parseTtsMessage(text); const before = asked.filter(a => a.url.includes('text-to-speech')).length; await runtime.play([{ context, messageId: text, segment }], 0); for (let i = 0; i < 200 && asked.filter(a => a.url.includes('text-to-speech')).length === before; i++) await tick(); return asked.filter(a => a.url.includes('text-to-speech')).at(-1); };
    const first = await say('하린 (sad): "[sad] 괜찮아… [sobbing] 정말."');
    assert.match(first.url, new RegExp(`/v1/text-to-speech/${OTHER}\\?output_format=mp3_44100_128$`), "the card's own voice");
    assert.equal(first.key, 'sk_test');
    assert.deepEqual(first.body, { text: '[husky][sad] 괜찮아… [sobbing] 정말.', model_id: 'eleven_v3' }, 'the parentheses are the face only; the base delivery and the tags in the line speak');
    // The account's voices were read in by themselves, once: the one kept here keeps its name and tags, the new one
    // joins, and with no default voice chosen the first of the list becomes it.
    for (let i = 0; i < 200 && !(data.settings.eleven.listed && data.settings.eleven.voice); i++) await tick();
    assert.equal(asked.filter(a => a.url.includes('/v2/voices')).length, 1);
    assert.deepEqual(api.ttsData().elevenVoices.map(v => [v.fishId, v.name]), [[VOICE, 'Rachel'], [OTHER, '내가 고친 이름']]);
    assert.equal(api.ttsData().settings.eleven.voice, VOICE);
    assert.deepEqual(api.ttsEngineVoices().map(v => v.fishId), [VOICE, OTHER]); assert.deepEqual(api.ttsCandidateVoices().map(v => v.fishId), [VOICE, OTHER]);
    const second = await say('민수 (happy): "좋아!"');
    assert.match(second.url, new RegExp(`/text-to-speech/${VOICE}\\?`), 'no voice of his own: the default voice');
    assert.deepEqual(second.body, { text: '좋아!', model_id: 'eleven_v3' });
    // A model that reads brackets aloud: the tags are out of what it is sent.
    data.settings.eleven.model = 'eleven_multilingual_v2';
    assert.deepEqual((await say('하린 (sad): "[sad] 그만해 [sigh]."')).body, { text: '그만해.', model_id: 'eleven_multilingual_v2' });
    // Read again: nothing new; a voice the account no longer lists stays while a card speaks with it.
    world.voices = [row(VOICE, 'Rachel renamed')];
    assert.equal(await api.loadElevenVoiceList(), 0);
    assert.deepEqual(api.ttsData().elevenVoices.map(v => [v.fishId, v.name]), [[VOICE, 'Rachel'], [OTHER, '내가 고친 이름']]);
    await api.removeElevenVoice(`eleven:${OTHER}`);
    assert.deepEqual(api.ttsData().elevenVoices.map(v => v.fishId), [VOICE]);
    assert.equal('elevenKey' in api.ttsData().characters.find(c => c.name === '하린'), false, 'the card that spoke with it reads with the default voice');
  } finally { delete globalThis.risuai; }
});

test('the very first line, before any voice is known: it waits for the list, and the first voice of it speaks', async () => {
  const asked = world();
  world.voices = [row(OTHER, 'Bella', { gender: 'female' }), row(VOICE, 'Rachel')];
  try {
    const data = api.ttsData();
    Object.assign(data.settings, { enabled: true, autoAssign: false, continuous: false, engine: 'elevenlabs' });
    data.settings.eleven = { ...data.settings.eleven, key: 'sk_test', model: 'eleven_v3', voice: '', listed: false };
    data.elevenVoices = [];
    const runtime = new api.OmniTtsRuntime(); await runtime.init();
    const context = { scope: 'eleven-first', rosterScope: 'global', characterId: 'c', chatId: 'chat', sessionId: 's', character: {}, chat: {}, messages: [] };
    const [segment] = api.parseTtsMessage('민수 (happy): "처음이야."');
    await runtime.play([{ context, messageId: 'first', segment }], 0);
    for (let i = 0; i < 200 && !asked.some(a => a.url.includes('text-to-speech')); i++) await tick();
    assert.deepEqual(asked.map(a => a.url.replace('https://api.elevenlabs.io', '').split('?')[0]), ['/v2/voices', `/v1/text-to-speech/${OTHER}`], 'the list first, then the line with its first voice');
    assert.equal(api.ttsData().settings.eleven.voice, OTHER);
    assert.equal(runtime.player.status, 'playing');
  } finally { delete globalThis.risuai; }
});
