import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterAssetPromptTags,
  formatAssetTagsInjectBlock,
  packAssetTagGroups,
  restoreAssetTagWeights,
  splitNaiPromptTokens,
} from '../.test-build/nai-meta-prompt-tags.mjs';
import { assetMatchTriggers, assetNameTokens, scoreAssetName, assetPriorityForTrigger, pickAssetsPerTrigger, filterAssetTriggersForUnfilledLooks, loreKeysByCompactTrigger, originalTagFromPlains, matchFoundLooksToRoster } from '../.test-build/nai-meta-match.mjs';
import { naiMetaHasPrompt, pickNaiMeta, promptFromNaiMetadata } from '../.test-build/nai-meta-from-metadata.mjs';
import {
  aspectFromCanvas,
  canvasDimsForShot,
  dimsForAspect,
  generationUsesShotAspect,
  normalizeShotAspect,
  resolveShotAspect,
} from '../.test-build/nai-meta-aspect.mjs';
import { filterStylePresetPositive, styleFieldsFromNaiMetadata } from '../.test-build/nai-meta-style-preset.mjs';
import {
  extractStealthFromRgba,
  writeStealthAlphaLsb,
} from '../.test-build/nai-meta-stealth.mjs';
import { decodePngToRgba } from '../.test-build/nai-meta-png-rgba.mjs';
import { deflateSync } from 'node:zlib';
import {
  assetsFromEnabledModules,
  collectEnabledModuleIds,
  mergeNamedAssets,
  parseRisuAssetRows,
  personaEmbeddedModule,
} from '../.test-build/nai-meta-risu-asset-list.mjs';

const EXAMPLE = [
  '1girl',
  '0.5::artist:opossumachine::',
  '1.2::artist:healthyman::',
  '0.8::artist:yamamoto souichirou::',
  '0.3::artist:tianliang duohe fangdongye::',
  '[[[[[[[artist:jp06]]]]]]]',
  '0.7::artist:ningen mame::',
  '0.6::artist:mochi (circle rin)::',
  '0.5::artist:kuromoto-kun (rina masimaro)::',
  '1.5::artist:shuri 84k::',
  '0.5::artist:mikozin::',
  '0.9::artist:freng::',
  'year 2024',
  'year 2025',
  'cowboy shot',
  'dark green hair',
  'purple eyes',
  'red demon horns',
  'large breasts',
  'witch hat',
  'black dress',
  'fantasy',
  'bags under eyes',
  'black cape',
  'looking at viewer',
  'one eye closed',
  'light smile',
  '{{{hand on own hip, index finger raised}}}',
  'white background',
  '{best quality, amazing quality, very aesthetic, highres, incredibly absurdres}',
  '-1::bad anatomy::',
  'best illustration',
  '-6::artist collaboration::',
].join(', ');

test('filterAssetPromptTags drops artist/year/quality/negatives and strips emphasis', () => {
  const { plains, weightMap } = filterAssetPromptTags(EXAMPLE);
  assert.deepEqual(plains, [
    '1girl',
    'dark green hair',
    'purple eyes',
    'red demon horns',
    'large breasts',
    'witch hat',
    'black dress',
    'fantasy',
    'bags under eyes',
    'black cape',
    'one eye closed',
    'light smile',
    'hand on own hip',
    'index finger raised',
  ]);
  assert.equal(weightMap.get('hand on own hip'), '{{{hand on own hip}}}');
  assert.equal(weightMap.get('index finger raised'), '{{{index finger raised}}}');
  assert.equal(weightMap.get('dark green hair'), 'dark green hair');
});

test('filterAssetPromptTags keeps looks when artist shares a brace group', () => {
  const { plains } = filterAssetPromptTags(
    '{best quality, 0.5::artist:foo::, 1girl, white hair, red eyes}',
  );
  assert.ok(plains.includes('1girl'));
  assert.ok(plains.includes('white hair'));
  assert.ok(!plains.some((p) => /artist/i.test(p)));
});

test('filterAssetPromptTags drops *background and straight-on variants', () => {
  const { plains } = filterAssetPromptTags(
    'blonde hair, white background, simple-background, pink background, straight on, straight-on, straighton, blue eyes',
  );
  assert.deepEqual(plains, ['blonde hair', 'blue eyes']);
});

test('restoreAssetTagWeights reapplies brace emphasis', () => {
  const { weightMap } = filterAssetPromptTags(EXAMPLE);
  const restored = restoreAssetTagWeights(
    'dark green hair, hand on own hip, index finger raised, witch hat',
    weightMap,
  );
  assert.match(restored, /dark green hair/);
  assert.match(restored, /\{\{\{hand on own hip\}\}\}/);
  assert.match(restored, /\{\{\{index finger raised\}\}\}/);
  assert.match(restored, /witch hat/);
});

test('packAssetTagGroups computes common and unique per trigger', () => {
  const a = filterAssetPromptTags('blonde hair, blue eyes, school uniform');
  const b = filterAssetPromptTags('blonde hair, blue eyes, hoodie');
  const c = filterAssetPromptTags('black hair, red eyes, armor');
  const d = filterAssetPromptTags('black hair, green eyes, armor');
  const loreKeys = loreKeysByCompactTrigger(
    ['Yuki', '유키', 'yuki', 'Awa', '아와'],
    ['yuki', 'awa'],
    [
      ['Yuki', '유키', 'Cardinal Yuki'],
      ['Awa', '아와'],
    ],
  );
  const packed = packAssetTagGroups(
    [
      { name: 'yuki_school', plains: a.plains, weightMap: a.weightMap, trigger: 'yuki' },
      { name: 'yuki_casual', plains: b.plains, weightMap: b.weightMap, trigger: 'yuki' },
      { name: 'awa_a', plains: c.plains, weightMap: c.weightMap, trigger: 'awa' },
      { name: 'awa_b', plains: d.plains, weightMap: d.weightMap, trigger: 'awa' },
    ],
    loreKeys,
  );
  assert.equal(packed.groups.length, 2);
  assert.deepEqual(packed.groups[0].common, ['blonde hair', 'blue eyes']);
  assert.deepEqual(packed.groups[0].assets[0].unique, ['school uniform']);
  assert.deepEqual(packed.groups[0].assets[1].unique, ['hoodie']);
  assert.ok(packed.groups[0].lore_keys.includes('Yuki'));
  assert.ok(packed.groups[0].lore_keys.includes('유키'));
  assert.ok(packed.groups[0].lore_keys.includes('Cardinal Yuki'));
  // Not polluted by yuki — awa keeps its own common
  assert.deepEqual(packed.groups[1].common, ['black hair', 'armor']);
  assert.deepEqual(packed.groups[1].assets[0].unique, ['red eyes']);
  assert.deepEqual(packed.groups[1].assets[1].unique, ['green eyes']);
  const block = formatAssetTagsInjectBlock(packed);
  assert.match(block, /## trigger `yuki`/);
  assert.match(block, /lore_keys:.*유키/);
  assert.match(block, /common: blonde hair, blue eyes/);
  assert.match(block, /asset `yuki_school`:/);
  assert.doesNotMatch(block, /공통|에셋/);
});

test('packAssetTagGroups single image puts all plains in common', () => {
  const tags = filterAssetPromptTags('girl, pink hair, 1.3::dress::');
  const packed = packAssetTagGroups(
    [{ name: 'Colizabeth', plains: tags.plains, weightMap: tags.weightMap, trigger: 'colizabeth' }],
    new Map([['colizabeth', ['콜리자베스', 'Colizabeth']]]),
  );
  assert.equal(packed.groups.length, 1);
  assert.ok(packed.groups[0].common.includes('girl'));
  assert.ok(packed.groups[0].common.includes('pink hair'));
  assert.ok(packed.groups[0].common.includes('dress'));
  assert.deepEqual(packed.groups[0].assets[0].unique, []);
  assert.ok(packed.groups[0].lore_keys.includes('콜리자베스'));
  assert.match(formatAssetTagsInjectBlock(packed), /lore_keys:.*콜리자베스/);
});

test('asset matching uses leading filename words, not substring', () => {
  assert.deepEqual(assetMatchTriggers(['h', 'yu', 'yuki', 'witch', '나루', '이한', '주']), [
    'yuki',
    'witch',
    '나루',
    '이한',
    '주',
  ]);
  assert.deepEqual(assetMatchTriggers(['sen-oy', 'sen_oy', 'Senoy']), ['senoy']);
  assert.deepEqual(assetMatchTriggers(['安', '漢', '漢字']), []);
  assert.deepEqual(assetMatchTriggers(['大漢字', 'abc']), ['大漢字', 'abc']);
  assert.ok(scoreAssetName('나루_smile.png', ['나루']));
  assert.ok(scoreAssetName('Juwon_happy.png', ['juwon']));
  assert.ok(scoreAssetName('Senoy(Fallen).webp', ['senoy']));
  assert.ok(scoreAssetName('senoy-normal.webp', ['senoy']));
  assert.ok(scoreAssetName('세노이(P).webp', ['세노이']));
  assert.equal(scoreAssetName('양나루_프로필.png', ['나루']), null);
  assert.equal(scoreAssetName('kurokage_away.webp', ['awa']), null);
  assert.equal(scoreAssetName('sen_oy-default.webp', ['senoy']), null);
  assert.deepEqual(assetMatchTriggers(['ha', 'han']), ['han']);
});

test('originalTagFromPlains prefers qualified identity tag', () => {
  assert.equal(
    originalTagFromPlains(['florian (pokemon)', 'happy', 'smile'], 'florian'),
    'florian (pokemon)',
  );
  assert.equal(originalTagFromPlains(['happy', 'smile'], 'florian'), '');
});

test('filterAssetTriggersForUnfilledLooks drops filled character triggers only', () => {
  const roster = [
    { name: '보민', aliases: ['Bomin'], appearance: 'boy, black hair', attire: 'sweater' },
    { name: '세노이', aliases: ['Senoy'], appearance: '', attire: '' },
  ];
  const out = filterAssetTriggersForUnfilledLooks(
    ['보민', '세노이', '성당', 'Senoy', 'Bomin'],
    roster,
  );
  assert.deepEqual([...out].sort(), ['성당', '세노이', 'senoy'].sort());
});

test('filterAssetTriggersForUnfilledLooks preferFilledLooks drops a twin empty row', () => {
  const roster = [
    {
      name: '하츠세 이즈나',
      aliases: ['Izuna', '이즈나'],
      appearance: 'girl, blue eyes, animal_ears, tail',
      hair_color: 'black hair',
      hair_style: 'short hair',
      scope: 'risu_filled',
    },
    {
      name: '하츠세 이즈나',
      aliases: ['Izuna', '이즈나'],
      appearance: '',
      scope: 'risu_empty',
    },
  ];
  const raw = filterAssetTriggersForUnfilledLooks(['Izuna', '이즈나', '성당'], roster);
  assert.ok(raw.includes('Izuna') || raw.includes('이즈나'));
  const prefer = filterAssetTriggersForUnfilledLooks(['Izuna', '이즈나', '성당'], roster, {
    preferFilledLooks: true,
  });
  assert.deepEqual([...prefer].sort(), ['성당'].sort());
});

test('asset priority: exact > default > profile > (normal = smil*, shorter wins)', () => {
  const tr = 'senoy';
  assert.ok(assetPriorityForTrigger('Senoy.webp', tr) > assetPriorityForTrigger('Senoy-normal.webp', tr));
  assert.ok(assetPriorityForTrigger('Senoy-default.webp', tr) > assetPriorityForTrigger('Senoy-profile.webp', tr));
  assert.ok(assetPriorityForTrigger('Senoy-profile.webp', tr) > assetPriorityForTrigger('Senoy-normal.webp', tr));
  assert.ok(assetPriorityForTrigger('Senoy-smile.webp', tr) > assetPriorityForTrigger('Senoy-normal.webp', tr));
  assert.ok(assetPriorityForTrigger('Senoy-smile.webp', tr) > assetPriorityForTrigger('Senoy-smiling.webp', tr));
  assert.ok(assetPriorityForTrigger('shiro_smiling', 'shiro') > assetPriorityForTrigger('shiro_Dogeza_Normal', 'shiro'));
  assert.ok(assetPriorityForTrigger('Senoy-smiling.webp', tr) > assetPriorityForTrigger('Senoy-angry.webp', tr));
  assert.ok(assetPriorityForTrigger('Senoy-normal.webp', tr) > assetPriorityForTrigger('Senoy-angry.webp', tr));
  assert.ok(assetPriorityForTrigger('Senoy-default.webp', tr) > assetPriorityForTrigger('Senoy-angry-pregnant.webp', tr));
  assert.ok(assetPriorityForTrigger('Senoy-a.webp', tr) > assetPriorityForTrigger('Senoy-angry-pregnant.webp', tr));
  assert.ok(assetPriorityForTrigger('Senoy(Fallen).webp', tr) > 0);
  assert.equal(assetPriorityForTrigger('senoyii.webp', tr), -1);
});

test('pickAssetsPerTrigger takes 4 per trigger preferring exact/normal/short', () => {
  const scored = [
    { name: 'Juwon.png', key: 'a0', score: 1, hits: ['juwon'] },
    { name: 'Juwon_normal.png', key: 'a1', score: 1, hits: ['juwon'] },
    { name: 'Juwon_default.png', key: 'a2', score: 1, hits: ['juwon'] },
    { name: 'Juwon_armpit.png', key: 'a3', score: 1, hits: ['juwon'] },
    { name: 'Juwon_casual.png', key: 'a4', score: 1, hits: ['juwon'] },
    { name: 'Juwon_sad.png', key: 'a5', score: 1, hits: ['juwon'] },
    { name: 'naru_default.png', key: 'b1', score: 1, hits: ['naru'] },
    { name: 'naru_angry.png', key: 'b2', score: 1, hits: ['naru'] },
    { name: 'naru_smile.png', key: 'b3', score: 1, hits: ['naru'] },
    { name: 'naru_normal.png', key: 'b4', score: 1, hits: ['naru'] },
    { name: 'naru_cry.png', key: 'b5', score: 1, hits: ['naru'] },
  ].map((row) => ({
    ...row,
    score: assetPriorityForTrigger(row.name, row.hits[0]),
  }));
  const picked = pickAssetsPerTrigger(scored, ['juwon', 'naru']);
  assert.equal(picked.length, 8);
  assert.equal(picked[0].name, 'Juwon.png');
  assert.equal(picked[1].name, 'Juwon_default.png');
  assert.equal(picked[2].name, 'Juwon_normal.png');
  assert.deepEqual(picked.slice(4, 7).map((p) => p.name), [
    'naru_default.png',
    'naru_smile.png',
    'naru_normal.png',
  ]);
});

test('pickAssetsPerTrigger does not spend a dump of emotion files before another character', () => {
  const stephanie = Array.from({ length: 40 }, (_, i) => ({
    name: `stephanie_emotion${i}.png`,
    key: `st${i}`,
    score: 1,
    hits: ['stephanie'],
  }));
  const scored = [
    ...stephanie,
    { name: 'sora_default.png', key: 'sora', score: 1, hits: ['sora'] },
    { name: 'shiro_default.png', key: 'shiro', score: 1, hits: ['shiro'] },
  ].map((row) => ({
    ...row,
    score: assetPriorityForTrigger(row.name, row.hits[0]),
  }));
  const picked = pickAssetsPerTrigger(scored, ['stephanie', 'sora', 'shiro']);
  assert.equal(picked.filter((p) => p.hits.includes('stephanie')).length, 4);
  assert.ok(picked.some((p) => p.name === 'sora_default.png'));
  assert.ok(picked.some((p) => p.name === 'shiro_default.png'));
});

test('promptFromNaiMetadata merges base and char captions', () => {
  const prompt = promptFromNaiMetadata({
    Comment: JSON.stringify({
      prompt: 'solo',
      v4_prompt: {
        caption: {
          base_caption: 'white background',
          char_captions: [
            { char_caption: 'dark green hair, purple eyes' },
            { char_caption: 'witch hat' },
          ],
        },
      },
    }),
  });
  assert.match(prompt, /solo/);
  assert.match(prompt, /white background/);
  assert.match(prompt, /dark green hair/);
  assert.match(prompt, /witch hat/);
});

test('style-preset prompt uses base_caption only', () => {
  const meta = {
    Comment: JSON.stringify({
      prompt: 'solo, dark green hair',
      uc: 'lowres, bad hands',
      v4_prompt: {
        caption: {
          base_caption: '0.5::artist:freng::, best quality',
          char_captions: [
            { char_caption: 'dark green hair, purple eyes' },
            { char_caption: 'witch hat' },
          ],
        },
      },
    }),
  };
  const base = promptFromNaiMetadata(meta, { includeCharCaptions: false });
  assert.match(base, /artist:freng/);
  assert.match(base, /best quality/);
  assert.equal(base.includes('dark green hair'), false);
  assert.equal(base.includes('witch hat'), false);
  const fields = styleFieldsFromNaiMetadata(meta, base);
  assert.match(fields.positive, /artist:freng/);
  assert.equal(fields.negative, 'lowres, bad hands');
});

test('Comment string that is not JSON is still a prompt', () => {
  assert.ok(naiMetaHasPrompt({ Comment: '1girl, white hair, red eyes' }));
  assert.match(promptFromNaiMetadata({ Comment: '1girl, white hair, red eyes' }), /white hair/);
});

test('Source=NovelAI alone is not a prompt (must fall through to stealth)', () => {
  assert.equal(promptFromNaiMetadata({ Source: 'NovelAI' }), '');
  assert.equal(naiMetaHasPrompt({ Source: 'NovelAI' }), false);
  assert.equal(naiMetaHasPrompt({ Description: 'NovelAI' }), false);
  assert.equal(naiMetaHasPrompt({ Comment: { prompt: '1girl, white hair' } }), true);
});

test('splitNaiPromptTokens keeps brace groups', () => {
  const tokens = splitNaiPromptTokens('a, {{{hand on own hip, index finger raised}}}, b');
  assert.ok(tokens.some((t) => t.includes('hand on own hip')));
});

test('normalizeShotAspect and dimsForAspect', () => {
  assert.equal(normalizeShotAspect('portrait'), 'portrait');
  assert.equal(normalizeShotAspect('1:1'), 'square');
  assert.equal(normalizeShotAspect('landscape'), 'landscape');
  assert.deepEqual(dimsForAspect('square', { width: 832, height: 1216 }, true), {
    width: 1024,
    height: 1024,
    aspect: 'square',
  });
  assert.deepEqual(dimsForAspect('landscape', { width: 832, height: 1216 }, true), {
    width: 1216,
    height: 832,
    aspect: 'landscape',
  });
  assert.equal(dimsForAspect('portrait', { width: 900, height: 900 }, false).aspect, 'settings');
  assert.equal(generationUsesShotAspect(false, false), false);
  assert.equal(generationUsesShotAspect(false, true), true);
  assert.deepEqual(
    canvasDimsForShot('landscape', { width: 832, height: 1216 }, false, false),
    { width: 832, height: 1216, aspect: 'settings' },
  );
  assert.deepEqual(
    canvasDimsForShot('landscape', { width: 832, height: 1216 }, false, true),
    { width: 1216, height: 832, aspect: 'landscape' },
  );
});

test('aspectFromCanvas labels the actual canvas, not the tagger string', () => {
  assert.equal(aspectFromCanvas(1024, 1024), 'square');
  assert.equal(aspectFromCanvas(832, 1216), 'portrait');
  assert.equal(aspectFromCanvas(1216, 832), 'landscape');
  assert.equal(aspectFromCanvas(900, 900), 'square');
  assert.equal(aspectFromCanvas(1400, 800), 'landscape');
  assert.equal(aspectFromCanvas(800, 1400), 'portrait');
  assert.equal(aspectFromCanvas(0, 1024), 'portrait');
});

test('resolveShotAspect defaults missing or unknown values to portrait', () => {
  assert.equal(resolveShotAspect(undefined), 'portrait');
  assert.equal(resolveShotAspect(''), 'portrait');
  assert.equal(resolveShotAspect('comic'), 'portrait');
  assert.equal(resolveShotAspect('horizontal'), 'landscape');
  assert.equal(resolveShotAspect('1:1'), 'square');
});

test('filterStylePresetPositive keeps artist and quality with emphasis', () => {
  const pos = filterStylePresetPositive(EXAMPLE);
  assert.match(pos, /artist:opossumachine/);
  assert.match(pos, /artist:jp06/);
  assert.match(pos, /best quality/);
  assert.match(pos, /amazing quality/);
  assert.match(pos, /-1::bad anatomy::/);
  assert.match(pos, /best illustration/);
  assert.match(pos, /-6::artist collaboration::/);
  assert.equal(pos.includes('dark green hair'), false);
  assert.equal(pos.includes('witch hat'), false);
  assert.equal(pos.includes('1girl'), false);
});

test('pickNaiMeta prefers stealth when text chunks have prompt but no uc', () => {
  const textOnly = { Description: '0.5::artist:freng::, best quality, dark green hair', Source: 'NovelAI' };
  const stealth = {
    Comment: {
      prompt: '0.5::artist:freng::, best quality',
      uc: 'lowres, bad hands',
    },
  };
  assert.equal(pickNaiMeta(textOnly, stealth), stealth);
  assert.equal(pickNaiMeta(stealth, textOnly), stealth);
  assert.equal(pickNaiMeta(textOnly, null), textOnly);
});

test('styleFieldsFromNaiMetadata can dump main without the artist filter', () => {
  const raw = '0.5::artist:freng::, best quality, dark green hair, 1girl, 3::1boy, solo::';
  const filtered = styleFieldsFromNaiMetadata({ Comment: { uc: 'lowres' } }, raw);
  assert.equal(filtered.positive.includes('dark green hair'), false);
  const dumped = styleFieldsFromNaiMetadata({ Comment: { uc: 'lowres' } }, raw, { filterTags: false });
  assert.match(dumped.positive, /dark green hair/);
  assert.equal(dumped.positive.includes('1girl'), false);
  assert.equal(dumped.positive.includes('1boy'), false);
  assert.equal(dumped.positive.includes('solo'), false);
});

test('styleFieldsFromNaiMetadata reads neg and cfg', () => {
  const fields = styleFieldsFromNaiMetadata(
    {
      Comment: JSON.stringify({
        prompt: '0.5::artist:freng::, best quality, dark green hair',
        uc: 'lowres, bad hands',
        scale: 5.5,
        cfg_rescale: 0.2,
      }),
    },
    '0.5::artist:freng::, best quality, dark green hair',
  );
  assert.match(fields.positive, /artist:freng/);
  assert.match(fields.positive, /best quality/);
  assert.equal(fields.positive.includes('dark green hair'), false);
  assert.equal(fields.negative, 'lowres, bad hands');
  assert.equal(fields.cfg_scale, 5.5);
  assert.equal(fields.cfg_rescale, 0.2);
});

test('collectEnabledModuleIds mirrors Risu global/chat/character/persona/integration sources', () => {
  assert.deepEqual(
    collectEnabledModuleIds({
      enabledModules: ['glob-a', 'glob-b'],
      chatModules: ['chat-x'],
      characterModules: ['char-y'],
      personaEmbeddedModuleId: '$embedded',
      moduleIntergration: ' ns1 , ns2 ',
    }),
    ['glob-a', 'glob-b', 'chat-x', 'char-y', '$embedded', 'ns1', 'ns2'],
  );
});

test('assetsFromEnabledModules matches id or namespace and skips inactive modules', () => {
  const modules = [
    { id: 'm1', assets: [['alice_dress', 'path/a', 'png']] },
    { id: 'm2', namespace: 'outfit-pack', assets: [['bob_coat', 'path/b', 'webp']] },
    { id: 'm3', assets: [['carol_hat', 'path/c', 'png']] },
  ];
  const got = assetsFromEnabledModules(modules, ['m1', 'outfit-pack']);
  assert.deepEqual(got, [
    { name: 'alice_dress', key: 'path/a' },
    { name: 'bob_coat', key: 'path/b' },
  ]);
});

test('parseRisuAssetRows skips Inlay character-ref module files', () => {
  assert.deepEqual(
    parseRisuAssetRows([
      ['inxref_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp', 'path/ref', 'webp'],
      ['senoy_default', 'path/look', 'webp'],
    ]),
    [{ name: 'senoy_default', key: 'path/look' }],
  );
});

test('mergeNamedAssets prefers character rows and dedupes by storage key', () => {
  const merged = mergeNamedAssets(
    parseRisuAssetRows([['char_skin', 'same-key', 'png']]),
    [{ name: 'mod_skin', key: 'same-key' }, { name: 'mod_only', key: 'other' }],
  );
  assert.deepEqual(merged, [
    { name: 'char_skin', key: 'same-key' },
    { name: 'mod_only', key: 'other' },
  ]);
});

test('personaEmbeddedModule reads selectedPersona index', () => {
  const embedded = { id: '$embedded', assets: [['p_asset', 'p/key', 'png']] };
  const got = personaEmbeddedModule({
    selectedPersona: 1,
    personas: [{ name: 'a' }, { name: 'b', embeddedModule: embedded }],
  });
  assert.equal(got, embedded);
});

test('extractStealthFromRgba reads column-major alpha LSBs (NovelAI order)', async () => {
  const width = 64;
  const height = 64;
  const rgba = new Uint8Array(width * height * 4);
  // Opaque white base.
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 255;
    rgba[i + 1] = 255;
    rgba[i + 2] = 255;
    rgba[i + 3] = 255;
  }
  const json = JSON.stringify({ prompt: 'stealth ok, dark green hair', Comment: '{"prompt":"nested"}' });
  const jsonBytes = new TextEncoder().encode(json);
  const magic = new TextEncoder().encode('stealth_pnginfo');
  const len = jsonBytes.length * 8;
  const header = new Uint8Array(4);
  header[0] = (len >>> 24) & 0xff;
  header[1] = (len >>> 16) & 0xff;
  header[2] = (len >>> 8) & 0xff;
  header[3] = len & 0xff;
  const payload = new Uint8Array(magic.length + 4 + jsonBytes.length);
  payload.set(magic, 0);
  payload.set(header, magic.length);
  payload.set(jsonBytes, magic.length + 4);
  writeStealthAlphaLsb(rgba, width, height, payload);

  const meta = await extractStealthFromRgba(rgba, width, height);
  assert.ok(meta && typeof meta === 'object');
  assert.match(String(meta.prompt || ''), /stealth ok/);
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'latin1');
  const body = Buffer.concat([t, Buffer.from(data)]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

test('decodePngToRgba keeps alpha LSBs so stealth survives Source=NovelAI PNG', async () => {
  const width = 32;
  const height = 32;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 200;
    rgba[i + 1] = 80;
    rgba[i + 2] = 40;
    rgba[i + 3] = 255;
  }
  const json = JSON.stringify({ prompt: '1girl, white hair, red eyes' });
  const jsonBytes = new TextEncoder().encode(json);
  const magic = new TextEncoder().encode('stealth_pnginfo');
  const bitLen = jsonBytes.length * 8;
  const header = new Uint8Array(4);
  header[0] = (bitLen >>> 24) & 0xff;
  header[1] = (bitLen >>> 16) & 0xff;
  header[2] = (bitLen >>> 8) & 0xff;
  header[3] = bitLen & 0xff;
  const payload = new Uint8Array(magic.length + 4 + jsonBytes.length);
  payload.set(magic, 0);
  payload.set(header, magic.length);
  payload.set(jsonBytes, magic.length + 4);
  writeStealthAlphaLsb(rgba, width, height, payload);

  const scan = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    scan[y * (1 + width * 4)] = 0;
    scan.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const source = Buffer.from('Source\0NovelAI', 'latin1');
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', source),
    pngChunk('IDAT', deflateSync(scan)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  const decoded = await decodePngToRgba(png);
  assert.ok(decoded);
  assert.equal(decoded.colorType, 6);
  const meta = await extractStealthFromRgba(decoded.rgba, decoded.width, decoded.height);
  assert.match(String(meta?.prompt || ''), /white hair/);
});

test('matchFoundLooksToRoster pairs a found asset trigger to the roster row', () => {
  const hits = matchFoundLooksToRoster(
    [{ id: 'c1', name: 'Senoy', aliases: ['세노이'], scope: 'chat_a' }],
    [{ trigger: 'senoy' }],
  );
  assert.deepEqual(hits, [{ characterId: 'c1', recordScope: 'chat_a', trigger: 'senoy' }]);
});

test('matchFoundLooksToRoster matches aliases and skips nameless / id-less rows', () => {
  const hits = matchFoundLooksToRoster(
    [
      { id: '', name: 'Senoy', scope: 'chat_a' },
      { id: 'c2', name: 'Other', aliases: ['senoy'], scope: 'chat_b' },
    ],
    [{ trigger: 'senoy' }],
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].characterId, 'c2');
  assert.equal(hits[0].recordScope, 'chat_b');
});

test('matchFoundLooksToRoster is one look per character and one character per look', () => {
  const hits = matchFoundLooksToRoster(
    [
      { id: 'a', name: 'Alice', scope: 's' },
      { id: 'b', name: 'Bob', scope: 's' },
    ],
    [{ trigger: 'alice' }, { trigger: 'alice_default' }, { trigger: 'bob' }],
  );
  assert.equal(hits.filter((h) => h.characterId === 'a').length, 1);
  assert.equal(hits.filter((h) => h.characterId === 'b').length, 1);
  assert.ok(hits.some((h) => h.characterId === 'b' && h.trigger === 'bob'));
});

test('matchFoundLooksToRoster ignores a found file that matches nobody', () => {
  assert.deepEqual(
    matchFoundLooksToRoster([{ id: 'c1', name: 'Senoy', scope: 's' }], [{ trigger: 'unrelated' }]),
    [],
  );
});
