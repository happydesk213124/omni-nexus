import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// 모델 설정 › Gemini TTS: its fields in place of Fish's, saved as changed (the key, or a Vertex service account read from
// its JSON); its connection tested; 「Gemini 목소리」 stands where 음성 목록 does, the list read in; a card picks one.
const built = await build({ stdin: { contents: `import {mountTts,ttsSettingsHtml} from './src/tts-ui/mount';import {ttsData,saveTtsData} from './src/storage/tts-store';import {omniTts} from './src/services/tts-runtime';import {settingsUxCss} from './src/settings-ux/styles';import {previewChrome} from './src/settings-ux/tab-html';import {setSoundPage} from './src/sound-ui/page';Object.assign(window,{setSoundPage,mountTts,ttsSettingsHtml,ttsData,saveTtsData,omniTts,settingsUxCss,previewChrome});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });

test('모델 설정 › Gemini TTS: its fields saved, its connection tested; 「Gemini 목소리」 in place of 음성 목록, the list read in; a card speaks with the one it picks', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', d => d.accept());
    await page.route('https://tts.test/', route => route.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="background:#0b0f18;color:#eee;font:14px sans-serif"></body></html>' })); await page.goto('https://tts.test/');
    await page.evaluate(() => {
      const save = new Map(), local = new Map(); window.asked = [];
      // A 24 kHz WAV of a few samples, as Gemini 3.8 answers.
      const wav = () => { const pcm = 64, b = new ArrayBuffer(44 + pcm), v = new DataView(b), put = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0))); put(0, 'RIFF'); v.setUint32(4, 36 + pcm, true); put(8, 'WAVE'); put(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 24000, true); v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); put(36, 'data'); v.setUint32(40, pcm, true); return btoa(String.fromCharCode(...new Uint8Array(b))); };
      window.risuai = { pluginStorage: { getItem: async k => save.get(k), setItem: async (k, v) => save.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
        requestPluginPermission: async () => true, getDatabase: async () => ({ modules: [], enabledModules: [], characters: [] }), setDatabase: async () => {}, getCurrentCharacterIndex: async () => -1, getCharacterFromIndex: async () => null, getCharacter: async () => null,
        nativeFetch: async (url, options) => {
          window.asked.push({ url, method: options.method, key: options.headers?.['x-goog-api-key'] || '', body: options.body ? JSON.parse(options.body) : null });
          if (url.includes('/v1beta/voices')) return { ok: true, status: 200, json: async () => ({ voices: [{ id: 'voice_haru', display_name: 'Haru', gender: 'FEMALE', description: 'soft, sleepy', language_code: 'ko-KR' }, { id: 'Kore', display_name: 'Kore' }] }) };
          return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav() } }] } }] }) };
        } };
      window.Audio = class { play() { return Promise.resolve(); } pause() {} load() {} removeAttribute() {} };
      window.AudioContext = class { state = 'running'; destination = {}; resume() { return Promise.resolve(); } createGain() { return { gain: { value: 1 }, connect() { return this; } }; } createMediaElementSource() { return { connect(n) { return n; } }; } };
    });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    const open = name => page.evaluate(async name => { window.setSoundPage(name); document.getElementById('nx-main').innerHTML = window.ttsSettingsHtml(); await window.mountTts(); }, name);
    await page.evaluate(async () => { document.documentElement.classList.add('nx-ux-on'); document.documentElement.dataset.theme = 'dark'; const style = document.createElement('style'); style.textContent = window.settingsUxCss; document.head.append(style); document.body.innerHTML = '<div id="nx-shell" class="nx-ux">' + window.previewChrome() + '</div>'; });
    await open('tts');
    await page.locator('#tts-power').check();
    await page.waitForFunction(() => document.getElementById('audio-unlock-dialog').open);
    await page.locator('#audio-unlock-cancel').click();
    await open('models');
    await page.waitForFunction(() => !document.getElementById('tts-models').hidden);
    assert.equal(await page.locator('#tts-gemini-group').isVisible(), false, 'Fish first, as every save was');
    await page.locator('#tts-engine').selectOption('gemini');
    await page.waitForFunction(() => window.ttsData().settings.engine === 'gemini');
    assert.equal(await page.locator('#tts-fish-key').isVisible(), false);
    assert.equal(await page.locator('#tts-irodori-group').isVisible(), false);
    assert.equal(await page.locator('#tts-gemini-key').isVisible(), true);
    assert.equal(await page.locator('#tts-gemini-sa').isVisible(), false, 'the service account only for Vertex');
    // The key, and the model and voice as typed.
    await page.locator('#tts-gemini-key').fill('AIza-test'); await page.locator('#tts-gemini-key').dispatchEvent('change');
    await page.locator('#tts-gemini-voice').fill('Puck'); await page.locator('#tts-gemini-voice').dispatchEvent('change');
    await page.waitForFunction(() => { const g = window.ttsData().settings.gemini; return g.key === 'AIza-test' && g.voice === 'Puck' && g.model === 'gemini-3.8-flash-tts'; });
    await page.locator('#tts-test-gemini').click();
    await page.waitForFunction(() => /연결 성공/.test(document.getElementById('tts-test-gemini-result').textContent));
    assert.match(await page.locator('#tts-test-gemini-result').textContent(), /gemini-3\.8-flash-tts · Puck/);
    const said = await page.evaluate(() => window.asked.at(-1));
    assert.equal(said.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent');
    assert.equal(said.key, 'AIza-test');
    assert.deepEqual(said.body.generationConfig.speechConfig, { voiceConfig: { voice: 'Puck' } });
    // Vertex: its JSON (read from its file) and region; what it is, said under it (never the key).
    await page.locator('#tts-gemini-via').selectOption('vertex');
    assert.equal(await page.locator('#tts-gemini-key').isVisible(), false);
    const account = JSON.stringify({ type: 'service_account', project_id: 'proj-1', client_email: 'tts@proj-1.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n' });
    await page.locator('#tts-gemini-sa-input').setInputFiles({ name: 'key.json', mimeType: 'application/json', buffer: Buffer.from(account) });
    await page.waitForFunction(() => window.ttsData().settings.gemini.via === 'vertex' && window.ttsData().settings.gemini.serviceAccountJson.includes('proj-1'));
    assert.equal(await page.locator('#tts-gemini-sa-status').textContent(), 'tts@proj-1.iam.gserviceaccount.com · 프로젝트 proj-1');
    await page.locator('#tts-gemini-via').selectOption('studio');
    await page.waitForFunction(() => window.ttsData().settings.gemini.via === 'studio');
    // 「Gemini 목소리」 where 음성 목록 is: the 30 prebuilt; 목록 불러오기 adds the key's own and the library's.
    await open('tts');
    assert.equal(await page.locator('[data-tts-tab="tts-voices"]').isVisible(), false);
    assert.equal(await page.locator('[data-tts-tab="tts-gemini-voices"]').isVisible(), true);
    await page.locator('[data-tts-tab="tts-gemini-voices"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#gv-list .gv-row').length === 30);
    await page.locator('#gv-language').fill('ko');
    await page.locator('#gv-load').click();
    await page.waitForFunction(() => window.ttsData().geminiVoices.length === 31);
    assert.match(await page.locator('#gv-status').textContent(), /목소리 2개를 불러왔습니다. 지금 31개/);
    assert.match(await page.evaluate(() => window.asked.at(-1).url), /\/v1beta\/voices\?page_size=1000&language_code=ko$/);
    assert.equal(await page.evaluate(() => window.ttsData().geminiVoices.filter(v => v.fishId === 'Kore').length), 1, 'Kore once');
    // A card: its Gemini voice chosen in the sheet (its delivery kept), saved apart from its Fish voice.
    await page.evaluate(async () => { window.ttsData().characters.push({ id: 't-haru', scope: 'global', name: '하루', surname: '', givenName: '하루', surnameAliases: [], givenAliases: [], triggers: ['하루'], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 }); await window.saveTtsData(); });
    await open('people');
    await page.locator('.char-card', { hasText: '하루' }).dblclick();
    await page.waitForFunction(() => document.getElementById('character-dialog').open);
    assert.equal(await page.locator('#c-irodori-wrap span').textContent(), 'Gemini 목소리');
    assert.equal(await page.locator('#c-tone').isVisible(), true, 'Gemini takes the delivery in words');
    assert.equal(await page.locator('#c-id').isVisible(), false, "Fish's voice id is out of sight");
    await page.locator('#c-irodori-voice').selectOption('gemini:voice_haru');
    await page.locator('#c-irodori-voice').dispatchEvent('change');
    await page.waitForFunction(() => window.ttsData().characters.find(c => c.id === 't-haru')?.geminiKey === 'gemini:voice_haru');
    // Heard with it.
    await page.locator('#test-character-editor').click();
    await page.waitForFunction(() => window.asked.some(a => a.body?.generationConfig?.speechConfig?.voiceConfig?.voice === 'voice_haru'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
