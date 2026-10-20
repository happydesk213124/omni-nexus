import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 설정 검색 in the shipped bundle: header buttons, local search, jumping to a setting,
// and LLM한테 물어보기 with the backend answer stubbed at the window's request seam.
const full = await readFile('dist/omninexus.js', 'utf8');
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('about:blank');
  await page.evaluate(() => {
    const kv = new Map();
    let character = { chaId: 'ux', name: 'UX', globalLore: [], chats: [{ id: 'c', message: [] }] }, modules = [];
    globalThis.storageWrites = 0;
    globalThis.risuai = {
      pluginStorage: { getItem: async k => kv.get(k), setItem: async (k, v) => { globalThis.storageWrites++; kv.set(k, v); }, removeItem: async k => kv.delete(k) },
      getArgument: async () => '', getDatabase: async () => ({ characters: [structuredClone(character)], modules: structuredClone(modules) }),
      setDatabase: async db => { if (db.modules) modules = structuredClone(db.modules); },
      getCharacterFromIndex: async () => structuredClone(character), setCharacterToIndex: async (_i, c) => { character = structuredClone(c); },
      getChatFromIndex: async () => structuredClone(character.chats[0]),
      getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
    };
  });
  await page.addScriptTag({ type: 'module', content: full.replace('  await Qa();', `
    await le(); t.uiOpen = true;
    globalThis.uxTestRuntime = {t, paint:P, flush:flushSettingsSave};
    await P();
  `) });
  await page.waitForFunction(() => !!globalThis.uxTestRuntime && !!document.getElementById('nx-search-toggle'));

  // 🔍 sits left of ?, and every header button is as tall as EXPORT, on a desk and a phone.
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const head = await page.evaluate(() => ['nx-search-toggle', 'nx-help-toggle', 'nx-export-all', 'nx-import-all', 'nx-close']
      .map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { id, h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) }; }));
    assert.deepEqual(new Set(head.map(b => b.h)).size, 1, `header buttons share one height @${width}: ${JSON.stringify(head)}`);
    assert.deepEqual(new Set(head.map(b => b.top)).size, 1, `header buttons share one row @${width}: ${JSON.stringify(head)}`);
    assert.ok(head[0].left < head[1].left, '🔍 is left of ?');
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Local search: words, a sentence, and nothing typed.
  await page.click('#nx-search-toggle');
  assert.equal(await page.locator('#nx-search').isVisible(), true);
  const writes = await page.evaluate(() => globalThis.storageWrites);
  await page.fill('#nx-search input[type=search]', '스크롤');
  const hits = await page.locator('#nx-search-list .nx-search-hit b').allTextContents();
  assert.ok(hits.includes('스크롤 붙잡기') && hits.includes('스트리밍 스크롤 붙잡기'), `스크롤 finds both holds: ${hits}`);
  await page.fill('#nx-search input[type=search]', '업스케일 방식');
  assert.equal(await page.locator('#nx-search-list .nx-search-hit b').first().textContent(), '🆙 버튼 방식');
  // The live collector waits 300 ms, then writes: give it well past that.
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => globalThis.storageWrites), writes, 'typing a search saves no settings');

  // Picking a hit opens its tab, centres the row and makes it blink.
  await page.locator('#nx-search-list .nx-search-hit').first().click();
  await page.waitForFunction(() => document.querySelector('#nx-main #nx-upscale-button-mode')?.closest('.row')?.classList.contains('nx-found'));
  assert.equal(await page.locator('#nx-search').isVisible(), false, 'the panel closes on a pick');
  assert.equal(await page.locator('#nx-tabs [data-nx-tab="gen_options"].active, #nx-tabs [data-nx-tab="gen_options"][aria-current="page"]').count(), 1);
  await page.waitForTimeout(900);   // the smooth scroll settles
  const box = await page.locator('#nx-upscale-button-mode').boundingBox();
  assert.ok(box && box.y > 0 && box.y < 900, 'the setting is on screen');

  // LLM한테 물어보기: numbers and short names go out; listed numbers come back as buttons.
  const asked = await page.evaluate(async () => {
    const actions = globalThis.__OMNI_SETTINGS_ACTIONS__;
    const sent = [];
    const real = actions.request;
    actions.request = async (path, body, timeout) => {
      if (path !== '/v1/settings/ask') return real(path, body, timeout);
      sent.push({ body, timeout });
      const stream = body.tabs.flatMap(tab => tab.items).find(item => item.title === '스트리밍 스크롤 붙잡기');
      return { ok: true, answer: '「스트리밍 스크롤 붙잡기」를 켜세요.', picks: [stream.n, 99999] };
    };
    globalThis.askSent = sent;
    return true;
  });
  assert.equal(asked, true);
  await page.click('#nx-search-toggle');
  await page.fill('#nx-search input[type=search]', '스트리밍 끝나면 화면이 위로 튀어요');
  await page.click('#nx-search-ask');
  await page.waitForFunction(() => document.querySelector('#nx-search-answer p')?.textContent.includes('스트리밍 스크롤 붙잡기'));
  const sent = await page.evaluate(() => globalThis.askSent[0]);
  assert.equal(sent.body.question, '스트리밍 끝나면 화면이 위로 튀어요');
  assert.ok(sent.timeout >= 60000, 'an LLM call is given time');
  assert.ok(sent.body.details.length <= 10 && sent.body.details.length > 0, 'help goes only for the top matches');
  const size = JSON.stringify(sent.body).length;
  assert.ok(size < 9000, `the request stays small: ${size} chars`);
  assert.ok(sent.body.tabs.every(tab => tab.items.every(item => Object.keys(item).join() === 'n,title')), 'every setting goes as a number and a name only');
  const buttons = await page.locator('#nx-search-answer .nx-search-hit b').allTextContents();
  assert.deepEqual(buttons, ['스트리밍 스크롤 붙잡기'], 'an unlisted number makes no button');
  await page.locator('#nx-search-answer .nx-search-hit').click();
  await page.waitForFunction(() => document.querySelector('#nx-main #nx-stream-scroll-hold')?.closest('.row')?.classList.contains('nx-found'));
  assert.deepEqual(errors, []);
  console.log(`Settings search: header heights, search, jump and blink, LLM ask (${size} chars, ${sent.body.tabs.reduce((n, tab) => n + tab.items.length, 0)} settings) passed.`);
} finally { await browser.close(); }
