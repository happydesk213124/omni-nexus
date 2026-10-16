import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * 샷 태그 수정: a history tile is picked at once and its tags follow from that
 * image's metadata; a tile can be deleted (not the one a chat shows); 「불러오기」
 * reads a local file like a drop does, names and preset included.
 */
test('history tiles reload their own tags, delete from the right, and 불러오기 fills C1/C2 and the preset', { timeout: 90000 }, async () => {
  const bundle = await build({ entryPoints: ['src/tag-studio/mount.ts'], bundle: true, write: false, format: 'iife', globalName: 'Studio' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<body></body>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(png => {
      const url = 'data:image/png;base64,' + png;
      window.requests = [];
      window.hold = null;
      const prompts = {
        img: { main_prompt: 'cafe', characters: [{ name: '하나', prompt: 'girl, smile', center_x: 0.5, center_y: 0.5 }] },
        img_r1: { main_prompt: 'masterpiece, best style, beach', characters: [
          { name: '하나', prompt: 'girl, wave', center_x: 0.3, center_y: 0.5 }, { name: '민아', prompt: 'girl, run', center_x: 0.7, center_y: 0.5 }] },
      };
      const base = { ok: true, model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, sampler: 'k_euler', cfg_rescale: 0, seed: 1 };
      globalThis.__INLAY_NATIVE__ = {
        ensureImageUrl: async () => url,
        fetch: async (path, options) => {
          window.requests.push({ path, body: options?.body });
          const id = decodeURIComponent(path.split('/')[3] || '');
          if (path.endsWith('/nai-prompt')) {
            if (window.hold && id === 'img_r1') await window.hold;
            return { ...base, ...prompts[id] };
          }
          if (path.endsWith('/history')) return { ok: true, cards: [{ id: 'img', seed: 1 }, { id: 'img_r1', seed: 2 }] };
          if (path.endsWith('/history-delete')) return id === 'img'
            ? { ok: false, error: { code: 'in_chat', message: '채팅에 걸린 이미지는 지울 수 없습니다.' } } : { ok: true, deleted: 1 };
          if (path === '/v1/cards/nai-from-image') return { ...base, main_prompt: 'masterpiece, best style, park', characters: [
            { scope: 'other_bot', id: '민아', name: '민아', prompt: 'girl, sit', center_x: 0.3, center_y: 0.5 },
            { scope: 'other_bot', id: '하나', name: '하나', prompt: 'girl, read', center_x: 0.7, center_y: 0.5 }] };
          if (path === '/v1/settings') return { settings: { card: { presets: [{ id: 'p', name: '프리셋P', positive: 'masterpiece, best style' }] } } };
          if (path.startsWith('/v1/characters')) return { characters: [
            { id: '하나', scope: 'session1', name: '하나', appearance: 'girl, red hair' },
            { id: '민아', scope: 'session1', name: '민아', appearance: 'girl, blue hair' }], global: [] };
          return { ok: true };
        },
      };
      void Studio.openTagStudio({ id: 'img', session_id: 'session1' });
    }, PNG);
    const tiles = page.locator('#hgrid .hitem');
    await page.waitForFunction(() => document.querySelectorAll('#hgrid .hitem').length === 2);
    const charTabs = () => page.locator('#charTabsBar').innerText();
    await page.waitForFunction(() => /하나/.test(document.querySelector('#charTabsBar')?.textContent || ''));

    // A tile: picked at once, its picture shown, the tags after its metadata lands.
    await page.evaluate(() => { window.hold = new Promise(r => { window.release = r; }); });
    await tiles.nth(1).click();
    assert.equal(await tiles.nth(1).evaluate(el => el.classList.contains('on')), true, 'the tile is picked before its metadata arrives');
    assert.equal(await tiles.nth(1).evaluate(el => el.classList.contains('loading')), true, 'and spins');
    await page.locator('.metaload').waitFor();
    assert.match(await page.locator('.metaload').innerText(), /메타 불러오는 중/, 'the preset header says the tags are on their way');
    assert.doesNotMatch(await charTabs(), /민아/, 'the tags are still the old image\'s');
    await page.evaluate(() => window.release());
    await page.waitForFunction(() => /민아/.test(document.querySelector('#charTabsBar')?.textContent || ''));
    assert.match(await charTabs(), /C1 하나[\s\S]*C2 민아/, 'C1/C2 from that image');
    assert.equal(await page.locator('[data-opt="style"]').inputValue(), 'p', 'and its preset');
    assert.equal(await page.locator('.metaload').count(), 0);
    assert.equal(await tiles.nth(1).evaluate(el => el.classList.contains('loading')), false);

    // A quick second pick wins over one still loading.
    await page.evaluate(() => { window.hold = new Promise(r => { window.release = r; }); });
    await tiles.nth(1).click();
    await tiles.nth(0).click();
    await page.waitForFunction(() => !document.querySelector('.metaload'));
    await page.evaluate(() => window.release());
    await page.waitForTimeout(100);
    assert.doesNotMatch(await charTabs(), /민아/, 'the late answer for the earlier pick is dropped');
    await page.evaluate(() => { window.hold = null; });

    // Delete on the right of a tile; the chat's own image refuses and stays.
    const del = tiles.nth(0).locator('.hdel');
    const tile = await tiles.nth(0).boundingBox(), box = await del.boundingBox();
    assert.ok(box.x + box.width / 2 > tile.x + tile.width / 2, 'the delete button sits on the right');
    await del.click();
    await page.locator('#askYes').click();
    await page.waitForFunction(() => window.requests.some(r => r.path === '/v1/cards/img/history-delete'));
    await page.locator('.toast').filter({ hasText: '채팅에 걸린' }).waitFor();
    assert.equal(await tiles.count(), 2, 'refused: the tile stays');
    await tiles.nth(1).locator('.hdel').click();
    await page.locator('#askNo').click();
    assert.equal(await tiles.count(), 2, 'no: nothing happens');
    assert.equal((await page.evaluate(() => window.requests.filter(r => r.path.endsWith('/history-delete')).length)), 1);
    await tiles.nth(1).locator('.hdel').click();
    await page.locator('#askYes').click();
    await page.waitForFunction(() => document.querySelectorAll('#hgrid .hitem').length === 1);
    assert.equal(await page.locator('#hcount').innerText(), '1');

    // 불러오기 beside 저장: a local file's metadata, with the file name, fills C1/C2 and the preset.
    const save = await page.locator('#save').boundingBox(), load = await page.locator('#load').boundingBox();
    assert.ok(Math.abs(load.y - save.y) < 2 && load.x > save.x, '불러오기 sits right after 저장');
    await page.locator('#loadFile').setInputFiles({ name: 'inxshot_scene_c47c6-ae47.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
    await page.waitForFunction(() => window.requests.some(r => r.path === '/v1/cards/nai-from-image'));
    const sent = await page.evaluate(() => window.requests.find(r => r.path === '/v1/cards/nai-from-image').body);
    assert.equal(sent.file_name, 'inxshot_scene_c47c6-ae47.png', 'the file name goes along (its cast ids)');
    await page.waitForFunction(() => /C1 민아/.test(document.querySelector('#charTabsBar')?.textContent || ''));
    assert.match(await charTabs(), /C1 민아[\s\S]*C2 하나/, 'people saved under another scope still find their roster rows');
    assert.equal(await page.locator('[data-opt="style"]').inputValue(), 'p');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
