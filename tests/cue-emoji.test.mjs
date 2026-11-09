import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/domain/tts/cue-emoji';export {parseTtsMessage} from './src/domain/tts/segment';export {ttsCuePrompt,TTS_CUE_PROMPT,ttsModule} from './src/domain/tts/module';export {ttsDefaults} from './src/config/tts-defaults';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

test('첫 대사 이모지: age-gender then personality, read into a gender and the sample voices\' own tags', () => {
  assert.deepEqual(api.cueHint('👩🥺'), { gender: 'female', tags: ['청년', '소심한', '부드러운'] });
  assert.deepEqual(api.cueHint('👦😤'), { gender: 'male', tags: ['어린이', '츤데레', '툴툴대는'] });
  // Mature and elderly are both 중년 in the voice library, told apart by 성숙한 and 노인.
  assert.deepEqual(api.cueHint('👴'), { gender: 'male', tags: ['중년', '노인'] });
  assert.deepEqual(api.cueHint('🧓'), { tags: ['중년', '노인'] });
  assert.deepEqual(api.cueHint('👨‍🦰'), { gender: 'male', tags: ['중년', '성숙한'] }, 'red hair on a grown-up: mature');
  assert.deepEqual(api.cueHint('👩‍🦰🍷'), { gender: 'female', tags: ['중년', '성숙한', '우아한'] }, "🍷's 성숙한 once");
  assert.deepEqual(api.cueHint('👵😊'), { gender: 'female', tags: ['중년', '노인', '밝은', '친근한'] });
  // The other way round, a skin tone, a ZWJ sequence: still the same person.
  assert.deepEqual(api.cueHint('🥺👩'), { gender: 'female', tags: ['청년', '소심한', '부드러운'] });
  assert.deepEqual(api.cueHint('👩🏻😎'), { gender: 'female', tags: ['청년', '쿨함', '자신감 있는'] });
  assert.deepEqual(api.cueHint('👩‍🦳'), { gender: 'female', tags: ['중년', '노인'] }, 'white hair: elderly');
  assert.deepEqual(api.cueHint('👱‍♂️'), { gender: 'male', tags: ['청년'] }, 'the sign says who');
  // No gender to say: the age alone.
  assert.deepEqual(api.cueHint('🧑🤓'), { tags: ['청년', '지적인'] });
  // Personality alone, or emoji the table does not know.
  assert.deepEqual(api.cueHint('😏'), { tags: ['장난기 있는', '여유로운'] });
  assert.deepEqual(api.cueHint('🧑‍🚀'), { tags: ['청년'] }, 'a person in a ZWJ sequence: their age');
  assert.equal(api.cueHint(''), null);
  assert.equal(api.cueHint('🚀🛸'), null);
  assert.equal(api.cueHint(undefined), null);
});

test('a hint fills a new character outright, and only the gaps of one the reader already has', () => {
  const fresh = { gender: 'unknown', tags: ['차분함'] };
  assert.equal(api.applyCueHint(fresh, { gender: 'female', tags: ['청년', '소심한'] }, true), true);
  assert.deepEqual(fresh, { gender: 'female', tags: ['청년', '소심한', '차분함'] });
  const told = { gender: 'male', tags: [] };
  api.applyCueHint(told, { gender: 'female', tags: ['청년'] }, true);
  assert.equal(told.gender, 'female', 'a new one: the writer said so');
  const kept = { gender: 'male', tags: ['깊은'] };
  assert.equal(api.applyCueHint(kept, { gender: 'female', tags: ['청년'] }, false), false, 'the reader\'s own stays');
  const gaps = { gender: 'unknown', tags: [] };
  api.applyCueHint(gaps, { gender: 'female', tags: ['청년', '소심한'] }, false);
  assert.deepEqual(gaps, { gender: 'female', tags: ['청년', '소심한'] });
});

test('the cue keeps the emoji it opened with; the name is the name', () => {
  const [line] = api.parseTtsMessage('👩🥺 하린 (soft tone): "안녕."');
  assert.equal(line.speaker, '하린');
  assert.equal(line.marks, '👩🥺');
  assert.equal(line.text, '안녕.');
  const [next] = api.parseTtsMessage('👦 Sora:\n“Hello.”');
  assert.equal(next.marks, '👦', 'a cue whose quotation is on the next line too');
  const [worn] = api.parseTtsMessage('👩 하린_2 (calm): "옷 갈아입었어."');
  assert.equal(worn.costume, 2); assert.equal(worn.marks, '👩');
  const [plain] = api.parseTtsMessage('하린 (calm): "그냥."');
  assert.equal('marks' in plain, false, 'none written, none kept');
});

test('the cue prompt asks for the emoji only with the switch on, and stays short', () => {
  const off = api.ttsModule({ ...api.ttsDefaults() }).lorebook[0].content;
  const on = api.ttsModule({ ...api.ttsDefaults(), cueEmoji: true }).lorebook[0].content;
  assert.equal(off, api.TTS_CUE_PROMPT);
  assert.doesNotMatch(off, /emoji/);
  assert.match(on, /Each character's first cue in every reply starts with two emoji/);
  assert.match(on, /Their later cues in that reply have none/);
  assert.doesNotMatch(on, /in the story/, 'never "first in the story": the model cannot know that');
  assert.match(on, /👧 girl, 👦 boy: elementary school age or younger only; 👩 woman, 👨 man: middle schooler to young adult, students included; 👩‍🦰, 👨‍🦰: mature, 30s-40s; 👵, 👴: elderly/);
  assert.ok(on.startsWith(off.replace('\n</OmniTTS>', '')), 'the same rules, one line more');
  // It goes with every reply: 1261 characters before it was cut down. A rule added back should earn its words.
  assert.ok(off.length <= 760, `the cue prompt grew to ${off.length} characters`);
});
