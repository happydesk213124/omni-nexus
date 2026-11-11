import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';

const built = await build({ stdin: { contents: `export * from './src/config/tts-defaults';export * from './src/providers/tts/selection';export * from './src/services/tts-characters';export * from './src/storage/tts-store';export * from './src/domain/tts/voice-words';export {cueEmojiWords} from './src/domain/tts/cue-emoji';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', logLevel: 'silent' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text + '\n//# sourceURL=voice-variety-check.mjs').toString('base64'));
const presets = JSON.parse(fs.readFileSync('src/config/tts-presets.json', 'utf8'));
const SHINOBU = '86de73e3231e4f139435cf4684833a07';
const woman = (key, tags = ['여성', '청년', '차분함'], fishId = 'a'.repeat(32)) => ({ key, name: key, fishId, tags, gender: 'female', folder: '' });
const her = (name, tags = ['청년', '차분함']) => { const c = api.blankTtsCharacter('bot:x', name); c.gender = 'female'; c.tags = tags; return c; };

// Every word the sample voices and the 첫 대사 이모지 table use goes out in English: one the table lacked would reach
// the embedding in Korean, a stranger to the English around it.
test('every sample-voice tag and every emoji word has its English; the words come back in Korean', () => {
  const words = new Set([...presets.flatMap(p => p.fine.split(',').map(t => t.trim())), ...api.cueEmojiWords()]);
  const missing = [...words].filter(word => api.englishVoiceWord(word) === word && !/\p{Extended_Pictographic}/u.test(word));
  assert.deepEqual(missing, []);
  assert.deepEqual(api.englishVoiceTags(['청년', '허스키', '숨소리 섞인', '내 태그']), ['young adult', 'husky', 'breathy', '내 태그'], 'one of the reader\'s own goes as written');
  for (const word of ['young adult', 'Husky', 'breathy']) assert.equal(api.englishVoiceWord(api.koreanVoiceWord(word)), word.toLowerCase());
  assert.equal(api.koreanVoiceWord('unknown-word'), 'unknown-word');
  assert.ok(api.VOICE_VOCABULARY.includes('teen') && !api.VOICE_VOCABULARY.includes('female'), 'gender is asked apart');
});

test('the sample voices: an English name each, one age of six and one pitch; a save still on the first tags moves on, an edited one stays', () => {
  const ages = ['어린이', '10대', '청년', '성인', '중년', '노인'], pitches = ['높음', '중간', '낮음'];
  for (const p of presets) {
    const tags = p.fine.split(',').map(t => t.trim());
    assert.ok(p.en && /[A-Za-z]/.test(p.en), p.name);
    assert.equal(tags.filter(t => ages.includes(t)).length, 1, `${p.name}: ${p.fine}`);
    assert.equal(tags.filter(t => pitches.includes(t)).length, 1, `${p.name}: ${p.fine}`);
  }
  assert.ok(presets.filter(p => p.fine.includes('청년')).length < 100, 'no longer 148 of 176 the same age');
  assert.equal(api.presetVoiceEnglishName(SHINOBU.toUpperCase()), 'Shinobu Kocho (Demon Slayer)');
  assert.equal(api.voiceNameForModel({ name: '내 목소리', fishId: 'b'.repeat(32) }), '내 목소리');
  const first = presets[0].tag.split(', ');
  assert.deepEqual(api.upgradedPresetTags({ fishId: SHINOBU, tags: [...first].reverse() }), presets[0].fine.split(', '), 'the first tags in any order: moved on');
  const edited = { fishId: SHINOBU, tags: [...first, '내 태그'] };
  assert.equal(api.upgradedPresetTags(edited), edited.tags, 'the reader\'s own: kept as is');
  assert.deepEqual(api.presetVoiceRows()[0], { name: presets[0].name, tag: presets[0].fine, id: SHINOBU });
});

test('JEV: options name the known voice in English; two of a bot never get the same one; a taken or current voice gives way', async () => {
  const settings = api.ttsDefaults(); settings.jev.key = 'k';
  let body;
  // JEV likes the first option best for everyone, the second next.
  globalThis.risuai = { nativeFetch: async (_url, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => ({ answers: Object.fromEntries(Object.entries(body.questions).map(([k, q]) => { const [a, b] = Object.keys(q.criteria); return [k, { choice: a, probabilities: { [a]: 0.6, [b]: 0.3 } }]; })) }) }; } };
  try {
    const voices = [woman('shinobu', ['여성', '청년', '차분함'], SHINOBU), woman('other')];
    const a = her('하린'), b = her('유나');
    const picked = await api.selectTtsVoices([a, b], voices, settings, 'jev');
    const lines = Object.values(body.questions[0].criteria);
    assert.ok(lines.includes('Shinobu Kocho (Demon Slayer): female, young adult, calm'), lines.join(' | '));
    assert.deepEqual(body.questions[0].instructions.character, ['하린', 'female', ['young adult', 'calm']]);
    assert.notEqual(picked.get(a.id)[0].key, picked.get(b.id)[0].key, 'one call, two people: two voices');
    const top = picked.get(a.id)[0].key, next = voices.find(v => v.key !== top).key;
    // The bot's other character already speaks with the top one: it goes behind.
    assert.equal((await api.selectTtsVoices([a], voices, settings, 'jev', undefined, null, { taken: new Set([top]) })).get(a.id)[0].key, next);
    // Asked again, the card gets another than the one it has, which goes last.
    const again = (await api.selectTtsVoices([a], voices, settings, 'jev', undefined, null, { current: new Map([[a.id, top]]) })).get(a.id);
    assert.deepEqual(again.map(v => v.key), [next, top]);
  } finally { delete globalThis.risuai; }
});

test('embedding: the character in English with its lore against each voice; near equals go to the less used voice; no emoji', async () => {
  const settings = api.ttsDefaults(), asked = [];
  // A toy embedding: "calm" lights one axis, "husky" another; everything has a little of a third.
  const vector = text => [/calm/.test(text) ? 1 : 0, /husky/.test(text) ? 1 : 0, 0.1];
  globalThis.risuai = { nativeFetch: async (_url, options) => { const input = JSON.parse(options.body).input; asked.push(...input); return { ok: true, status: 200, json: async () => ({ data: input.map((t, index) => ({ index, embedding: vector(t) })) }) }; } };
  try {
    const embed = { provider: 'openrouter', model: 'x', endpoint: '', api_key: 'k' };
    const voices = [woman('busy', ['여성', '차분함']), woman('quiet', ['여성', '차분함']), woman('rough', ['여성', '허스키'])];
    const c = her('하린', ['차분함', '🫠']);
    const picked = await api.selectTtsVoices([c], voices, settings, 'embedding', undefined, embed, { uses: new Map([['busy', 4]]), about: new Map([[c.id, '조용한 사서']]) });
    assert.equal(picked.get(c.id)[0].key, 'quiet', 'two calm voices, the same score: the one nobody uses yet');
    const query = asked.find(t => t.includes('character'));
    assert.match(query, /female character — 하린 — calm — 조용한 사서/);
    assert.doesNotMatch(query, /🫠/, 'an emoji means nothing to the embedding');
    assert.ok(asked.some(t => t === 'female voice — busy — female, calm'), asked.join(' | '));
  } finally { delete globalThis.risuai; }
});

test('voicePickOptions: the bot\'s other voices are taken, uses count every bot, the voice a card has is its current one', async () => {
  const saved = new Map();
  globalThis.risuai = { pluginStorage: { getItem: async k => saved.get(k), setItem: async (k, v) => saved.set(k, v) } };
  try {
    const data = await api.loadTtsData();
    const card = (name, scope, voiceKey) => ({ ...api.blankTtsCharacter(scope, name), voiceKey });
    const mine = card('하린', 'bot:a', 'v1');
    data.characters = [mine, card('유나', 'bot:a', 'v2'), card('남', 'bot:b', 'v3'), card('셋', 'bot:b', 'v2'), card('나레이션', 'global', 'v4')];
    const options = api.voicePickOptions([mine]);
    assert.deepEqual([...options.taken].sort(), ['v2', 'v4'], 'the same bot and the shared cards, not itself, not another bot');
    assert.equal(options.uses.get('v2'), 2);
    assert.equal(options.current.get(mine.id), 'v1');
  } finally { delete globalThis.risuai; }
});
