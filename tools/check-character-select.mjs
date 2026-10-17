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
    const roster = [
      { id: 'alpha', name: 'Alpha', aliases: ['Alpha'], appearance: 'girl, red hair', schema_version: 2 },
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
  for (const gone of ['copy', 'move']) assert.equal(await page.locator(`#nx-char-select-bar [data-sel="${gone}"]`).count(), 0, gone + ' gave way to 참고컷 생성 · vibe레퍼로');
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
  console.log('[character select] PASS: pick, 비활성화/활성화 saved and shown, LLM command for the picked, bulk delete, 참고컷 생성·vibe레퍼로 one by one, no 완료');
} finally { await browser.close(); }
