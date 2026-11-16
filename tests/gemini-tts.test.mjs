import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';

// Gemini TTS: by an AI Studio key or a Vertex AI service account (a JWT signed here, traded for a token). The 3.8
// models take `voiceConfig.voice` and `speech_metadata.style`; older ones `prebuiltVoiceConfig.voiceName` and a
// style written before the line. A WAV answer is played as it comes; raw PCM gets a header.
const built = await build({ stdin: { contents: "export * from './src/providers/tts/gemini';export * from './src/domain/tts/gemini-voices';export {normalizeTtsSettings} from './src/storage/tts-store';export {ttsDefaults} from './src/config/tts-defaults';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

const pcm = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const b64 = bytes => Buffer.from(bytes).toString('base64');
const answerWith = (data, mimeType) => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }] });
/** Risu's nativeFetch, answering each call by `reply(url, init)` and keeping what was asked. */
function host(reply) {
  const calls = [];
  globalThis.risuai = { nativeFetch: async (url, init) => { calls.push({ url, init, body: typeof init.body === 'string' ? init.body : '' }); const r = await reply(url, init, calls.length); return { ok: r.status < 400, status: r.status, json: async () => r.json }; } };
  return calls;
}
const settings = gemini => ({ gemini: { ...api.ttsDefaults().gemini, ...gemini } });

test('the request shape follows the model: 3.8 and after take voice and speech_metadata.style, older ones prebuiltVoiceConfig and a written style', () => {
  assert.equal(api.geminiNewShape('gemini-3.8-flash-tts'), true);
  assert.equal(api.geminiNewShape('gemini-4.0-flash-tts'), true);
  assert.equal(api.geminiNewShape('gemini-3.1-flash-tts-preview'), false);
  assert.equal(api.geminiNewShape('gemini-2.5-flash-preview-tts'), false);
  assert.deepEqual(api.geminiBody('안녕', 'cheerful', 'Kore', true), { contents: [{ role: 'user', parts: [{ text: '안녕', speech_metadata: { style: 'cheerful' } }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: 'Kore' } } } });
  assert.deepEqual(api.geminiBody('안녕', 'cheerful', 'Kore', false).generationConfig.speechConfig, { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } });
  assert.equal(api.geminiBody('안녕', 'cheerful', 'Kore', false).contents[0].parts[0].text, 'Say cheerful: 안녕');
  assert.deepEqual(api.geminiBody('안녕', '', 'Kore', true).contents[0].parts[0], { text: '안녕' }, 'no style, no metadata');
});

test('a WAV answer is played as it comes; raw PCM gets a 44-byte header at its rate', () => {
  const wav = api.wavOf(pcm, 24000);
  assert.deepEqual(new Uint8Array(api.geminiAudio(answerWith(b64(new Uint8Array(wav)), 'audio/wav'))), new Uint8Array(wav));
  const made = new DataView(api.geminiAudio(answerWith(b64(pcm), 'audio/L16;codec=pcm;rate=16000')));
  assert.equal(made.byteLength, 44 + pcm.length);
  assert.equal(String.fromCharCode(made.getUint8(0), made.getUint8(1), made.getUint8(2), made.getUint8(3)), 'RIFF');
  assert.equal(made.getUint32(24, true), 16000, 'its rate');
  assert.equal(made.getUint16(34, true), 16, '16-bit');
  assert.throws(() => api.geminiAudio({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }), /SAFETY/);
});

test('AI Studio: the key in its header, the model in the path; a shape refused as malformed is tried once in the other', async () => {
  const calls = host((url, init, n) => n === 1 ? { status: 400, json: { error: { message: 'Unknown name "voice"' } } } : { status: 200, json: answerWith(b64(pcm), 'audio/L16;rate=24000') });
  const audio = await api.synthesizeGemini('안녕하세요', 'whispering', '', settings({ key: 'AIza-test' }));
  assert.equal(audio.byteLength, 44 + pcm.length);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent');
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'AIza-test');
  assert.deepEqual(JSON.parse(calls[0].body).generationConfig.speechConfig, { voiceConfig: { voice: 'Kore' } }, 'the default voice, the new shape first');
  assert.deepEqual(JSON.parse(calls[1].body).generationConfig.speechConfig, { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }, 'then the other');
  delete globalThis.risuai;
});

test('Vertex: a JWT signed with the service account key is traded for a token, which is reused; the project and region are in the path', async () => {
  const keys = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64').match(/.{1,64}/g).join('\n');
  const account = JSON.stringify({ type: 'service_account', project_id: 'my-proj', client_email: 'tts@my-proj.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n`, token_uri: 'https://oauth2.googleapis.com/token' });
  assert.equal(api.parseServiceAccount('{"type":"x"}'), null);
  assert.equal(api.parseServiceAccount(account).project_id, 'my-proj');
  const calls = host(url => url.startsWith('https://oauth2') ? { status: 200, json: { access_token: 'ya29.token', expires_in: 3599 } } : { status: 200, json: answerWith(b64(new Uint8Array(api.wavOf(pcm))), 'audio/wav') });
  const s = settings({ via: 'vertex', serviceAccountJson: account, location: 'us-central1', model: 'gemini-2.5-flash-preview-tts' });
  assert.equal(api.geminiReady(s), true);
  await api.synthesizeGemini('안녕', '', 'Puck', s);
  await api.synthesizeGemini('또 안녕', '', 'Puck', s);
  const trades = calls.filter(c => c.url === 'https://oauth2.googleapis.com/token');
  assert.equal(trades.length, 1, 'one token for both lines');
  const form = new URLSearchParams(trades[0].body), [head, claims, signature] = form.get('assertion').split('.');
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const claim = JSON.parse(Buffer.from(claims, 'base64url').toString());
  assert.deepEqual([claim.iss, claim.scope, claim.aud], ['tts@my-proj.iam.gserviceaccount.com', 'https://www.googleapis.com/auth/cloud-platform', 'https://oauth2.googleapis.com/token']);
  assert.equal(await webcrypto.subtle.verify('RSASSA-PKCS1-v1_5', keys.publicKey, Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${head}.${claims}`)), true, 'signed with the account\'s key');
  const speech = calls.filter(c => c.url.includes('aiplatform'));
  assert.equal(speech[0].url, 'https://us-central1-aiplatform.googleapis.com/v1/projects/my-proj/locations/us-central1/publishers/google/models/gemini-2.5-flash-preview-tts:generateContent');
  assert.equal(speech[0].init.headers.Authorization, 'Bearer ya29.token');
  assert.deepEqual(JSON.parse(speech[0].body).generationConfig.speechConfig, { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }, '2.5: the older shape first');
  delete globalThis.risuai;
});

test('the voice list (AI Studio): its rows as presets, every page read; Vertex is told it reads the prebuilt ones', async () => {
  const calls = host((url, init, n) => ({ status: 200, json: n === 1 ? { voices: [{ id: 'voice_abc', display_name: '내 목소리', gender: 'FEMALE', description: 'calm, low', language_code: 'ko-KR' }], next_page_token: 'p2' } : { voices: [{ name: 'voices/Leda', displayName: 'Leda', gender: 'female' }] } }));
  const voices = await api.listGeminiVoices(settings({ key: 'AIza-test' }), 'ko');
  assert.deepEqual(voices.map(v => [v.key, v.fishId, v.gender]), [['gemini:voice_abc', 'voice_abc', 'female'], ['gemini:Leda', 'Leda', 'female']]);
  assert.deepEqual(voices[0].languages, ['ko']);
  assert.match(calls[0].url, /\/v1beta\/voices\?page_size=1000&language_code=ko$/);
  assert.match(calls[1].url, /page_token=p2/);
  await assert.rejects(api.listGeminiVoices(settings({ via: 'vertex' })), /AI Studio 키로만/);
  delete globalThis.risuai;
});

test('settings: Gemini is an engine of its own; its fields fall back to their defaults; the prebuilt voices are presets', () => {
  const s = api.normalizeTtsSettings({ engine: 'gemini', gemini: { via: 'nope', concurrency: 99 } });
  assert.equal(s.engine, 'gemini');
  assert.equal(s.gemini.via, 'studio');
  assert.equal(s.gemini.concurrency, 5);
  assert.equal(s.gemini.model, 'gemini-3.8-flash-tts');
  assert.equal(api.normalizeTtsSettings({ engine: 'other' }).engine, 'fish');
  const voices = api.geminiPrebuiltVoices();
  assert.equal(voices.length, 30);
  assert.deepEqual(voices.find(v => v.fishId === 'Kore'), { key: 'gemini:Kore', name: 'Kore · 단단한', fishId: 'Kore', tags: ['단단한', 'firm'], gender: 'female', folder: '' });
});
