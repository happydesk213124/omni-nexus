import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

test('real bundle closes with blocked storage, retains last DOM input, and an unchanged reopen does not write', async () => {
  const source = readFileSync(new URL('../dist/omninexus.js', import.meta.url), 'utf8');
  assert.equal(source.split('  await Qa();').length, 2);
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('about:blank');
    await page.evaluate(() => {
      const kv = new Map();
      const character = { chaId: 'save-test', name: 'Save test', globalLore: [], chats: [{ id: 'chat', message: [] }] };
      let modules = [];
      const probe = globalThis.saveProbe = { writes: 0, hides: 0, block: false, release: null, showAgain: null, kv };
      globalThis.risuai = {
        pluginStorage: {
          getItem: async key => structuredClone(kv.get(key)),
          setItem: async (key, value) => {
            if (key === 'onx_native_settings') {
              probe.writes++;
              if (probe.block) await new Promise(resolve => { probe.release = resolve; });
            }
            kv.set(key, structuredClone(value));
          },
          removeItem: async key => kv.delete(key),
        },
        getArgument: async () => '',
        getDatabase: async () => ({ characters: [structuredClone(character)], modules: structuredClone(modules) }),
        setDatabase: async db => { if (db.modules) modules = structuredClone(db.modules); },
        getCharacterFromIndex: async () => structuredClone(character),
        getChatFromIndex: async () => structuredClone(character.chats[0]),
        getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
        hideContainer: () => {
          probe.hides++;
          document.getElementById('nx-shell')?.remove();
          return new Promise(resolve => { probe.showAgain = resolve; });
        },
      };
    });
    await page.addScriptTag({ type: 'module', content: source.replace('  await Qa();', `
      await le(); t.uiOpen = true; t.uiTab = 'dashboard';
      globalThis.saveRuntime = { t, paint: P, save: xa, flush: flushSettingsSave };
      await P();
    `) });
    await page.waitForFunction(() => !!document.getElementById('nx-close'));
    await page.evaluate(() => globalThis.saveRuntime.save({ silent: true }));
    await page.evaluate(() => globalThis.__INLAY_NATIVE__.flushSettings());
    const before = await page.evaluate(() => globalThis.saveProbe.writes);
    const expected = await page.evaluate(() => {
      const field = document.getElementById('nx-scroll-hold');
      field.checked = !field.checked;
      const value = field.checked;
      globalThis.saveProbe.block = true;
      // No input/change/blur event: close must capture the mounted value itself.
      document.getElementById('nx-close').click();
      return value;
    });
    assert.equal(await page.evaluate(() => globalThis.saveProbe.hides), 1);
    assert.equal(await page.locator('#nx-shell').count(), 0);
    await page.waitForFunction(() => !!globalThis.saveProbe.release);
    assert.equal(await page.evaluate(() => globalThis.saveRuntime.t.uiOpen), false);
    assert.equal(await page.evaluate(() => globalThis.saveProbe.kv.get('onx_native_settings').card.scroll_hold), !expected);
    await page.evaluate(() => { globalThis.saveProbe.block = false; globalThis.saveProbe.release(); });
    await page.waitForFunction(value => globalThis.saveProbe.kv.get('onx_native_settings').card.scroll_hold === value && !globalThis.saveRuntime.t.settingsSaveInFlight, expected);
    assert.equal(await page.evaluate(() => globalThis.saveProbe.writes), before + 1);
    await page.evaluate(async () => {
      const { t, paint } = globalThis.saveRuntime;
      t.uiOpen = true; t._settingsCloseEpoch++;
      globalThis.saveProbe.showAgain();
      await paint();
    });
    const noChange = await page.evaluate(() => globalThis.saveProbe.writes);
    await page.evaluate(() => document.getElementById('nx-close').click());
    await page.waitForFunction(() => globalThis.saveProbe.hides === 2);
    // Flush explicitly after the close timer without waiting on host hide.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    await page.evaluate(() => globalThis.saveRuntime.flush());
    assert.equal(await page.evaluate(() => globalThis.saveProbe.writes), noChange);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
