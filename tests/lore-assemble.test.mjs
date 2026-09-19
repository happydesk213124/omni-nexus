import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assembleLorebookForTagger,
  explainTriggeredLoreEntries,
  loreEntrySharesCharacterTrigger,
} from '../.test-build/lore-assemble.mjs';

test('loreEntrySharesCharacterTrigger detects overlapping keys', () => {
  assert.equal(
    loreEntrySharesCharacterTrigger({ key: '세노이, Cardinal Senoy', content: 'bio' }, ['세노이', 'Senoy']),
    true,
  );
  assert.equal(
    loreEntrySharesCharacterTrigger({ key: '성당, 교단', content: 'place' }, ['세노이']),
    false,
  );
  assert.equal(
    loreEntrySharesCharacterTrigger({ key: '성당', secondkey: '세노이', content: 'x' }, ['세노이']),
    true,
  );
});

test('explainTriggeredLoreEntries lists sibling keys not in the message', () => {
  const rows = explainTriggeredLoreEntries(
    [{ comment: '세노이', key: '세노이, Senoy, Fallen, Angel, MISC', content: 'bio' }],
    '세노이가 성당에 들어온다',
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].keys_hit_in_message, ['세노이']);
  assert.ok(rows[0].sibling_keys_not_in_message.includes('Fallen'));
  assert.ok(rows[0].sibling_keys_not_in_message.includes('MISC'));
});

test('assembleLorebookForTagger skips story lore sharing filled character triggers', () => {
  const entries = [
    { comment: '세노이 설정', key: '세노이', content: '추기경 세노이의 과거 이야기…' },
    { comment: '성당', key: '성당', content: '대리석 복도와 스테인드글라스.' },
    {
      comment: 'lb-xnai.lb.extra',
      content: `## Character Image Tags\n\n### 세노이\ngirl, silver hair\n`,
    },
  ];
  const out = assembleLorebookForTagger(
    entries,
    '세노이가 성당에 들어온다',
    ['세노이'], // filled character triggers
    5,
    1200,
    null,
    'tags',
  );
  const comments = out.map((e) => e.comment);
  assert.ok(!comments.includes('세노이 설정'), 'character-keyed story lore skipped');
  assert.ok(comments.includes('성당'), 'unrelated place lore kept');
});
