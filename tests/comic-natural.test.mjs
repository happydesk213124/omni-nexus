import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseComicPages, synthesizeLayout } from '../.test-build/comic-page.mjs';
import { comicNaturalInstruction } from '../.test-build/comic-natural.mjs';

test('cut descriptions survive parsing and follow their own tags only when enabled', () => {
  const [page] = parseComicPages({ pages: [{ cuts: [
    { cut_kind: 'normal', base: 'cafe, side view, warm light', natural: 'The woman on the left reaches across the table.', characters: [] },
    { cut_kind: 'background', base: '2::no humans::, rainy street', natural: 'Rain reflects the street lights in the empty road.', characters: [] },
  ] }] });
  assert.equal(page.cuts.length, 2);
  assert.equal(page.cuts[0].natural, 'The woman on the left reaches across the table.');
  assert.doesNotMatch(page.layout, /reaches|reflects/);
  assert.equal(synthesizeLayout(page.cuts), page.layout);
  const detailed = synthesizeLayout(page.cuts, true);
  assert.match(detailed, /cafe, side view, warm light\. The woman/);
  assert.ok(detailed.indexOf('reaches') < detailed.indexOf('cut 2'));
  assert.match(detailed, /rainy street\. Rain reflects/);
  assert.match(comicNaturalInstruction(true), /cuts\[\]\.natural/);
  assert.match(comicNaturalInstruction(false), /OFF: omit/);
});

test('legacy cuts without natural retain their exact layout when enabled', () => {
  const [page] = parseComicPages({ pages: [{ cuts: [{ cut_kind: 'normal', base: 'room, close-up', characters: [] }] }] });
  assert.equal(synthesizeLayout(page.cuts, true), page.layout);
});
