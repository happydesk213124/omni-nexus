import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 선택 모드 in the real settings bundle: pick tiles, 비활성화/활성화, delete, open an LLM command for the picked.
const full = await readFile('dist/omninexus.js', 'utf8');
const seam = '  await Qa();';
assert.equal(full.split(seam).length, 2, 'bundle boot seam must match exactly once');
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 860 });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('about:blank');
  await page.evaluate(() => {
    const kv = new Map();
    // Alpha is a TTS character too (연결된 TTS); Gamma is not.
    kv.set('omnitts.data', { version: 1, settings: {}, voices: [], folders: [], characters: [{ id: 't-alpha', scope: 'global', name: 'Alpha', surname: '', givenName: '', surnameAliases: [], givenAliases: [], triggers: ['Alpha'], tags: [], gender: 'female', voiceKey: '', fishId: '', fixed: false, gain: 0 }] });
    const roster = [
      { id: 'alpha', name: 'Alpha', aliases: ['Alpha'], appearance: 'girl, red hair', schema_version: 2, example_hash: 'alpha-shot' },
      { id: 'beta', name: 'Beta', aliases: ['Beta'], appearance: 'boy, black hair', schema_version: 2 },
      { id: 'gamma', name: 'Gamma', aliases: ['Gamma'], appearance: 'girl, blue hair', schema_version: 2 },
    ];
    let character = { chaId: 'select-bot', name: 'Select', chats: [{ id: 'select-chat', message: [] }],
      globalLore: [{ comment: 'omni.nexus.data.global', key: '', secondkey: '', alwaysActive: false, selective: false, mode: 'normal', insertorder: 0,
        content: JSON.stringify({ version: 1, characterId: 'select-bot', roster }) }] };
    let modules = [{ id: 'inlay-inray-display', namespace: 'inlay.inray_display', lorebook: [], assets: [] }];
    globalThis.rosterNow = () => JSON.parse(character.globalLore.find(e => e.comment === 'omni.nexus.data.global').content).roster;
    globalThis.risuai = {
      pluginStorage: { getItem: async k => kv.get(k), setItem: async (k, v) => kv.set(k, v), removeItem: async k => kv.delete(k) },
      getArgument: async () => '', getDatabase: async () => ({ characters: [structuredClone(character)], modules: structuredClone(modules) }),
      setDatabase: async db => { if (db.modules) modules = structuredClone(db.modules); },
      getCharacterFromIndex: async () => structuredClone(character), setCharacterToIndex: async (_i, c) => { character = structuredClone(c); },
      getChatFromIndex: async () => structuredClone(character.chats[0]), getCharacter: async () => structuredClone(character),
      getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
    };
  });
  await page.addScriptTag({ type: 'module', content: full.replace(seam, 'await le();await ia();t.lastScope=await Z();t.uiOpen=true;t.uiTab="characters";globalThis.selectRuntime={t,paint:P,refresh:ce};await ce();await P();') });
  await page.waitForFunction(() => !!globalThis.selectRuntime);
  const tile = name => page.locator(`[data-ux-character-tile]:has([data-character-label]:text-is("${name}"))`);
  await tile('Alpha').waitFor();
  await tile('Beta').waitFor();
  // "참고컷 없는" filters on the saved example shot, not on text; it holds beside text terms.
  const shownNames = () => page.evaluate(() => [...document.querySelectorAll('[data-ux-character-tile]')].filter(t => !t.hidden).map(t => t.querySelector('[data-character-label]').textContent));
  for (const [query, names] of [['참고컷 없는', ['Beta', 'Gamma']], ['참고컷 있는', ['Alpha']], ['참고컷 없는, blue', ['Gamma']], ['', ['Alpha', 'Beta', 'Gamma']]]) {
    await page.locator('#nx-char-search').fill(query);
    assert.deepEqual((await shownNames()).sort(), names, 'search ' + JSON.stringify(query));
  }
  const select = page.locator('#nx-char-select');
  assert.equal(await select.textContent(), '선택');
  assert.equal(await page.locator('#nx-char-select-bar').isHidden(), true);
  assert.equal(await page.locator('#nx-char-del-all').count(), 0, '전체삭제 is 선택 → 전체 선택 → 삭제 now');
  for (const id of ['#nx-char-head-look-gen', '#nx-char-look-vibe', '#nx-char-dup']) assert.equal(await page.locator(id).isVisible(), true, id + ' in the name row');
  await select.click();
  assert.equal(await page.locator('#nx-char-select-bar').isVisible(), true);
  // The bar takes the row's place: same line, the row's own buttons out of the way.
  assert.equal(await page.locator('#nx-char-dup').isVisible(), false);
  const sameLine = await page.evaluate(() => Math.abs(document.getElementById('nx-char-select').getBoundingClientRect().top - document.querySelector('#nx-char-select-bar [data-sel="all"]').getBoundingClientRect().top) < 8);
  assert.ok(sameLine, 'the bar sits in the name row');
  await tile('Alpha').click();
  await tile('Beta').click();
  assert.match(await page.locator('#nx-char-select-bar [data-sel-count]').textContent(), /2명 선택/);
  assert.equal(await page.locator('#nx-char-sheet.open').count(), 0, 'a tap in selection mode never opens the editor');

  await page.locator('#nx-char-select-bar [data-sel="off"]').click();
  await page.waitForFunction(() => rosterNow().filter(row => row.id !== 'gamma').every(row => row.disabled === true));
  await page.waitForFunction(() => document.querySelectorAll('[data-ux-character-tile].nx-off').length === 2);
  // Picks stay; enable only Beta again.
  await tile('Alpha').click();
  await page.locator('#nx-char-select-bar [data-sel="on"]').click();
  await page.waitForFunction(() => { const r = rosterNow(); return r.find(x => x.id === 'alpha').disabled === true && !r.find(x => x.id === 'beta').disabled; });
  await page.waitForFunction(() => document.querySelectorAll('[data-ux-character-tile].nx-off').length === 1);

  // LLM 명령 opens the roster command for the picked one only.
  await page.locator('#nx-char-select-bar [data-sel="llm"]').click();
  await page.locator('#nx-roster-command-modal').waitFor();
  assert.match(await page.locator('#nx-roster-command-modal').textContent(), /고른 1명: Beta/);
  await page.locator('[data-rc-close]').click();

  await page.locator('#nx-char-select-bar [data-sel="delete"]').click();
  await page.waitForFunction(() => rosterNow().map(row => row.id).join() === 'alpha,gamma');
  assert.equal(await tile('Beta').count(), 0);
  assert.equal(await page.locator('#nx-char-select-bar [data-sel="done"]').count(), 0, 'no 완료: 선택 itself turns it off');
  for (const gone of ['copy']) assert.equal(await page.locator(`#nx-char-select-bar [data-sel="${gone}"]`).count(), 0, gone + ' gave way to 참고컷 생성 · vibe레퍼로');
  await select.click();
  assert.equal(await page.locator('#nx-char-select-bar').isHidden(), true);
  assert.equal(await page.locator('#nx-char-dup').isVisible(), true, 'the row comes back');
  assert.equal(await page.locator('#nx-char-add-global').isVisible(), false, 'a scope-hidden button stays hidden');
  assert.equal(await page.locator('[data-ux-character-tile].nx-picked').count(), 0);
  // 참고컷 생성 / vibe레퍼로 over the picked: one card at a time, in tile order, each painted on its own card.
  await page.evaluate(() => {
    const nat = globalThis.__INLAY_NATIVE__, real = nat.fetch.bind(nat);
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    globalThis.shotLog = [];
    nat.fetch = async (path, init, timeout) => {
      const id = init?.body?.character_id;
      if (path === '/v1/characters/example-shot' && init?.body?.generate) {
        shotLog.push('gen ' + id); await new Promise(r => setTimeout(r, 300)); shotLog.push('gen-done ' + id);
        return { ok: true, preview_url: PNG + '#' + id, image_b64: PNG.split(',')[1] };
      }
      if (path === '/v1/characters/ref' && init?.method === 'POST') { shotLog.push('vibe ' + id); return { ok: true, preview_url: PNG }; }
      return real(path, init, timeout);
    };
  });
  await select.click();
  await page.locator('#nx-char-select-bar [data-sel="all"]').click();
  await page.locator('#nx-char-select-bar [data-sel="look-gen"]').click();
  await page.waitForFunction(() => /참고컷 2명 완료/.test(document.querySelector('#nx-char-select-bar [data-sel-count]').textContent));
  assert.deepEqual(await page.evaluate(() => shotLog), ['gen alpha', 'gen-done alpha', 'gen gamma', 'gen-done gamma'], 'the next starts only after the last is done');
  assert.deepEqual(await page.evaluate(() => ['alpha', 'gamma'].map(id => document.querySelector(`.char-card[data-char-id="${id}"] [data-char-ex-preview] img`)?.getAttribute('src')?.split('#')[1])), ['alpha', 'gamma']);
  await page.locator('#nx-char-select-bar [data-sel="look-vibe"]').click();
  await page.waitForFunction(() => /vibe 2명 완료/.test(document.querySelector('#nx-char-select-bar [data-sel-count]').textContent));
  assert.deepEqual(await page.evaluate(() => shotLog.filter(line => line.startsWith('vibe'))), ['vibe alpha', 'vibe gamma']);
  await select.click();
  assert.equal(await page.locator('#nx-char-select-bar').isHidden(), true, '선택 off ends selection');
  assert.equal(await page.locator('[data-ux-character-tile].nx-picked').count(), 0);
  // 연결된 TTS, by 삭제: the TTS character the card is, greyed for one who is none; pressed, the TTS 캐릭터 page.
  assert.equal(await page.locator('#nx-char-edit-body [data-char-delete] + #nx-char-to-tts').count(), 1, 'right after 삭제');
  await tile('Gamma').click();
  await page.waitForFunction(() => document.getElementById('nx-char-to-tts').disabled === true);
  await tile('Alpha').click();
  await page.waitForFunction(() => document.getElementById('nx-char-to-tts').disabled === false);
  await page.evaluate(() => { globalThis.ttsOpened = 0; globalThis.__OMNI_OPEN_TTS__ = async () => { globalThis.ttsOpened++; }; document.getElementById('nx-char-to-tts').click(); });
  await page.waitForFunction(() => globalThis.ttsOpened === 1);
  // 전역 캐릭터는 현재 페르소나만: a chip on the one global tile that is the selected persona, and only with the switch on.
  const tiles = () => page.evaluate(() => [...document.querySelectorAll('[data-ux-character-tile].nx-persona')].map(el => [el.dataset.uxCharacterTile, getComputedStyle(el, '::after').content]));
  await page.evaluate(async () => {
    const entry = { comment: 'omni.nexus.data.globalcharacter', key: '', secondkey: '', alwaysActive: false, selective: false, mode: 'normal', insertorder: 0,
      content: JSON.stringify({ version: 1, roster: [{ id: 'g-alias', name: 'GlobalAlias', aliases: ['GlobalMe'] }, { id: 'g-me', name: 'GlobalMe', aliases: [] }] }) };
    const db = await risuai.getDatabase();
    await risuai.setDatabase({ modules: db.modules.map(m => ({ ...m, lorebook: [entry] })) });
    const read = risuai.getDatabase;
    risuai.getDatabase = async (...args) => ({ ...await read(...args), personas: [{ name: 'GlobalMe' }], selectedPersona: 0 });
    document.getElementById('nx-refresh-chars').click();
  });
  await page.waitForFunction(() => !!document.querySelector('[data-ux-character-tile="g-me"]'));
  assert.deepEqual(await tiles(), [], 'switch off: no chip');
  await page.evaluate(async () => {
    await globalThis.__OMNI_SETTINGS_ACTIONS__.save({ card: { user_info_persona_only: true } });
    document.getElementById('nx-refresh-chars').click();
  });
  await page.waitForFunction(() => !!document.querySelector('[data-ux-character-tile].nx-persona'));
  assert.deepEqual(await tiles(), [['g-me', '"페르소나"']], 'the whole name, not the alias, and no session tile');
  await page.evaluate(() => globalThis.__OMNI_SETTINGS_ACTIONS__.save({ card: { user_info_persona_only: false } }));
  // 현재 챗으로 · 전역 로스터로: a move, one by its button or many from the bar, and only ever to the other roster.
  const on = (scope, id) => `[data-ux-character-scope="${scope}"][data-ux-character-tile="${id}"]`;
  const moved = (scope, id, from) => page.waitForFunction(([there, gone]) => !!document.querySelector(there) && !document.querySelector(gone), [on(scope, id), on(from, id)]);
  const pane = id => page.locator('#' + id), sel = name => page.locator(`#nx-char-select-bar [data-sel="${name}"]`);
  await page.locator('[data-ux-scope="global"]').dispatchEvent('click');
  assert.deepEqual([await pane('nx-char-to-global').isVisible(), await pane('nx-char-to-session').isVisible()], [false, true], 'the global tab sends to the chat');
  await page.locator(on('global', 'g-me')).click();
  await pane('nx-char-to-session').click();
  await moved('session', 'g-me', 'global');
  await select.click();
  const shown = async () => [await sel('to-global').isVisible(), await sel('to-session').isVisible()];
  assert.deepEqual(await shown(), [false, true], 'and so does its bar');
  await page.locator('[data-ux-scope="session"]').dispatchEvent('click');
  assert.deepEqual(await shown(), [true, false], 'the bar follows the tab');
  await page.locator('[data-ux-scope="global"]').dispatchEvent('click');
  assert.deepEqual(await shown(), [false, true], 'and back');
  await page.locator(on('global', 'g-alias')).click();
  await sel('to-session').click();
  await moved('session', 'g-alias', 'global');
  assert.equal(await page.locator('#nx-char-select-bar').isVisible(), false, 'the list is drawn again, and selecting ends with it');
  await page.locator('[data-ux-scope="session"]').dispatchEvent('click');
  await select.click();
  await page.locator(on('session', 'g-me')).click();
  await page.locator(on('session', 'g-alias')).click();
  assert.match(await page.locator('#nx-char-select-bar [data-sel-count]').textContent(), /2명 선택/);
  await sel('to-global').click();
  await moved('global', 'g-me', 'session');
  await moved('global', 'g-alias', 'session');
  // 연결된 삽화 from a TTS sheet when the 캐릭터 tab has no list yet (no chat picked, or never shown): the frozen UI's
  // own opener loads it first, then opens the sheet (it once found nothing).
  await page.evaluate(async () => { const r = globalThis.selectRuntime; r.t.charactersSession = []; r.t.charactersGlobal = []; await r.paint(); });
  await page.waitForFunction(() => !document.querySelector('[data-ux-character-tile]'));
  await page.evaluate(() => globalThis.__OMNI_OPEN_CAST_EDITOR__({ id: 'gamma', name: 'Gamma', scope: 'session' }));
  await page.waitForFunction(() => document.getElementById('nx-char-sheet')?.classList.contains('open') && document.getElementById('nx-char-edit-title')?.textContent === 'Gamma');
  console.log('[character select] PASS: pick, 비활성화/활성화 saved and shown, LLM command for the picked, bulk delete, 참고컷 생성·vibe레퍼로 one by one, no 완료, 연결된 TTS, the cast opener loading an empty tab');
} finally { await browser.close(); }
