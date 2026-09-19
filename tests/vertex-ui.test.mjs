import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('model tabs show SA status and a scoped remove button with pending and failed states', async () => {
  const built = await build({ stdin: { contents: `
    export { bindModels } from './src/settings-ux/model-bindings.ts';
    export { tabHtml } from './src/settings-ux/tab-html.ts';
    export { renderLlmRoleCardHtml, renderLlmRoleTabsHtml } from './src/ui-contract/llm-form.ts';
  `, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'UI' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(() => {
      const roles = [['nx-llm','main'], ['nx-llm-autotag','autotag'], ['nx-llm-asset','asset_char'], ['nx-llm-comic','comic']];
      const settings = { provider: 'vertex', source: 'custom', follow_main: false, service_account_configured: true, vertex_region: 'global' };
      window.cfg = { llm: { ...settings }, llm_roles: Object.fromEntries(roles.slice(1).map(([,id]) => [id, { ...settings }])) };
      window.saved = [];
      window.__OMNI_SETTINGS_ACTIONS__ = { config: () => cfg, save: async patch => {
        saved.push(patch);
        await new Promise(resolve => { window.releaseSave = resolve; });
        if (window.rejectSave) throw Error('write rejected');
        const value = patch.llm || Object.values(patch.llm_roles)[0];
        const target = patch.llm ? cfg.llm : cfg.llm_roles[Object.keys(patch.llm_roles)[0]];
        if (value.clearServiceAccount) target.service_account_configured = false;
      } };
      const vendor = UI.renderLlmRoleTabsHtml('main') + roles.map(([prefix]) => UI.renderLlmRoleCardHtml({ prefix, title: prefix, settings })).join('');
      document.body.innerHTML = '<div id="nx-save-flash"></div>' + UI.tabHtml('models', vendor);
      UI.bindModels();
      UI.bindModels();
    });
    assert.equal(await page.locator('#nx-llm-sa-status').textContent(), '등록됨');
    assert.equal(await page.locator('#nx-llm-remove-sa').count(), 1, 'rebinding cannot duplicate remove controls');
    assert.equal(await page.locator('#nx-llm-clear-sa').isVisible(), false);
    assert.equal(await page.locator('#nx-llm-endpoint').getAttribute('placeholder'), 'https://aiplatform.googleapis.com');
    assert.match(await page.locator('#nx-llm-model').getAttribute('placeholder'), /^google\/gemini-/);
    await page.locator('#nx-llm-service-account').fill('{"new":"draft"}');
    assert.equal(await page.locator('#nx-llm-sa-status').textContent(), '저장 중');
    await page.evaluate(() => { document.getElementById('nx-save-flash').textContent = '자동 저장 실패'; });
    await page.waitForFunction(() => document.getElementById('nx-llm-sa-status').textContent === '저장 실패');
    await page.locator('#nx-llm-remove-sa').click();
    assert.equal(await page.locator('#nx-llm-remove-sa').isDisabled(), true);
    await page.evaluate(() => releaseSave());
    await page.waitForFunction(() => document.getElementById('nx-llm-sa-status').textContent === '미등록');
    assert.equal(await page.locator('#nx-llm-service-account').inputValue(), '');
    assert.equal(await page.locator('#nx-llm-autotag-sa-status').textContent(), '등록됨');
    assert.deepEqual(await page.evaluate(() => saved[0]), { llm: { clearServiceAccount: true } });

    await page.evaluate(() => {
      document.querySelector('[data-ux-llm-role="main"]').hidden = true;
      document.querySelector('[data-ux-llm-role="autotag"]').hidden = false;
      window.rejectSave = true;
    });
    await page.locator('#nx-llm-autotag-remove-sa').click();
    await page.evaluate(() => releaseSave());
    await page.waitForFunction(() => document.getElementById('nx-llm-autotag-sa-status').textContent === '삭제 실패');
    assert.equal(await page.locator('#nx-llm-autotag-remove-sa').isDisabled(), false);
    assert.deepEqual(await page.evaluate(() => saved[1]), { llm_roles: { autotag: { clearServiceAccount: true } } });
    await page.evaluate(() => { window.rejectSave = false; });
    await page.locator('#nx-llm-autotag-remove-sa').click();
    await page.evaluate(() => releaseSave());
    await page.waitForFunction(() => document.getElementById('nx-llm-autotag-sa-status').textContent === '미등록');
  } finally { await browser.close(); }
});
