import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

/**
 * The chat control is a zero-width anchor, so a line that fills the message
 * would hang it outside. The block keeps a gutter for it: at every length of
 * a paragraph, in every way a line can end, the control stays inside.
 */
test('a play control never hangs outside its message, however full its last line is', { timeout: 60000 }, async () => {
  const built = await build({ stdin: { contents: `export {TTS_MODULE_CSS} from './src/domain/tts/module';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm' });
  const { TTS_MODULE_CSS } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    await page.setContent(`<style>${TTS_MODULE_CSS} body{margin:0;font:16px/1.6 sans-serif} #box{width:300px;padding:0;margin:20px;overflow:visible}</style><div id="box"></div>`);
    const tail = '<span data-omnitts-tail="1"><button type="button" data-omnitts-play="1" data-omnitts-kind="narration"></button></span>';
    const bad = await page.evaluate(tail => {
      const box = document.getElementById('box'), text = n => '가'.repeat(n), out = [];
      const shapes = {
        paragraph: n => `<p>${text(n)}${tail}</p>`,
        inline: n => `<p><em>${text(n)}${tail}</em></p>`,
        quote: n => `<div class="regex-quote-block">“${text(n)}”${tail}</div>`,
        br: n => `<div>첫 줄${tail}<br>${text(n)}${tail}</div>`,
      };
      for (const [shape, make] of Object.entries(shapes)) for (let n = 1; n <= 80; n++) {
        box.innerHTML = make(n);
        const edge = box.getBoundingClientRect().right;
        for (const button of box.querySelectorAll('[data-omnitts-play]')) { const over = button.getBoundingClientRect().right - edge; if (over > 0.5) out.push(`${shape}@${n}:+${Math.round(over)}px`); }
      }
      return out;
    }, tail);
    assert.deepEqual(bad, [], 'every control stays inside the message');
    // The gutter is only where a control is, and only once.
    const gutters = await page.evaluate(tail => {
      const box = document.getElementById('box');
      box.innerHTML = `<div id="outer"><p id="with">글${tail}</p><p id="without">글</p></div>`;
      const pad = id => getComputedStyle(document.getElementById(id)).paddingInlineEnd;
      return [pad('with'), pad('without'), pad('outer')];
    }, tail);
    assert.deepEqual(gutters, ['32px', '0px', '0px'], 'a hair wider than the control, on its own block only');
  } finally { await browser.close(); }
});
