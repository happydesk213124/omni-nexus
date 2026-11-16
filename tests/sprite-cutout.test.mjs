import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/domain/emotion/cutout';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { cutoutPixels } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

/** A w×h picture of one background colour with a figure: a body of one colour and, inside it, an eye of the background's. */
function picture(w, h, bg, { body = [200, 60, 60], eye = bg, edge = null } = {}) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, inBody = x >= 6 && x < w - 6 && y >= 6 && y < h - 6, inEye = x >= 12 && x < 16 && y >= 12 && y < 16;
    const ring = edge && inBody && (x === 6 || x === w - 7 || y === 6 || y === h - 7);
    const c = inEye ? eye : ring ? edge : inBody ? body : bg;
    px.set([...c, 255], i);
  }
  return px;
}
const alpha = (px, w, x, y) => px[(y * w + x) * 4 + 3];

test('a white background joined to the edge goes; white inside the figure (an eye) stays; the figure stays whole', () => {
  const w = 32, h = 40, px = picture(w, h, [255, 255, 255]);
  const out = cutoutPixels(px, w, h);
  assert.equal(out.result, 'cut');
  assert.equal(out.color, 'white');
  assert.equal(alpha(px, w, 0, 0), 0, 'the corner went');
  assert.equal(alpha(px, w, 3, 20), 0, 'the side went');
  assert.equal(alpha(px, w, 13, 13), 255, 'the white eye inside stays');
  assert.equal(alpha(px, w, 20, 20), 255, 'the body stays');
});

test('a near-white drawn background (a few levels off) and a black one go too', () => {
  const w = 32, h = 40;
  const grey = picture(w, h, [246, 248, 244]);
  assert.equal(cutoutPixels(grey, w, h).result, 'cut');
  assert.equal(alpha(grey, w, 1, 1), 0);
  const dark = picture(w, h, [4, 6, 2]);
  const out = cutoutPixels(dark, w, h);
  assert.equal(out.color, 'black');
  assert.equal(alpha(dark, w, 1, 1), 0);
  assert.equal(alpha(dark, w, 20, 20), 255);
});

test('the outline\'s blend with the background turns see-through by how close it is, its white taken out', () => {
  const w = 32, h = 40, px = picture(w, h, [255, 255, 255], { body: [40, 40, 200], edge: [200, 200, 240] });
  cutoutPixels(px, w, h);
  const a = alpha(px, w, 6, 20), i = (20 * w + 6) * 4;
  assert.ok(a > 0 && a < 255, `half see-through: ${a}`);
  assert.ok(px[i] < 200, `its white share taken out: ${px[i]}`);
});

test('already see-through: nothing is done; a mixed edge (a room behind them): nothing unless a colour is picked', () => {
  const w = 32, h = 40;
  const clear = picture(w, h, [255, 255, 255]);
  for (let p = 0; p < w * h; p++) if (alpha(clear, w, p % w, Math.floor(p / w)) === 255 && (p % w < 6)) clear[p * 4 + 3] = 0;
  const before = clear.slice();
  assert.equal(cutoutPixels(clear, w, h).result, 'transparent');
  assert.deepEqual(clear, before, 'untouched');
  const room = picture(w, h, [255, 255, 255]);
  for (let x = 0; x < w; x++) for (let y = 0; y < h / 2; y++) room.set([90, 120, 60, 255], (y * w + x) * 4);
  const kept = room.slice();
  assert.equal(cutoutPixels(room, w, h).result, 'mixed');
  assert.deepEqual(room, kept, 'untouched');
  // Picked by hand: the white part joined to the edge goes.
  assert.equal(cutoutPixels(room, w, h, { color: 'white' }).result, 'cut');
  assert.equal(alpha(room, w, 1, h - 2), 0);
  assert.equal(alpha(room, w, 1, 1), 255, 'the green half stays');
});

test('the tolerance decides how far from the colour a pixel may be', () => {
  const w = 32, h = 40;
  const strict = picture(w, h, [235, 235, 235]);
  assert.equal(cutoutPixels(strict, w, h, { color: 'white', tolerance: 10 }).cleared, 0);
  const loose = picture(w, h, [235, 235, 235]);
  assert.ok(cutoutPixels(loose, w, h, { color: 'white', tolerance: 30 }).cleared > 0);
});
