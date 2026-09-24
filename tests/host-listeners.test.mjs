import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setMaxListeners } from 'node:events';
import { repairHostListeners } from '../tools/vendor-patches/host-listeners.mjs';

const vendor = readFileSync(new URL('../vendor/inlay-nexus-ui.js', import.meta.url), 'utf8');
const start = vendor.indexOf('  async function fe(');
const end = vendor.indexOf('  async function Wa(', start);
assert.ok(start >= 0 && end > start);
const original = vendor.slice(start, end);

function setup(source, { booleanOnly = false } = {}) {
  const document = new EventTarget();
  setMaxListeners(0, document);
  let serial = 0, calls = 0, removedPlugin = false, pending = 0;
  const tracked = new Set();
  // Both hosts register on document, then discard their bookkeeping even if
  // removeEventListener misses because the capture flag differs.
  class SafeElement {
    constructor(parent = null) { this.parent = parent; this.listeners = new Map(); }
    async getParent() { return this.parent; }
    async addEventListener(type, fn, options) {
      if (booleanOnly && typeof options === 'object') throw new Error('boolean options only');
      const id = ++serial, callback = () => fn();
      this.listeners.set(id, callback); tracked.add(id);
      document.addEventListener(type, callback, typeof options === 'boolean' ? {capture: options} : options);
      return id;
    }
    async removeEventListener(type, id, options) {
      const callback = this.listeners.get(id);
      if (!callback) return;
      document.removeEventListener(type, callback, typeof options === 'boolean' ? {capture: options} : options);
      this.listeners.delete(id); tracked.delete(id);
    }
  }
  const onScroll = () => { calls++; if (removedPlugin) pending++; };
  const t = { overlayUi: { onStickyScroll: onScroll, extraScrollBindings: [] } };
  const D = async (_label, fn, fallback) => { try { return await fn(); } catch { return fallback; } };
  const api = new Function('t', 'D', 'y', source + '\nreturn {fe,de,Ha,zt};')(t, D, () => {});
  let root = null;
  for (let i = 0; i < 8; i++) root = new SafeElement(root);
  return { ...api, root, tracked, onScroll,
    unload() { removedPlugin = true; },
    emit(type) { const before = calls; document.dispatchEvent(new Event(type)); return calls - before; },
    pending() { return pending; },
  };
}

test('scroll rebinding keeps working without retaining old document listeners', async () => {
  const api = setup(repairHostListeners(original));
  for (let i = 0; i < 100; i++) {
    await api.Ha(api.root);
    assert.equal(api.emit('scroll'), 8, `scroll callbacks after rebind ${i + 1}`);
    assert.equal(api.emit('scrollend'), 8);
  }
  await api.zt();
  api.unload();
  for (let i = 0; i < 100; i++) {
    assert.equal(api.emit('scroll'), 0, 'removed plugin must receive no more callbacks');
    assert.equal(api.emit('scrollend'), 0);
  }
  assert.equal(api.pending(), 0);
  assert.equal(api.tracked.size, 0);
});

test('capture and non-capture registrations can be removed independently', async () => {
  const api = setup(repairHostListeners(original));
  const capture = await api.fe(api.root, 'click', api.onScroll, true);
  const bubble = await api.fe(api.root, 'click', api.onScroll);
  assert.equal(api.emit('click'), 2);
  await api.de(api.root, 'click', capture);
  assert.equal(api.emit('click'), 1);
  await api.de(api.root, 'click', bubble);
  assert.equal(api.emit('click'), 0);
});

test('boolean capture fallback and directly registered non-capture listeners clean up', async () => {
  const api = setup(repairHostListeners(original), { booleanOnly: true });
  const capture = await api.fe(api.root, 'scroll', api.onScroll, true);
  assert.notEqual(capture, null);
  assert.equal(api.emit('scroll'), 1);
  await api.de(api.root, 'scroll', capture);
  assert.equal(api.emit('scroll'), 0);
  const direct = await api.root.addEventListener('click', api.onScroll);
  await api.de(api.root, 'click', direct);
  assert.equal(api.emit('click'), 0);
  await api.de(api.root, 'scroll', capture);
  await api.de(null, 'scroll', null);
  assert.equal(api.tracked.size, 0);
});

test('listener patch rejects missing, duplicate and changed upstream functions', () => {
  for (const source of ['', original + original, original.replace('capture: !0', 'capture: !1')]) {
    assert.throws(() => repairHostListeners(source), /host listeners.*drift/);
  }
});
