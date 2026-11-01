import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/domain/quick-setup';export {authorNotePresetExamples} from './src/domain/tagging/author-note-presets';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

const helper = { endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini' };
const base = { features: ['image'], naiKey: '', fishKey: '', routerKey: '', tagMode: 'stream', helper: 'aux', helperModel: '', picker: 'off', images: 2, comicShare: 50, speech: true, quality: false };
const plan = extra => api.planQuickSetup({ ...base, ...extra }, helper);

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
});

test('one OpenRouter key: the helper model, JEV or embedding; keys typed are written, empty ones keep the saved', () => {
  const custom = plan({ helper: 'custom', routerKey: ' or-key ', naiKey: 'nai-key' });
  assert.deepEqual(custom.settings.llm, { source: 'custom', provider: 'openrouter', endpoint: helper.endpoint, model: helper.model, api_key: 'or-key' });
  assert.deepEqual(custom.settings.nai, { api_key: 'nai-key' });
  assert.equal(plan({ helper: 'custom', helperModel: 'google/gemini-2.5-flash' }).settings.llm.model, 'google/gemini-2.5-flash');
  const jev = plan({ features: ['tts', 'viewer'], picker: 'jev', routerKey: 'or-key', fishKey: 'fish' });
  assert.deepEqual(jev.tts, { enabled: true, selector: 'jev', fishKey: 'fish', jevKey: 'or-key' });
  assert.equal(jev.viewer.bgPick, 'jev');
  assert.equal(jev.emotion.enabled, true);
  const embedding = plan({ features: ['sound'], picker: 'embedding', routerKey: 'or-key' });
  assert.deepEqual(embedding.sound, { bgmEnabled: true, sfxEnabled: true, embedKey: 'or-key' });
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
