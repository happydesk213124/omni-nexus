import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// 대사 중간 감정 태그: the voice is written into the line as English [tags] where it changes; the cue's parentheses
// only choose the 감정 에셋 face. Fish takes the tags as they are, Gemini in angle brackets; nobody sees them.
const built = await build({ stdin: { contents: "export * from './src/domain/tts/voice-tags';export {ttsComparable} from './src/domain/tts/anchors';export {ttsModule,ttsCuePrompt,TTS_CUE_PROMPT} from './src/domain/tts/module';export {ttsDefaults} from './src/config/tts-defaults';export {normalizeTtsSettings} from './src/storage/tts-store';export {synthesizeSpeech} from './src/providers/tts/speech';export {translateTts} from './src/providers/tts/translation';export {buildScenes} from './src/domain/viewer/scenes';export {parseTtsMessage} from './src/domain/tts/segment';export {TTS_DISPLAY_ORDER} from './src/domain/tts/module';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

const LINE = '[sad] 괜찮아… [sobbing] 정말 [속마음] (작게) 진짜라니까 [giggle].';
const module = extra => api.ttsModule({ hideName: false, hideTone: false, narration: true, illustration: false, passageLine: true, ...extra });
const toJapanese = { ...api.ttsDefaults().translation, provider: 'google-free', language: 'ja' };

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
  // Tags written in Japanese (the translation goes there) keep theirs too; Korean in brackets is still the story's.
  assert.equal(api.spokenWithVoiceTags('[ため息] 大丈夫 [sobbing] [속마음] [すすり泣き]', '[, ]', 'ja'), '[ため息] 大丈夫 [sobbing] 속마음 [すすり泣き]');
  assert.equal(api.geminiVoiceTags('[ため息] 大丈夫', 'ja'), '<ため息> 大丈夫');
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
  assert.match(on, /Voice tags: short English words in square brackets, only inside the quotes \(never by the name or outside the quotes\), right where a feeling, a way of speaking or a sound comes or changes, mid-sentence too\./);
  assert.match(on, /vary them, never the same few every line/);
  for (const kind of ['feelings: sad,', 'speaking: whispering,', 'sounds: sigh,', 'pauses: short pause']) assert.ok(on.includes(kind), kind);
  assert.match(on, /\[whispering\] Ah, hnn… M-Minsu…\? \[short pause\] \[nervous laugh\]/, 'the example changes its delivery midway');
  assert.doesNotMatch(on, /none if plain/, 'no leave to skip them');
  assert.ok(on.length <= 1500, `the entry rides every request: ${on.length} characters`);
  // The TTS translation going to Japanese: tags in Japanese, which the translation service leaves alone.
  const ja = module({ inlineTags: true, engine: 'fish', translation: toJapanese }).lorebook[0].content;
  assert.match(ja, /Voice tags: short Japanese words/);
  assert.match(ja, /\[ささやき声で\] Ah, hnn… M-Minsu…\? \[短い間\] \[苦笑い\]/);
  assert.ok(ja.includes('すすり泣き') && !ja.includes('nervous laugh'));
  assert.equal(module({ inlineTags: true, engine: 'fish', translation: { ...toJapanese, provider: 'off' } }).lorebook[0].content, on, 'translation off: English');
  assert.equal(module({ inlineTags: true, engine: 'fish', translation: { ...toJapanese, language: 'en' } }).lorebook[0].content, on);
  assert.equal(api.voiceTagLanguage({ translation: { ...toJapanese, language: '日本語' } }), 'ja');
  assert.doesNotMatch(on, /Fish Audio cue/);
  assert.equal(module({ inlineTags: true, engine: 'gemini' }).lorebook[0].content, on);
  assert.equal(module({ inlineTags: false, engine: 'fish' }).lorebook[0].content, api.TTS_CUE_PROMPT, 'off: as before');
  assert.equal(module({ inlineTags: true, engine: 'irodori' }).lorebook[0].content, api.ttsCuePrompt(false, 'irodori'));
  assert.match(module({ inlineTags: true, engine: 'fish', cueEmoji: true }).lorebook[0].content, /👩🥺 Harin \(shy\): "Hi\."/);
});

test('the chat never shows a tag on a line it reads, slipped ones too; Korean brackets and lines without a control stay', () => {
  const rule = module({ inlineTags: true, engine: 'fish' }).regex.find(r => r.comment === 'omnitts-hide-voice-tags');
  assert.ok(rule, 'the rule is there when the switch is on');
  const hide = text => text.replace(new RegExp(rule.in, 'gu'), rule.out);
  const control = '<button data-omnitts-kind="dialogue"></button>';
  assert.equal(hide(`하린 (sad): "[sad] 괜찮아… [sobbing] 정말 [giggle]."${control}`), `하린 (sad): "괜찮아… 정말."${control}`);
  assert.equal(hide(`하린 (sad): "[속마음] 응"${control}`), `하린 (sad): "[속마음] 응"${control}`);
  assert.equal(hide(`하린 (sad): [sigh] "응."${control}`), `하린 (sad): "응."${control}`, 'before the quote');
  assert.equal(hide(`하린 (sad): "응." [sigh]${control}`), `하린 (sad): "응."${control}`, 'after the quote');
  assert.equal(hide('[sigh] 하린은 고개를 숙였다.<button data-omnitts-kind="narration"></button>'), '하린은 고개를 숙였다.<button data-omnitts-kind="narration"></button>', 'a narration line read with its tag');
  assert.equal(hide('[sigh] 코드 블록 안'), '[sigh] 코드 블록 안', 'no control on the line: not ours');
  assert.ok(api.TTS_DISPLAY_ORDER.voiceTags > api.TTS_DISPLAY_ORDER.hideTone, 'it runs before the name and delivery are hidden (lower runs later)');
  assert.ok(api.TTS_DISPLAY_ORDER.voiceTags < api.TTS_DISPLAY_ORDER.dialogue && api.TTS_DISPLAY_ORDER.voiceTags < api.TTS_DISPLAY_ORDER.narration, 'and after the controls are there');
  // Japanese tags only when the tags are written in Japanese.
  const jaRule = module({ inlineTags: true, engine: 'fish', translation: toJapanese }).regex.find(r => r.comment === 'omnitts-hide-voice-tags');
  assert.equal(`하린 (sad): "[ため息] 응 [すすり泣き]."${control}`.replace(new RegExp(jaRule.in, 'gu'), ''), `하린 (sad): "응."${control}`);
  assert.equal(hide(`하린 (sad): "[メモ] 응"${control}`), `하린 (sad): "[メモ] 응"${control}`);
  assert.equal(module({ inlineTags: false, engine: 'fish' }).regex.find(r => r.comment === 'omnitts-hide-voice-tags'), undefined);
  assert.equal(module({ inlineTags: true, engine: 'irodori' }).regex.find(r => r.comment === 'omnitts-hide-voice-tags'), undefined);
});

test('a dialogue line ending in a slipped tag still gets its control', () => {
  const rule = module({ inlineTags: true, engine: 'fish', excludeText: '' }).regex.find(r => r.comment === 'omnitts-dialogue');
  const run = text => text.replace(new RegExp(rule.in, 'gu'), rule.out);
  assert.match(run('하린 (sad): "응." [sigh]'), /data-omnitts-kind="dialogue"/);
  const off = module({ inlineTags: false, engine: 'fish', excludeText: '' }).regex.find(r => r.comment === 'omnitts-dialogue');
  assert.doesNotMatch('하린 (sad): "응." [sigh]'.replace(new RegExp(off.in, 'gu'), off.out), /data-omnitts-kind="dialogue"/, 'off: as before');
});

test('tags a model slipped outside the quotes are read inside them, and one by the name is the face', () => {
  const parsed = line => api.parseTtsMessage(line).map(s => ({ kind: s.kind, speaker: s.speaker, tone: s.tone, text: s.text }));
  assert.deepEqual(parsed('하린 (sad): [sigh] "괜찮아."'), [{ kind: 'dialogue', speaker: '하린', tone: 'sad', text: '[sigh] 괜찮아.' }]);
  assert.deepEqual(parsed('하린 (sad): "괜찮아." [sigh]'), [{ kind: 'dialogue', speaker: '하린', tone: 'sad', text: '괜찮아. [sigh]' }]);
  assert.deepEqual(parsed('하린 [sad]: "괜찮아."'), [{ kind: 'dialogue', speaker: '하린', tone: 'sad', text: '괜찮아.' }]);
  assert.deepEqual(parsed('하린 (sad): [ため息] "괜찮아." [すすり泣き]'), [{ kind: 'dialogue', speaker: '하린', tone: 'sad', text: '[ため息] 괜찮아. [すすり泣き]' }]);
  // Only characters move: a line keeps its length, so every offset into the message holds.
  for (const line of ['하린 (sad): [sigh] "괜찮아."', '하린 (sad): "괜찮아." [sigh]', '하린 [sad]: "괜찮아."']) assert.equal(api.settleVoiceTags(line).length, line.length);
  assert.equal(api.settleVoiceTags('[System] 하린: "응."'), '[System] 하린: "응."', 'a bracket before the name is not the name\'s');
  assert.equal(api.settleVoiceTags('하린 (sad): "[sad] 응."'), '하린 (sad): "[sad] 응."', 'written right: untouched');
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

test('a translation service keeps the tags already in its target language and drops the rest', () => {
  const line = '[ため息] 괜찮아 [sobbing] 정말 [속마음]';
  assert.equal(api.voiceTagsForTarget(line, 'ja', 'ja'), '[ため息] 괜찮아 정말 [속마음]', 'into Japanese: the Japanese tag stays');
  assert.equal(api.voiceTagsForTarget(line, 'ja', 'en'), '괜찮아 [sobbing] 정말 [속마음]', 'into English: the English one');
  assert.equal(api.voiceTagsForTarget(line, 'ja', 'zh'), '괜찮아 정말 [속마음]', 'anything else: none');
  assert.equal(api.voiceTagsForTarget('[sad] 응 [ため息]', 'en', 'ja'), '응 [ため息]', 'English tags into Japanese go; a Japanese bracket is not a tag in English mode');
});

test('translation: a translation service is sent the line without the tags it would make words of', async () => {
  const calls = host([['괜찮아', 0]]);
  globalThis.risuai.nativeFetch = async (url, init) => { calls.push({ url, body: String(init.body) }); return { ok: true, status: 200, json: async () => [[['大丈夫', '괜찮아']]] }; };
  const settings = { ...api.ttsDefaults(), engine: 'fish', translation: { ...api.ttsDefaults().translation, provider: 'google-free', language: 'ja' } };
  await api.translateTts([{ id: '1', speaker: '하린', tone: 'sad', text: '[sad] 괜찮아 [sobbing]', kind: 'dialogue', start: 0, end: 1 }], settings);
  const asked = decodeURIComponent(new URL(calls[0].url).searchParams.get('q'));
  assert.equal(asked, '괜찮아');
});
