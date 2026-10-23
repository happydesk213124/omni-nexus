import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { crc32, deflateSync } from 'node:zlib';

// A 1×1 PNG, with NovelAI's Comment text chunk or without one.
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
const png = comment => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
  ...(comment ? [chunk('tEXt', Buffer.from('Comment\0' + comment, 'latin1'))] : []),
  chunk('IDAT', deflateSync(Buffer.from([0, 200, 80, 80, 255]))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
const shots = {
  'assets/meta.png': png(JSON.stringify({ prompt: 'artist:testpainter, masterpiece, 1girl', uc: 'lowres', scale: 5, cfg_rescale: 0 })),
  'assets/plain.png': png(''),
};

// 스타일 프리셋 in the real settings bundle: NAI5/NAI4.5 marks, JSON 관리, 선택 모드
// (참고컷 생성 one by one, bulk delete) and the "참고컷 없는" search.
const full = await readFile('dist/omninexus.js', 'utf8');
const seam = '  await Qa();';
assert.equal(full.split(seam).length, 2, 'bundle boot seam must match exactly once');
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 860 });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('about:blank');
  await page.evaluate(shots => {
    const kv = new Map();
    const character = { chaId: 'preset-bot', name: 'Preset', chats: [{ id: 'preset-chat', message: [] }], globalLore: [],
      additionalAssets: [['NAI shot', 'assets/meta.png', 'png'], ['Plain art', 'assets/plain.png', 'png']] };
    globalThis.risuai = {
      pluginStorage: { getItem: async k => kv.get(k), setItem: async (k, v) => kv.set(k, v), removeItem: async k => kv.delete(k) },
      getArgument: async () => '', getDatabase: async () => ({ characters: [structuredClone(character)], modules: [] }),
      setDatabase: async () => {}, getCharacterFromIndex: async () => structuredClone(character), setCharacterToIndex: async () => {},
      getChatFromIndex: async () => structuredClone(character.chats[0]), getCharacter: async () => structuredClone(character),
      getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
      readImage: async key => Uint8Array.from(atob(shots[key]), c => c.charCodeAt(0)),
    };
  }, shots);
  await page.addScriptTag({ type: 'module', content: full.replace(seam, 'await le();await ia();t.lastScope=await Z();globalThis.presetRuntime={t,paint:P,save:pe};') });
  await page.waitForFunction(() => !!globalThis.presetRuntime);
  // Four presets, two of each family, none with a reference shot yet.
  await page.evaluate(async () => {
    const { t } = presetRuntime;
    const presets = ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({ id, name: 'Preset ' + (i + 1), positive: 'tag' + i, negative: '', model_family: i % 2 ? 'v5' : 'v4' }));
    await presetRuntime.save({ card: { ...t.backendSettings.card, presets, active_preset_id: 'p1', custom_pos: 'tag0', custom_neg: '' } });
    t.uiOpen = true; t.uiTab = 'style_presets';
    await presetRuntime.paint();
  });
  const tile = id => page.locator(`#nx-preset-chips [data-preset-select="${id}"]`);
  await tile('p4').waitFor();
  assert.deepEqual(await page.evaluate(() => ['p1', 'p2', 'p3', 'p4'].map(id => document.querySelector(`#nx-preset-chips [data-preset-select="${id}"] [data-preset-model]`)?.textContent)),
    ['NAI4.5', 'NAI5', 'NAI4.5', 'NAI5'], 'each tile marks its model in the corner');

  // JSON 관리: one dock button; export and file load inside the paste popup.
  for (const id of ['#nx-preset-export', '#nx-preset-file', '#nx-preset-import']) assert.equal(await page.locator(id).isVisible(), false, id + ' folds into JSON 관리');
  await page.locator('#nx-preset-json').click();
  assert.equal(await page.locator('#nx-preset-import-pop').isVisible(), true);
  for (const id of ['#nx-preset-json-export', '#nx-preset-json-file', '#nx-preset-import-text', '#nx-preset-import-ok']) assert.equal(await page.locator(id).isVisible(), true, id + ' in the popup');
  await page.locator('#nx-preset-import-cancel').click();
  assert.equal(await page.locator('#nx-preset-import-pop').isVisible(), false);

  // 참고컷 생성 over the picked: one after another, each drawn on its own tile.
  await page.evaluate(() => {
    const nat = globalThis.__INLAY_NATIVE__, real = nat.fetch.bind(nat);
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    globalThis.lookLog = [];
    nat.fetch = async (path, init, timeout) => {
      if (path === '/v1/presets/look/generate') {
        const id = init?.body?.preset_id;
        lookLog.push('gen ' + id); await new Promise(r => setTimeout(r, 200)); lookLog.push('done ' + id);
        return { ok: true, preset_id: id, configured: true, preview_url: PNG + '#' + id, look_hash: 'hash-' + id };
      }
      return real(path, init, timeout);
    };
  });
  const pick = page.locator('#nx-preset-pick');
  await pick.click();
  assert.equal(await page.locator('#nx-preset-pick-bar').isVisible(), true);
  assert.equal(await page.locator('#nx-preset-dup').isVisible(), false, 'the bar takes the row');
  await tile('p2').click();
  await tile('p3').click();
  assert.match(await page.locator('#nx-preset-pick-bar [data-sel-count]').textContent(), /2개 선택/);
  assert.equal(await page.locator('#nx-preset-sheet.open').count(), 0, 'a tap in selection mode never opens the editor');
  assert.equal(await page.evaluate(() => presetRuntime.t.backendSettings.card.active_preset_id), 'p1', 'nor applies the preset');
  await page.locator('#nx-preset-pick-bar [data-sel="look-gen"]').click();
  await page.waitForFunction(() => /참고컷 2개 완료/.test(document.querySelector('#nx-preset-pick-bar [data-sel-count]').textContent));
  assert.deepEqual(await page.evaluate(() => lookLog), ['gen p2', 'done p2', 'gen p3', 'done p3'], 'the next starts only after the last is done');

  // "참고컷 없는" keeps only the tiles without one; "참고컷 있는" the others.
  // The backend records each hash on the preset as it stores the shot; this page mocked that call, so it saves them itself.
  await page.evaluate(async () => {
    const { t } = presetRuntime;
    const presets = t.backendSettings.card.presets.map(row => row.id === 'p2' || row.id === 'p3' ? { ...row, look_hash: 'hash-' + row.id } : row);
    await presetRuntime.save({ card: { ...t.backendSettings.card, presets } });
    await presetRuntime.paint();
  });
  await tile('p4').waitFor();
  const shown = () => page.evaluate(() => [...document.querySelectorAll('#nx-preset-chips [data-preset-select]')].filter(t => !t.hidden).map(t => t.dataset.presetSelect));
  await page.locator('#nx-preset-search').fill('참고컷 없는');
  assert.deepEqual(await shown(), ['p1', 'p4'], '참고컷 없는: only those without a shot');
  await page.locator('#nx-preset-search').fill('참고컷 있는');
  assert.deepEqual(await shown(), ['p2', 'p3']);
  await page.locator('#nx-preset-search').fill('참고컷 없는, nai5');
  assert.deepEqual(await shown(), ['p4'], 'the filter holds beside text terms');
  await page.locator('#nx-preset-search').fill('');
  assert.equal((await shown()).length, 4);
  await pick.click();
  await tile('p2').click();
  await tile('p3').click();

  // 삭제: the picked go in one write; the applied one stays.
  await page.locator('#nx-preset-pick-bar [data-sel="delete"]').click();
  await page.waitForFunction(() => presetRuntime.t.backendSettings.card.presets.map(p => p.id).join() === 'p1,p4');
  await tile('p4').waitFor();
  assert.equal(await tile('p2').count(), 0);
  assert.equal(await page.evaluate(() => presetRuntime.t.backendSettings.card.active_preset_id), 'p1');
  assert.equal(await page.locator('#nx-preset-pick-bar').isHidden(), true, 'delete ends selection');

  // 에셋에서: a picture without NovelAI's data says so; "메타데이터 있는 것만" finds the one with it,
  // which then becomes a preset named after the asset.
  await page.locator('#nx-preset-from-asset').click();
  const dialog = page.locator('dialog[aria-label="캐릭터 에셋으로 스타일 프리셋"]');
  await dialog.locator('button[data-asset-key]').nth(1).waitFor();
  await dialog.locator('button[data-asset-key="assets/plain.png"]').click();
  await page.waitForFunction(() => /메타데이터\(텍스트·알파값\)가 없습니다/.test(document.querySelector('dialog [role="status"]')?.textContent || ''));
  await dialog.locator('input[data-preset-asset-meta]').check();
  await page.waitForFunction(() => /메타데이터 있는 그림 1개 \(2개 중\)/.test(document.querySelector('dialog [role="status"]')?.textContent || ''));
  assert.deepEqual(await dialog.locator('button[data-asset-key]').evaluateAll(tiles => tiles.map(t => t.dataset.assetKey)), ['assets/meta.png']);
  await dialog.locator('button[data-asset-key="assets/meta.png"]').click();
  await page.waitForFunction(() => presetRuntime.t.backendSettings.card.presets.some(p => p.name === 'NAI shot'));
  const made = await page.evaluate(() => presetRuntime.t.backendSettings.card.presets.find(p => p.name === 'NAI shot'));
  assert.match(made.positive, /artist:testpainter/);
  assert.equal(made.negative, 'lowres');
  await page.waitForFunction(() => !document.querySelector('dialog[aria-label="캐릭터 에셋으로 스타일 프리셋"]'));
  console.log('[preset select] PASS: NAI5/NAI4.5 marks, JSON 관리 popup, pick without applying, 참고컷 생성 one by one, 참고컷 없는/있는 search, bulk delete, 에셋에서 with the metadata-only search');
} finally { await browser.close(); }
