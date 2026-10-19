import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 메인 태거 작가의 노트 presets in the real bundle: pick an example, save my own, delete it.
const full = await readFile('dist/omninexus.js', 'utf8');
const seam = '  await Qa();';
assert.equal(full.split(seam).length, 2, 'bundle boot seam must match exactly once');
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 360, height: 800 });
  const dialogs = [];
  page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.accept(); });
  await page.goto('about:blank');
  await page.evaluate(() => {
    const kv = new Map();
    const character = { chaId: 'note-bot', name: 'Note', chats: [{ id: 'note-chat', message: [] }], globalLore: [] };
    globalThis.risuai = {
      pluginStorage: { getItem: async k => kv.get(k), setItem: async (k, v) => kv.set(k, v), removeItem: async k => kv.delete(k) },
      getArgument: async () => '', getDatabase: async () => ({ characters: [structuredClone(character)], modules: [] }), setDatabase: async () => {},
      getCharacterFromIndex: async () => structuredClone(character), setCharacterToIndex: async () => {},
      getChatFromIndex: async () => structuredClone(character.chats[0]), getCharacter: async () => structuredClone(character),
      getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
    };
  });
  await page.addScriptTag({ type: 'module', content: full.replace(seam, 'await le();await ia();t.lastScope=await Z();t.uiOpen=true;t.uiTab="prompts";globalThis.noteRuntime={t};await P();') });
  await page.waitForFunction(() => !!globalThis.noteRuntime);
  const request = (path, body) => page.evaluate(([p, b]) => globalThis.__OMNI_SETTINGS_ACTIONS__.request(p, b), [path, body]);
  const savedNote = async () => ((await request('/v1/prompts')).prompts || []).find(row => row.key === 'author_note')?.text || '';
  const select = page.locator('#nx-anp-select'), note = page.locator('#nx-prompt-author_note');
  await page.waitForFunction(() => document.querySelectorAll('#nx-anp-select optgroup[label="예제"] option').length >= 6);
  const listing = () => request('/v1/author-note-presets');
  assert.equal(await page.locator('#nx-anp-select option').first().textContent(), '직접 입력', '직접 입력 comes first');
  // The shipped note is always there to go back to, and the untouched note already is it.
  assert.equal(await page.locator('#nx-anp-select optgroup[label="예제"] option').first().textContent(), '기존 노트 (기본값)');
  assert.equal(await select.inputValue(), 'example-default', 'an untouched note shows as the shipped one');
  assert.equal(await page.locator('#nx-anp-delete').isDisabled(), true, 'an example cannot be deleted');
  const shipped = await note.inputValue();
  assert.ok(shipped.trim().length > 0);
  assert.ok(await page.locator('#nx-anp-select option[value="example-quality"]').count() === 1, '퀄리티 향상 is listed');

  // 직접 입력: one's own note, saved as it is typed.
  await select.selectOption('custom');
  assert.equal(await note.inputValue(), '', 'a fresh install has an empty 직접 입력');
  await note.fill('내가 열심히 쓴 노트');
  await page.waitForFunction(async () => (await globalThis.__OMNI_SETTINGS_ACTIONS__.request('/v1/author-note-presets')).custom === '내가 열심히 쓴 노트');

  // An example only shows its text: no question, and 직접 입력 is untouched.
  const asked = dialogs.length;
  await select.selectOption('example-pov');
  assert.equal(dialogs.length, asked, 'picking never asks');
  assert.match(await note.inputValue(), /pov hands/);
  // The pick reaches the prompt writer itself, not just the textarea (a later API read would flush the DOM anyway).
  assert.match(await page.evaluate(() => globalThis.noteRuntime.t.promptDrafts?.author_note || ''), /never a character/, 'picking a preset queues the note save');
  await page.waitForFunction(async () => ((await globalThis.__OMNI_SETTINGS_ACTIONS__.request('/v1/prompts')).prompts || []).find(r => r.key === 'author_note')?.text?.includes('never a character'));
  assert.equal((await listing()).custom, '내가 열심히 쓴 노트');
  assert.equal((await listing()).selected, 'example-pov', 'the pick is remembered');
  // Editing the example leaves 직접 입력 alone too.
  await note.fill((await note.inputValue()) + '\n추가 지침');
  assert.match(await page.locator('#nx-anp-status').textContent(), /고친 상태/);
  assert.equal((await listing()).custom, '내가 열심히 쓴 노트');

  // Back to 직접 입력: the writing comes back exactly.
  await select.selectOption('custom');
  assert.equal(await note.inputValue(), '내가 열심히 쓴 노트');
  await page.waitForFunction(async () => ((await globalThis.__OMNI_SETTINGS_ACTIONS__.request('/v1/prompts')).prompts || []).find(r => r.key === 'author_note')?.text === '내가 열심히 쓴 노트');

  // Saving by name makes a preset; the same name overwrites it. 직접 입력 stays.
  await select.selectOption('example-pov');
  await note.fill((await note.inputValue()) + '\n추가 지침');
  await page.locator('#nx-anp-name').fill('내 POV');
  await page.locator('#nx-anp-save').click();
  await page.waitForFunction(() => document.querySelector('#nx-anp-select optgroup[label="내 프리셋"] option')?.textContent === '내 POV');
  const mine = (await listing()).items.find(row => row.name === '내 POV');
  assert.ok(mine && !mine.builtin && mine.text.endsWith('추가 지침'));
  assert.equal(await select.inputValue(), mine.id, 'the saved preset is the one shown');
  assert.match(await page.locator('#nx-anp-status').textContent(), /저장했어요/);
  await note.fill('바뀐 내용');
  await page.locator('#nx-anp-save').click();
  await page.waitForFunction(async () => (await globalThis.__OMNI_SETTINGS_ACTIONS__.request('/v1/author-note-presets')).items.find(r => r.name === '내 POV')?.text === '바뀐 내용');
  assert.equal((await listing()).items.filter(row => !row.builtin).length, 1, 'overwritten in place, not a second copy');
  assert.equal((await listing()).custom, '내가 열심히 쓴 노트');

  // Deleting the preset on screen brings 직접 입력 back in its place.
  await page.locator('#nx-anp-delete').click();
  assert.match(dialogs.at(-1) || '', /내 POV/);
  await page.waitForFunction(() => !document.querySelector('#nx-anp-select optgroup[label="내 프리셋"]'));
  assert.equal(await select.inputValue(), 'custom');
  assert.equal(await note.inputValue(), '내가 열심히 쓴 노트');
  await page.waitForFunction(async () => ((await globalThis.__OMNI_SETTINGS_ACTIONS__.request('/v1/prompts')).prompts || []).find(r => r.key === 'author_note')?.text === '내가 열심히 쓴 노트');
  // Phone width: the bar stays inside the block.
  const fits = await page.evaluate(() => { const bar = document.getElementById('nx-author-note-presets').getBoundingClientRect(); return bar.right <= document.documentElement.clientWidth + 1; });
  assert.ok(fits, 'preset bar fits a 360px screen');
  // 기존 노트 (기본값) gives back exactly the note this started with.
  await select.selectOption('example-default');
  assert.equal(await note.inputValue(), shipped);
  await page.waitForFunction(async shippedText => ((await globalThis.__OMNI_SETTINGS_ACTIONS__.request('/v1/prompts')).prompts || []).find(r => r.key === 'author_note')?.text?.trim() === shippedText, shipped.trim());
  // The prompt writer batches: an earlier queued text may land in between. What settles is the last pick.
  let steady = 0;
  for (let i = 0; i < 40 && steady < 3; i++) { steady = (await savedNote()).trim() === shipped.trim() ? steady + 1 : 0; await new Promise(r => setTimeout(r, 300)); }
  assert.equal(steady, 3, 'the shipped note is what stays saved');
  assert.equal((await listing()).custom, '내가 열심히 쓴 노트', '직접 입력 survives every pick');
  console.log('[author note presets] PASS: 직접 입력 kept apart from every pick and restored, examples listed, save/overwrite by name, delete');
} finally { await browser.close(); }
