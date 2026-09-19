import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repair = readFileSync(new URL('../tools/vendor-patches/omni-repairs.mjs', import.meta.url), 'utf8');
const startMarker = "replace('  async function runMsgChipAction(', `";
const endMarker = '  async function runMsgChipAction(`);';
assert.equal(repair.split(startMarker).length, 2, 'popup injection must have one owner');
const start = repair.indexOf(startMarker) + startMarker.length;
const end = repair.indexOf(endMarker, start);
assert.ok(end > start, 'popup injection end must exist');
// Evaluate the template literal first, just as the repair does, including escaping.
const popupSource = new Function('return `' + repair.slice(start, end) + '`;')();
const noteRoute = '/v1/session-author-note';
const presetRoute = '/v1/session-author-note-presets';

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.style = { cssText: '' };
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.inert = false;
  }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  add(node) { this.append(node); }
  replaceChildren(...nodes) {
    for (const node of this.children) node.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  focus() { this.focused = true; }
  remove() {
    this.parentNode.children = this.parentNode.children.filter(node => node !== this);
    this.parentNode = null;
  }
}
const descendants = node => [node, ...node.children.flatMap(descendants)];
const css = node => Object.fromEntries(node.style.cssText.split(';').filter(Boolean).map(pair => {
  const colon = pair.indexOf(':');
  return [pair.slice(0, colon).trim(), pair.slice(colon + 1).trim()];
}));

async function harness(source = popupSource, opts = {}) {
  const document = { body: new Element('body'), createElement: tag => new Element(tag) };
  const state = {
    sessionId: 'actual-chat/7',
    note: { prefix: 'old prefix', suffix: 'old suffix', location: 'stale station', preset_id: '' },
    presets: [{ id: 'existing', name: 'Existing', prefix: 'preset prefix', suffix: 'preset suffix' }],
    roster: [
      { id: 'c1', name: 'Aria' },
      { id: 'c2', name: 'Merk' },
    ],
    rosterFail: !!opts.rosterFail,
    calls: [], scopes: [], shown: [], hidden: 0, failure: null,
  };
  if (opts.note) Object.assign(state.note, opts.note);
  let now = 0, nextTimer = 0;
  const timers = new Map();
  const bindings = {
    document,
    Option: class extends Element {
      constructor(text, value) { super('option'); this.textContent = text; this.value = value; }
    },
    Z: async options => { state.scopes.push(options); return { sessionId: state.sessionId }; },
    t: { uiOpen: false },
    k: { showContainer: async mode => state.shown.push(mode), hideContainer: async () => { state.hidden++; } },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    K: async (url, options = {}) => {
      const method = options.method || 'GET';
      state.calls.push({ url, method, body: structuredClone(options.body) });
      if (method === 'PUT' && state.failure) {
        if (state.failure === 'reject') throw new Error('offline');
        return { ok: false };
      }
      if (url === noteRoute && method === 'PUT') {
        const { session_id, ...patch } = options.body;
        assert.equal(session_id, 'actual-chat/7');
        // Model the separately owned backend partial-update contract.
        Object.assign(state.note, patch);
        return { ok: true, ...state.note };
      }
      if (url === noteRoute + '?session_id=actual-chat%2F7' && method === 'GET') return structuredClone(state.note);
      if (url.startsWith('/v1/characters?') && method === 'GET') {
        if (state.rosterFail) throw new Error('roster offline');
        return { ok: true, characters: structuredClone(state.roster), global: [] };
      }
      if (url === presetRoute) {
        if (method === 'PUT') state.presets = structuredClone(options.body.items);
        return { ok: true, items: structuredClone(state.presets) };
      }
      throw new Error('Unexpected API call: ' + method + ' ' + url);
    },
  };
  const open = new Function(...Object.keys(bindings), source + ';return openOmniNote;')(...Object.values(bindings));
  await open({});
  const nodes = descendants(document.body);
  const button = text => {
    const node = nodes.find(node => node.tagName === 'button' && node.textContent === text);
    assert.ok(node, 'missing button: ' + text);
    return node;
  };
  const [prefix, suffix, location] = nodes.filter(node => node.tagName === 'textarea');
  assert.ok(prefix && suffix && location, 'all note fields must be mounted');
  return {
    state, document, prefix, suffix, location, button,
    root: document.body.children[0],
    panel: nodes.find(node => node.attributes.role === 'dialog'),
    status: nodes.find(node => node.attributes.role === 'status'),
    select: nodes.find(node => node.tagName === 'select'),
    name: nodes.find(node => node.tagName === 'input'),
    wearBox: nodes.find(node => node.tagName === 'div' && node.attributes['aria-label'] === '옷 상태 목록'),
    edit(node, value) { node.value = value; node.oninput(); },
    puts(url) { return state.calls.filter(call => call.method === 'PUT' && call.url === url); },
    async tick(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        now = timer.at; timers.delete(id);
        await timer.callback();
      }
      now = target;
    },
  };
}

async function verifyDirtySave(source = popupSource) {
  const h = await harness(source);
  assert.deepEqual(h.state.scopes, [{ useOverride: false }]);
  h.state.sessionId = 'another-chat';
  h.state.note.location = 'latest generated location';
  h.edit(h.prefix, 'draft');
  await h.tick(200);
  h.edit(h.prefix, 'final prefix');
  await h.tick(249);
  assert.equal(h.puts(noteRoute).length, 0, 'typing resets the 250ms debounce');
  await h.tick(1);
  assert.deepEqual(h.puts(noteRoute).map(call => call.body), [{ session_id: 'actual-chat/7', prefix: 'final prefix' }]);
  assert.equal(h.state.note.location, 'latest generated location');
  assert.equal(h.state.note.suffix, 'old suffix');
  await h.button('닫기').onclick();
  assert.equal(h.puts(noteRoute).length, 1, 'clean close must not write');
  assert.equal(h.document.body.children.length, 0);
  assert.equal(h.state.hidden, 1);
}

test('dirty prefix is debounced, retains captured scope and omits stale location', () => verifyDirtySave());

test('preset save/select/delete uses GET/PUT and never stores location', async () => {
  const h = await harness();
  h.edit(h.prefix, 'my prefix'); h.edit(h.suffix, 'my suffix');
  h.name.value = 'My note';
  await h.button('프리셋 저장').onclick();
  const items = h.puts(presetRoute)[0].body.items;
  assert.equal(items.length, 2, 'existing presets survive saving a new one');
  for (const item of items) assert.deepEqual(Object.keys(item).sort(), ['id', 'name', 'prefix', 'suffix']);
  const added = items.find(item => item.name === 'My note');
  assert.ok(added?.id);
  assert.equal(added.prefix, 'my prefix'); assert.equal(added.suffix, 'my suffix');
  assert.equal(h.select.value, added.id);
  assert.equal(h.state.calls.filter(call => call.url === presetRoute && call.method === 'GET').length, 2);
  h.select.value = 'existing'; h.select.onchange();
  assert.equal(h.prefix.value, 'preset prefix'); assert.equal(h.suffix.value, 'preset suffix');
  assert.equal(h.location.value, 'stale station');
  await h.button('프리셋 삭제').onclick();
  assert.deepEqual(h.puts(presetRoute)[1].body.items, [added]);
  assert.equal(h.select.value, '');
  assert.equal(h.prefix.value, 'preset prefix', 'deleting a preset preserves the draft');
  await h.tick(250);
  assert.ok(h.puts(noteRoute).length);
  for (const call of h.puts(noteRoute)) assert.equal(Object.hasOwn(call.body, 'location'), false);
});

test('fixed dark dialog keeps status and close outside the scrolling body', async () => {
  const h = await harness();
  const close = h.button('닫기'), footer = close.parentNode, content = h.prefix.parentNode.parentNode;
  assert.equal(css(h.root).position, 'fixed');
  const panel = css(h.panel);
  assert.equal(panel.width, 'min(700px,100%)'); assert.equal(panel.height, 'min(960px,95vh)');
  assert.equal(panel.display, 'flex'); assert.equal(panel['flex-direction'], 'column');
  assert.equal(panel.overflow, 'hidden'); assert.equal(panel.background, '#101620');
  assert.equal(css(content)['overflow-y'], 'auto'); assert.equal(css(content)['min-height'], '0');
  assert.equal(css(content).flex, '1'); assert.equal(css(footer).flex, 'none');
  assert.equal(footer.parentNode, h.panel); assert.equal(content.parentNode, h.panel);
  assert.equal(h.panel.children.at(-1), footer); assert.equal(h.status.parentNode, footer);
  assert.equal(descendants(content).includes(close), false);
  assert.equal(h.panel.attributes['aria-modal'], 'true');
});

for (const failure of ['reject', 'response']) {
  test('failed note save preserves editable input and retry on close: ' + failure, async () => {
    const h = await harness();
    const close = h.button('닫기'), content = h.prefix.parentNode.parentNode;
    h.state.failure = failure;
    h.edit(h.prefix, 'unsaved draft');
    await h.tick(250);
    assert.match(h.status.textContent, /저장 실패/);
    await close.onclick();
    assert.equal(h.document.body.children[0], h.root);
    assert.equal(h.prefix.value, 'unsaved draft');
    assert.equal(close.disabled, false); assert.equal(content.inert, false);
    assert.equal(h.state.hidden, 0); assert.equal(h.state.note.prefix, 'old prefix');
    h.edit(h.prefix, 'revised draft');
    h.state.failure = null;
    await close.onclick();
    assert.equal(h.state.note.prefix, 'revised draft');
    assert.equal(h.document.body.children.length, 0); assert.equal(h.state.hidden, 1);
    const count = h.puts(noteRoute).length;
    await h.tick(250);
    assert.equal(h.puts(noteRoute).length, count, 'close cancels the pending timer');
  });
}

test('failed preset save retains name and note for retry', async () => {
  const h = await harness();
  h.edit(h.prefix, 'keep prefix'); h.edit(h.suffix, 'keep suffix'); h.name.value = 'Keep name';
  h.state.failure = 'reject';
  await h.button('프리셋 저장').onclick();
  assert.match(h.status.textContent, /실패/);
  assert.equal(h.name.value, 'Keep name'); assert.equal(h.prefix.value, 'keep prefix'); assert.equal(h.suffix.value, 'keep suffix');
  assert.equal(h.button('프리셋 저장').disabled, false); assert.equal(h.button('닫기').disabled, false);
  h.state.failure = null;
  await h.button('프리셋 저장').onclick();
  assert.ok(h.state.presets.some(item => item.name === 'Keep name' && item.prefix === 'keep prefix'));
});

test('dirty-field regression guard rejects an in-memory stale-location mutation', async () => {
  const needle = 'const body={session_id:sid};';
  assert.ok(popupSource.includes(needle), 'mutation must hit the live save body');
  const broken = popupSource.replace(needle, 'const body={session_id:sid,location:fields.location.value};');
  await assert.rejects(() => verifyDirtySave(broken), { code: 'ERR_ASSERTION' });
});

const wearSelect = (h, name) => {
  assert.ok(h.wearBox, 'wear list must be mounted');
  const spans = descendants(h.wearBox).filter(node => node.tagName === 'span' && node.textContent === name);
  assert.equal(spans.length, 1, 'one wear row for ' + name);
  const sel = descendants(spans[0].parentNode).find(node => node.tagName === 'select');
  assert.ok(sel, 'missing wear select for ' + name);
  return sel;
};
const setWear = (h, name, st) => { const sel = wearSelect(h, name); sel.value = st; sel.onchange(); };
const wearSearch = h => {
  const input = descendants(h.panel).find(node => node.tagName === 'input' && node.placeholder === '이름 검색');
  assert.ok(input, 'wear name search must be mounted');
  return input;
};

test('preset row sits above prefix/suffix/location fields', async () => {
  const h = await harness();
  const content = h.prefix.parentNode.parentNode;
  const first = content.children[0];
  assert.equal(first.tagName, 'div');
  assert.ok(descendants(first).includes(h.select), 'first row must be the preset group');
});

test('wear list shows roster names with selects, scrollable, clothed by default', async () => {
  const h = await harness();
  assert.equal(css(h.wearBox)['max-height'], '300px');
  assert.equal(css(h.wearBox)['overflow-y'], 'auto');
  assert.equal(css(h.wearBox).display, 'grid');
  assert.equal(css(h.wearBox)['grid-template-columns'], '1fr 1fr');
  for (const name of ['Aria', 'Merk']) {
    const sel = wearSelect(h, name);
    assert.deepEqual(sel.children.map(opt => opt.value), ['clothed', 'torn', 'topless', 'bottomless', 'nude', 'completely']);
    assert.equal(sel.value, 'clothed');
  }
});

test('wear search filters rows by name', async () => {
  const h = await harness();
  const search = wearSearch(h);
  search.value = 'ari'; search.oninput();
  const rows = descendants(h.wearBox).filter(node => node.tagName === 'span');
  const display = name => rows.find(node => node.textContent === name).parentNode.style.display;
  assert.notEqual(display('Aria'), 'none');
  assert.equal(display('Merk'), 'none');
  search.value = ''; search.oninput();
  assert.notEqual(display('Merk'), 'none');
});

test('wear select saves the id-keyed map debounced; clothed clears it', async () => {
  const h = await harness();
  setWear(h, 'Aria', 'nude');
  await h.tick(249);
  assert.equal(h.puts(noteRoute).length, 0, 'wear select joins the 250ms debounce');
  await h.tick(1);
  assert.deepEqual(h.puts(noteRoute).map(call => call.body), [
    { session_id: 'actual-chat/7', wear: { c1: { name: 'Aria', wear: 'nude' } } },
  ]);
  assert.equal(h.status.textContent, '저장됨');
  assert.deepEqual(h.state.note.wear, { c1: { name: 'Aria', wear: 'nude' } });
  setWear(h, 'Aria', 'clothed');
  await h.tick(250);
  assert.deepEqual(h.puts(noteRoute).map(call => call.body).at(-1), { session_id: 'actual-chat/7', wear: {} });
});

test('remembered wear preselects and stays editable when the roster fetch fails', async () => {
  const h = await harness(popupSource, {
    note: { wear: [{ id: 'c9', name: 'Ghost', wear: 'topless' }] },
    rosterFail: true,
  });
  assert.match(h.status.textContent, /로스터/);
  assert.equal(wearSelect(h, 'Ghost').value, 'topless');
  assert.equal(descendants(h.wearBox).filter(node => node.tagName === 'span').length, 1);
  setWear(h, 'Ghost', 'bottomless');
  await h.tick(250);
  assert.deepEqual(h.puts(noteRoute).map(call => call.body).at(-1), {
    session_id: 'actual-chat/7', wear: { c9: { name: 'Ghost', wear: 'bottomless' } },
  });
});

test('wear regression guard sends the wear map, not a missing field', async () => {
  const needle = 'body[key]=key==="wear"?wearEdit.map:fields[key].value;';
  assert.ok(popupSource.includes(needle), 'wear must ride the live save body');
  const broken = popupSource.replace(needle, 'body[key]=fields[key].value;');
  await assert.rejects(async () => {
    const h = await harness(broken);
    chip(h, 'Aria', 'nude').onclick();
    await h.tick(250);
    assert.deepEqual(h.puts(noteRoute).map(call => call.body), [
      { session_id: 'actual-chat/7', wear: { c1: { name: 'Aria', wear: 'nude' } } },
    ]);
  });
});
