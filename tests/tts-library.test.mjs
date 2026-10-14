import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('voice library searches model IDs, groups errors and keeps its actions beside the selected voice', async () => {
  const built = await build({ stdin: { contents: `import { TtsLibrary } from './src/tts-ui/library';import { loadTtsData, ttsData } from './src/storage/tts-store';import layout from './src/tts-ui/layout.json';Object.assign(window,{TtsLibrary,loadTtsData,ttsData,layout});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://tts.test/', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.goto('https://tts.test/');
    await page.evaluate(() => { const storage = new Map(); window.risuai = { pluginStorage: { getItem: async key => storage.get(key), setItem: async (key, value) => storage.set(key, value) } }; });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(async () => {
      await window.loadTtsData(); const data = window.ttsData(); data.settings.enabled = true;
      data.voices = [
        { key: 'clean', name: '정상', fishId: 'b1d83aa085254aa390a1251beaab9f1e', tags: ['차분'], gender: 'female', folder: '' },
        { key: 'recent', name: '최근 오류', fishId: 'b'.repeat(32), tags: [], gender: 'male', folder: '', error: { count: 1, lastAt: 30, status: 400 } },
        { key: 'frequent', name: '반복 오류', fishId: 'c'.repeat(32), tags: [], gender: 'unknown', folder: '', error: { count: 2, lastAt: 10, status: 400 } },
        { key: 'old', name: '이전 오류', fishId: 'd'.repeat(32), tags: [], gender: 'female', folder: '', error: { count: 1, lastAt: 20, status: 503 } },
      ];
      document.body.innerHTML = window.layout.html + window.layout.dialogs;
      const style = document.createElement('style'); style.textContent = window.layout.css + '[hidden]{display:none!important}'; document.head.append(style);
      document.querySelectorAll('section.panel').forEach(panel => panel.hidden = panel.id !== 'tts-voices');
      window.library = new window.TtsLibrary(() => {}); window.library.bind();
      window.openCalls = []; window.open = (...args) => { window.openCalls.push(args); return null; }; document.execCommand = () => true;
    });
    const names = () => page.locator('#voice-list .voice-row strong').allTextContents();
    await page.locator('#voice-search').fill('B1D83AA085254AA390A1251BEAAB9F1E');
    assert.deepEqual(await names(), ['정상'], 'Fish ID search is case insensitive');
    await page.locator('#voice-search').fill('b1d83aa085254');
    assert.deepEqual(await names(), ['정상'], 'partial Fish IDs also match');
    await page.locator('#clear-voice-search').click();
    assert.equal(await page.locator('#voice-sort option[value="errors"]').count(), 1, 'error sort is available');
    await page.locator('#voice-sort').selectOption('errors');
    assert.deepEqual(await names(), ['반복 오류', '최근 오류', '이전 오류', '정상']);
    assert.match(await page.locator('#voice-list .voice-row').first().textContent(), /HTTP 400.*2회/);
    await page.locator('#voice-sort').selectOption('number');
    assert.deepEqual(await names(), ['정상', '최근 오류', '반복 오류', '이전 오류'], 'returning to number order preserves stored positions');
    await page.locator('#voice-list .voice-row').first().click();
    const move = await page.locator('#move-selected-voices').boundingBox(), remove = await page.locator('#delete-selected-voices').boundingBox();
    assert.ok(Math.abs(remove.y - move.y) < 1 && remove.x - move.x - move.width <= 7, 'delete sits immediately to the right of folder move');
    await page.locator('#edit-selected-voice').click();
    const link = page.locator('#v-visit'), fetch = await page.locator('#v-fetch').boundingBox(), visit = await link.boundingBox();
    assert.ok(visit.y >= fetch.y + fetch.height, 'the Fish visit link is below metadata fetch');
    assert.equal(await link.getAttribute('href'), 'https://fish.audio/ko/app/m/b1d83aa085254aa390a1251beaab9f1e/');
    await link.click();
    assert.match(await page.locator('#tts-notice').textContent(), /휠 클릭/);
    assert.equal(await link.evaluate(node => node.dispatchEvent(new MouseEvent('auxclick', { button: 1, cancelable: true, bubbles: true }))), true, 'middle clicks retain browser navigation');
    await page.locator('#v-id').fill('https://fish.audio/m/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    assert.equal(await link.getAttribute('href'), 'https://fish.audio/ko/app/m/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/');
    await page.locator('#v-id').fill('invalid');
    assert.equal(await link.isVisible(), false, 'invalid IDs cannot open another address');
    await page.locator('#v-id').fill('b1d83aa085254aa390a1251beaab9f1e');
    await page.locator('#v-name').fill('정상 수정');
    await page.locator('#voice-submit').click();
    await page.waitForFunction(() => !document.getElementById('voice-dialog').open);
    assert.deepEqual(await names(), ['정상 수정', '최근 오류', '반복 오류', '이전 오류'], 'editing a voice keeps its original tile position');
    await page.locator('#voice-list .voice-row').nth(2).click();
    await page.locator('#edit-selected-voice').click();
    await page.locator('#v-name').fill('반복 오류 수정');
    await page.locator('#voice-submit').click();
    await page.waitForFunction(() => !document.getElementById('voice-dialog').open);
    assert.equal(await page.evaluate(() => window.ttsData().voices[2].error.count), 2, 'renaming a preset preserves its error history');
    await page.locator('#edit-selected-voice').click();
    await page.locator('#v-id').fill('e'.repeat(32));
    await page.locator('#voice-submit').click();
    await page.waitForFunction(() => !document.getElementById('voice-dialog').open);
    assert.equal(await page.evaluate(() => window.ttsData().voices[2].error), undefined, 'replacing the failed model clears errors belonging to the previous ID');
    assert.deepEqual(await page.evaluate(() => window.ttsData().voices.map(voice => voice.key)), ['clean', 'recent', 'frequent', 'old']);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
