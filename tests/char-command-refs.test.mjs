import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

/** 명령수정: the two reference switches show what is saved and save when flipped. */
test('명령수정 lb-xnai / 로어북 참조 switches load from and save to the settings', { timeout: 60000 }, async () => {
  const bundle = await build({ stdin: { contents: `export { openCharacterCommandEdit } from './src/char-command/mount';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'CC', loader: { '.txt': 'text' } });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<body><div id="form" data-char-ref-scope="bot1"><input data-ce-name value="하나"><textarea data-ce-appearance>girl</textarea></div></body>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      window.card = { char_command_xnai: true, char_command_lore: false }; window.posts = [];
      globalThis.__INLAY_NATIVE__ = { fetch: async (path, init = {}) => {
        if (path === '/v1/settings' && init.method === 'POST') { window.posts.push(init.body.card); Object.assign(window.card, init.body.card); return { ok: true }; }
        if (path === '/v1/settings') return { settings: { card: { ...window.card } } };
        return { items: [] };
      } };
      CC.openCharacterCommandEdit({ formRoot: document.getElementById('form') });
    });
    const xnai = page.locator('[data-cc-ref-xnai]'), lore = page.locator('[data-cc-ref-lore]');
    await page.waitForFunction(() => document.querySelector('[data-cc-ref-xnai]')?.checked === true);
    assert.equal(await lore.isChecked(), false, 'each shows its own saved value');
    await lore.check();
    await page.waitForFunction(() => window.posts.length === 1);
    assert.deepEqual(await page.evaluate(() => window.posts), [{ char_command_lore: true }]);
    await xnai.uncheck();
    await page.waitForFunction(() => window.posts.length === 2);
    assert.deepEqual(await page.evaluate(() => window.card), { char_command_xnai: false, char_command_lore: true });
    // Both sit above the 명령어 box.
    const refs = await page.locator('[data-cc-refs]').boundingBox(), cmd = await page.locator('[data-cc-cmd]').boundingBox();
    assert.ok(refs.y + refs.height <= cmd.y);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
