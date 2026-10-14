import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: `export * from './src/services/tts-runtime'; export * from './src/services/tts-characters'; export * from './src/storage/tts-store'; export { ensureTtsRoleCards } from './src/domain/tts/identity'; export * from './src/config/tts-defaults'; export * from './src/domain/tts/segment';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text + '\n//# sourceURL=tts-recovery-check.mjs').toString('base64'));
const failedId = '11111111111111111111111111111111', nextId = '22222222222222222222222222222222';
const local = new Map(), saved = new Map();
const context = { scope: 'recovery', rosterScope: 'global', characterId: 'bot', chatId: 'chat', sessionId: 'session', character: {}, chat: {}, messages: [] };
const request = (text = '다시 읽어 주세요.') => ({ context, messageId: text, segment: { id: '1', kind: 'dialogue', speaker: '하린', tone: 'happy', text, start: 0, end: text.length } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function setup() {
  local.clear(); saved.clear();
  const calls = { fish: [], llm: [] };
  globalThis.risuai = {
    pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, structuredClone(v)) },
    getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k), keys: async () => [...local.keys()] }),
    nativeFetch: async (_url, options) => { const body = JSON.parse(options.body); calls.fish.push(body); return body.reference_id === failedId ? { ok: false, status: 400 } : { ok: true, data: new Uint8Array(32) }; },
    runLLMModel: async options => { calls.llm.push(JSON.parse(options.messages.at(-1).content)); return { success: true, content: '{"0":[1]}' }; },
  };
  const data = await api.loadTtsData();
  data.settings = { ...api.ttsDefaults(), enabled: true, autoAssign: false, continuous: false };
  data.settings.translation.provider = 'off';
  data.settings.fish.key = 'mock';
  data.voices = [
    { key: 'failed', name: '문제 음성', fishId: failedId, tags: ['female'], gender: 'female', folder: '' },
    { key: 'duplicate', name: '같은 모델', fishId: failedId, tags: ['female'], gender: 'female', folder: 'copy' },
    { key: 'next', name: '대체 음성', fishId: nextId, tags: ['female', 'calm'], gender: 'female', folder: '' },
  ];
  data.characters = [{ ...api.blankTtsCharacter('global', '하린'), gender: 'female', voiceKey: 'failed', fishId: failedId }];
  return { data, calls, runtime: new api.OmniTtsRuntime() };
}
async function audio(runtime, line = request(), valid = () => true) {
  const [prepared] = await runtime.prepare([line], valid);
  return runtime.audio(prepared, 0, valid);
}

test('Fish 400 reruns LLM without the failed model, persists replacement, and caches only replacement bytes', async () => {
  const { data, calls, runtime } = await setup();
  const line = request();
  assert.equal((await audio(runtime, line)).byteLength, 32);
  assert.deepEqual(calls.fish.map(body => body.reference_id), [failedId, nextId]);
  assert.equal(calls.llm.length, 1);
  assert.equal(calls.llm[0].voices.length, 1, 'all presets sharing the rejected Fish ID are excluded');
  assert.equal(data.characters[0].voiceKey, 'next');
  assert.equal(data.characters[0].fishId, nextId);
  for (const voice of data.voices.slice(0, 2)) assert.deepEqual({ count: voice.error.count, status: voice.error.status }, { count: 1, status: 400 });
  assert.equal(saved.get('omnitts.data').characters[0].fishId, nextId);
  assert.equal(runtime.cache.has(api.synthesisSignature(line.segment.text, 'happy', failedId, data.settings)), false);
  await audio(runtime, line);
  assert.equal(calls.fish.length, 2, 'the next playback reuses replacement audio');
});

test('replacement 400 is recorded and stops after exactly one recommendation and retry', async () => {
  const { data, calls, runtime } = await setup();
  globalThis.risuai.nativeFetch = async (_url, options) => { calls.fish.push(JSON.parse(options.body)); return { ok: false, status: 400 }; };
  await assert.rejects(audio(runtime), /400/);
  assert.equal(calls.llm.length, 1);
  assert.deepEqual(calls.fish.map(body => body.reference_id), [failedId, nextId]);
  assert.equal(data.voices[2].error.status, 400);
  assert.equal(runtime.cache.count, 0);
});

test('non-400 failures and fixed or explicitly auditioned voices never request an automatic replacement', async () => {
  for (const variant of ['401', 'fixed', 'audition']) {
    const { data, calls, runtime } = await setup();
    if (variant === '401') globalThis.risuai.nativeFetch = async (_url, options) => { calls.fish.push(JSON.parse(options.body)); return { ok: false, status: 401 }; };
    if (variant === 'fixed') data.characters[0].fixed = true;
    const line = request();
    if (variant === 'audition') { line.segment.kind = 'audition'; line.fishId = failedId; }
    await assert.rejects(audio(runtime, line), /400|401/);
    assert.equal(calls.llm.length, 0, variant);
    assert.equal(calls.fish.length, 1, variant);
    assert.equal(data.characters[0].fishId, failedId, variant);
    assert.ok(saved.get('omnitts.data').voices[0].error, variant);
  }
});

test('a failed recommendation keeps the rejected preset error and the previous character selection', async () => {
  const { data, calls, runtime } = await setup();
  globalThis.risuai.runLLMModel = async () => ({ success: true, content: '{"0":[999]}' });
  await assert.rejects(audio(runtime), /유효한 음성 추천/);
  assert.equal(calls.fish.length, 1);
  assert.equal(data.characters[0].fishId, failedId);
  assert.equal(saved.get('omnitts.data').voices[0].error.status, 400);
});

test('cancel, settings change, character edit or deletion while LLM runs cannot overwrite a newer choice', async () => {
  for (const variant of ['cancel', 'settings', 'character', 'delete']) {
    const { data, calls, runtime } = await setup();
    const started = deferred(), finish = deferred(); let valid = true;
    globalThis.risuai.runLLMModel = async () => { started.resolve(); await finish.promise; return { success: true, content: '{"0":[1]}' }; };
    const playing = audio(runtime, request(), () => valid);
    await started.promise;
    if (variant === 'cancel') valid = false;
    if (variant === 'settings') data.settings.fish.model = 'changed-model';
    if (variant === 'character') data.characters[0].tags.push('사용자 수정');
    if (variant === 'delete') data.characters = [];
    finish.resolve();
    await assert.rejects(playing, /400/);
    assert.equal(calls.fish.length, 1, variant);
    assert.equal(data.characters[0]?.fishId, variant === 'delete' ? undefined : failedId, variant);
  }
});

test('concurrent lines share one recommendation and remain valid when the first requester cancels', async () => {
  const { data, calls, runtime } = await setup();
  const started = deferred(), finish = deferred(); let firstValid = true;
  globalThis.risuai.runLLMModel = async options => { calls.llm.push(JSON.parse(options.messages.at(-1).content)); started.resolve(); await finish.promise; return { success: true, content: '{"0":[1]}' }; };
  const first = audio(runtime, request('첫번째 문장입니다.'), () => firstValid).then(() => 'ok', error => error.message);
  await started.promise;
  const second = audio(runtime, request('두번째 문장입니다.'));
  // Wait until both failures have joined the shared selection.
  while (data.voices[0].error.count < 2) await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  firstValid = false; finish.resolve();
  assert.match(await first, /400/);
  assert.equal((await second).byteLength, 32);
  assert.equal(calls.llm.length, 1);
  assert.equal(data.characters[0].fishId, nextId);
  assert.equal(calls.fish.filter(body => body.reference_id === nextId).length, 1);
});

test('a late failure from another already prepared line reuses the applied recommendation', async () => {
  const { calls, runtime } = await setup();
  const [first, late] = await runtime.prepare([request('먼저 완료될 문장입니다.'), request('늦게 도착할 문장입니다.')], () => true);
  await runtime.audio(first, 0, () => true);
  await runtime.audio(late, 0, () => true);
  assert.equal(calls.llm.length, 1);
  assert.deepEqual(calls.fish.map(body => body.reference_id), [failedId, nextId, failedId, nextId]);
});

test('a foreground reader sharing background synthesis can recover after the background intent expires', async () => {
  const { calls, runtime } = await setup();
  const started = deferred(), finish = deferred(); let backgroundValid = true;
  const original = globalThis.risuai.nativeFetch;
  globalThis.risuai.nativeFetch = async (url, options) => { if (JSON.parse(options.body).reference_id === failedId) { started.resolve(); await finish.promise; } return original(url, options); };
  const background = audio(runtime, request(), () => backgroundValid).then(() => 'ok', error => error.message);
  await started.promise;
  const foreground = audio(runtime);
  await new Promise(resolve => setImmediate(resolve));
  backgroundValid = false; finish.resolve();
  assert.equal((await foreground).byteLength, 32);
  assert.match(await background, /400/);
  assert.equal(calls.llm.length, 1);
  assert.equal(calls.fish.length, 2);
});

test('characters sharing identical failed synthesis receive their own replacements without occupying a Fish slot during recovery', { timeout: 2000 }, async () => {
  const { data, calls, runtime } = await setup();
  const otherId = '33333333333333333333333333333333';
  data.voices.push({ key: 'other', name: '다른 대체 음성', fishId: otherId, tags: ['female'], gender: 'female', folder: '' });
  data.characters.push({ ...api.blankTtsCharacter('global', '소라'), gender: 'female', voiceKey: 'failed', fishId: failedId });
  runtime.queue.configure(1, 1);
  const started = deferred(), finish = deferred();
  globalThis.risuai.nativeFetch = async (_url, options) => {
    const body = JSON.parse(options.body); calls.fish.push(body);
    if (body.reference_id === failedId) { started.resolve(); await finish.promise; return { ok: false, status: 400 }; }
    return { ok: true, data: new Uint8Array(32).fill(body.reference_id === nextId ? 2 : 3) };
  };
  globalThis.risuai.runLLMModel = async options => {
    const input = JSON.parse(options.messages.at(-1).content); calls.llm.push(input);
    return { success: true, content: JSON.stringify({ 0: [input.characters[0][1] === '하린' ? 1 : 2] }) };
  };
  const first = audio(runtime);
  await started.promise;
  const secondRequest = request(); secondRequest.segment.speaker = '소라';
  const second = audio(runtime, secondRequest);
  await new Promise(resolve => setImmediate(resolve)); finish.resolve();
  const [firstBytes, secondBytes] = await Promise.all([first, second]);
  assert.deepEqual(data.characters.map(row => row.fishId), [nextId, otherId]);
  assert.equal(new Uint8Array(firstBytes)[0], 2);
  assert.equal(new Uint8Array(secondBytes)[0], 3);
  assert.equal(calls.fish.filter(body => body.reference_id === failedId).length, 1, 'original paid synthesis stays shared');
  assert.equal(calls.llm.length, 2, 'each character gets a recommendation based on their own traits');
});

test('cancelled first character cannot prevent a second character sharing its failed synthesis from recovering', async () => {
  const { data, calls, runtime } = await setup();
  data.characters.push({ ...api.blankTtsCharacter('global', '소라'), gender: 'female', voiceKey: 'failed', fishId: failedId });
  const started = deferred(), finish = deferred(); let firstValid = true;
  const original = globalThis.risuai.nativeFetch;
  globalThis.risuai.nativeFetch = async (url, options) => { if (JSON.parse(options.body).reference_id === failedId) { started.resolve(); await finish.promise; } return original(url, options); };
  const first = audio(runtime, request(), () => firstValid).then(() => 'ok', error => error.message);
  await started.promise;
  const secondRequest = request(); secondRequest.segment.speaker = '소라';
  const second = audio(runtime, secondRequest);
  await new Promise(resolve => setImmediate(resolve)); firstValid = false; finish.resolve();
  assert.match(await first, /400/);
  assert.equal((await second).byteLength, 32);
  assert.deepEqual(data.characters.map(row => row.fishId), [failedId, nextId]);
  assert.equal(calls.fish.length, 2);
  assert.equal(calls.llm.length, 1);
  assert.equal(calls.llm[0].characters[0][1], '소라');
});

test('narration and monologue lines use their role cards, with the card speed and the bot card when it stops following', async () => {
  const { data, calls, runtime } = await setup();
  const cards = api.ensureTtsRoleCards(data.characters, 'global', data.voices, 'next');
  data.characters = cards;
  const narrator = cards.find(c => c.role === 'narrator'), monologue = cards.find(c => c.role === 'monologue');
  assert.equal(narrator.fishId, nextId, 'the old narration voice setting seeds the global narrator card');
  monologue.fishId = failedId; monologue.voiceKey = 'failed'; monologue.rate = 1.5;
  const say = (kind, extra = {}) => ({ context, messageId: kind + JSON.stringify(extra), segment: { id: '1', kind, speaker: '', tone: '', text: '혼자 중얼거렸다', start: 0, end: 5, ...extra } });
  const [spoken] = await runtime.prepare([say('dialogue', { monologue: true })], () => true);
  assert.equal(spoken.fishId, failedId); assert.equal(spoken.rate, 1.5);
  const [told] = await runtime.prepare([say('narration')], () => true);
  assert.equal(told.fishId, nextId); assert.equal(told.rate, undefined);
  // This bot's own pair takes over only once following is switched off.
  data.characters = api.ensureTtsRoleCards(data.characters, 'bot:x', data.voices);
  const own = data.characters.find(c => c.role === 'narrator' && c.scope === 'bot:x'); own.fishId = failedId; own.voiceKey = 'failed';
  const bot = { ...context, rosterScope: 'bot:x' }, line = { ...say('narration'), context: bot };
  assert.equal((await runtime.prepare([line], () => true))[0].fishId, nextId, 'following the global card');
  own.followGlobal = false;
  assert.equal((await runtime.prepare([line], () => true))[0].fishId, failedId, 'its own card once switched off');
  // A role card that follows an ordinary character is voiced by that character.
  const lead = { ...api.blankTtsCharacter('global', '지젤'), voiceKey: 'next', fishId: nextId, gain: 2 };
  data.characters.push(lead); monologue.followId = lead.id;
  const [borrowed] = await runtime.prepare([say('dialogue', { monologue: true })], () => true);
  assert.equal(borrowed.fishId, nextId, 'the followed character voice is what plays'); assert.equal(borrowed.gain, 2);
  api.deleteTtsCharacters(api.ttsData().characters.filter(c => c.role));
  assert.equal(api.ttsData().characters.filter(c => c.role).length, 4, 'role cards cannot be deleted');
  assert.equal(calls.fish.length, 0);
});
