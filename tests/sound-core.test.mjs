import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: `export * from './src/domain/sound/tags';export * from './src/domain/sound/match';export * from './src/domain/sound/audio';export * from './src/domain/sound/module';export * from './src/config/sound-defaults';export {normalizeSoundData} from './src/storage/sound-store';export {parseCueLine} from './src/domain/tts/segment';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const item = (key, tags, kind = 'bgm') => ({ key, kind, name: key, tags, folder: '', source: 'url', url: `https://x.test/${key}.mp3` });

test('BGM tags: thirty vocabulary words, synonyms fold in, the marker yields three tags', () => {
  assert.equal(api.BGM_TAGS.length, 30);
  assert.equal(api.normalizeSoundTag(' Tense '), 'tense');
  assert.equal(api.normalizeSoundTag('긴박'), 'tense');
  assert.equal(api.normalizeSoundTag('추격'), 'chase');
  assert.deepEqual(api.parseBgmMarker('[[bgm:tense, chase, fast]]\n본문'), ['tense', 'chase', 'fast']);
  assert.equal(api.parseBgmMarker('그냥 본문'), null);
  assert.match(api.bgmPromptText(api.BGM_TAGS), /exactly three tags/);
  assert.doesNotMatch(api.bgmPromptText(api.BGM_TAGS), /https?:/, 'the prompt never carries the track list');
});

test('BGM pick: shared tags decide, the current track stays unless another is strictly better', () => {
  const items = [item('chase', ['tense', 'chase', 'fast']), item('calm-day', ['calm', 'daily', 'slow']), item('night', ['tense', 'night', 'slow'])];
  assert.deepEqual(api.pickBgm(['긴박', '추격', '빠른'], items), { key: 'chase', score: 3, reason: 'switch' });
  // One tag in common with the current song, one with another: keep playing.
  assert.equal(api.pickBgm(['tense', 'school', 'mid'], items, 'night').key, 'night');
  assert.equal(api.pickBgm(['tense', 'night', 'slow'], items, 'chase').key, 'night', 'a strictly better match switches');
  assert.deepEqual(api.pickBgm(['festival'], items, 'chase'), { key: 'chase', score: 0, reason: 'keep' });
  assert.deepEqual(api.pickBgm(['festival'], items), { key: '', score: 0, reason: 'none' });
});

test('effects: rules find the words in reading order, the glossary picks the sound', () => {
  const rules = api.soundDefaults().sfxRules;
  const text = '§싸아아아──§\n문이 열렸다.\n§덜컹! 덜컹! 와르르르르──!§';
  assert.deepEqual(api.sfxHits(text, rules).map(hit => hit.word), ['싸아아아──', '덜컹! 덜컹! 와르르르르──!']);
  assert.notEqual(api.sfxRuleError('(unclosed'), '');
  assert.deepEqual(api.sfxHits('§x§', [{ id: 'bad', name: 'bad', pattern: '(', flags: '', enabled: true }]), [], 'an invalid rule is skipped');
  const sfx = [item('door', ['문 닫힘'], 'sfx'), item('crash', ['붕괴'], 'sfx')];
  const glossary = [{ id: 'g', terms: ['덜컹', '쾅'], sfxKey: 'door', enabled: true }, { id: 'h', terms: ['와르르'], sfxKey: 'crash', enabled: false }];
  assert.equal(api.pickSfx('덜컹! 덜컹!', glossary, sfx).key, 'door');
  assert.equal(api.pickSfx('와르르', glossary, sfx), null, 'a disabled glossary row is ignored');
  assert.equal(api.pickSfx('쾅! 문 닫힘', glossary, sfx).key, 'door', 'an effect tag can match without a glossary row');
  assert.equal(api.pickSfx('문', [], [item('one', ['문'], 'sfx')]), null, 'a one-letter tag never matches by itself (it would hit every word)');
});

test('audio files are recognised by their bytes, not their names', () => {
  const head = text => new Uint8Array([...text].map(c => c.charCodeAt(0)).concat(Array(16).fill(0)));
  assert.equal(api.sniffAudioMime(head('ID3')), 'audio/mpeg');
  assert.equal(api.sniffAudioMime(new Uint8Array([0xff, 0xfb, 0x90, 0, ...Array(12).fill(0)])), 'audio/mpeg');
  const wav = head('RIFF0000WAVE'); assert.equal(api.sniffAudioMime(wav), 'audio/wav');
  assert.equal(api.sniffAudioMime(head('OggS')), 'audio/ogg');
  assert.equal(api.sniffAudioMime(head('<!doctype html>')), '', 'a web page is not audio');
});

test('modules: ⚛️ names, display rules run before OmniTTS, files become module assets', () => {
  const settings = { ...api.soundDefaults(), bgmEnabled: true, sfxEnabled: true };
  const bgm = api.soundModule('bgm', settings, [{ ...item('a', []), source: 'asset', assetName: 'omnisound_bgm_a.mp3', assetPath: 'assets/a.mp3' }, item('b', [])]);
  assert.equal(bgm.name, '⚛️ omni bgm'); assert.equal(bgm.id, 'omni-bgm');
  assert.deepEqual(bgm.assets, [['omnisound_bgm_a.mp3', 'assets/a.mp3', 'omnisound_bgm_a.mp3']], 'only stored files are assets; links are not');
  assert.match(bgm.regex[0].flag, /<order -10120>/);
  assert.ok(-10120 > -10200, 'higher order runs first: the marker is a button before TTS reads lines');
  const shown = '[[bgm:tense,chase,fast]]\n본문'.replace(new RegExp(bgm.regex[0].in, 'gi'), bgm.regex[0].out);
  assert.match(shown, /data-omni-bgm="1"[^>]*>♪</); assert.doesNotMatch(shown, /\[\[bgm:/);
  assert.match(bgm.lorebook[0].content, /\[\[bgm:mood,place,tempo\]\]/);
  assert.equal(api.soundModule('bgm', { ...settings, bgmPrompt: false }, []).lorebook.length, 0);
  const sfx = api.soundModule('sfx', settings, []);
  assert.equal(sfx.name, '⚛️ omni 효과음');
  const line = '§덜컹§'.replace(new RegExp(sfx.regex[0].in, 'g'), sfx.regex[0].out);
  assert.match(line, /^§덜컹§<span data-omni-sfx-tail="1"><button[^>]*data-omni-sfx="1"[^>]*>▶</, 'the effect text stays and a gray ▶ follows it');
});

test('TTS never reads the BGM marker line', () => {
  assert.equal(api.parseCueLine('[[bgm:tense,chase,fast]]', '1'), null);
  assert.equal(api.parseCueLine('그녀가 문을 열었다.', '2').kind, 'narration');
});

test('stored data is normalised: bad rows dropped, settings clamped', () => {
  const data = api.normalizeSoundData({ settings: { bgmVolume: 7, bgmMatcher: 'nope', bgmTags: [] }, bgm: [item('ok', ['a']), { key: 'x', name: 'no url', source: 'url', url: 'http://insecure' }], sfx: [{ key: 'f', name: 'file', source: 'asset' }] });
  assert.equal(data.settings.bgmVolume, 1); assert.equal(data.settings.bgmMatcher, 'auto'); assert.equal(data.settings.bgmTags.length, 30);
  assert.deepEqual(data.bgm.map(i => i.key), ['ok']); assert.deepEqual(data.sfx, [], 'a file row without its asset path is dropped');
});
