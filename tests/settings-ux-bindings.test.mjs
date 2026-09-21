import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext, Script } from 'node:vm';
import { build } from 'esbuild';

async function load(entry, context) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'iife', globalName: 'Subject' });
  runInNewContext(result.outputFiles[0].text, context);
  return context.Subject;
}

// These tests exercise bindings without a browser; geometry assertions inspect
// the assigned constraints, not computed layout in the Risu host.
class Element extends EventTarget {
  constructor(tag = 'div') {
    super();
    this.tagName = tag;
    this.dataset = {};
    this.children = [];
    this.isConnected = true;
    this.style = {};
    this.value = '';
    this.classList = { toggle: (name, on) => { this[name] = on; } };
  }
  append(...nodes) { for (const node of nodes) { if (node && typeof node === 'object') node.isConnected = this.isConnected; this.children.push(node); } }
  prepend(node) { if (node && typeof node === 'object') node.isConnected = this.isConnected; this.children.unshift(node); }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this[name] = value; }
  querySelectorAll() { return this.children.filter(node => node.dataset.risuValue); }
  querySelector() { return null; }
  showModal() { this.open = true; }
  close() { this.open = false; this.onclose?.(); }
  remove() { this.isConnected = false; }
}

const roles = ['main', 'autotag', 'asset_char', 'comic', 'curator'];
test('each restored model role shows exactly its panel and selection', async () => {
  const buttons = roles.map(role => Object.assign(new Element('button'), { dataset: { llmRole: role } }));
  const panels = roles.map(role => ({ dataset: { uxLlmRole: role }, hidden: false }));
  let active = 'main';
  const tabs = { querySelector: () => buttons.find(button => button.dataset.llmRole === active), querySelectorAll: () => buttons };
  const context = { document: { getElementById: id => id === 'nx-llm-role-tabs' ? tabs : null, querySelectorAll: () => panels } };
  const subject = await load('src/settings-ux/model-bindings.ts', context);
  for (const role of [...roles, 'autotag', 'main']) {
    active = role;
    subject.bindModels();
    assert.deepEqual(panels.filter(panel => !panel.hidden).map(panel => panel.dataset.uxLlmRole), [role]);
    assert.equal(buttons.filter(button => button.on).length, 1);
    assert.equal(buttons.find(button => button.dataset.llmRole === role)['aria-pressed'], 'true');
  }
});

test('picker keeps global and other bot selections through repeated fills', async () => {
  const box = new Element(), bar = new Element(), label = new Element(), select = new Element();
  select.options = [{ value: 'live', textContent: 'Live' }, { value: '0', textContent: 'Bot A' }, { value: '1', textContent: 'Bot B' }];
  select.value = '1';
  Object.defineProperty(select, 'selectedOptions', { get: () => select.options.filter(option => option.value === select.value) });
  bar.dataset.uxSelectedScope = 'session';
  bar.querySelector = selector => ({ click() {
    bar.dataset.uxSelectedScope = selector.includes('global') ? 'global' : 'session';
    bar.dispatchEvent(new Event('omni-roster-scope'));
  } });
  const context = {
    Event, URL,
    document: { querySelector: () => select, getElementById: id => id === 'nx-char-scope-bar' ? bar : label, createElement: tag => new Element(tag) },
    risuai: { getDatabase: async () => ({ characters: [] }), getCurrentCharacterIndex: async () => 1 },
  };
  const subject = await load('src/settings-ux/risu-bindings.ts', context);
  await subject.fillRisuTiles(box);
  assert.deepEqual(box.children.map(button => button.dataset.risuValue), ['live', '__global__', '0', '1']);
  assert.equal(box.children[3].on, true);
  box.children[1].dispatchEvent(new Event('click'));
  assert.equal(select.value, '1', 'global roster must leave bot scope untouched');
  await subject.fillRisuTiles(box);
  assert.equal(box.children[1].on, true);
  assert.equal(label.textContent, '전역 로스터');
  box.children[2].dispatchEvent(new Event('click'));
  assert.equal(select.value, '0');
  assert.equal(bar.dataset.uxSelectedScope, 'session');
  await subject.fillRisuTiles(box);
  assert.equal(box.children[2].on, true);
  box.children[0].dispatchEvent(new Event('click'));
  assert.equal(select.value, '1');
  assert.equal(box.children[0]['aria-pressed'], 'false');
  assert.equal(box.children[3]['aria-pressed'], 'true');
});

test('rail loads once per mount; reopen only repaints selection', async () => {
  const box = new Element(), bar = new Element(), label = new Element(), select = new Element();
  select.options = [{ value: 'live', textContent: 'Live' }, { value: '0', textContent: 'Bot A' }];
  select.value = '0';
  bar.dataset.uxSelectedScope = 'session';
  let dbCalls = 0;
  const context = {
    Event, URL,
    document: { querySelector: () => select, getElementById: id => id === 'nx-char-scope-bar' ? bar : label, createElement: tag => new Element(tag) },
    risuai: { getDatabase: async () => { dbCalls++; return { characters: [] }; }, getCurrentCharacterIndex: async () => 0 },
  };
  const subject = await load('src/settings-ux/risu-bindings.ts', context);
  await subject.fillRisuTiles(box);
  assert.equal(dbCalls, 1);
  const tiles = [...box.children];
  assert.ok(tiles.length > 0);
  select.value = 'live';
  await subject.fillRisuTiles(box);
  assert.equal(dbCalls, 1, 'reopen must not hit getDatabase again');
  assert.deepEqual(box.children, tiles, 'tiles must stay mounted, no rebuild flicker');
});

test('rail rebuild from warm cache skips database and image re-download', async () => {
  const box1 = new Element(), box2 = new Element(), bar = new Element(), label = new Element(), select = new Element();
  select.options = [{ value: 'live', textContent: 'Live' }, { value: '0', textContent: 'Bot A' }];
  select.value = '0';
  let dbCalls = 0;
  const reads = [];
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.callback([{ isIntersecting: true }], this); }
    unobserve() {}
    disconnect() {}
  }
  const context = {
    Event, Blob,
    URL: { createObjectURL: () => 'blob:thumb', revokeObjectURL: () => {} },
    IntersectionObserver: Observer,
    document: { querySelector: () => select, getElementById: id => id === 'nx-char-scope-bar' ? bar : label, createElement: tag => new Element(tag) },
    risuai: {
      getDatabase: async () => { dbCalls++; return { characters: [{ image: 'a.webp' }] }; },
      getCurrentCharacterIndex: async () => 0,
      readImage: async key => { reads.push(key); return 'data:image/webp;base64,AAA'; },
    },
  };
  const subject = await load('src/settings-ux/risu-bindings.ts', context);
  const imgs = box => box.children.flatMap(button => button.children).filter(node => node.tagName === 'img');
  await subject.fillRisuTiles(box1);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dbCalls, 1);
  assert.equal(imgs(box1).length, 1, 'first build paints the thumbnail');
  assert.deepEqual(reads, ['a.webp']);
  await subject.fillRisuTiles(box2);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dbCalls, 1, 'cached rebuild must not hit getDatabase');
  assert.deepEqual(reads, ['a.webp'], 'cached rebuild must not re-download');
  assert.equal(imgs(box2).length, 1);
  assert.equal(imgs(box2)[0].src, imgs(box1)[0].src, 'cached rebuild reuses the thumbnail URL');
});

test('asset picker constrains exterior and lazily loads only intersecting thumbnails', async () => {
  const body = new Element(), observers = [], reads = [], revoked = [];
  class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
    unobserve(target) { this.targets = this.targets.filter(value => value !== target); }
    disconnect() { this.targets = []; }
  }
  const context = {
    Blob, Uint8Array, ArrayBuffer, Event, atob,
    URL: { createObjectURL: () => 'blob:thumbnail', revokeObjectURL: url => revoked.push(url) },
    IntersectionObserver: Observer,
    document: { body, createElement: tag => new Element(tag), querySelector: () => null, getElementById: () => null },
    risuai: {
      getCurrentCharacterIndex: async () => 0,
      getDatabase: async () => ({ characters: [{additionalAssets: [['Alice', 'a'], ['Bob', 'b']]}], modules: [], enabledModules: [] }),
      readImage: async key => { reads.push(key); return new Uint8Array([1, 2, 3]); },
    },
  };
  const subject = await load('src/settings-ux/asset-picker.ts', context);
  await subject.pickCharacterAsset(new Element());
  const dialog = body.children[0];
  const [close, modules, search, costume, status, list] = dialog.children[0].children;
  assert.equal(modules.hidden, true);
  assert.equal(costume.children[0].type, 'checkbox');
  assert.match(dialog.style.cssText, /height:min\(1000px,90dvh\)/);
  assert.match(dialog.style.cssText, /overflow:hidden/);
  assert.match(list.style.cssText, /min-height:0;overflow:auto/);
  assert.match(list.style.cssText, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.equal(list.children.length, 2);
  assert.equal(observers[0].options.root, list);
  assert.deepEqual(reads, [], 'listing must not read image pixels');
  observers[0].callback([{ isIntersecting: true, target: list.children[0] }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reads, ['a']);
  assert.equal(list.children[0].children[0].src, 'blob:thumbnail');
  search.value = 'Bob'; search.oninput();
  assert.equal(list.children.length, 1);
  assert.deepEqual(revoked, ['blob:thumbnail']);
  assert.deepEqual(reads, ['a'], 'search must preserve lazy reads');
  search.value = ' ALICE, bob, ,'; search.oninput();
  assert.equal(list.children.length, 2, 'comma search is case-insensitive OR');
  search.value = 'missing'; search.oninput();
  assert.equal(list.children.length, 0);
  assert.equal(status.textContent, '일치하는 에셋이 없습니다.');
  close.onclick();
  assert.equal(dialog.isConnected, false);
  assert.equal(observers[0].targets.length, 0);
});

test('preview scripts parse and import picker has scoped internal scroll constraints', async () => {
  const html = await readFile('docs/settings-ux-preview.html', 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length);
  scripts.forEach(([, source]) => new Script(source));
  assert.match(html, /#nx-char-import-modal > div\s*\{[^}]*height:min\(86dvh,720px\)!important/);
  assert.match(html, /#nx-char-import-modal \[data-imp-list\]\s*\{[^}]*min-height:0; overflow:auto!important/);
  assert.match(html, /id="nx-lorefilter-slot"/);
});

test('rail header and selection change before a slow scope read and never revert on repaint', async () => {
  const box=new Element(),bar=new Element(),label=new Element(),select=new Element();
  select.options=[{value:'0',textContent:'Bot A'},{value:'1',textContent:'Bot B'}];select.value='0';
  bar.dataset.uxSelectedScope='session';
  bar.querySelector=()=>({click(){bar.dispatchEvent(new Event('omni-roster-scope'));}});
  let finish;
  const context={Event,URL,document:{querySelector:()=>select,getElementById:id=>id==='nx-char-scope-bar'?bar:label,createElement:tag=>new Element(tag)},
    risuai:{getDatabase:async()=>({characters:[]}),getCurrentCharacterIndex:async()=>0},
    __OMNI_SELECT_CHARACTER_SCOPE__:()=>new Promise(resolve=>{finish=()=>{select.value='1';resolve({ok:true});};})};
  const subject=await load('src/settings-ux/risu-bindings.ts',context);
  await subject.fillRisuTiles(box);
  box.children.find(b=>b.dataset.risuValue==='1').dispatchEvent(new Event('click'));
  assert.equal(label.textContent,'Bot B','header must not show A during B read');
  await subject.fillRisuTiles(box);
  assert.equal(label.textContent,'Bot B','live-index repaint must respect pending selection');
  finish();await new Promise(r=>setImmediate(r));
  assert.equal(label.textContent,'Bot B');
});
