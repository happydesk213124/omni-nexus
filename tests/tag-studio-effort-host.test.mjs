import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('studio imports Medium, switches effort in requests, and fits the seed row and canvas status', async () => {
  const bundle = await build({ entryPoints: ['src/tag-studio/mount.ts'], bundle: true,
    write: false, format: 'iife', globalName: 'Studio' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    for (const width of [320, 375, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent('<body></body>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(() => {
        window.requests = [];
        window.cardSettings = { studio_coords_visible: true };
        globalThis.__INLAY_NATIVE__ = { fetch: async (path, options) => {
          if (path.endsWith('/nai-prompt')) return { model: 'nai-diffusion-5-full-medium',
            width: 832, height: 1216, steps: 14, sampler: 'k_euler_ancestral', cfg_rescale: 0,
            seed: 3511406839, main_prompt: 'cafe', characters: [{ prompt: 'girl', center_x: 0.38, center_y: 0.5 }] };
          if (path === '/v1/settings') {
            if (options?.body?.card) window.cardSettings = { ...window.cardSettings, ...options.body.card };
            return { settings: { card: window.cardSettings } };
          }
          if (path.startsWith('/v1/characters')) return { characters: [], global: [] };
          if (path.endsWith('/studio-generate')) {
            window.requests.push(options.body);
            return { ok: false, error: { message: 'mock request captured' } };
          }
          return { ok: true };
        } };
        void Studio.openTagStudio({ id: 'medium-image', session_id: 'session1' });
      });
      const effort = page.locator('[data-g="effort"]');
      await effort.waitFor();
      assert.equal(await effort.inputValue(), 'medium');
      assert.equal(await page.locator('[data-g="steps"]').isDisabled(), true);
      assert.equal(await page.locator('[data-g="sampler"]').isDisabled(), true);
      assert.equal(await page.locator('#panel .chips').count(), 0, 'status does not consume panel space');
      assert.equal(await page.locator('.chip').count(), 0, 'redundant status badges are removed');
      assert.match(await page.locator('.readout').innerText(), /확대.*좌표/s);
      const status = await page.locator('.readout').boundingBox();
      const center = await page.locator('#center').boundingBox();
      assert.ok(status.x >= center.x && status.x + status.width <= center.x + center.width + 1);
      assert.ok(status.height <= 60, 'compact status can wrap on narrow screens');
      const grid = page.locator('[data-act="grid"]:visible').first();
      await grid.click();
      await page.waitForFunction(() => window.cardSettings.studio_coords_visible === false);
      await page.evaluate(() => { Studio.closeTagStudio(); void Studio.openTagStudio({ id: 'medium-image', session_id: 'session1' }); });
      await effort.waitFor();
      assert.equal(await grid.evaluate(el => el.classList.contains('on')), false, 'hidden coordinates stay hidden on reopen');
      assert.equal(await page.locator('#dots').evaluate(el => el.classList.contains('hide')), true);
      await grid.click();
      await page.waitForFunction(() => window.cardSettings.studio_coords_visible === true);
      await page.evaluate(() => { Studio.closeTagStudio(); void Studio.openTagStudio({ id: 'medium-image', session_id: 'session1' }); });
      await effort.waitFor();
      assert.equal(await grid.evaluate(el => el.classList.contains('on')), true, 'visible coordinates stay visible on reopen');
      await effort.scrollIntoViewIfNeeded();
      const seed = await page.locator('[data-g="seed"]').boundingBox();
      const select = await effort.boundingBox();
      const row = await page.locator('.seed-row').boundingBox();
      assert.ok(seed.width >= 75 && Math.abs(seed.y - select.y) <= 1, 'seed and effort share one usable row');
      assert.ok(select.x >= seed.x + seed.width && select.x + select.width <= row.x + row.width + 1);
      await page.locator('#gen').click();
      await page.waitForFunction(() => window.requests.length === 1);
      assert.equal(await page.evaluate(() => window.requests[0].model), 'nai-diffusion-5-full-medium');
      await effort.selectOption('high');
      await page.locator('[data-g="steps"]').fill('23');
      await page.locator('[data-g="sampler"]').selectOption('k_euler');
      await page.locator('[data-g="rescale"]').fill('0.2');
      await effort.selectOption('medium');
      assert.equal(await page.locator('[data-g="steps"]').inputValue(), '14');
      await page.locator('[data-model=""]').click();
      assert.equal(await effort.inputValue(), 'medium', 'image values retain imported effort');
      await page.locator('#gen').click();
      await page.waitForFunction(() => window.requests.length === 2);
      const medium = await page.evaluate(() => window.requests[1]);
      assert.equal(medium.model, 'nai-diffusion-5-full-medium');
      assert.equal(medium.steps, 14); assert.equal(medium.sampler, 'k_euler_ancestral'); assert.equal(medium.cfg_rescale, 0);
      await effort.selectOption('high');
      assert.equal(await page.locator('[data-g="steps"]').inputValue(), '23');
      assert.equal(await page.locator('[data-g="sampler"]').inputValue(), 'k_euler');
      await page.locator('#gen').click();
      await page.waitForFunction(() => window.requests.length === 3);
      assert.equal(await page.evaluate(() => window.requests[2].model), 'nai-diffusion-5-full');
      await page.locator('[data-model="nai-diffusion-4-5-full"]').click();
      assert.equal(await effort.count(), 0, 'V4 has no effort control');
      const auto = page.locator('[data-act="auto"]:visible').first();
      await auto.click();
      await page.waitForFunction(() => window.cardSettings.studio_coord_mode === 'ai');
      await page.evaluate(() => { Studio.closeTagStudio(); void Studio.openTagStudio({ id: 'medium-image', session_id: 'session1' }); });
      await effort.waitFor();
      assert.equal(await auto.evaluate(el => el.classList.contains('on')), true, 'AI choice survives reopening an image with placed coordinates');
      assert.equal(await grid.evaluate(el => el.classList.contains('on')), false);
      assert.equal(await page.locator('#dots').evaluate(el => el.classList.contains('hide')), true);
      await page.locator('#gen').click();
      await page.waitForFunction(() => window.requests.length === 4);
      assert.equal(await page.evaluate(() => window.requests[3].use_coords), false, 'restored AI choice also applies to generation');
      await grid.click();
      await grid.click();
      await page.waitForFunction(() => window.cardSettings.studio_coord_mode === 'manual' && window.cardSettings.studio_coords_visible === false);
      await page.evaluate(() => { Studio.closeTagStudio(); void Studio.openTagStudio({ id: 'medium-image', session_id: 'session1' }); });
      await effort.waitFor();
      assert.equal(await auto.evaluate(el => el.classList.contains('on')), false, 'manual mode also persists');
      assert.equal(await grid.evaluate(el => el.classList.contains('on')), false, 'manual mode can reopen with the overlay hidden');
      // Ctrl+Enter draws as 생성 does, from inside a field; Enter alone does not.
      const drawn = await page.evaluate(() => window.requests.length);
      await page.locator('[data-g="seed"]').focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Control+Enter');
      await page.waitForFunction(n => window.requests.length === n + 1, drawn);
      await page.evaluate(() => new Promise(r => setTimeout(r, 100)));
      assert.equal(await page.evaluate(() => window.requests.length), drawn + 1, 'one press, one picture');
      await page.evaluate(() => Studio.closeTagStudio());
      // Closed: the key belongs to the chat again.
      await page.keyboard.press('Control+Enter');
      await page.evaluate(() => new Promise(r => setTimeout(r, 100)));
      assert.equal(await page.evaluate(() => window.requests.length), drawn + 1, 'a closed studio draws nothing');
      await page.close();
    }
  } finally { await browser.close(); }
});

test('좌표보기: a slot linked to a character carries its name under C1; one linked to no one shows C1 alone', async () => {
  const bundle = await build({ entryPoints: ['src/tag-studio/mount.ts'], bundle: true, write: false, format: 'iife', globalName: 'Studio' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.setContent('<body></body>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      globalThis.__INLAY_NATIVE__ = { fetch: async (path) => {
        if (path.endsWith('/nai-prompt')) return { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 23, seed: 1, main_prompt: 'cafe',
          characters: [{ prompt: 'girl', center_x: 0.3, center_y: 0.5 }, { prompt: 'boy', center_x: 0.7, center_y: 0.5 }] };
        if (path === '/v1/settings') return { settings: { card: { studio_coord_mode: 'manual', studio_coords_visible: true } } };
        if (path.startsWith('/v1/characters')) return { characters: [], global: [] };
        return { ok: true };
      } };
      void Studio.openTagStudio({ id: 'two', session_id: 's' });
    });
    const dots = page.locator('#dots .dot');
    await dots.nth(1).waitFor();
    assert.equal(await page.locator('#dots .dot-name').count(), 0, 'no one linked, no name');
    await page.locator('.tab', { hasText: 'C1' }).first().click();
    const name = page.locator('[data-c="charName"]').first();
    await name.fill('오미선');
    await page.locator('#dots .dot-name').first().waitFor();
    assert.deepEqual(await dots.evaluateAll(list => list.map(el => [el.dataset.label, el.querySelector('.dot-name')?.textContent || ''])), [['C1', '오미선'], ['C2', '']]);
    // The number stays on top, the name under it, both inside the button.
    const [label, who, box] = await page.evaluate(() => {
      const dot = document.querySelector('#dots .dot'), span = dot.querySelector('.dot-name');
      return [getComputedStyle(dot, '::before').content, span.getBoundingClientRect().toJSON(), dot.getBoundingClientRect().toJSON()];
    });
    assert.equal(label, '"C1"');
    assert.ok(who.top >= box.top && who.bottom <= box.bottom + 0.5 && who.left >= box.left - 0.5 && who.right <= box.right + 0.5, 'the name sits inside the button');
    assert.equal(await dots.first().getAttribute('aria-label'), 'C1 오미선');
  } finally { await browser.close(); }
});
