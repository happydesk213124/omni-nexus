import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: `export * from './src/domain/character/save-costumes';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

// The list from a real roster: one person merged again and again.
const costume = (name, note) => ({ name, note, attire: name, accessories: '' });
const messy = [
  costume('default', '래그 · 기본 외형·의상'),
  costume('hostage', 'tied up hostage with ropes and red bandana gag'),
  costume('bomb_hostage', 'transparent dome helmet with large ticking time bomb backpack'),
  costume('Lag_default', 'Lag · 기본 외형·의상'),
  ...Array.from({ length: 8 }, (_, i) => costume(`Lag_default_${i + 2}`, 'Lag · 기본 외형·의상')),
  costume('래그_default', '래그 · 기본 외형·의상'),
  costume('래그_hostage', '래그 · tied up hostage with ropes and red bandana gag'),
  costume('래그_bomb_hostage', '래그 · transparent dome helmet with large ticking time bomb backpack'),
  costume('붉은래그_default', '붉은래그 · 기본 외형·의상'),
];

test('costumes that say the same thing become one; another form stays; the active costume follows', () => {
  const { costumes, active_costume } = api.collapseSameCostumes(messy, '래그', 13);
  assert.deepEqual(costumes.map(c => c.name), ['default', 'hostage', 'bomb_hostage', 'Lag_default', '붉은래그_default'],
    '래그\'s own name is not part of the description; Lag and 붉은래그 are other forms and stay, once each');
  assert.equal(active_costume, 1, '래그_hostage was being worn: it is hostage now');
  assert.equal(api.collapseSameCostumes(messy, '래그', 0).active_costume, 0, 'the default never moves');
  assert.equal(api.collapseSameCostumes(messy, '래그', 8).active_costume, 3, 'a Lag_default_N is Lag_default now');
  const plain = [costume('default', ''), costume('swim', ''), costume('beach', '')];
  assert.equal(api.collapseSameCostumes(plain, '래그').costumes.length, 3, 'costumes with no description are never merged');
});

test('merging the same person again adds no default copy', () => {
  const survivor = { name: '래그', costumes: messy.slice(0, 4) };
  const donor = { name: 'Lag', costumes: [{ name: 'default', note: '', attire: 'slightly different shirt', accessories: '' }] };
  const out = api.appendDuplicateCostumes(survivor, [donor]);
  assert.equal(out.length, 4, 'Lag · 기본 외형·의상 is there already, whatever its tags');
  const other = api.appendDuplicateCostumes(survivor, [{ name: '붉은래그', costumes: [{ name: 'default', note: '', attire: 'red', accessories: '' }] }]);
  assert.deepEqual(other.slice(4).map(c => c.note), ['붉은래그 · 기본 외형·의상'], 'a different form is still added');
});
