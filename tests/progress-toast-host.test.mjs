import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const built = readFileSync(new URL('../dist/omninexus.js', import.meta.url), 'utf8');
function section(start, end) {
  const a = built.indexOf(start), b = built.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'shipped helper boundaries must exist');
  return built.slice(a, b);
}
const helpers = section('  function nxToastAnchor()', '  const HOST_TOAST_CHROME')
  + section('  async function H(', '  async function rt(');
const runtime = section('  const nxProgress =', '  /** risutts-style one-shot host toast');
assert.equal(runtime.trim(), readFileSync(new URL('../tools/vendor-patches/progress-toast-runtime.js', import.meta.url), 'utf8').trim(), 'build must include the current toast runtime');
const core = await build({ entryPoints: ['src/ui-contract/viewer-core.ts'], bundle: true, write: false, format: 'iife', globalName: 'ViewerCore' });

test('toast renders through restricted SafeElement and DOMPurify on mobile and desktop', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    for (const width of [320, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.setContent('<body style="margin:0;background:#161922"><button id="behind" style="position:fixed;inset:0;width:100%;height:100%">Chat</button></body>');
      await page.addScriptTag({ content: readFileSync(new URL('../node_modules/dompurify/dist/purify.min.js', import.meta.url), 'utf8') });
      await page.addScriptTag({ content: core.outputFiles[0].text });
      const result = await page.evaluate(async ({ runtime, helpers }) => {
        const writes = { html: 0, text: 0, style: 0, attrs: [] };
        // Mirror Risu's public SafeElement operations, including the restriction
        // that the earlier permissive toast mock missed (apiV3/v3.svelte.ts).
        class SafeElement {
          #node;
          constructor(node) { this.#node = node; }
          async setAttribute(key, value) {
            if (!key.startsWith('x-')) throw Error('Unsupported SafeElement attribute: ' + key);
            writes.attrs.push(key); this.#node.setAttribute(key, value);
          }
          async setStyleAttribute(css) { writes.style++; this.#node.style.cssText = css; }
          async setInnerHTML(html) { writes.html++; this.#node.innerHTML = DOMPurify.sanitize(html); }
          async setTextContent(text) { writes.text++; this.#node.textContent = text; }
          async querySelector(selector) { const node = this.#node.querySelector(selector); return node ? new SafeElement(node) : null; }
          async appendChild(child) { this.#node.appendChild(child.#node); }
          async remove() { this.#node.remove(); }
        }
        const doc = { createElement: async tag => new SafeElement(document.createElement(tag)) };
        const t = { backendSettings: { card: { progress_toast: true, toast_anchor: 'tc' } } };
        globalThis.__INLAY_VIEWER_CORE__ = ViewerCore;
        let now = 1000, timerId = 0;
        const timers = new Map();
        const api = new Function('t', 'ue', 'Ee', 'Pe', 'Date', 'setTimeout', 'clearTimeout', helpers + runtime + ';return {sync:syncProgressToast,dispose:nxDisposeProgressToast,prepare:nxWithScenePreparation};')(
          t, async () => doc, async () => new SafeElement(document.body), (_label, error) => { throw error; }, { now: () => now },
          (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, id => timers.delete(id),
        );
        let finish;
        const preparation = api.prepare(() => new Promise(resolve => { finish = resolve; }));
        await api.sync();
        const preparingRoot = document.querySelector('[x-omni-progress-toast]');
        const immediate = !!preparingRoot && getComputedStyle(preparingRoot).display !== 'none' && preparingRoot.textContent.includes('장면 정리 중');
        t.jobProgress = { jobId: 'first', state: 'generating', shot_count: 4, shot_done: 1, shot_index: 1 };
        await api.sync(); finish(); await preparation; await api.sync();
        const root = document.querySelector('[x-omni-progress-toast]');
        const rect = root.getBoundingClientRect();
        const live = root.querySelector('[role="status"][aria-live="polite"][aria-atomic="true"]');
        const initial = { text: root.textContent, width: rect.width, height: rect.height, left: rect.left, right: rect.right,
          display: getComputedStyle(root).display, live: !!live,
          passesInput: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.id === 'behind' };
        const before = JSON.stringify(writes);
        for (let i = 0; i < 20; i++) await api.sync();
        const unchanged = JSON.stringify(writes) === before;
        t.jobProgress = { ...t.jobProgress, state: 'error', message: '<img src=x onerror=alert(1)>키 확인' };
        await api.sync();
        const safeError = root.textContent.includes('<img src=x onerror=alert(1)>키 확인') && !root.querySelector('img');
        t.jobProgress = null; await api.sync();
        const retained = getComputedStyle(root).display !== 'none';
        now += 6000; await api.sync();
        const hidden = getComputedStyle(root).display === 'none' && timers.size === 0;
        await api.dispose();
        return { initial, immediate, unchanged, safeError, retained, hidden, removed: !root.isConnected, htmlWrites: writes.html, attrs: writes.attrs };
      }, { runtime, helpers });
      assert.match(result.initial.text, /이미지 생성 중/);
      assert.match(result.initial.text, /2 \/ 4장 · 1장 완료/);
      assert.ok(result.initial.width > 0 && result.initial.height > 0);
      assert.ok(result.initial.left >= 0 && result.initial.right <= width);
      assert.notEqual(result.initial.display, 'none');
      for (const key of ['live', 'passesInput']) assert.equal(result.initial[key], true, key);
      for (const key of ['immediate', 'unchanged', 'safeError', 'retained', 'hidden', 'removed']) assert.equal(result[key], true, key);
      assert.equal(result.htmlWrites, 1);
      assert.deepEqual(result.attrs, ['x-omni-progress-toast']);
      await page.close();
    }
  } finally { await browser.close(); }
});
