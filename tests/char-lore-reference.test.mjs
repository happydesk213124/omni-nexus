import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: `export * from './src/domain/lore/character-reference';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

const xnai = { comment: 'lb-xnai.lb.extra', key: '', content: '공통 머리말\n\n### 하나\nred hair, school uniform\n\n### 민아\nblue hair, maid outfit' };
const lore = [
  xnai,
  { comment: '하나 · 설정', key: '하나, Hana', content: '하나는 붉은 머리의 학생이다. 늘 교복을 입는다.' },
  { comment: '세계관', key: '학교', content: '학교 이야기. 하나와 민아가 다닌다.' },
  { comment: '민아', key: '민아', content: '민아는 메이드다.' },
  { comment: 'omni.nexus.data.cast', key: '하나', content: '{"stored":true}' },
];

test('명령수정 reference: only this character\'s lb-xnai section and lore entries that name it', () => {
  const both = api.characterLoreReference(lore, ['하나', 'Hana'], { xnai: true, lore: true });
  assert.match(both.lb_xnai, /### 하나\nred hair, school uniform/);
  assert.doesNotMatch(both.lb_xnai, /민아|maid/, 'another person\'s section stays out');
  assert.deepEqual(both.lorebook.map(e => e.title), ['하나 · 설정'], 'by key or title only: a world entry that merely mentions her stays out, and so does our own data');
  assert.deepEqual(api.characterLoreReference(lore, ['하나'], { xnai: false, lore: false }), {}, 'both off: nothing');
  assert.deepEqual(Object.keys(api.characterLoreReference(lore, ['하나'], { xnai: true, lore: false })), ['lb_xnai']);
  assert.deepEqual(Object.keys(api.characterLoreReference(lore, ['하나'], { xnai: false, lore: true })), ['lorebook']);
  assert.deepEqual(api.characterLoreReference(lore, ['없는사람'], { xnai: true, lore: true }), {}, 'nobody named: nothing');
  // Bounded: at most five entries, each and all together capped.
  const many = Array.from({ length: 9 }, (_, i) => ({ comment: `하나 ${i}`, key: '하나', content: 'x'.repeat(5000) }));
  const capped = api.characterLoreReference(many, ['하나'], { xnai: false, lore: true }).lorebook;
  assert.ok(capped.length <= api.CHARACTER_LORE_LIMITS.entries);
  assert.ok(capped.every(e => e.text.length <= api.CHARACTER_LORE_LIMITS.chars));
  assert.ok(capped.reduce((n, e) => n + e.text.length, 0) <= api.CHARACTER_LORE_LIMITS.total);
});
