import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/domain/emotion/emotions';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

test('mood words fold onto a fixed set of faces; delivery words choose none', () => {
  for (const [w, face] of [['happy', 'happy'], ['Cheerful', 'happy'], ['giggling', 'laugh'], ['enraged', 'angry'], ['flustered', 'embarrassed'], ['기쁨', 'happy'], ['grossed out', 'disgust']]) assert.equal(api.expressionOfWord(w), face, w);
  for (const w of ['whispering', 'slow', 'husky', '', '   ']) assert.equal(api.expressionOfWord(w), null, `«${w}» is how, not a face`);
  assert.equal(api.expressionOfWord('pouting'), 'pouting', 'an unknown mood keeps its own word');
  assert.equal(api.expressionOfWord('pouting', { pouting: 'sad' }), 'sad', 'the settings table maps it');
  assert.equal(api.expressionOfTone('whispering, sad'), 'sad', 'the first word with a face wins');
  assert.equal(api.expressionOfTone('soft tone, slow'), 'neutral');
  assert.equal(api.expressionOfTone('slow, quiet'), null);
  const keys = api.BASE_EXPRESSIONS.map(e => e.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.length >= 12 && keys.length <= 16, 'about a dozen images per character');
  assert.ok(keys.includes(api.DEFAULT_EXPRESSION));
});

test("an asset matches its person's face under any of their names, in either order", () => {
  const names = ['오미선', '미선', 'Oh Misun', 'Misun'];
  for (const asset of ['오미선_happy.png', 'happy_misun.webp', 'Oh Misun Happy', 'misun-cheerful', 'Ohmisun.happy', '미선 기쁨']) assert.equal(api.assetMatchesExpression(asset, names, 'happy'), true, asset);
  assert.equal(api.assetMatchesExpression('Sasaki Yua enraged', ['Sasaki Yua'], 'angry'), true);
  assert.equal(api.assetMatchesExpression('Yua_grossed_out', ['Yua'], 'disgust'), true, 'a two-word face');
  for (const asset of ['오미선_sad.png', 'happy', '하린_happy', 'misun', 'happy_happy']) assert.equal(api.assetMatchesExpression(asset, names, 'happy'), false, asset);
  assert.equal(api.emotionAssetName('오 미선', 'happy'), 'omni_오_미선_happy.png', "omni_ first: never mixed with the bot's own");
  assert.equal(api.assetMatchesExpression('omni_오미선_happy.webp', names, 'happy'), true, "a picture Omni drew is still that person's");
  assert.equal(api.assetMatchesExpression('omni_오미선_sad.webp', names, 'happy'), false);
  assert.equal(api.emotionAssetName('오미선', 'sad', 'webp'), 'omni_오미선_sad.webp');
  assert.equal(api.assetMatchesExpression(api.emotionAssetName('오미선', 'pouting'), names, 'pouting'), true, 'what Omni writes, it finds again');
});

test('a sprite prompt is looks plus fixed tags: no LLM', () => {
  const p = api.emotionPrompt({ looks: 'girl, black hair, short hair, blue eyes', face: 'happy', prefix: 'best quality', suffix: 'anime coloring' });
  assert.equal(p, 'best quality, girl, black hair, short hair, blue eyes, 2::smile::, open mouth, happy, 2::cowboy shot::, standing, looking at viewer, solo, white background, simple background, anime coloring');
  assert.match(api.emotionPrompt({ looks: 'girl', face: 'sad', transparent: true, pose: 'full body' }), /^girl, 2::sad::, frown, downcast eyes, full body, transparent background$/);
  assert.match(api.emotionPrompt({ looks: 'girl', face: 'pouting' }), /2::pouting::/, 'an unmapped face is its own weighted tag');
});

test("a costume's sprite is named apart (omni_c2_이름_face) and is never taken for the default costume's", () => {
  assert.equal(api.emotionAssetName('오미선', 'happy', 'webp', 2), 'omni_c2_오미선_happy.webp');
  assert.equal(api.emotionAssetName('오미선', 'happy', 'webp'), 'omni_오미선_happy.webp', 'the default costume as ever');
  assert.equal(api.assetMatchesExpression('omni_c2_오미선_happy.webp', ['오미선'], 'happy'), false);
  assert.equal(api.assetMatchesExpression('omni_c2_오미선_happy.webp', ['오미선_c2'], 'happy'), true);
  assert.equal(api.assetMatchesExpression('omni_c2_오미선_happy.webp', ['오미선_c1'], 'happy'), false);
});

test("a nude face is named apart (omni_nude_이름_face) and is never taken for the default costume's", () => {
  assert.equal(api.emotionAssetName('오미선', 'happy', 'png', api.NUDE_COSTUME), 'omni_nude_오미선_happy.png');
  assert.equal(api.assetMatchesExpression('omni_nude_오미선_happy.png', ['오미선'], 'happy'), false);
});

test('excludeTags: a bare rule is that tag, a star any tag with that word, through emphasis', () => {
  const sweep = api.excludeTags;
  assert.equal(sweep('penis, huge penis', 'penis'), 'huge penis', 'bare: the whole tag only');
  assert.equal(sweep('penis, huge penis, penises', '*penis'), 'penises', 'star: the word, not a longer one');
  assert.equal(sweep('sex, anal sex, sexy', '*sex'), 'sexy');
  assert.equal(sweep('huge_penis, pubic_hair, 1girl', '*penis, *pubic hair'), '1girl', 'underscores are spaces');
  assert.equal(sweep('2::huge penis::, 1girl, {nude}', '*penis, *nude'), '1girl', 'emphasis does not hide a tag');
  assert.equal(sweep('2::huge penis, smile::, 1girl', '*penis'), '2::smile::, 1girl', 'the rest of its group stays');
  assert.equal(sweep('NSFW, 1girl', '*nsfw'), '1girl', 'any case');
  assert.equal(sweep('벗은 몸, 몸매', '*몸'), '몸매', 'a word in any language');
  assert.equal(sweep('nude, 1girl', ''), 'nude, 1girl', 'no rules, nothing out');
  assert.equal(sweep('nude, 1girl', '*, , '), 'nude, 1girl', 'a lone star names nothing');
  assert.equal(sweep('a.b, axb', '*a.b'), 'axb', 'rules are words, not patterns');
  assert.match(api.EMOTION_EXCLUDE_DEFAULT, /^\*penis, /);
  // The first value holds the male anatomy words only: a girl's nipples, nude and nsfw are the user's to list.
  assert.equal(api.EMOTION_EXCLUDE_DEFAULT, '*penis, *cock, *dick, *testicle, *testicles, *scrotum, *erection');
  assert.equal(sweep('huge penis, erection, nipples, nsfw, large breasts, long hair', api.EMOTION_EXCLUDE_DEFAULT), 'nipples, nsfw, large breasts, long hair');
});
