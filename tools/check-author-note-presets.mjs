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
  assert.equal(await page.locator('#nx-anp-delete').isDisabled(), true, 'nothing picked, nothing to delete');

  // A hand-written note is not in any preset: replacing it asks first.
  await note.fill('내가 쓴 노트');
  await select.selectOption('example-pov');
  assert.match(dialogs.at(-1) || '', /저장되어 있지 않아요/);
  assert.match(await note.inputValue(), /pov hands/);
  assert.equal(await page.locator('#nx-anp-delete').isDisabled(), true, 'an example cannot be deleted');
  // The pick reaches the prompt writer itself, not just the textarea (a later API read would flush the DOM anyway).
  assert.match(await page.evaluate(() => globalThis.noteRuntime.t.promptDrafts?.author_note || ''), /faceless male/, 'picking a preset queues the note save');
  await page.waitForFunction(async () => ((await globalThis.__OMNI_SETTINGS_ACTIONS__.request('/v1/prompts')).prompts || []).find(r => r.key === 'author_note')?.text?.includes('faceless male'));

  // Saving an edited example makes it mine; examples stay unstored.
  await note.fill((await note.inputValue()) + '\n추가 지침');
  assert.match(await page.locator('#nx-anp-status').textContent(), /예제를 고친 상태/);
  await page.locator('#nx-anp-name').fill('내 POV');
  await page.locator('#nx-anp-save').click();
  await page.waitForFunction(() => document.querySelector('#nx-anp-select optgroup[label="내 프리셋"] option')?.textContent === '내 POV');
  const listed = (await request('/v1/author-note-presets')).items;
  const mine = listed.find(row => row.name === '내 POV');
  assert.ok(mine && !mine.builtin && mine.text.endsWith('추가 지침'));
  assert.equal(await select.inputValue(), mine.id, 'the saved preset is the one shown');
  assert.equal(await page.locator('#nx-anp-status').textContent(), '저장됨');

  // Overwrite in place, not a second copy.
  await note.fill('바뀐 내용');
  await page.locator('#nx-anp-save').click();
  await page.waitForFunction(async () => (await globalThis.__OMNI_SETTINGS_ACTIONS__.request('/v1/author-note-presets')).items.find(r => r.name === '내 POV')?.text === '바뀐 내용');
  assert.equal((await request('/v1/author-note-presets')).items.filter(row => !row.builtin).length, 1);

  // Switching from a saved note does not ask.
  const asked = dialogs.length;
  await select.selectOption('example-cinematic');
  assert.equal(dialogs.length, asked);
  assert.match(await note.inputValue(), /wide shot/);
  await select.selectOption(mine.id);
  assert.equal(await note.inputValue(), '바뀐 내용');
  await page.waitForFunction(async () => ((await globalThis.__OMNI_SETTINGS_ACTIONS__.request('/v1/prompts')).prompts || []).find(r => r.key === 'author_note')?.text === '바뀐 내용');

  await page.locator('#nx-anp-delete').click();
  assert.match(dialogs.at(-1) || '', /내 POV/);
  await page.waitForFunction(() => !document.querySelector('#nx-anp-select optgroup[label="내 프리셋"]'));
  assert.equal((await request('/v1/author-note-presets')).items.filter(row => !row.builtin).length, 0);
  assert.equal(await note.inputValue(), '바뀐 내용', 'deleting a preset keeps the note');
  assert.equal(await savedNote(), '바뀐 내용');
  // Phone width: the bar stays inside the block.
  const fits = await page.evaluate(() => { const bar = document.getElementById('nx-author-note-presets').getBoundingClientRect(); return bar.right <= document.documentElement.clientWidth + 1; });
  assert.ok(fits, 'preset bar fits a 360px screen');
  console.log('[author note presets] PASS: examples listed, unsaved note guarded, pick persists, save/overwrite/delete');
} finally { await browser.close(); }
