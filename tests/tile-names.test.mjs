import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const bundle = await build({ stdin: { contents: `
  export { bindPresetSheet } from './src/settings-ux/preset-bindings';
  export { bindCharacterSheet } from './src/settings-ux/character-bindings';
  export { tabHtml } from './src/settings-ux/tab-html';
  export { getConfig, setConfig } from './src/services/context';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'Tiles' });
const preview = await readFile('docs/settings-ux-preview.html', 'utf8');
const css = preview.slice(preview.indexOf('<style>') + 7, preview.indexOf('</style>'));
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><path fill="#7132f5" d="M0 0h160v160H0z"/></svg>');

test('renaming updates only the mounted character/preset labels and keeps thumbnails', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(image => {
      document.body.innerHTML = `<div id="nx-char-scope-bar"><button data-char-scope="session"></button><button data-char-scope="global"></button></div>
        <div id="nx-char-current"></div><div id="nx-char-edit-title"></div><input id="nx-char-search">
        <div id="nx-char-edit-body"><input id="edit-name" data-char-name></div>
        <div id="nx-char-session-list"><div class="char-card" data-char-id="same-id" data-char-scope="session"><input data-char-name value="Alice"><div data-char-ref-preview><img src="${image}"></div></div></div>
        <div id="nx-char-global-list"><div class="char-card" data-char-id="same-id" data-char-scope="global"><input data-char-name value="Global Alice"><div data-char-ref-preview><img src="${image}"></div></div></div>`;
      Tiles.bindCharacterSheet();
      window.charTile = document.querySelector('[data-ux-character-tile][data-ux-character-scope="session"]');
      window.charImage = charTile.querySelector('img');
      window.charList = document.getElementById('nx-char-session-list');
      window.networkCalls = 0;
      window.fetch = async () => { networkCalls++; throw Error('rename must not reload'); };
    }, image);
    await page.locator('#edit-name').fill('이름 변경 <safe>');
    assert.equal(await page.locator('[data-ux-character-scope="session"] [data-character-label]').textContent(), '이름 변경 <safe>');
    assert.equal(await page.locator('[data-ux-character-scope="global"] [data-character-label]').textContent(), 'Global Alice');
    assert.equal(await page.locator('#nx-char-current').textContent(), '이름 변경 <safe>');
    assert.equal(await page.locator('#nx-char-edit-title').textContent(), '이름 변경 <safe>');
    assert.equal(await page.evaluate(() => charTile === document.querySelector('[data-ux-character-scope="session"]')
      && charImage === charTile.querySelector('img') && charList === document.getElementById('nx-char-session-list')), true);
    assert.equal(await page.evaluate(() => networkCalls), 0);

    await page.evaluate(image => {
      const vendor = `<select id="nx-preset-select"><option value="one" selected>First</option><option value="two">Second</option></select>
        <input id="nx-preset-name" value="First"><div class="preset-chip-row"><button class="preset-chip active" data-preset-select="one"><img src="${image}">First</button><button class="preset-chip" data-preset-select="two"><img src="${image}">Second</button></div>`;
      document.body.innerHTML = Tiles.tabHtml('style_presets', vendor);
      Tiles.bindPresetSheet();
      window.presetTile = document.querySelector('[data-preset-select="one"]');
      window.presetImage = presetTile.querySelector('img');
      window.presetList = document.getElementById('nx-preset-chips');
      document.getElementById('nx-preset-sheet').classList.add('open');
    }, image);
    await page.locator('#nx-preset-name').fill('바뀐 프리셋 <safe>');
    assert.equal(await page.locator('[data-preset-select="one"]').textContent(), '바뀐 프리셋 <safe>');
    assert.equal(await page.locator('[data-preset-select="two"]').textContent(), 'Second');
    assert.equal(await page.locator('#nx-preset-select option:checked').textContent(), '바뀐 프리셋 <safe>');
    assert.equal(await page.evaluate(() => presetTile === document.querySelector('[data-preset-select="one"]')
      && presetImage === presetTile.querySelector('img') && presetList === document.getElementById('nx-preset-chips')), true);
    assert.equal(await page.evaluate(() => networkCalls), 0);
  } finally { await browser.close(); }
});

test('tile labels overlay the image bottom and explorer filenames stay hidden at mobile and desktop widths', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>${css}</style><div id="nx-preset-chips" style="width:160px"><button class="preset-tile preset-chip"><img class="preset-look-chip" src="${image}"><span data-preset-label>프리셋 이름</span></button></div>
      <div style="width:160px"><button class="preset-tile" data-ux-character-tile="a"><img src="${image}"><span data-character-label>캐릭터 이름</span></button></div>
      <div id="nx-explorer-grid" style="width:160px"><div class="explorer-card"><img src="${image}"><div class="cap">very-long-file-name.png</div><button class="ex-star">★</button></div></div>`);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const measured = await page.evaluate(() => [...document.querySelectorAll('.preset-tile')].map(tile => {
        const img = tile.querySelector('img').getBoundingClientRect();
        const label = tile.querySelector('span').getBoundingClientRect();
        return { inside: label.bottom <= img.bottom + 1 && label.top >= img.top && label.left >= img.left - 1 && label.right <= img.right + 1,
          nearBottom: Math.abs(label.bottom - img.bottom) <= 1, imageFills: img.height >= tile.clientHeight - 1 };
      }));
      assert.ok(measured.every(value => value.inside && value.nearBottom && value.imageFills), JSON.stringify({ width, measured }));
      assert.equal(await page.locator('.explorer-card .cap').isVisible(), false);
      assert.equal(await page.locator('.ex-star').isVisible(), true);
    }
  } finally { await browser.close(); }
});

test('secondary preset tile keeps a visible green mark without repaint', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.addStyleTag({ content: css });
    await page.evaluate(image => {
      const vendor = `<select id="nx-preset-select"><option value="one" selected>First</option><option value="two">Second</option></select>
        <input id="nx-preset-name" value="First"><div class="preset-chip-row"><button class="preset-chip" data-preset-select="one"><img src="${image}">First</button><button class="preset-chip" data-preset-select="two"><img src="${image}">Second</button></div>`;
      const config = Tiles.getConfig();
      Tiles.setConfig({ ...config, card: { ...config.card, secondary_preset_id: 'two' } });
      document.body.innerHTML = Tiles.tabHtml('style_presets', vendor, { card: { secondary_preset_id: 'two' } });
      Tiles.bindPresetSheet();
      window.secondTile = document.querySelector('[data-preset-select="two"]');
    }, image);
    assert.equal(await page.locator('[data-preset-select="two"].second').count(), 1);
    assert.equal(await page.locator('[data-preset-select="one"].second').count(), 0);
    assert.equal(await page.evaluate(() => getComputedStyle(secondTile).outlineColor), 'rgb(20, 158, 97)');
    assert.equal(await page.evaluate(() => getComputedStyle(secondTile).outlineWidth), '3px');
    assert.equal(await page.evaluate(() => getComputedStyle(secondTile, '::after').content), '"2순위"');
    await page.evaluate(() => {
      const config = Tiles.getConfig();
      Tiles.setConfig({ ...config, card: { ...config.card, secondary_preset_id: 'one' } });
      document.getElementById('nx-preset-search').dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.locator('[data-preset-select="one"].second').count(), 1);
    assert.equal(await page.locator('[data-preset-select="two"].second').count(), 0);
    assert.equal(await page.evaluate(() => document.querySelector('[data-preset-select="two"]') === secondTile), true);
    await page.evaluate(() => {
      const select = document.getElementById('nx-preset-select');
      select.value = 'two';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal(await page.locator('[data-preset-select="one"].second').count(), 1);
    await page.evaluate(() => { document.getElementById('nx-preset-second').click(); });
    assert.equal(await page.locator('[data-preset-select="two"].second').count(), 1);
    assert.equal(await page.locator('[data-preset-select="one"].second').count(), 0);
    assert.equal(await page.evaluate(() => document.querySelector('[data-preset-select="two"]') === secondTile), true);
  } finally { await browser.close(); }
});
