import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/domain/quick-setup';export {authorNotePresetExamples} from './src/domain/tagging/author-note-presets';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

const helper = { endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini' };
const base = { features: ['image'], naiKey: '', fishKey: '', routerKey: '', tagMode: 'stream', helper: 'aux', helperModel: '', picker: 'off', images: 3, comicShare: 50, speech: true, quality: false, ttsAuto: false, narration: true, sfxMatcher: 'auto' };
const plan = (extra, opened) => api.planQuickSetup({ ...base, ...extra }, helper, opened);

test('⚡ 빠른 설정: illustrations by streaming tags, two to three a reply, the helper model as Risu has it', () => {
  const p = plan({});
  assert.deepEqual(p.settings.card, { power: true, image_min: 2, image_max: 3, stream_inline_tags: true, stream_inline_autogen: true, comic_gen: 'off' });
  assert.equal(p.settings.nai, undefined, 'no key typed: the saved one stays');
  assert.deepEqual(p.settings.llm, { source: 'aux' });
  assert.deepEqual(p.tts, { enabled: false, selector: 'llm' });
  assert.deepEqual(p.sound, { bgmEnabled: false, sfxEnabled: false });
  assert.equal(p.emotion.enabled, false);
  assert.equal(p.viewer.bgPick, 'auto');
  assert.deepEqual(plan({ tagMode: 'tagger', images: 1 }).settings.card, { power: true, image_min: 1, image_max: 1, stream_inline_tags: false, auto_gen_on_reply: true, comic_gen: 'off' });
  assert.deepEqual(plan({ features: ['tts'] }).settings.card, { power: false }, 'no pictures wanted: Omni\'s drawing is off, the rest untouched');
});

test('comics: beside illustrations half or all; alone, always all of them', () => {
  assert.equal(plan({ features: ['image', 'comic'] }).settings.card.comic_gen_ratio, 50);
  assert.equal(plan({ features: ['image', 'comic'], comicShare: 100 }).settings.card.comic_gen_ratio, 100);
  const alone = plan({ features: ['comic'], comicShare: 50, speech: false }).settings.card;
  assert.deepEqual([alone.power, alone.comic_gen, alone.comic_gen_ratio, alone.comic_llm_batch, alone.nai5_speech], [true, 'on', 100, 'with_main', false]);
  // Finer shares, and finer counts: one, one to two, two to three, three to four.
  assert.equal(plan({ features: ['image', 'comic'], comicShare: 25 }).settings.card.comic_gen_ratio, 25);
  assert.equal(plan({ features: ['image', 'comic'], comicShare: 75 }).settings.card.comic_gen_ratio, 75);
  assert.deepEqual([1, 2, 3, 4].map(images => { const c = plan({ images }).settings.card; return [c.image_min, c.image_max]; }), [[1, 1], [1, 2], [2, 3], [3, 4]]);
  assert.deepEqual([[1, 1], [1, 2], [2, 2], [2, 3], [3, 3], [1, 3], [3, 4], [4, 6]].map(([min, max]) => api.quickImagesOf(min, max)), [1, 2, 2, 3, 3, 2, 4, 4]);
  assert.deepEqual([0, 10, 40, 50, 70, 90, 100].map(api.quickComicShareOf), [50, 25, 50, 50, 75, 100, 100]);
});

// Three answers are coarser than the settings behind them. Opened and applied untouched, the sheet leaves them be:
// a saved 3~3 is not turned into 2~3, a saved 40% not into 50%, a saved JEV effect matcher not into 자동.
test('an answer left as the sheet opened it is not written over a finer saved value', () => {
  const opened = { ...base, features: ['image', 'comic', 'sfx'] };
  const same = plan({ features: ['image', 'comic', 'sfx'] }, opened);
  assert.equal('image_min' in same.settings.card, false);
  assert.equal('comic_gen_ratio' in same.settings.card, false);
  assert.equal('sfxMatcher' in same.sound, false);
  const moved = plan({ features: ['image', 'comic', 'sfx'], images: 4, comicShare: 75, sfxMatcher: 'embedding-only' }, opened);
  assert.deepEqual([moved.settings.card.image_min, moved.settings.card.image_max, moved.settings.card.comic_gen_ratio, moved.sound.sfxMatcher], [3, 4, 75, 'embedding-only']);
  assert.equal(plan({ features: ['comic'] }, opened).settings.card.comic_gen_ratio, 100, 'comics alone are all of them, whatever was open');
});

test('sound is asked apart: BGM and effects each on their own, how TTS reads, how an effect is matched', () => {
  const p = plan({ features: ['tts', 'sfx'], ttsAuto: true, narration: false, sfxMatcher: 'tag' });
  assert.deepEqual(p.tts, { enabled: true, selector: 'llm', autoReply: true, narration: false });
  assert.deepEqual(p.sound, { bgmEnabled: false, sfxEnabled: true, sfxMatcher: 'tag' });
  assert.deepEqual(plan({ features: ['bgm'] }).sound, { bgmEnabled: true, sfxEnabled: false }, 'effects off: their matcher is not touched');
  assert.equal('autoReply' in plan({ features: ['bgm'] }).tts, false, 'TTS off: how it reads is not touched');
  // 임베딩만 needs the embedding: the OpenRouter key goes there even with the picker off.
  assert.equal(plan({ features: ['sfx'], sfxMatcher: 'embedding-only', routerKey: 'or-key' }).sound.embedKey, 'or-key');
});

test('steps and keys follow the answers: nothing to ask is passed over, and only the keys called for are asked', () => {
  const a = extra => ({ ...base, ...extra });
  assert.deepEqual(api.QUICK_STEPS.filter(step => !api.quickStepSkipped(step, a({ features: ['tts'] }))), ['features', 'sound', 'models', 'keys', 'review']);
  assert.deepEqual(api.QUICK_STEPS.filter(step => !api.quickStepSkipped(step, a({ features: ['image'] }))), ['features', 'draw', 'models', 'keys', 'review']);
  assert.deepEqual(api.QUICK_STEPS.filter(step => !api.quickStepSkipped(step, a({ features: [] }))), ['features', 'models', 'keys', 'review']);
  const needs = answers => Object.fromEntries(api.quickKeyNeeds(answers).map(row => [row.key, row.needed ? row.why : false]));
  assert.deepEqual(needs(a({ features: ['image', 'comic', 'viewer'] })), { naiKey: '삽화·만화 · 옴니 뷰어 스탠딩', routerKey: false, fishKey: false });
  assert.deepEqual(needs(a({ features: ['tts'], picker: 'jev' })), { naiKey: false, routerKey: 'JEV', fishKey: 'TTS 음성' });
  assert.deepEqual(needs(a({ features: ['sfx'], sfxMatcher: 'embedding-only', helper: 'custom' })), { naiKey: false, routerKey: '보조 모델 · 임베딩', fishKey: false });
  assert.deepEqual(needs(a({ features: ['image'], picker: 'jev' })), { naiKey: '삽화', routerKey: false, fishKey: false }, 'a picker with nothing to pick for asks no key');
  // A typed key that does not look like the service's keys is hinted at, never refused; empty is fine.
  assert.equal(api.quickKeyLooksRight('naiKey', 'pst-' + 'a'.repeat(40)), true);
  assert.equal(api.quickKeyLooksRight('naiKey', 'sk-or-v1-abc'), false);
  assert.equal(api.quickKeyLooksRight('routerKey', 'sk-or-v1-' + 'b'.repeat(40)), true);
  assert.equal(api.quickKeyLooksRight('fishKey', 'f'.repeat(32)), true);
  assert.equal(api.quickKeyLooksRight('fishKey', 'short'), false);
  assert.equal(api.quickKeyLooksRight('fishKey', ''), true);
});

test('one OpenRouter key: the helper model, JEV or embedding; keys typed are written, empty ones keep the saved', () => {
  const custom = plan({ helper: 'custom', routerKey: ' or-key ', naiKey: 'nai-key' });
  assert.deepEqual(custom.settings.llm, { source: 'custom', provider: 'openrouter', endpoint: helper.endpoint, model: helper.model, api_key: 'or-key' });
  assert.deepEqual(custom.settings.nai, { api_key: 'nai-key' });
  assert.equal(plan({ helper: 'custom', helperModel: 'google/gemini-2.5-flash' }).settings.llm.model, 'google/gemini-2.5-flash');
  const jev = plan({ features: ['tts', 'viewer'], picker: 'jev', routerKey: 'or-key', fishKey: 'fish' });
  assert.deepEqual(jev.tts, { enabled: true, selector: 'jev', autoReply: false, narration: true, fishKey: 'fish', jevKey: 'or-key' });
  assert.equal(jev.viewer.bgPick, 'jev');
  assert.equal(jev.emotion.enabled, true);
  const embedding = plan({ features: ['bgm', 'sfx'], picker: 'embedding', routerKey: 'or-key' });
  assert.deepEqual(embedding.sound, { bgmEnabled: true, sfxEnabled: true, sfxMatcher: 'auto', embedKey: 'or-key' });
  assert.equal(embedding.tts.selector, 'embedding');
});

test('퀄리티 향상: its text, and about how many tokens it adds', () => {
  const quality = api.authorNotePresetExamples().find(row => row.id === api.QUALITY_PRESET_ID);
  assert.ok(quality, 'the example is there to pick');
  assert.match(quality.text, /2::back head::, "2::back view::"/);
  assert.match(quality.text, /8 Apply "motion blur" to dynamic scenes\./);
  assert.match(quality.text, /뒷모습 보이는게 자연스러우면 back view 태그 넣어줘$/);
  const tokens = api.estimateTokens(quality.text);
  assert.ok(tokens > 300 && tokens < 900, String(tokens));
  assert.equal(api.estimateTokens('abcd'.repeat(10)), 10);
  assert.equal(api.estimateTokens('가나다'), 3);
  assert.equal(plan({ quality: true }).quality, true);
});
