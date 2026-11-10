import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `export * from './src/domain/css-scope'; export * from './src/domain/inray-display'; export * from './src/domain/message-controls';
  export { displayPageCss, installDisplayCss, syncDisplayCss } from './src/image-ui/display-css';
  export { displayModuleCss } from './src/storage/inray-display-module';
  export { getConfig, setConfig } from './src/services/context';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.txt': 'text' }, logLevel: 'silent' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

// Each of these was put through Risu's own scoping (parser.svelte.ts decodeStyleRule: @adobe/css-tools and
// postcss-selector-parser) and says the same, spacing aside.
const cases = [
  ['.a{color:red}.a .b>.c~.d+.e{margin:0}', '.chattext .x-risu-a{color:red}.chattext .x-risu-a .x-risu-b>.x-risu-c~.x-risu-d+.x-risu-e{margin:0}'],
  ['.a,.b:hover,[data-x] .c{top:0}', '.chattext .x-risu-a,.chattext .x-risu-b:hover,.chattext [data-x] .x-risu-c{top:0}'],
  // A comma, a dot or a class-like word inside an attribute's value is the value's.
  ['[data-k=".x,y"] .a,[title=\'a.b\'],[data-n="1"]{left:0}', '.chattext [data-k=".x,y"] .x-risu-a,.chattext [title=\'a.b\'],.chattext [data-n="1"]{left:0}'],
  // Classes inside :not() and :has() are renamed too; braces inside a declared string are the string's.
  ['.a:not(.b):has(> .c:checked)~.d::before{content:"}.x{"}', '.chattext .x-risu-a:not(.x-risu-b):has(> .x-risu-c:checked)~.x-risu-d::before{content:"}.x{"}'],
  ['@media(min-width:601px){.a,[data-b]{--w:var(--n,100%)}}@media (hover:none){.a .b{opacity:0!important}}', '@media(min-width:601px){.chattext .x-risu-a,.chattext [data-b]{--w:var(--n,100%)}}@media (hover:none){.chattext .x-risu-a .x-risu-b{opacity:0!important}}'],
  // Keyframes are not selectors: left as written.
  ['@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}.a{animation:spin 1s linear infinite}', '@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}.chattext .x-risu-a{animation:spin 1s linear infinite}'],
  ['@supports (display:grid){@media (max-width:400px){.a{gap:2px}}}', '@supports (display:grid){@media (max-width:400px){.chattext .x-risu-a{gap:2px}}}'],
  // Already renamed: not renamed twice.
  ['.x-risu-a .b{top:0}', '.chattext .x-risu-a .x-risu-b{top:0}'],
  ['p > .a, div.b, button:hover{top:0}', '.chattext p > .x-risu-a,.chattext div.x-risu-b,.chattext button:hover{top:0}'],
  // A number that starts with a dot is not a class.
  ['.a{width:.5em;margin:.1rem auto .75rem 0;flex:0 0 34px;font:18px/1 system-ui}', '.chattext .x-risu-a{width:.5em;margin:.1rem auto .75rem 0;flex:0 0 34px;font:18px/1 system-ui}'],
];

test('a stylesheet is scoped as Risu scopes a chat stylesheet: under .chattext, classes renamed x-risu-', () => {
  for (const [written, scoped] of cases) assert.equal(api.scopeChatCss(written), scoped, written);
  assert.equal(api.scopeChatCss(''), '');
});

/** A sheet as [what comes before a block, the block], block by block, nested ones opened: a second reading, to check the first. */
function blocks(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    let depth = 0, quote = '', end = open;
    for (; end < text.length; end++) {
      const c = text[end];
      if (quote) { if (c === '\\') end++; else if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") quote = c; else if (c === '{') depth++; else if (c === '}' && --depth === 0) break;
    }
    const head = text.slice(i, open).trim(), body = text.slice(open + 1, end);
    if (/^@(media|supports|container)/.test(head)) out.push([head, '…'], ...blocks(body)); else out.push([head, body]);
    i = end + 1;
  }
  return out;
}
const sheets = () => ({ 'pictures': api.chatDisplayCss(100), 'pictures at 70%': api.chatDisplayCss(70), 'the row': api.messageControlsCss(false), 'the row, folded': api.messageControlsCss(true) });

test('our own sheets: every selector scoped, no class left as written, and what each rule declares untouched', () => {
  for (const [name, written] of Object.entries(sheets())) {
    const before = blocks(written), after = blocks(api.scopeChatCss(written));
    assert.equal(after.length, before.length, `${name}: as many rules`);
    assert.ok(before.length >= 5, `${name}: ${before.length} rules`);
    for (let i = 0; i < before.length; i++) {
      const [head, body] = before[i], [scopedHead, scopedBody] = after[i];
      assert.equal(scopedBody, body, `${name}: ${head} declares what it declared`);
      if (head.startsWith('@')) { assert.equal(scopedHead, head); continue; }
      // Attribute values aside, each selector of the list (a comma inside :is() or :not() is not the list's) starts
      // under .chattext and has no bare class.
      const bare = scopedHead.replace(/\[[^\]]*\]/g, '[]');
      const list = []; let depth = 0, from = 0;
      for (let at = 0; at <= bare.length; at++) { const c = bare[at]; if (c === '(') depth++; else if (c === ')') depth--; else if (at === bare.length || (c === ',' && !depth)) { list.push(bare.slice(from, at)); from = at + 1; } }
      for (const selector of list) {
        assert.ok(selector.startsWith('.chattext '), `${name}: ${selector}`);
        assert.doesNotMatch(selector.slice(9), /\.(?!x-risu-)[A-Za-z_-]/, `${name}: ${selector}`);
      }
      assert.equal(scopedHead.replace(/\.chattext /g, '').replace(/\.x-risu-/g, '.'), head.split(',').map(s => s.trim()).join(','), `${name}: the selector is the one written`);
    }
  }
  // What a picture's hover bar needs, by name.
  assert.match(api.scopeChatCss(api.chatDisplayCss(100)), /\.chattext \.x-risu-inray-shot\[data-inlay-inline-shot\]:hover \.x-risu-inray-bar/);
});

test('the page\'s copy and the module\'s copy are the same sheet, the page\'s scoped', () => {
  for (const card of [{ inline_chat_scale_pct: 100 }, { inline_chat_scale_pct: 60, inline_msg_fan: true, inline_msg_fan_folded: true }]) {
    const inModule = /^<style>([\s\S]*)<\/style>$/.exec(api.displayModuleCss(card.inline_chat_scale_pct, card.inline_msg_fan_folded === true))[1];
    assert.equal(api.displayPageCss(card), api.scopeChatCss(inModule));
  }
});

/** A page as a plugin reaches it: Risu's SafeElement, as much of it as the sheet's installer uses. */
function page({ prepend = true, stale = 0 } = {}) {
  const made = [];
  const element = (tag) => {
    const node = { tag, attrs: {}, text: '', parent: null, children: [],
      setAttribute: async (k, v) => { assert.ok(k.startsWith('x-'), 'only x- attributes may be set'); node.attrs[k] = v; },
      setTextContent: async v => { node.text = v; },
      appendChild: async child => { child.parent = node; node.children.push(child); },
      remove: async () => { if (node.parent) node.parent.children = node.parent.children.filter(n => n !== node); node.parent = null; },
      release: () => {} };
    if (prepend) node.prepend = async child => { child.parent = node; node.children.unshift(child); };
    return node;
  };
  const body = element('body');
  body.children.push(Object.assign(element('div'), { parent: body, attrs: { id: 'app' } }));
  for (let i = 0; i < stale; i++) body.children.push(Object.assign(element('style'), { parent: body, attrs: { 'x-omni-display-css': '1' }, text: 'old' }));
  const doc = {
    querySelector: async q => q === 'body' ? body : null,
    querySelectorAll: async q => q === '[x-omni-display-css]' ? body.children.filter(n => 'x-omni-display-css' in n.attrs) : [],
    createElement: async tag => { const node = element(tag); made.push(node); return node; },
  };
  return { body, doc, made, sheets: () => body.children.filter(n => n.tag === 'style') };
}

test('the sheet goes into the page once the settings are read: first in the body, one node, kept up with the settings', async () => {
  const { body, doc, made, sheets } = page({ stale: 2 });
  let unload, ready, asked = 0;
  const settings = new Promise(resolve => { ready = resolve; });
  globalThis.risuai = { getRootDocument: async () => { asked++; return doc; }, onUnload: async fn => { unload = fn; } };
  try {
    const installing = api.installDisplayCss({ ready: () => settings });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(asked, 0, 'nothing is put in the page before the settings are known: the size is one of them');
    api.setConfig({ ...api.getConfig(), card: { ...api.getConfig().card, inline_chat_scale_pct: 80, inline_msg_fan_folded: false } });
    ready(); await installing;
    assert.equal(sheets().length, 1, 'the two a reloaded build left are gone');
    assert.equal(body.children[0], sheets()[0], 'first in the body: a chat\'s own styles come after it');
    assert.equal(sheets()[0].text, api.displayPageCss(api.getConfig().card));
    assert.match(sheets()[0].text, /^\.chattext \.x-risu-inray-shot/);
    // A setting that changes the sheet: the same node, new text.
    api.setConfig({ ...api.getConfig(), card: { ...api.getConfig().card, inline_chat_scale_pct: 120 } });
    Reflect.get(globalThis, '__OMNI_DISPLAY_CSS__').sync();
    await api.syncDisplayCss();
    assert.equal(made.length, 1, 'no second node');
    assert.equal(sheets()[0].text, api.displayPageCss(api.getConfig().card));
    assert.match(sheets()[0].text, /min\(100%,var/);
    // Nothing changed: nothing written.
    let writes = 0; const set = sheets()[0].setTextContent; sheets()[0].setTextContent = async v => { writes++; return set(v); };
    await api.syncDisplayCss();
    assert.equal(writes, 0);
    await unload();
    assert.equal(sheets().length, 0, 'unloaded, it leaves the page');
  } finally { delete globalThis.risuai; }
});
