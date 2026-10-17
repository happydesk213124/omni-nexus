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
  await select.click();
  assert.equal(await page.locator('#nx-char-select-bar').isVisible(), true);
  await tile('Alpha').click();
  await tile('Beta').click();
  assert.match(await page.locator('#nx-char-select-bar [data-sel-count]').textContent(), /2명 선택/);
  assert.equal(await page.locator('#nx-char-sheet.open').count(), 0, 'a tap in selection mode never opens the editor');

  await page.locator('#nx-char-select-bar [data-sel="off"]').click();
  await page.waitForFunction(() => rosterNow().every(row => row.disabled === true));
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
  await page.waitForFunction(() => rosterNow().map(row => row.id).join() === 'alpha');
  assert.equal(await tile('Beta').count(), 0);
  await page.locator('#nx-char-select-bar [data-sel="done"]').click();
  assert.equal(await page.locator('#nx-char-select-bar').isHidden(), true);
  assert.equal(await page.locator('[data-ux-character-tile].nx-picked').count(), 0);
  // 전역으로 복사: the bot keeps Alpha, the global roster gets her too.
  await select.click();
  await tile('Alpha').click();
  assert.match(await page.locator('#nx-char-select-bar [data-sel="copy"]').textContent(), /전역으로 복사/);
  await page.locator('#nx-char-select-bar [data-sel="copy"]').click();
  await page.waitForFunction(async () => {
    const db = await risuai.getDatabase(), entry = db.modules.flatMap(m => m.lorebook || []).find(e => e.comment === 'omni.nexus.data.globalcharacter');
    return !!entry && JSON.parse(entry.content).roster.some(row => row.id === 'alpha');
  });
  assert.deepEqual(await page.evaluate(() => rosterNow().map(row => row.id)), ['alpha'], 'a copy leaves the bot roster as it was');
  console.log('[character select] PASS: pick, 비활성화/활성화 saved and shown, LLM command for the picked, bulk delete, copy to global');
} finally { await browser.close(); }
