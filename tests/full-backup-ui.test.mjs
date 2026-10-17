import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

/** 디버그 → 백업: the pane warns about keys, saves the file as given, and restores after a confirm. */
test('디버그 백업: 내보내기 saves the keyed file, 불러오기 asks first and reloads the settings', { timeout: 60000 }, async () => {
  const bundle = await build({ stdin: { contents: `export { tabHtml } from './src/settings-ux/tab-html'; export { bindFullBackup } from './src/settings-ux/full-backup';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'UX' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ acceptDownloads: true }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
    const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); void d.accept(); });
    await page.setContent('<body></body>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      document.body.innerHTML = UX.tabHtml('debug', '', { card: {} });
      document.querySelector('[data-debug-pane="backup"]').hidden = false;
      window.calls = []; window.reloads = 0;
      globalThis.__OMNI_SETTINGS_ACTIONS__ = {
        flush: async () => { window.calls.push('flush'); },
        reload: async () => { window.reloads++; },
        request: async (path, body) => {
          window.calls.push(path);
          if (path === '/v1/backup/full-export') return { ok: true, json: JSON.stringify({ type: 'omni-nexus-full-backup', settings: { llm: { api_key: 'sk-real' } } }) };
          if (path === '/v1/backup/full-import') { window.imported = body.json; return { ok: true, restored: ['삽화 설정', 'TTS', 'BGM·효과음'] }; }
          return { ok: false };
        },
      };
      UX.bindFullBackup();
    });
    assert.match(await page.locator('#nx-full-backup').innerText(), /API 키가 그대로 들어 있습니다[\s\S]*공유하거나 게시하지 마세요/);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#nx-full-backup-export').click()]);
    assert.match(download.suggestedFilename(), /^omni-nexus-full-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const saved = JSON.parse(await (await download.createReadStream()).toArray().then(parts => Buffer.concat(parts).toString('utf8')));
    assert.equal(saved.settings.llm.api_key, 'sk-real', 'saved as given: the key is not stripped on the way out');
    assert.deepEqual(await page.evaluate(() => window.calls), ['flush', '/v1/backup/full-export'], 'unsaved edits are saved first');
    await page.locator('#nx-full-backup-file').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from('{"type":"omni-nexus-full-backup"}') });
    await page.waitForFunction(() => window.reloads === 1);
    assert.equal(dialogs.length, 1); assert.match(dialogs[0], /API 키 포함/);
    assert.equal(await page.evaluate(() => window.imported), '{"type":"omni-nexus-full-backup"}');
    assert.match(await page.locator('#nx-full-backup-status').innerText(), /불러왔습니다: 삽화 설정 · TTS · BGM·효과음/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
