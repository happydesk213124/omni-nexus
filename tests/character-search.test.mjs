import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ stdin: { contents: `export { bindCharacterSheet } from './src/settings-ux/character-bindings';`, resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', globalName: 'Chars' });

test('the roster search takes several names split by commas; any one shows its tile', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const card = (id, name, alias) => `<div class="char-card" data-char-id="${id}" data-char-scope="session"><input data-char-name value="${name}"><input data-char-aliases value="${alias}"></div>`;
      document.body.innerHTML = `<div id="nx-char-scope-bar"><button data-char-scope="session"></button><button data-char-scope="global"></button></div>
        <div id="nx-char-current"></div><div id="nx-char-edit-title"></div><input id="nx-char-search"><div id="nx-char-empty"></div>
        <div id="nx-char-edit-body"></div>
        <div id="nx-char-session-list">${card('a', '송지은', 'Jieun')}${card('b', '김연희', '이연희')}${card('c', '고아름', 'Areum')}</div>
        <div id="nx-char-global-list"></div>`;
      Chars.bindCharacterSheet();
    });
    const shown = () => page.evaluate(() => [...document.querySelectorAll('[data-ux-character-tile][data-ux-character-scope="session"]')]
      .filter(tile => !tile.hidden).map(tile => tile.textContent.trim()));
    const search = async value => page.locator('#nx-char-search').fill(value);
    await search('송지은, 이연희');
    assert.deepEqual(await shown(), ['송지은', '김연희'], 'a name and another one\'s alias');
    await search('jieun，  areum ,');
    assert.deepEqual(await shown(), ['송지은', '고아름'], 'full-width comma, spaces and an empty tail');
    await search('김연희');
    assert.deepEqual(await shown(), ['김연희']);
    await search(' , ');
    assert.deepEqual(await shown(), ['송지은', '김연희', '고아름'], 'nothing to look for shows everyone');
  } finally { await browser.close(); }
});
