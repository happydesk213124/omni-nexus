import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('a sprite goes to the screen at the size it is seen at, as WebP with its alpha, and only once', async () => {
  const built = await build({ stdin: { contents: "import {screenImage,SPRITE_BOX} from './src/viewer/shrink';Object.assign(window,{screenImage,SPRITE_BOX});", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ content: built.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      // A full-size sprite as NovelAI saves it: a large PNG, transparent around the figure, with noise PNG cannot squeeze.
      const canvas = new OffscreenCanvas(1400, 2000), g = canvas.getContext('2d');
      const noise = g.createImageData(900, 1600);
      for (let i = 0; i < noise.data.length; i += 4) { noise.data[i] = Math.random() * 255; noise.data[i + 1] = Math.random() * 255; noise.data[i + 2] = Math.random() * 255; noise.data[i + 3] = 255; }
      g.putImageData(noise, 250, 200);
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
      const url = await window.screenImage('assets/sprite.png', bytes, window.SPRITE_BOX);
      const img = new Image(); img.src = url; await img.decode();
      const probe = new OffscreenCanvas(img.width, img.height).getContext('2d'); probe.drawImage(img, 0, 0);
      const again = await window.screenImage('assets/sprite.png', new Uint8Array(1), window.SPRITE_BOX);
      return { mime: url.slice(5, url.indexOf(';')), width: img.width, height: img.height, size: url.length * 3 / 4, original: bytes.byteLength, corner: probe.getImageData(2, 2, 1, 1).data[3], again: again === url };
    });
    assert.equal(result.mime, 'image/webp');
    assert.ok(result.width <= 700 && result.height <= 1000 && result.height >= 990, 'fitted to the box, its shape kept: ' + JSON.stringify(result));
    assert.ok(result.size < result.original / 3, 'far fewer bytes over the bridge: ' + JSON.stringify(result));
    assert.equal(result.corner, 0, 'the transparent edge stays transparent');
    assert.equal(result.again, true, 'made once per file');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
