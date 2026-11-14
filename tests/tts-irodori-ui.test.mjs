import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('모델 설정: the engine choice shows one engine\'s fields; Irodori\'s are saved, its voices listed, its connection tested', async () => {
  const built = await build({ stdin: { contents: `import {mountTts,ttsSettingsHtml} from './src/tts-ui/mount';import {ttsData} from './src/storage/tts-store';import {omniTts} from './src/services/tts-runtime';import {settingsUxCss} from './src/settings-ux/styles';import {previewChrome} from './src/settings-ux/tab-html';import {setSoundPage} from './src/sound-ui/page';Object.assign(window,{setSoundPage,mountTts,ttsSettingsHtml,ttsData,omniTts,settingsUxCss,previewChrome});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', d => d.dismiss());
    await page.route('https://tts.test/', route => route.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="background:#0b0f18;color:#eee;font:14px sans-serif"></body></html>' })); await page.goto('https://tts.test/');
    await page.evaluate(() => {
      const save = new Map(), local = new Map(); window.asked = [];
      window.risuai = { pluginStorage: { getItem: async k => save.get(k), setItem: async (k, v) => save.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
        requestPluginPermission: async () => true, getDatabase: async () => ({ modules: [], enabledModules: [], characters: [] }), setDatabase: async () => {}, getCurrentCharacterIndex: async () => -1, getCharacterFromIndex: async () => null, getCharacter: async () => null,
        nativeFetch: async (url, options) => { window.asked.push([url, options.method, options.headers?.Authorization || '', options.body ? JSON.parse(options.body) : null]);
          return url.endsWith('/v1/audio/voices') ? { ok: true, json: async () => ({ data: [{ id: 'sample' }, { id: 'alice' }] }) } : { ok: true, arrayBuffer: async () => new Uint8Array(2048).buffer }; } };
      window.Audio = class { play() { return Promise.resolve(); } pause() {} load() {} removeAttribute() {} };
      window.AudioContext = class { state = 'running'; destination = {}; resume() { return Promise.resolve(); } createGain() { return { gain: { value: 1 }, connect() { return this; } }; } createMediaElementSource() { return { connect(n) { return n; } }; } };
    });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(async () => { document.documentElement.classList.add('nx-ux-on'); document.documentElement.dataset.theme = 'dark'; const style = document.createElement('style'); style.textContent = window.settingsUxCss; document.head.append(style); document.body.innerHTML = '<div id="nx-shell" class="nx-ux">' + window.previewChrome() + '</div>'; window.setSoundPage('tts'); document.getElementById('nx-main').innerHTML = window.ttsSettingsHtml(); await window.mountTts(); });
    await page.locator('#tts-power').check();
    await page.waitForFunction(() => !document.getElementById('tts-controls').disabled);
    await page.waitForFunction(() => document.getElementById('audio-unlock-dialog').open);
    await page.locator('#audio-unlock-cancel').click();
    // 모델 설정 is a page of its own in the side menu.
    const models = () => page.evaluate(async () => { window.setSoundPage('models'); document.getElementById('nx-main').innerHTML = window.ttsSettingsHtml(); await window.mountTts(); });
    await models();
    await page.waitForFunction(() => !document.getElementById('tts-models').hidden);
    // Fish, as every save was: its fields shown, Irodori's not.
    assert.equal(await page.locator('#tts-engine').inputValue(), 'fish');
    assert.equal(await page.locator('#tts-fish-key').isVisible(), true);
    assert.equal(await page.locator('#tts-irodori-group').isVisible(), false);
    assert.equal(await page.locator('#tts-engine-group').evaluate(node => node.nextElementSibling?.tagName === 'HR' && !!node.closest('#tts-models')), true, 'the choice heads the tab');
    await page.locator('#tts-engine').selectOption('irodori');
    await page.waitForFunction(() => window.ttsData().settings.engine === 'irodori');
    assert.equal(await page.locator('#tts-fish-key').isVisible(), false, 'Fish\'s fields are out of sight');
    assert.equal(await page.locator('#tts-irodori-url').isVisible(), true);
    assert.equal(await page.locator('#tts-irodori-url').inputValue(), 'http://127.0.0.1:8088');
    assert.equal(await page.locator('#tts-llm-model').isVisible(), true, 'the other model sections stay');
    // 목소리 불러오기: the server's voices, the first one chosen when none was.
    await page.locator('#tts-irodori-key').fill('secret'); await page.locator('#tts-irodori-key').dispatchEvent('change');
    await page.locator('#tts-irodori-list').click();
    await page.waitForFunction(() => window.ttsData().settings.irodori.voice === 'sample');
    assert.match(await page.locator('#tts-test-irodori-result').textContent(), /목소리 2개: sample, alice/);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#tts-irodori-voice-list option')].map(o => o.value)), ['sample', 'alice']);
    assert.deepEqual(await page.evaluate(() => window.asked.at(-1).slice(0, 3)), ['http://127.0.0.1:8088/v1/audio/voices', 'GET', 'Bearer secret']);
    // Every field is saved as it is changed.
    await page.locator('#tts-irodori-voice').fill('alice'); await page.locator('#tts-irodori-voice').dispatchEvent('change');
    await page.locator('#tts-irodori-format').selectOption('wav');
    await page.locator('#tts-irodori-concurrency').fill('2'); await page.locator('#tts-irodori-concurrency').dispatchEvent('change');
    await page.waitForFunction(() => { const i = window.ttsData().settings.irodori; return i.voice === 'alice' && i.format === 'wav' && i.concurrency === 2 && i.key === 'secret'; });
    await page.locator('#tts-test-irodori').click();
    await page.waitForFunction(() => /연결 성공/.test(document.getElementById('tts-test-irodori-result').textContent));
    assert.match(await page.locator('#tts-test-irodori-result').textContent(), /연결 성공 · 음성 2\.0 KB \(alice\)/);
    assert.deepEqual(await page.evaluate(() => window.asked.at(-1)), ['http://127.0.0.1:8088/v1/audio/speech', 'POST', 'Bearer secret', { model: 'irodori-tts', input: 'こんにちは。接続テストです。', voice: 'alice', response_format: 'wav' }]);
    if (process.env.IRODORI_SHOT) await page.screenshot({ path: process.env.IRODORI_SHOT });
    // Reopened, the tab stands as it was left; back on Fish, Fish's fields return.
    await models();
    assert.equal(await page.locator('#tts-engine').inputValue(), 'irodori');
    assert.equal(await page.locator('#tts-irodori-voice').inputValue(), 'alice');
    assert.equal(await page.locator('#tts-fish-key').isVisible(), false);
    await page.locator('#tts-engine').selectOption('fish');
    await page.waitForFunction(() => window.ttsData().settings.engine === 'fish');
    assert.equal(await page.locator('#tts-fish-key').isVisible(), true); assert.equal(await page.locator('#tts-irodori-group').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
