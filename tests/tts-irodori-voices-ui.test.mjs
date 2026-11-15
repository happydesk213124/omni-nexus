import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('Irodori 목소리: the tab stands where 음성 목록 does; presets are made from the server, a file and a description; a card chooses one', async () => {
  const built = await build({ stdin: { contents: `import {mountTts,ttsSettingsHtml} from './src/tts-ui/mount';import {ttsData,updateTtsSettings} from './src/storage/tts-store';import {omniTts} from './src/services/tts-runtime';import {settingsUxCss} from './src/settings-ux/styles';import {previewChrome} from './src/settings-ux/tab-html';import {setSoundPage} from './src/sound-ui/page';Object.assign(window,{setSoundPage,mountTts,ttsSettingsHtml,ttsData,updateTtsSettings,omniTts,settingsUxCss,previewChrome});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }), errors = [], alerts = [];
    page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
    // A confirm (deleting a preset) is agreed to; an alert is an action that failed, kept to be read.
    page.on('dialog', d => { if (d.type() === 'alert') alerts.push(d.message()); return d.accept(); });
    await page.route('https://tts.test/', route => route.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="background:#0b0f18;color:#eee;font:14px sans-serif"></body></html>' })); await page.goto('https://tts.test/');
    await page.evaluate(() => {
      const save = new Map(), local = new Map(); window.asked = []; window.llm = [];
      window.risuai = { pluginStorage: { getItem: async k => save.get(k), setItem: async (k, v) => save.set(k, v) }, getLocalPluginStorage: async () => ({ getItem: async k => local.get(k), setItem: async (k, v) => local.set(k, v), removeItem: async k => local.delete(k) }),
        requestPluginPermission: async () => true, getCurrentLorebookEntries: async () => [],
        runLLMModel: async options => { window.llm.push(options.messages); return { success: true, content: JSON.stringify({ name: '하린', gender: 'female', tags: ['young adult', 'tsundere', 'high-pitched'], caption: '素直になれない若い女性の声。つんつんと話す。' }) }; }, getDatabase: async () => ({ modules: [], enabledModules: [], characters: [] }), setDatabase: async () => {}, getCurrentCharacterIndex: async () => -1, getCharacterFromIndex: async () => null, getCharacter: async () => null,
        nativeFetch: async (url, options) => {
          if (String(url).includes('translate.googleapis.com')) return { ok: true, json: async () => [[[new URL(url).searchParams.get('q')]]] };
          if (url.endsWith('/v1/audio/voices') && options.method === 'GET') { window.asked.push(['list']); return { ok: true, json: async () => ({ data: [{ id: 'none', no_ref: true }, { id: 'sample' }, { id: 'alice' }] }) }; }
          if (url.endsWith('/v1/audio/voices')) {
            const form = new TextDecoder('latin1').decode(options.body), id = /name="voice_id"\r\n\r\n([^\r]+)/.exec(form)?.[1], file = /filename="([^"]+)"/.exec(form)?.[1];
            window.asked.push(['upload', id, file, options.body.length]); return { ok: true, json: async () => ({ id }) };
          }
          window.asked.push(['speech', JSON.parse(options.body)]);
          if (window.slow) await new Promise(done => setTimeout(done, 150));
          return { ok: true, arrayBuffer: async () => new Uint8Array(2048).buffer };
        } };
      window.Audio = class { play() { return Promise.resolve(); } pause() {} load() {} removeAttribute() {} };
      window.AudioContext = class { state = 'running'; destination = {}; resume() { return Promise.resolve(); } createGain() { return { gain: { value: 1 }, connect() { return this; } }; } createMediaElementSource() { return { connect(n) { return n; } }; } };
    });
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.evaluate(() => { document.documentElement.classList.add('nx-ux-on'); document.documentElement.dataset.theme = 'dark'; const style = document.createElement('style'); style.textContent = window.settingsUxCss; document.head.append(style); document.body.innerHTML = '<div id="nx-shell" class="nx-ux">' + window.previewChrome() + '</div>'; });
    const open = () => page.evaluate(async () => { window.setSoundPage('tts'); document.getElementById('nx-main').innerHTML = window.ttsSettingsHtml(); await window.mountTts(); });
    const presets = () => page.evaluate(() => window.ttsData().irodoriVoices.map(v => [v.name, v.fishId, v.gender, v.tags.join('|'), v.caption || '']));
    const last = kind => page.evaluate(k => window.asked.filter(row => row[0] === k).at(-1), kind);
    await open();
    await page.locator('#tts-power').check();
    await page.waitForFunction(() => !document.getElementById('tts-controls').disabled);
    await page.waitForFunction(() => document.getElementById('audio-unlock-dialog').open);
    await page.locator('#audio-unlock-confirm').click();
    await page.waitForFunction(() => !document.getElementById('audio-unlock-dialog').open);
    // Fish, as every save was: its library's tab, and no Irodori one.
    assert.equal(await page.locator('#tab-voices').isVisible(), true);
    assert.equal(await page.locator('#tab-irodori-voices').isVisible(), false);
    await page.evaluate(() => window.updateTtsSettings({ engine: 'irodori', irodori: { ...window.ttsData().settings.irodori, voice: 'sample' } }));
    await open();
    assert.equal(await page.locator('#tab-voices').isVisible(), false, 'Fish presets are out of sight while Irodori speaks');
    assert.equal(await page.locator('#tab-irodori-voices').isVisible(), true);
    await page.locator('#tab-irodori-voices').click();
    assert.equal(await page.locator('#tts-irodori-voices').isVisible(), true);
    assert.equal(await page.locator('#tts-voices').isVisible(), false);
    assert.match(await page.locator('#iv-list .iv-empty').textContent(), /기본 목소리\(sample\)/);
    // 서버 목소리 가져오기: one preset per server voice, once; the server's own "none" is no recording and gets none.
    await page.locator('#iv-sync').click();
    await page.waitForFunction(() => window.ttsData().irodoriVoices.length === 2);
    assert.deepEqual(await presets(), [['sample', 'sample', 'unknown', '', ''], ['alice', 'alice', 'unknown', '', '']]);
    await page.locator('#iv-sync').click();
    await page.waitForFunction(() => /모두 프리셋에 있습니다/.test(document.getElementById('tts-notice')?.textContent || ''));
    assert.equal((await presets()).length, 2);
    // + 목소리, from a description: heard first, then kept on the server under the preset's name.
    await page.locator('#iv-add').click();
    await page.locator('#iv-name').fill('Aoi 아오이'); await page.locator('#iv-gender').selectOption('여성'); await page.locator('#iv-tags').fill('젊은, 차분한');
    assert.equal(await page.locator('#iv-keep').isDisabled(), true, 'nothing to keep before a voice is made');
    await page.locator('#iv-caption').fill('落ち着いた若い女性');
    await page.locator('#iv-design').click();
    await page.waitForFunction(() => !document.getElementById('iv-keep').disabled);
    const designed = (await last('speech'))[1];
    assert.deepEqual([designed.voice, designed.response_format, designed.irodori], ['none', 'wav', { caption: '落ち着いた若い女性' }]);
    await page.locator('#iv-keep').click();
    await page.waitForFunction(() => document.getElementById('iv-id').value === 'Aoi');
    assert.deepEqual(await last('upload'), ['upload', 'Aoi', 'design.wav', (await last('upload'))[3]]);
    assert.ok((await last('upload'))[3] > 2048, 'the recording went up inside the form');
    if (process.env.IRODORI_VOICES_SHOT) await page.screenshot({ path: process.env.IRODORI_VOICES_SHOT.replace(/(\.\w+)$/, '-sheet$1') });
    await page.locator('#irodori-voice-form button.primary').click();
    await page.waitForFunction(() => window.ttsData().irodoriVoices.length === 3);
    assert.deepEqual((await presets())[2], ['Aoi 아오이', 'Aoi', 'female', '젊은|차분한', '落ち着いた若い女性']);
    // + 목소리, from a recording: the file goes up and names the preset when it has no name yet.
    await page.locator('#iv-add').click();
    assert.equal(await page.locator('#iv-name').inputValue(), '', 'a new sheet starts empty');
    await page.locator('#iv-file').setInputFiles({ name: 'ken voice.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(300, 1) });
    await page.waitForFunction(() => document.getElementById('iv-id').value === 'ken-voice');
    assert.equal(await page.locator('#iv-name').inputValue(), 'ken voice');
    assert.deepEqual((await last('upload')).slice(0, 3), ['upload', 'ken-voice', 'ken_voice.wav']);
    await page.locator('#iv-gender').selectOption('남성');
    await page.locator('#irodori-voice-form button.primary').click();
    await page.waitForFunction(() => window.ttsData().irodoriVoices.length === 4);
    // A sheet with no server voice is refused: a preset must name one.
    await page.locator('#iv-add').click(); await page.locator('#iv-name').fill('빈 목소리');
    await page.locator('#irodori-voice-form button.primary').click();
    await page.waitForFunction(() => window.ttsData().irodoriVoices.length === 4);
    assert.match(alerts.pop() || '', /서버의 목소리 ID가 비어/);
    await page.locator('#irodori-voice-dialog [data-close]').first().click();
    // ▶ 듣기 on a preset: asked of Irodori with that voice, in Japanese.
    assert.equal(await page.locator('#iv-list .iv-row').count(), 4);
    await page.locator('#iv-list .iv-row', { hasText: 'Aoi 아오이' }).locator('.tts-listen').click();
    await page.waitForFunction(() => window.asked.at(-1)[0] === 'speech' && window.asked.at(-1)[1].voice === 'Aoi');
    assert.equal((await last('speech'))[1].input, 'こんにちは。この声でお話しします。');
    if (process.env.IRODORI_VOICES_SHOT) await page.screenshot({ path: process.env.IRODORI_VOICES_SHOT });
    // 캐릭터: the sheet offers Irodori's presets, Fish's own fields step aside, and the choice is the card's.
    await page.locator('#tab-characters').click();
    await page.locator('#add-character').click();
    assert.equal(await page.locator('#c-irodori-wrap').isVisible(), true);
    assert.equal(await page.locator('#c-id').isVisible(), false, 'no Fish ID field');
    assert.equal(await page.locator('#choose-character-voice').isVisible(), true, '목록에서 선택 leads to Irodori\'s own list');
    assert.equal(await page.locator('#recommend-jev').isVisible(), true, 'the engines still recommend, among Irodori\'s presets');
    await page.locator('#c-name').fill('하린'); await page.locator('#c-name').dispatchEvent('change');
    await page.locator('#c-irodori-voice').selectOption({ label: 'Aoi 아오이' });
    await page.waitForFunction(() => { const c = window.ttsData().characters.find(row => row.name === '하린'), p = window.ttsData().irodoriVoices.find(v => v.fishId === 'Aoi'); return !!c && c.irodoriKey === p.key; });
    assert.equal(await page.locator('#character-voice-choice').textContent(), 'Aoi 아오이');
    assert.deepEqual(await page.evaluate(() => { const c = window.ttsData().characters.find(row => row.name === '하린'); return [c.voiceKey, c.fishId]; }), ['', ''], 'her Fish voice is untouched');
    if (process.env.IRODORI_VOICES_SHOT) await page.screenshot({ path: process.env.IRODORI_VOICES_SHOT.replace(/(\.\w+)$/, '-card$1') });
    await page.locator('#character-done').click();
    await page.waitForFunction(() => !document.getElementById('character-dialog').open);
    const tile = page.locator('#tts-characters .char-card', { hasText: '하린' });
    assert.match(await tile.textContent(), /Aoi 아오이/);
    // The card's ▶: its preset's voice.
    await tile.locator('.tts-listen').click();
    await page.waitForFunction(() => window.asked.at(-1)[0] === 'speech' && window.asked.at(-1)[1].voice === 'Aoi');
    // A preset deleted: its card speaks with the default voice again.
    await page.locator('#tab-irodori-voices').click();
    // Chosen with a click, then 삭제 in the selection bar, as in 음성 목록.
    await page.locator('#iv-list .iv-row', { hasText: 'Aoi 아오이' }).click();
    assert.equal(await page.locator('#iv-selected-count').textContent(), '선택 1개');
    await page.locator('#iv-delete-selected').click();
    await page.waitForFunction(() => window.ttsData().irodoriVoices.length === 3);
    await page.locator('#tab-characters').click();
    assert.match(await page.locator('#tts-characters .char-card', { hasText: '하린' }).textContent(), /기본 목소리/);
    // 기본 세트 만들기: each starter is designed from its description, kept on the server under its own id and listed
    // with its gender and tags. Stopped partway, what was made stays and the next press makes only the rest.
    await page.locator('#tab-irodori-voices').click();
    await page.evaluate(() => { window.asked.length = 0; window.slow = true; });
    await page.locator('#iv-starter').click();
    await page.waitForFunction(() => document.getElementById('iv-starter').textContent === '중지' && !document.getElementById('iv-progress').hidden);
    await page.waitForFunction(() => window.ttsData().irodoriVoices.length >= 5);
    assert.match(await page.locator('#iv-progress').textContent(), /기본 세트 만드는 중 \d+\/33 · /);
    await page.locator('#iv-starter').click();
    await page.waitForFunction(() => document.getElementById('iv-starter').textContent === '기본 세트 만들기' && !document.getElementById('iv-starter').disabled);
    const partial = (await presets()).length;
    assert.ok(partial >= 5 && partial < 36, `stopped partway (${partial})`);
    assert.equal(await page.locator('#iv-progress').isVisible(), false);
    await page.evaluate(() => { window.slow = false; });
    await page.locator('#iv-starter').click();
    await page.waitForFunction(() => window.ttsData().irodoriVoices.length === 36);
    await page.waitForFunction(() => document.getElementById('iv-starter').textContent === '기본 세트 만들기');
    const made = await page.evaluate(() => ({ designs: window.asked.filter(row => row[0] === 'speech').map(row => [row[1].voice, row[1].irodori?.caption]), uploads: window.asked.filter(row => row[0] === 'upload').map(row => row[1]) }));
    assert.equal(made.designs.length, 33, 'each made once across both presses');
    assert.ok(made.designs.every(([voice, caption]) => voice === 'none' && /[\u3040-\u30ff]/.test(caption)));
    assert.equal(new Set(made.uploads).size, 33); assert.ok(made.uploads.every(id => /^omni-[fm]-[a-z-]+$/.test(id)), made.uploads.join(' '));
    const starters = await presets();
    assert.deepEqual(starters.find(row => row[1] === 'omni-f-young-tsundere').slice(0, 4), ['여성 · 츤데레', 'omni-f-young-tsundere', 'female', '청년|츤데레|툴툴대는|높음']);
    assert.deepEqual(starters.find(row => row[1] === 'omni-m-elder').slice(0, 4), ['할아버지', 'omni-m-elder', 'male', '노인|차분함|느림']);
    assert.equal(await page.locator('#iv-list .iv-row').count(), 36);
    await page.locator('#iv-starter').click();
    await page.waitForFunction(() => /이미 모두 있습니다/.test(document.getElementById('tts-notice')?.textContent || ''));
    assert.equal((await presets()).length, 36);
    if (process.env.IRODORI_VOICES_SHOT) await page.screenshot({ path: process.env.IRODORI_VOICES_SHOT.replace(/\.png$/, '-starter.png'), fullPage: true });
    // LLM으로 채우기: for the card chosen, the model writes the name, gender, tags and description; the voice is made
    // and heard at once, and once kept and applied the card speaks with it.
    await page.locator('#iv-add').click();
    await page.waitForFunction(() => [...document.getElementById('iv-who').options].some(option => option.textContent === '하린'));
    assert.equal(await page.locator('#iv-who').evaluate(node => node.selectedOptions[0].textContent), '하린', 'the first one there is chosen');
    assert.equal(await page.locator('#iv-bind-wrap').isVisible(), true); assert.equal(await page.locator('#iv-bind').isChecked(), true);
    await page.locator('#iv-request').fill('조금 더 높은 목소리로');
    await page.evaluate(() => { window.asked.length = 0; });
    // 만들어 듣기 with no description typed asks the model first.
    await page.locator('#iv-design').click();
    await page.waitForFunction(() => !document.getElementById('iv-keep').disabled);
    assert.deepEqual(await page.evaluate(() => ['iv-name', 'iv-gender', 'iv-tags', 'iv-caption'].map(id => document.getElementById(id).value)), ['하린', '여성', '청년, 츤데레, 높음', '素直になれない若い女性の声。つんつんと話す。']);
    if (process.env.IRODORI_VOICES_SHOT) await page.screenshot({ path: process.env.IRODORI_VOICES_SHOT.replace(/.png$/, '-llm.png') });
    const asked = await page.evaluate(() => JSON.parse(window.llm.at(-1).at(-1).content));
    assert.deepEqual([asked.character, asked.request], ['하린', '조금 더 높은 목소리로']);
    assert.deepEqual((await last('speech'))[1].irodori, { caption: '素直になれない若い女性の声。つんつんと話す。' }, 'made from what the model wrote');
    await page.locator('#iv-keep').click();
    await page.waitForFunction(() => /^voice-/.test(document.getElementById('iv-id').value));
    await page.locator('#irodori-voice-form button.primary').click();
    await page.waitForFunction(() => window.ttsData().irodoriVoices.length === 37);
    assert.equal(await page.evaluate(() => { const data = window.ttsData(), preset = data.irodoriVoices.at(-1); return data.characters.find(row => row.name === '하린').irodoriKey === preset.key && preset.name === '하린' && preset.gender === 'female'; }), true, 'her card speaks with it');
    // With no character chosen the request alone is written, and nobody is bound.
    await page.locator('#iv-add').click();
    await page.waitForFunction(() => document.getElementById('iv-who').options.length > 1);
    await page.locator('#iv-who').selectOption('');
    assert.equal(await page.locator('#iv-bind-wrap').isVisible(), false);
    await page.locator('#iv-write').click();
    for (let i = 0; i < 100 && !alerts.length; i++) await page.waitForTimeout(50);
    assert.match(alerts.at(-1) || '', /캐릭터를 고르거나/); alerts.length = 0;
    await page.locator('#irodori-voice-dialog [data-close]').first().click();
    // 내보내기: the presets as a file. 불러오기: those not here are added, by key and by server voice; the recordings
    // are not in the file, so one the server lacks is named.
    const [saved] = await Promise.all([page.waitForEvent('download'), page.locator('#iv-export').click()]);
    assert.equal(saved.suggestedFilename(), 'omnitts-irodori-voices.json');
    const stream = await saved.createReadStream(), chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const file = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(file.irodoriVoices.length, 37); assert.ok(file.irodoriVoices.every(row => row.key && row.fishId));
    const incoming = { irodoriVoices: [file.irodoriVoices[0], { ...file.irodoriVoices[1], key: 'other-key' }, { key: 'k-new', name: '옮겨 온 목소리', fishId: 'moved', tags: ['청년'], gender: 'male' }, { key: 'k-alice2', name: 'bad' }] };
    await page.locator('#iv-import-file').setInputFiles({ name: 'voices.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
    await page.waitForFunction(() => window.ttsData().irodoriVoices.length === 38);
    await page.waitForFunction(() => /프리셋 1개를 불러왔습니다.*서버에 소리 파일이 없습니다\(moved\)/.test(document.getElementById('tts-notice')?.textContent || ''));
    assert.deepEqual((await presets()).at(-1), ['옮겨 온 목소리', 'moved', 'male', '청년', '']);
    await page.locator('#iv-import-file').setInputFiles({ name: 'voices.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
    await page.waitForFunction(() => /새로 추가할 프리셋이 없습니다/.test(document.getElementById('tts-notice')?.textContent || ''));
    assert.equal((await presets()).length, 38);
    // A voice made again for a preset and applied straight away, with no 「이 소리로 등록」: it is kept first, and under
    // a new id, since lines already spoken are kept by voice id and would go on playing the old recording.
    await page.locator('.iv-row', { hasText: 'ID alice' }).dblclick();
    await page.locator('#iv-caption').fill('明るい少女');
    await page.locator('#iv-design').click();
    await page.waitForFunction(() => !document.getElementById('iv-keep').disabled);
    await page.locator('#irodori-voice-form button.primary').click();
    await page.waitForFunction(() => window.ttsData().irodoriVoices.some(v => /^alice-[a-z0-9]{5}$/.test(v.fishId)));
    const remade = await page.evaluate(() => window.ttsData().irodoriVoices.find(v => v.fishId.startsWith('alice-')).fishId);
    assert.equal((await last('upload'))[1], remade, 'the voice heard went up under the id the preset now names');
    assert.equal(await page.evaluate(() => window.ttsData().irodoriVoices.some(v => v.fishId === 'alice')), false);
    // The bot with no TTS card of its own: applying gives it one, under its name, speaking with the voice.
    await page.evaluate(() => { window.risuai.getCharacter = async () => ({ name: '유키', chaId: 'b1', chats: [{ id: 'c1', message: [] }], chatPage: 0 }); });
    await page.locator('#iv-add').click();
    await page.waitForFunction(() => [...document.getElementById('iv-who').options].some(option => option.value === '@bot'));
    await page.locator('#iv-who').selectOption('@bot');
    assert.equal(await page.locator('#iv-bind-wrap').isVisible(), true);
    await page.locator('#iv-name').fill('유키 목소리'); await page.locator('#iv-id').fill('sample');
    await page.locator('#irodori-voice-form button.primary').click();
    await page.waitForFunction(() => window.ttsData().characters.some(row => row.name === '유키'));
    assert.equal(await page.evaluate(() => { const data = window.ttsData(), preset = data.irodoriVoices.find(v => v.name === '유키 목소리'); return data.characters.find(row => row.name === '유키').irodoriKey === preset.key; }), true, 'the bot speaks with it');
    // 캐릭터 › 목록에서 선택: Irodori's list opens in its choosing mode; the voice chosen there is the card's.
    await page.locator('#tab-characters').click();
    await page.locator('#tts-characters .char-card', { hasText: '하린' }).dblclick();
    await page.waitForFunction(() => document.getElementById('character-dialog').open);
    await page.locator('#choose-character-voice').click();
    await page.waitForFunction(() => !document.getElementById('tts-irodori-voices').hidden && !document.getElementById('iv-apply-picked').hidden);
    assert.equal(await page.locator('#tab-irodori-voices').textContent(), 'Irodori 목소리 (선택 중)');
    assert.equal(await page.locator('#tab-voices').isVisible(), false, 'never Fish\'s library');
    await page.locator('#iv-list .iv-row', { hasText: 'ID sample' }).first().click();
    await page.locator('#iv-apply-picked').click();
    await page.waitForFunction(() => document.getElementById('character-dialog').open);
    assert.equal(await page.evaluate(() => { const data = window.ttsData(); return data.irodoriVoices.find(v => v.key === data.characters.find(row => row.name === '하린').irodoriKey).fishId; }), 'sample');
    assert.equal(await page.locator('#tab-irodori-voices').textContent(), 'Irodori 목소리');
    // 선택 취소 returns to the card with nothing changed.
    await page.locator('#choose-character-voice').click();
    await page.waitForFunction(() => !document.getElementById('iv-cancel-picked').hidden);
    await page.locator('#iv-cancel-picked').click();
    await page.waitForFunction(() => document.getElementById('character-dialog').open);
    assert.equal(await page.evaluate(() => { const data = window.ttsData(); return data.irodoriVoices.find(v => v.key === data.characters.find(row => row.name === '하린').irodoriKey).fishId; }), 'sample');
    await page.locator('#character-done').click();
    await page.locator('#tab-irodori-voices').click();
    // 일본어로 번역: the description as typed goes to the translator with Japanese as its target, and comes back into the field.
    await page.evaluate(() => { const inner = window.risuai.nativeFetch; window.translated = []; window.risuai.nativeFetch = async (url, options) => { if (String(url).includes('translate.googleapis.com')) { const q = new URL(url).searchParams; window.translated.push([q.get('tl'), q.get('q')]); return { ok: true, json: async () => [[['低くて落ち着いた声']]] }; } return inner(url, options); }; });
    await page.locator('#iv-add').click();
    await page.locator('#iv-caption').fill('낮고 차분한 목소리');
    await page.locator('#iv-translate').click();
    await page.waitForFunction(() => document.getElementById('iv-caption').value === '低くて落ち着いた声');
    assert.deepEqual(await page.evaluate(() => window.translated), [['ja', '낮고 차분한 목소리']]);
    await page.locator('#irodori-voice-dialog [data-close]').first().click();
    // The list works as 음성 목록 does: filtered by gender, sorted, and chosen by click, Shift and Ctrl, with ▶ no choice.
    const names = () => page.locator('#iv-list .iv-row strong').allTextContents();
    const total = await page.locator('#iv-list .iv-row').count();
    await page.locator('#iv-gender-filter').selectOption('남성');
    assert.equal(await page.locator('#iv-list .iv-row').count(), await page.evaluate(() => window.ttsData().irodoriVoices.filter(v => v.gender === 'male').length));
    await page.locator('#iv-gender-filter').selectOption('all');
    await page.locator('#iv-sort').selectOption('name');
    const sorted = await names();
    assert.deepEqual(sorted, [...sorted].sort((a, b) => a.localeCompare(b, 'ko')));
    await page.locator('#iv-sort').selectOption('added');
    const rows = page.locator('#iv-list .iv-row');
    await rows.nth(0).click(); await rows.nth(2).click({ modifiers: ['Shift'] });
    assert.equal(await page.locator('#iv-selected-count').textContent(), '선택 3개');
    await rows.nth(1).click({ modifiers: ['Control'] });
    assert.equal(await page.locator('#iv-selected-count').textContent(), '선택 2개');
    assert.equal(await page.locator('#iv-edit-selected').isDisabled(), true, '수정 takes one');
    await rows.nth(5).locator('.tts-listen').click();
    assert.equal(await page.locator('#iv-selected-count').textContent(), '선택 2개', 'hearing one does not choose it');
    await page.locator('#iv-delete-selected').click();
    await page.waitForFunction(n => document.querySelectorAll('#iv-list .iv-row').length === n, total - 2);
    await page.locator('#iv-multiselect').click();
    await rows.nth(0).click(); await rows.nth(1).click();
    assert.equal(await page.locator('#iv-selected-count').textContent(), '선택 2개', '다중선택 adds with a plain click');
    await page.locator('#iv-clear-selection').click();
    assert.equal(await page.locator('#iv-selected-count').textContent(), '선택 없음');
    // Back on Fish: its library's tab and the sheet's Fish fields return.
    await page.evaluate(() => window.updateTtsSettings({ engine: 'fish' }));
    await open();
    assert.equal(await page.locator('#tab-voices').isVisible(), true);
    assert.equal(await page.locator('#tab-irodori-voices').isVisible(), false);
    await page.locator('#tab-characters').click();
    await page.locator('#add-character').click();
    assert.equal(await page.locator('#c-irodori-wrap').isVisible(), false);
    assert.equal(await page.locator('#c-id').isVisible(), true);
    assert.equal(await page.locator('#choose-character-voice').isVisible(), true);
    assert.deepEqual(alerts, []); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
