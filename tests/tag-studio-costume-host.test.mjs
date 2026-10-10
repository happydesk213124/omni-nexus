import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('studio character picking and plus include separate look slots for illustration and comic', async () => {
  const bundle = await build({ entryPoints: ['src/tag-studio/mount.ts'], bundle: true,
    write: false, format: 'iife', globalName: 'Studio' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    for (const comic of [false, true]) for (const width of [375, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent('<body></body>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(comic => {
        const characters = [
          { id: 'hana', name: 'Hana', gender: 'girl', appearance: 'girl, freckles, black hair',
            hair_color: 'black', hair_style: 'long hair', eye_color: 'green', age: 24, height: '172cm',
            costumes: [{ name: 'default', attire: 'hoodie', bottoms: 'jeans' }] },
          { id: 'jun', name: 'Jun', gender: 'boy', appearance: 'boy',
            hair_color: 'brown', hair_style: 'short hair', eye_color: 'blue', age: 28, height: '181cm',
            costumes: [{ name: 'default', attire: 'shirt', bottoms: 'trousers' }] },
        ];
        globalThis.__INLAY_NATIVE__ = { fetch: async path => {
          if (path.endsWith('/nai-prompt')) return { characters: [] };
          if (path === '/v1/settings') return { settings: { card: {} } };
          if (path.startsWith('/v1/characters')) return { ok: true, characters, global: [] };
          return { ok: true };
        } };
        void Studio.openTagStudio({ id: 'card1', session_id: 'session1', kind: comic ? 'comic' : 'illustration' });
      }, comic);
      await page.locator('#charPick').selectOption('hana');
      const tags = page.locator('[data-c="tags"]');
      const hana = 'girl, freckles, black hair, long hair, green eyes, 172cm, tall, 24 years old';
      assert.equal(await tags.inputValue(), hana);
      assert.equal(await page.locator('[data-c="costumeTags"]').inputValue(), 'hoodie');
      assert.equal(await page.locator('[data-c="costumeBottoms"]').inputValue(), 'jeans');
      assert.ok((await page.locator('#assembled').textContent()).includes(hana));
      await page.locator('[data-opt="char"]').selectOption('jun');
      assert.equal(await tags.inputValue(), 'boy, brown hair, short hair, blue eyes, 181cm, tall, 28 years old');
      // Exercise the + handler itself; the picker change handler also adds a tab.
      await page.locator('#charPick').evaluate(pick => { pick.value = 'hana'; });
      await page.locator('#tabAdd').click();
      assert.equal(await tags.inputValue(), hana);
      assert.equal(await page.locator('#charTabsBar .tab').count(), 2);
      await page.locator('#charPick').evaluate(pick => { pick.value = ''; });
      await page.locator('#tabAdd').click();
      assert.equal(await tags.inputValue(), '', 'an unassigned tab cannot invent look slots');
      await page.evaluate(() => Studio.closeTagStudio());
      await page.close();
    }
  } finally { await browser.close(); }
});

test('studio costume columns edit, save, switch and clear upper/lower tags', async () => {
  const bundle = await build({ entryPoints: ['src/tag-studio/mount.ts'], bundle: true,
    write: false, format: 'iife', globalName: 'Studio' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    for (const width of [375, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent('<body></body>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(() => {
        let character = { id: 'hana', name: 'Hana', appearance: 'black hair', costumes: [
          { name: 'default', attire: 'hoodie', bottoms: 'jeans', accessories: '' },
          { name: 'school', attire: 'white shirt', bottoms: 'pleated skirt', accessories: '', appearance: 'blue eyes' },
        ] };
        window.saved = [];
        globalThis.__INLAY_NATIVE__ = { fetch: async (path, options) => {
          if (path.endsWith('/nai-prompt')) return { characters: [{ name: 'Hana', costume: 'default',
            prompt: 'black hair, hoodie, jeans, smile', action: 'smile' }] };
          if (path === '/v1/settings') return { settings: { card: {} } };
          if (path.startsWith('/v1/characters')) {
            if (options?.method === 'POST') {
              character = options.body.character;
              window.saved.push(structuredClone(character));
            }
            return { ok: true, characters: [character], global: [] };
          }
          return { ok: true };
        } };
        void Studio.openTagStudio({ id: 'card1', session_id: 'session1' });
      });
      await page.locator('#charTabsBar .tab').first().click();
      const upper = page.locator('[data-c="costumeTags"]');
      const lower = page.locator('[data-c="costumeBottoms"]');
      assert.equal(await upper.inputValue(), 'hoodie');
      assert.equal(await lower.inputValue(), 'jeans');
      await upper.scrollIntoViewIfNeeded();
      const a = await upper.boundingBox(), b = await lower.boundingBox();
      assert.ok(a.width > 60 && Math.abs(a.width - b.width) < 2);
      assert.ok(Math.abs(a.y - b.y) < 2 && b.x >= a.x + a.width, 'two equal columns on one row');
      await upper.fill('sweater');
      await lower.fill('shorts');
      assert.match(await page.locator('#assembled').textContent(), /sweater, shorts/);
      await page.locator('[data-act="costumeSave"]').click();
      await page.locator('#askYes').click();
      await page.waitForFunction(() => window.saved.length === 1);
      const saved = await page.evaluate(() => window.saved[0]);
      assert.equal(saved.costumes[0].attire, 'sweater');
      assert.equal(saved.costumes[0].bottoms, 'shorts');
      assert.equal(saved.costumes[1].bottoms, 'pleated skirt');
      assert.equal(saved.costumes[1].appearance, 'blue eyes');
      await page.locator('[data-opt="costume"]').selectOption('school');
      assert.equal(await upper.inputValue(), 'white shirt');
      assert.equal(await lower.inputValue(), 'pleated skirt');
      await upper.fill('');
      await lower.fill('');
      await page.locator('[data-c="lock"]').check();
      assert.equal(await upper.inputValue(), '', 'rerender must not restore cleared upper tags');
      assert.equal(await lower.inputValue(), '', 'rerender must not restore cleared lower tags');
      assert.doesNotMatch(await page.locator('#assembled').textContent(), /white shirt|pleated skirt/);
      await page.evaluate(() => Studio.closeTagStudio());
      await page.close();
    }
  } finally { await browser.close(); }
});
