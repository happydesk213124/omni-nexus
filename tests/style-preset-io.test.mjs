import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseStylePresetsFromJson,
  toLorebookExport,
  splitPositiveNegative,
} from '../.test-build/style-preset-io.mjs';

const LOREBOOK_EXPORT = {
  type: 'risu',
  ver: 1,
  data: {
    0: {
      key: '',
      comment: '프리셋 닭장',
      content: 'https://example.com\n\n[Positive]\nartist:foo\n\n[Negative]\nlowres',
      mode: 'normal',
    },
    1: {
      key: '',
      comment: '프리셋 농후',
      content: '[Positive]\nartist:bar\n\n[Negative]\nbad hands',
      mode: 'normal',
    },
    2: {
      key: '',
      comment: 'lb-xnai.lb.extra',
      content: '## Character Image Tags\n\n### A\ngirl, black hair',
      mode: 'normal',
    },
    3: {
      key: '\uf000folder:abc',
      comment: '폴더',
      content: '',
      mode: 'folder',
    },
  },
};

const CARD_JSON = {
  spec: 'chara_card_v3',
  data: {
    character_book: {
      entries: [
        {
          name: '프리셋 매끈',
          comment: '프리셋 매끈',
          content: '[Positive]\nartist:uki\n\n[Negative]\nblurry',
        },
        {
          name: '스토리',
          content: '그냥 설정 글',
        },
      ],
    },
  },
};

test('splitPositiveNegative reads Positive/Negative blocks', () => {
  const split = splitPositiveNegative('[Positive]\na, b\n\n[Negative]\nx, y');
  assert.equal(split.positive, 'a, b');
  assert.equal(split.negative, 'x, y');
});

test('parseStylePresetsFromJson reads Risu lorebook_export', () => {
  const rows = parseStylePresetsFromJson(LOREBOOK_EXPORT);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, '프리셋 닭장');
  assert.match(rows[0].positive, /artist:foo/);
  assert.equal(rows[0].negative, 'lowres');
  assert.equal(rows[1].name, '프리셋 농후');
});

test('parseStylePresetsFromJson reads card.json character_book', () => {
  const rows = parseStylePresetsFromJson(CARD_JSON);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '프리셋 매끈');
  assert.match(rows[0].positive, /artist:uki/);
});

test('parseStylePresetsFromJson reads {presets:[…]}', () => {
  const rows = parseStylePresetsFromJson({
    presets: [{ name: 'A', positive: 'p', negative: 'n' }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'A');
});

test('toLorebookExport round-trips through parse', () => {
  const exported = toLorebookExport([
    { id: '1', name: '프리셋 테스트', positive: '1girl', negative: 'lowres' },
  ]);
  assert.equal(exported.type, 'risu');
  assert.equal(exported.ver, 1);
  assert.match(exported.data['0'].content, /\[Positive\]/);
  assert.match(exported.data['0'].content, /\[Negative\]/);
  const again = parseStylePresetsFromJson(exported);
  assert.equal(again.length, 1);
  assert.equal(again[0].name, '프리셋 테스트');
  assert.equal(again[0].positive, '1girl');
  assert.equal(again[0].negative, 'lowres');
});
