import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLoreCatalog,
  filterLoreEntriesBySelected,
  loreEntryId,
  matchCatalogIdsFromNames,
  parseLorefilterNameArray,
} from '../.test-build/lore-lorefilter.mjs';

test('buildLoreCatalog skips folders and lb-xnai.lb.extra', () => {
  const entries = [
    { comment: 'Alice', key: 'Alice, 앨리스', content: 'tags' },
    { comment: 'Town Square', key: 'plaza, market', content: 'place' },
    { comment: 'lb-xnai.lb.extra', key: 'x', content: '## Alice\n1girl' },
    { mode: 'folder', key: '\uf000folder:chars', content: '' },
  ];
  const catalog = buildLoreCatalog(entries);
  assert.equal(catalog.length, 2);
  assert.ok(catalog.some((c) => c.title === 'Alice'));
  assert.ok(catalog.some((c) => c.title === 'Town Square'));
  assert.equal(catalog.find((c) => c.title === 'Alice')?.content, 'tags');
});

test('filterLoreEntriesBySelected keeps extras and fail-opens on zero matches', () => {
  const entries = [
    { comment: 'Alice', key: 'Alice', content: 'tags' },
    { comment: 'Town', key: 'plaza', content: 'place' },
    { comment: 'lb-xnai.lb.extra', key: 'x', content: '## Alice' },
  ];
  const aliceId = loreEntryId(entries[0]);
  const filtered = filterLoreEntriesBySelected(entries, [aliceId]);
  assert.ok(filtered.some((e) => e.comment === 'Alice'));
  assert.ok(filtered.some((e) => e.comment === 'lb-xnai.lb.extra'));
  assert.ok(!filtered.some((e) => e.comment === 'Town'));
  const open = filterLoreEntriesBySelected(entries, ['t:nope']);
  assert.equal(open.length, entries.length);
});

test('parse + match catalog ids from LLM names', () => {
  const catalog = buildLoreCatalog([{ comment: 'Alice', key: 'Alice', content: 'x' }]);
  const names = parseLorefilterNameArray('```json\n["Alice"]\n```');
  assert.deepEqual(names, ['Alice']);
  assert.deepEqual(matchCatalogIdsFromNames(catalog, names), [loreEntryId({ comment: 'Alice', key: 'Alice' })]);
});
