import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** 샷 스튜디오 이미지 프리셋: tiles with the name inside, picked by a tap. */
test('image presets are tiles with their names; a tap applies one, ＋ 추가 starts a new one', { timeout: 90000 }, async () => {
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
    await page.waitForFunction(() => document.querySelectorAll('.stiles .stile').length === 3);
    const names = await page.locator('.stiles .stile').allInnerTexts();
    assert.deepEqual(names.map(s => s.trim()), ['＋ 추가', 'nai v5 thick line', '프리셋 리얼'], 'the add tile, then each preset by name');
    assert.equal(await page.locator('.stile[data-style-pick="real"] img').count(), 1, 'a preset with a look preview shows it');
    assert.equal(await page.locator('.stile[data-style-pick="thick"] img').count(), 0, 'one without is a name tile');

    await page.locator('.stile[data-style-pick="real"]').click();
    await page.waitForFunction(() => document.querySelector('[data-m="presetPrompt"]')?.value === 'photorealistic');
    assert.equal(await page.locator('.stile.on').getAttribute('data-style-pick'), 'real', 'the picked tile is marked');
    assert.equal(await page.locator('[data-m="presetName"]').inputValue(), '프리셋 리얼');

    await page.locator('.stile[data-style-pick="__add__"]').click();
    await page.waitForFunction(() => document.querySelector('[data-m="presetName"]')?.value === '');
    assert.equal(await page.locator('.stile.on').getAttribute('data-style-pick'), '__add__');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
