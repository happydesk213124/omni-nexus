import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/domain/viewer/fit';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

test("a line's rows are counted as the box wraps it: at spaces, a long word anywhere, each newline a row", () => {
  // 20 Hangul letters a row at 16px in 340px (reckoned a little narrower, 319px).
  assert.equal(api.textRows('가'.repeat(19), 340, 16), 1);
  // Three 12-letter words: broken anywhere they would take two rows; kept whole, one a row.
  assert.equal(api.textRows(Array(3).fill('가'.repeat(12)).join(' '), 340, 16), 3, 'keep-all: a word goes whole to the next row');
  assert.equal(api.textRows('가나다 '.repeat(10).trim(), 340, 16), 2, 'six short words a row');
  assert.equal(api.textRows('가'.repeat(60), 340, 16), 4, 'one word longer than a row breaks anywhere');
  assert.equal(api.textRows('짧다\n\n짧다', 340, 16), 3, 'a blank line is a row too');
  assert.equal(api.textRows('', 340, 16), 1);
  assert.ok(api.textRows('……—“”'.repeat(10), 200, 16) >= 3, 'dashes, ellipses and curly quotes count as wide as a letter');
  assert.deepEqual([api.textRows('a'.repeat(30), 340, 16), api.textRows('가'.repeat(30), 340, 16)], [1, 2], 'a Latin letter is narrower than a Hangul one');
});

test("the box's height for a line: its rows and padding, never under the box's least nor over most of the frame", () => {
  const g = { frameHeight: 700, boxWidth: 376, across: 38, down: 106, size: 16.5, lineHeight: 16.5 * 1.78, least: api.boxLeast(700, false) };
  assert.equal(api.boxLeast(700, false), 182, '26% of the frame');
  assert.equal(api.boxLeast(400, false), 136, 'never under 136px');
  assert.equal(api.boxLeast(1200, true), 200, 'never over 200px');
  assert.equal(api.fitBoxHeight('응.', g), g.least, 'a short line: the box as it is');
  const long = '야청이 오른손에 쥐고 있던 파란색 무늬의 수퍼볼을 입술 가까이 가져다 대며 윙크하더니, 유려한 투구 폼으로 코트 한가운데를 향해 힘차게 던져 올렸다.';
  const tall = api.fitBoxHeight(`${long} ${long}`, g);
  assert.ok(tall > g.least && tall === Math.round(api.textRows(`${long} ${long}`, g.boxWidth - g.across, g.size) * g.lineHeight + g.down), 'a long one: its rows');
  assert.equal(api.fitBoxHeight(long.repeat(10), g), Math.round(700 * api.BOX_MOST), 'never over most of the frame: past it the line scrolls');
});
