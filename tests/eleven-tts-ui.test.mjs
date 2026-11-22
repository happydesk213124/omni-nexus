import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// 모델 설정 › ElevenLabs: its fields in place of Fish's, saved as changed; the account's voices read in by themselves
// once the key is there; its connection tested; 「ElevenLabs 목소리」 stands where 음성 목록 does; a card picks one.
const built = await build({ stdin: { contents: `import {mountTts,ttsSettingsHtml} from './src/tts-ui/mount';import {ttsData,saveTtsData} from './src/storage/tts-store';import {omniTts} from './src/services/tts-runtime';import {settingsUxCss} from './src/settings-ux/styles';import {previewChrome} from './src/settings-ux/tab-html';import {setSoundPage} from './src/sound-ui/page';Object.assign(window,{setSoundPage,mountTts,ttsSettingsHtml,ttsData,saveTtsData,omniTts,settingsUxCss,previewChrome});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
const RACHEL = '21m00Tcm4TlvDq8ikWAM', BELLA = 'EXAVITQu4vr4xnSDxMaL', EXTRA = 'pNInz6obpgDQGcFmaJgB';

test('모델 설정 › ElevenLabs: its fields saved, the list read once, its connection tested; 「ElevenLabs 목소리」 in place of 음성 목록; a card speaks with the one it picks', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', d => d.accept());
    await page.route('https://tts.test/', route => route.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="background:#0b0f18;color:#eee;font:14px sans-serif"></body></html>' })); await page.goto('https://tts.test/');
    await page.evaluate(([RACHEL, BELLA, EXTRA]) => {
      const save = new Map(), local = new Map(); window.asked = [];
      window.risuai = { pluginStorage: { getItem: async k => save.get(k), setItem: async (k, v) => save.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
        requestPluginPermission: async () => true, getDatabase: async () => ({ modules: [], enabledModules: [], characters: [] }), setDatabase: async () => {}, getCurrentCharacterIndex: async () => -1, getCharacterFromIndex: async () => null, getCharacter: async () => null,
        nativeFetch: async (url, options) => {
          window.asked.push({ url, method: options.method, key: options.headers?.['xi-api-key'] || '', body: options.body ? JSON.parse(options.body) : null });
          if (url.includes('/v2/voices')) return { ok: true, status: 200, json: async () => ({ voices: [{ voice_id: RACHEL, name: 'Rachel', labels: { gender: 'female', age: 'young', description: 'calm' } }, { voice_id: BELLA, name: 'Bella', labels: { gender: 'female', descriptive: 'soft' } }], has_more: false }) };
          if (url.includes('/v1/voices/')) return { ok: true, status: 200, json: async () => ({ voice_id: EXTRA, name: 'Adam', labels: { gender: 'male', age: 'middle_aged' } }) };
          return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(64).buffer };
        } };
      window.Audio = class { play() { return Promise.resolve(); } pause() {} load() {} removeAttribute() {} };
      window.AudioContext = class { state = 'running'; destination = {}; resume() { return Promise.resolve(); } createGain() { return { gain: { value: 1 }, connect() { return this; } }; } createMediaElementSource() { return { connect(n) { return n; } }; } };
    }, [RACHEL, BELLA, EXTRA]);
    await page.addScriptTag({ content: built.outputFiles[0].text });
    const open = name => page.evaluate(async name => { window.setSoundPage(name); document.getElementById('nx-main').innerHTML = window.ttsSettingsHtml(); await window.mountTts(); }, name);
    await page.evaluate(async () => { document.documentElement.classList.add('nx-ux-on'); document.documentElement.dataset.theme = 'dark'; const style = document.createElement('style'); style.textContent = window.settingsUxCss; document.head.append(style); document.body.innerHTML = '<div id="nx-shell" class="nx-ux">' + window.previewChrome() + '</div>'; });
    await open('tts');
    await page.locator('#tts-power').check();
    await page.waitForFunction(() => window.omniTts.player.ready);
    await open('models');
    await page.waitForFunction(() => !document.getElementById('tts-models').hidden);
    assert.equal(await page.locator('#tts-eleven-group').isVisible(), false, 'Fish first, as every save was');
    await page.locator('#tts-engine').selectOption('elevenlabs');
    await page.waitForFunction(() => window.ttsData().settings.engine === 'elevenlabs');
    assert.equal(await page.locator('#tts-fish-key').isVisible(), false);
    assert.equal(await page.locator('#tts-gemini-group').isVisible(), false);
    assert.equal(await page.locator('#tts-irodori-group').isVisible(), false);
    assert.equal(await page.locator('#tts-eleven-key').isVisible(), true);
    assert.match(await page.locator('#tts-eleven-model-note').textContent(), /eleven_v3: 대사 안 \[감정 태그\]/);
    // The key: the account's voices are read in by themselves, once, and the first becomes the default voice.
    await page.locator('#tts-eleven-key').fill('sk_test'); await page.locator('#tts-eleven-key').dispatchEvent('change');
    await page.waitForFunction(RACHEL => { const s = window.ttsData().settings.eleven; return s.key === 'sk_test' && s.listed === true && s.voice === RACHEL && window.ttsData().elevenVoices.length === 2; }, RACHEL);
    await page.waitForFunction(RACHEL => document.getElementById('tts-eleven-voice').value === RACHEL, RACHEL);
    assert.equal(await page.locator('#tts-eleven-voice-list option').count(), 2, 'the voices offered by name under the field');
    // A model that reads tags aloud says so under the field.
    await page.locator('#tts-eleven-model').fill('eleven_multilingual_v2'); await page.locator('#tts-eleven-model').dispatchEvent('change');
    await page.waitForFunction(() => window.ttsData().settings.eleven.model === 'eleven_multilingual_v2');
    assert.match(await page.locator('#tts-eleven-model-note').textContent(), /태그와 억양은 빼고 대사만/);
    await page.locator('#tts-eleven-model').fill(''); await page.locator('#tts-eleven-model').dispatchEvent('change');
    await page.waitForFunction(() => window.ttsData().settings.eleven.model === 'eleven_v3');
    await page.locator('#tts-test-elevenlabs').click();
    await page.waitForFunction(() => /연결 성공/.test(document.getElementById('tts-test-elevenlabs-result').textContent));
    assert.match(await page.locator('#tts-test-elevenlabs-result').textContent(), new RegExp(`eleven_v3 · ${RACHEL}`));
    const said = await page.evaluate(() => window.asked.at(-1));
    assert.equal(said.url, `https://api.elevenlabs.io/v1/text-to-speech/${RACHEL}?output_format=mp3_44100_128`);
    assert.equal(said.key, 'sk_test'); assert.equal(said.body.model_id, 'eleven_v3');
    // 「ElevenLabs 목소리」 where 음성 목록 is.
    await open('tts');
    assert.equal(await page.locator('[data-tts-tab="tts-voices"]').isVisible(), false);
    assert.equal(await page.locator('[data-tts-tab="tts-gemini-voices"]').isVisible(), false);
    assert.equal(await page.locator('[data-tts-tab="tts-eleven-voices"]').isVisible(), true);
    await page.locator('[data-tts-tab="tts-eleven-voices"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#ev-list .ev-row').length === 2);
    assert.equal(await page.evaluate(() => window.asked.filter(a => a.url.includes('/v2/voices')).length), 1, 'read by itself once only');
    assert.match(await page.locator(`#ev-list .ev-row[data-key="eleven:${RACHEL}"] .voice-folder-label`).textContent(), /기본 목소리 · ID/);
    assert.match(await page.locator(`#ev-list .ev-row[data-key="eleven:${RACHEL}"] .voice-tags`).textContent(), /young, calm/);
    // The list's tiles are 음성 목록's: laid out as its grid, not one a line.
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('ev-list')).display), await page.evaluate(() => getComputedStyle(document.getElementById('voice-list')).display));
    // One not in the list, added by its id.
    await page.locator('#ev-id').fill(EXTRA); await page.locator('#ev-add').click();
    await page.waitForFunction(() => window.ttsData().elevenVoices.length === 3);
    assert.equal(await page.evaluate(() => window.asked.at(-1).url), `https://api.elevenlabs.io/v1/voices/${EXTRA}`);
    assert.match(await page.locator('#ev-status').textContent(), /「Adam」 목소리를 목록에 넣었습니다/);
    // 기본 목소리로: the one selected speaks for cards with none.
    await page.locator(`#ev-list .ev-row[data-key="eleven:${BELLA}"]`).click();
    await page.locator('#ev-default').click();
    await page.waitForFunction(BELLA => window.ttsData().settings.eleven.voice === BELLA, BELLA);
    // 목록에서 빼기: off this list only (no request to ElevenLabs).
    const requests = await page.evaluate(() => window.asked.length);
    await page.locator(`#ev-list .ev-row[data-key="eleven:${EXTRA}"]`).click();
    await page.locator('#ev-remove').click();
    await page.waitForFunction(() => window.ttsData().elevenVoices.length === 2);
    assert.equal(await page.evaluate(() => window.asked.length), requests);
    // A card: its ElevenLabs voice chosen in the sheet, saved apart from its Fish voice, and heard with it.
    const fish = await page.evaluate(async () => { const voice = window.ttsData().voices[0]; window.ttsData().characters.push({ id: 't-haru', scope: 'global', name: '하루', surname: '', givenName: '하루', surnameAliases: [], givenAliases: [], triggers: ['하루'], tags: [], gender: 'female', voiceKey: voice.key, fishId: voice.fishId, fixed: false, gain: 0 }); await window.saveTtsData(); return voice.key; });
    await open('people');
    await page.locator('.char-card', { hasText: '하루' }).dblclick();
    await page.waitForFunction(() => document.getElementById('character-dialog').open);
    assert.equal(await page.locator('#c-irodori-wrap span').textContent(), 'ElevenLabs 목소리');
    assert.equal(await page.locator('#c-tone').isVisible(), true, 'the base delivery goes to ElevenLabs as [cue]s');
    assert.equal(await page.locator('#c-id').isVisible(), false, "Fish's voice id is out of sight");
    assert.equal(await page.locator('#c-gemini-design').isVisible(), false, "Gemini's voice design is not ElevenLabs's");
    await page.locator('#c-irodori-voice').selectOption(`eleven:${RACHEL}`);
    await page.locator('#c-irodori-voice').dispatchEvent('change');
    await page.waitForFunction(RACHEL => window.ttsData().characters.find(c => c.id === 't-haru')?.elevenKey === `eleven:${RACHEL}`, RACHEL);
    assert.equal(await page.evaluate(() => window.ttsData().characters.find(c => c.id === 't-haru').voiceKey), fish, 'its Fish voice is kept beside it');
    await page.locator('#test-character-editor').click();
    await page.waitForFunction(RACHEL => window.asked.some(a => a.url.includes(`/text-to-speech/${RACHEL}`) && /Nice to meet you/.test(a.body?.text || '')), RACHEL);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
