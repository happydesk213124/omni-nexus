import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// 모델 설정 › Gemini TTS: its fields in place of Fish's, saved as changed (the key, or a Vertex service account read from
// its JSON); its connection tested; 「Gemini 목소리」 stands where 음성 목록 does, the list read in; a card picks one.
const built = await build({ stdin: { contents: `import {mountTts,ttsSettingsHtml} from './src/tts-ui/mount';import {ttsData,saveTtsData} from './src/storage/tts-store';import {omniTts} from './src/services/tts-runtime';import {settingsUxCss} from './src/settings-ux/styles';import {previewChrome} from './src/settings-ux/tab-html';import {setSoundPage} from './src/sound-ui/page';import {geminiPersona,voiceDesignOf} from './src/services/gemini-voices';Object.assign(window,{geminiPersona,voiceDesignOf,setSoundPage,mountTts,ttsSettingsHtml,ttsData,saveTtsData,omniTts,settingsUxCss,previewChrome});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });

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
          // Voices: the list; a POST designs one (its id, its sample); a DELETE lets one go.
          if (url.includes('/v1beta/voices') && options.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: `voice_new${window.made = (window.made || 0) + 1}`, type: 'prompted', sample_audio: { mime_type: 'audio/wav', data: wav() } }) };
          if (url.includes('/v1beta/voices') && options.method === 'DELETE') return { ok: true, status: 200, json: async () => ({}) };
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
    // The tap on the switch unlocked the voice by itself: no popup.
    await page.waitForFunction(() => window.omniTts.player.ready);
    assert.equal(await page.evaluate(() => document.getElementById('audio-unlock-dialog').open), false);
    await open('models');
    await page.waitForFunction(() => !document.getElementById('tts-models').hidden);
    assert.equal(await page.locator('#tts-gemini-group').isVisible(), false, 'Fish first, as every save was');
    await page.locator('#tts-engine').selectOption('gemini');
    await page.waitForFunction(() => window.ttsData().settings.engine === 'gemini');
    assert.equal(await page.locator('#tts-fish-key').isVisible(), false);
    assert.equal(await page.locator('#tts-irodori-group').isVisible(), false);
    assert.equal(await page.locator('#tts-gemini-key').isVisible(), true);
    assert.equal(await page.locator('#tts-gemini-sa').isVisible(), false, 'the service account only for Vertex');
    // The key, and the model and voice as typed. Ready to speak, the voice list is read in by itself, once: the thirty
    // prebuilt voices are all a cast has until then.
    await page.locator('#tts-gemini-key').fill('AIza-test'); await page.locator('#tts-gemini-key').dispatchEvent('change');
    await page.waitForFunction(() => window.ttsData().geminiVoices.length === 31 && window.ttsData().settings.gemini.listed === true);
    // (In the language the lines are read in: the translation's target, Japanese unless changed.)
    assert.match(await page.evaluate(() => window.asked.at(-1).url), /\/v1beta\/voices\?page_size=1000&language_code=ja$/);
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
    // 「Gemini 목소리」 where 음성 목록 is: the 30 prebuilt and what the list held (Kore once).
    await open('tts');
    assert.equal(await page.locator('[data-tts-tab="tts-voices"]').isVisible(), false);
    assert.equal(await page.locator('[data-tts-tab="tts-gemini-voices"]').isVisible(), true);
    await page.locator('[data-tts-tab="tts-gemini-voices"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#gv-list .gv-row').length === 31);
    assert.equal(await page.evaluate(() => window.ttsData().geminiVoices.filter(v => v.fishId === 'Kore').length), 1, 'Kore once');
    const lists = () => page.evaluate(() => window.asked.filter(a => a.method === 'GET' && a.url.includes('/v1beta/voices')).length);
    assert.equal(await lists(), 1, 'read by itself once only');
    await page.locator('#gv-language').fill('ko');
    await page.locator('#gv-load').click();
    await page.waitForFunction(() => /목록에 새 목소리가 없습니다\(지금 31개\)/.test(document.getElementById('gv-status').textContent));
    assert.match(await page.evaluate(() => window.asked.at(-1).url), /language_code=ko$/);
    // + 목소리 만들기: a description, a stored voice, in the list as one made here (it can be taken off).
    await page.locator('#gv-new').click();
    await page.locator('#gv-new-name').fill('나른한 언니'); await page.locator('#gv-new-gender').selectOption('female');
    await page.locator('#gv-new-about').fill('낮고 나른한 20대 여성');
    await page.locator('#gv-new-make').click();
    await page.waitForFunction(() => window.ttsData().geminiVoices.some(v => v.fishId === 'voice_new1'));
    assert.deepEqual(await page.evaluate(() => window.asked.filter(a => a.method === 'POST' && a.url.endsWith('/v1beta/voices')).at(-1).body), { store: true, voice: { type: 'prompted', display_name: '나른한 언니', gender: 'female', language_code: 'ja-JP', description: '낮고 나른한 20대 여성', prompted: { input: '낮고 나른한 20대 여성' } } });
    assert.equal(await page.locator('#gv-list .gv-row[data-own="1"]').count(), 2, 'voice_haru and the one just made');
    await page.locator('#gv-list .gv-row[data-key="gemini:voice_new1"] button.danger').click();
    await page.waitForFunction(() => !window.ttsData().geminiVoices.some(v => v.fishId === 'voice_new1'));
    assert.deepEqual(await page.evaluate(() => { const a = window.asked.at(-1); return [a.method, a.url]; }), ['DELETE', 'https://generativelanguage.googleapis.com/v1beta/voices/voice_new1']);
    // 캐릭터 특징을 말투에: a card's traits as the style of its lines, on a shared voice; none on a voice made for it.
    assert.equal(await page.evaluate(() => window.geminiPersona({ tags: ['차분함'], voiceKey: '', gender: 'female' }, 'Kore')), 'female character voice: calm');
    assert.equal(await page.evaluate(() => window.geminiPersona({ tags: ['차분함'], voiceKey: '', gender: 'female' }, 'voice_x')), '');
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
    // 이 캐릭터만의 목소리 새로 만들기: designed from the sheet (her gender, her traits), hers from then on.
    await page.locator('#c-tags').fill('차분함'); await page.locator('#c-tags').dispatchEvent('change');
    await page.locator('#c-gemini-design').click();
    await page.waitForFunction(() => window.ttsData().characters.find(c => c.id === 't-haru')?.geminiKey === 'gemini:voice_new2');
    const designed = await page.evaluate(() => window.asked.filter(a => a.method === 'POST' && a.url.endsWith('/v1beta/voices')).at(-1).body.voice);
    assert.deepEqual([designed.display_name, designed.gender, designed.language_code], ['하루', 'female', 'ja-JP']);
    assert.match(designed.prompted.input, /^A distinctive female voice for a story character: calm\./);
    assert.equal(await page.locator('#c-irodori-voice').inputValue(), 'gemini:voice_new2');
    // 캐릭터마다 새 목소리: only who has none of their own (하루 has hers now).
    await page.evaluate(async () => { document.getElementById('character-dialog').close(); window.ttsData().characters.push({ id: 't-mina', scope: 'global', name: '미나', surname: '', givenName: '미나', surnameAliases: [], givenAliases: [], triggers: ['미나'], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 }); await window.saveTtsData(); });
    await open('tts');
    await page.locator('[data-tts-tab="tts-gemini-voices"]').click();
    await page.locator('#gv-each').click();
    await page.waitForFunction(() => /새 목소리 1개를 만들어 캐릭터에 지정했습니다/.test(document.getElementById('gv-status').textContent));
    assert.equal(await page.evaluate(() => window.ttsData().characters.find(c => c.id === 't-mina').geminiKey), 'gemini:voice_new3');
    assert.equal(await page.evaluate(() => window.ttsData().characters.find(c => c.id === 't-haru').geminiKey), 'gemini:voice_new2', 'hers stays');
    // The voice of a combination of traits: made the first time it comes up, the same one for whoever has it after
    // (in whatever order their card holds the words).
    await page.evaluate(async () => {
      const card = (id, name, tags) => ({ id, scope: 'global', name, surname: '', givenName: name, surnameAliases: [], givenAliases: [], triggers: [name], tags, gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 });
      window.ttsData().characters.push(card('t-a', '가은', ['소심한', '부드러운']), card('t-b', '나은', ['부드러운', '소심한']), card('t-c', '다은', ['쿨함']));
      await window.saveTtsData();
    });
    await page.locator('#gv-each').click();
    await page.waitForFunction(() => /새 목소리 2개를 만들어 캐릭터에 지정했습니다\. 같은 특징이라 이미 만든 목소리를 쓴 캐릭터 1명/.test(document.getElementById('gv-status').textContent));
    const keys = await page.evaluate(() => ['t-a', 't-b', 't-c'].map(id => window.ttsData().characters.find(c => c.id === id).geminiKey));
    assert.equal(keys[0], keys[1], 'the same traits: one voice');
    assert.notEqual(keys[0], keys[2]);
    assert.equal(await page.evaluate(key => window.ttsData().geminiVoices.find(v => v.key === key).name, keys[0]), '여성 · 소심한 · 부드러운');
    assert.match(await page.evaluate(key => window.ttsData().geminiVoices.find(v => v.key === key).caption, keys[0]), /^A distinctive female voice for a story character: gentle, timid\./);
    assert.equal(await page.evaluate(() => window.ttsData().settings.gemini.assign), 'design', 'a speaker with no voice gets the voice of their traits unless switched to the list');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
