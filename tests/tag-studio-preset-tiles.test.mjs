import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** 샷 스튜디오 이미지 프리셋: tiles with the name inside, picked by a tap. */
test('the image preset caret opens a popup of image tiles, name inside at the bottom; a tap applies one', { timeout: 90000 }, async () => {
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
      globalThis.__INLAY_NATIVE__ = {
        ensureImageUrl: async () => url,
        fetch: async (path) => {
          if (path.endsWith('/nai-prompt')) return { ok: true, model: 'nai-diffusion-4-5-full', width: 832, height: 1216, main_prompt: 'cafe', characters: [] };
          if (path.endsWith('/history')) return { ok: true, cards: [{ id: 'img', seed: 1 }] };
          if (path === '/v1/settings') return { settings: { card: { presets: [
            { id: 'thick', name: 'nai v5 thick line', positive: 'thick lineart' },
            { id: 'real', name: '프리셋 리얼', positive: 'photorealistic', look_preview_url: url },
          ] } } };
          if (path.startsWith('/v1/characters')) return { characters: [], global: [] };
          return { ok: true };
        },
      };
      void Studio.openTagStudio({ id: 'img', session_id: 'session1' });
    }, PNG);
    await page.waitForSelector('[data-act="stylePop"]');
    assert.equal(await page.locator('.stiles').count(), 0, 'no tiles in the panel itself');
    const open = async () => { await page.locator('[data-act="stylePop"]').click(); await page.waitForSelector('#stylePop .stile'); };
    await open();
    const names = await page.locator('#stylePop .stile span').allInnerTexts();
    assert.deepEqual(names.map(s => s.trim()), ['추가', 'nai v5 thick line', '프리셋 리얼'], 'the add tile, then each preset by name');
    assert.equal(await page.locator('#stylePop .stile[data-style-pick="real"] img').count(), 1, 'a preset with a look image shows it');
    assert.equal(await page.locator('#stylePop .stile[data-style-pick="thick"] .noimg').count(), 1, 'one without keeps an empty image area');
    // The name sits inside the image, at its bottom.
    const box = await page.locator('#stylePop .stile[data-style-pick="real"]').boundingBox();
    const label = await page.locator('#stylePop .stile[data-style-pick="real"] span').boundingBox();
    assert.ok(label.y > box.y + box.height / 2 && label.y + label.height <= box.y + box.height + 1, 'name in the lower half, inside the tile');

    await page.locator('#stylePop .stile[data-style-pick="real"]').click();
    await page.waitForFunction(() => document.querySelector('[data-m="presetPrompt"]')?.value === 'photorealistic');
    assert.equal(await page.locator('#stylePop').count(), 0, 'picking closes the popup');
    assert.equal(await page.locator('[data-m="presetName"]').inputValue(), '프리셋 리얼');

    await open();
    assert.equal(await page.locator('#stylePop .stile.on').getAttribute('data-style-pick'), 'real', 'the picked preset is marked');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#stylePop').count(), 0, 'Esc closes');
    await open();
    await page.mouse.click(5, 895);
    assert.equal(await page.locator('#stylePop').count(), 0, 'the backdrop closes');
    await open();
    await page.locator('#stylePop .stile[data-style-pick="__add__"]').click();
    await page.waitForFunction(() => document.querySelector('[data-m="presetName"]')?.value === '');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
