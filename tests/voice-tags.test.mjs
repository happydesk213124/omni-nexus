import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// 대사 중간 감정 태그: the voice is written into the line as English [tags] where it changes; the cue's parentheses
// only choose the 감정 에셋 face. Fish takes the tags as they are, Gemini in angle brackets; nobody sees them.
const built = await build({ stdin: { contents: "export * from './src/domain/tts/voice-tags';export {ttsComparable} from './src/domain/tts/anchors';export {ttsModule,ttsCuePrompt,TTS_CUE_PROMPT} from './src/domain/tts/module';export {ttsDefaults} from './src/config/tts-defaults';export {normalizeTtsSettings} from './src/storage/tts-store';export {synthesizeSpeech} from './src/providers/tts/speech';export {translateTts} from './src/providers/tts/translation';export {buildScenes} from './src/domain/viewer/scenes';export {parseTtsMessage} from './src/domain/tts/segment';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

const LINE = '[sad] 괜찮아… [sobbing] 정말 [속마음] (작게) 진짜라니까 [giggle].';
const module = extra => api.ttsModule({ hideName: false, hideTone: false, narration: true, illustration: false, passageLine: true, ...extra });

test('on by default, for Fish and Gemini only, and an older save takes the default', () => {
  assert.equal(api.ttsDefaults().inlineTags, true);
  assert.equal(api.normalizeTtsSettings({}).inlineTags, true);
  assert.equal(api.normalizeTtsSettings({ inlineTags: false }).inlineTags, false);
  assert.equal(api.voiceTagsOn({ inlineTags: true, engine: 'fish' }), true);
  assert.equal(api.voiceTagsOn({ inlineTags: true, engine: 'gemini' }), true);
  assert.equal(api.voiceTagsOn({ inlineTags: true, engine: 'irodori' }), false, 'Irodori keeps its voice emoji');
  assert.equal(api.voiceTagsOn({ inlineTags: false, engine: 'fish' }), false);
});

test('an English [tag] keeps its brackets past 「생략할 문자들」; brackets holding other letters are read as before', () => {
  assert.equal(api.spokenWithVoiceTags(LINE, '[, ], (, )'), '[sad] 괜찮아… [sobbing] 정말 속마음 작게 진짜라니까 [giggle].');
  // Whatever the model makes up, as long as it is English.
  assert.equal(api.spokenWithVoiceTags('[whispering in a small voice] 응', '[, ]'), '[whispering in a small voice] 응');
  assert.equal(api.spokenWithVoiceTags('【메모】 [メモ] 안녕', '[, ], 【, 】'), '메모 メモ 안녕');
  assert.equal(api.spokenWithVoiceTags('[sad] 응', ''), '[sad] 응', 'nothing omitted, nothing changed');
});

test('shown and translated without them; Gemini gets them in angle brackets', () => {
  assert.equal(api.withoutVoiceTags(LINE), '괜찮아… 정말 [속마음] (작게) 진짜라니까.');
  assert.equal(api.geminiVoiceTags('[sad] 괜찮아 [sobbing] 정말 [giggle].'), '<sad> 괜찮아 <sobbing> 정말 <giggle>.');
  assert.equal(api.geminiVoiceTags('[속마음] 안녕'), '[속마음] 안녕');
  // A control finds its line by letters: the chat hides the tags, the source keeps them.
  assert.equal(api.ttsComparable(LINE), api.ttsComparable(api.withoutVoiceTags(LINE)));
});

test('the cue prompt: the parentheses are the face from the 감정 에셋 list, the voice goes in the line', () => {
  const on = module({ inlineTags: true, engine: 'fish' }).lorebook[0].content;
  assert.match(on, /Name \(face\): "Dialogue"/);
  assert.match(on, /Face: one of neutral, happy, laugh, sad, cry, angry, surprised, embarrassed, scared, smug, serious, tired, confused, love, disgust; neutral if plain\./);
  assert.match(on, /Voice tags go inside the quotes in English square brackets/);
  assert.match(on, /\[sad\] I'm fine… \[sobbing\] really\. \[happy\] No, I mean it \[giggle\]/, 'the example changes its feeling midway');
  assert.doesNotMatch(on, /Fish Audio cue/);
  assert.equal(module({ inlineTags: true, engine: 'gemini' }).lorebook[0].content, on);
  assert.equal(module({ inlineTags: false, engine: 'fish' }).lorebook[0].content, api.TTS_CUE_PROMPT, 'off: as before');
  assert.equal(module({ inlineTags: true, engine: 'irodori' }).lorebook[0].content, api.ttsCuePrompt(false, 'irodori'));
  assert.match(module({ inlineTags: true, engine: 'fish', cueEmoji: true }).lorebook[0].content, /👩🥺 Harin \(shy\): "Hi\."/);
});

test('the chat never shows a tag inside a dialogue quote; narration and other brackets stay', () => {
  const rule = module({ inlineTags: true, engine: 'fish' }).regex.find(r => r.comment === 'omnitts-hide-voice-tags');
  assert.ok(rule, 'the rule is there when the switch is on');
  const hide = text => text.replace(new RegExp(rule.in, 'g'), rule.out);
  const control = '<button data-omnitts-kind="dialogue"></button>';
  assert.equal(hide(`하린 (sad): "[sad] 괜찮아… [sobbing] 정말 [giggle]."${control}`), `하린 (sad): "괜찮아… 정말."${control}`);
  assert.equal(hide(`하린 (sad): "[속마음] 응"${control}`), `하린 (sad): "[속마음] 응"${control}`);
  assert.equal(hide('[System] 접속했다.<button data-omnitts-kind="narration"></button>'), '[System] 접속했다.<button data-omnitts-kind="narration"></button>');
  assert.equal(module({ inlineTags: false, engine: 'fish' }).regex.find(r => r.comment === 'omnitts-hide-voice-tags'), undefined);
  assert.equal(module({ inlineTags: true, engine: 'irodori' }).regex.find(r => r.comment === 'omnitts-hide-voice-tags'), undefined);
});

test('옴니 뷰어 shows the line without its tags and keeps the face from the parentheses', () => {
  const raw = '하린 (sad): "[sad] 괜찮아… [happy] 진짜라니까 [giggle]."';
  const [scene] = api.buildScenes(raw, api.parseTtsMessage(raw), {}, true);
  assert.equal(scene.text, '괜찮아… 진짜라니까.');
  assert.equal(scene.face, 'sad');
  assert.equal(api.buildScenes(raw, api.parseTtsMessage(raw))[0].text, '[sad] 괜찮아… [happy] 진짜라니까 [giggle].', 'off: as written');
});

/** Risu's nativeFetch, answering with `body` and keeping what was asked. */
function host(body) {
  const calls = [];
  globalThis.risuai = { nativeFetch: async (url, init) => { calls.push({ url, body: typeof init.body === 'string' ? init.body : '' }); return { ok: true, status: 200, json: async () => body, arrayBuffer: async () => new Uint8Array(64).buffer, headers: { get: () => 'audio/mpeg' } }; } };
  return calls;
}

test('Gemini is sent the tags in angle brackets just before the request; Fish as they are', async () => {
  const wav = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: Buffer.from(new Uint8Array(64)).toString('base64') } }] } }] };
  const settings = engine => ({ ...api.ttsDefaults(), engine, gemini: { ...api.ttsDefaults().gemini, key: 'k' }, fish: { ...api.ttsDefaults().fish, key: 'k' } });
  let calls = host(wav);
  await api.synthesizeSpeech('[sad] 괜찮아 [sobbing] 정말', '', 'Kore', settings('gemini'));
  assert.equal(JSON.parse(calls[0].body).contents[0].parts[0].text, '<sad> 괜찮아 <sobbing> 정말');
  calls = host(wav);
  await api.synthesizeSpeech('[sad] 괜찮아', '', 'Kore', { ...settings('gemini'), inlineTags: false });
  assert.equal(JSON.parse(calls[0].body).contents[0].parts[0].text, '[sad] 괜찮아', 'off: untouched');
  calls = host({});
  await api.synthesizeSpeech('[sad] 괜찮아 [sobbing] 정말', 'soft tone', '0123456789abcdef0123456789abcdef', settings('fish'));
  assert.equal(JSON.parse(calls[0].body).text, '[soft tone][sad] 괜찮아 [sobbing] 정말', "the card's base delivery first, then the line's own tags");
});

test('translation: a translation service is sent the line without the tags (it would make them words)', async () => {
  const calls = host([['괜찮아', 0]]);
  globalThis.risuai.nativeFetch = async (url, init) => { calls.push({ url, body: String(init.body) }); return { ok: true, status: 200, json: async () => [[['大丈夫', '괜찮아']]] }; };
  const settings = { ...api.ttsDefaults(), engine: 'fish', translation: { ...api.ttsDefaults().translation, provider: 'google-free', language: 'ja' } };
  await api.translateTts([{ id: '1', speaker: '하린', tone: 'sad', text: '[sad] 괜찮아 [sobbing]', kind: 'dialogue', start: 0, end: 1 }], settings);
  const asked = decodeURIComponent(new URL(calls[0].url).searchParams.get('q'));
  assert.equal(asked, '괜찮아');
});
