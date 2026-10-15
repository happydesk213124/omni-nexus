/**
 * Runs the shipped (built) versions of the host-traffic functions against a fake
 * host. Reads dist, so it belongs after `npm run build` (test:settings-ux).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dist = readFileSync(new URL('../dist/omninexus.js', import.meta.url), 'utf8');
const grab = (start) => {
  const at = dist.indexOf(start);
  assert.ok(at >= 0, `missing in dist: ${start.trim()}`);
  return dist.slice(at, dist.indexOf('\n  }\n', at) + 4);
};
const tick = () => new Promise(resolve => setImmediate(resolve));

// --- Z(): session bookkeeping -------------------------------------------------
{
  const host = { char: 0, failChat: false, failChar: false };
  const D = async (_name, fn, fallback) => { try { return await fn(); } catch { return fallback; } };
  const k = {
    getCurrentCharacterIndex: async () => host.char,
    getCurrentChatIndex: async () => 0,
    getCharacterFromIndex: async (i) => { if (host.failChar) throw new Error('busy'); return { chaId: `char${i}`, name: `Char ${i}` }; },
    getChatFromIndex: async () => { if (host.failChat) throw new Error('busy'); return { id: 'chat0', name: 'Chat 0' }; },
  };
  const make = () => {
    const logs = [], switches = [], t = { scopeOverride: null };
    const Z = new Function('t', 'D', 'k', 'y', 'w', 'ye', 'oa', 'schedulePointerSelect', grab('  async function Z(e = {}) {') + '\nreturn Z;')(
      t, D, k, (...a) => logs.push(a.join(' ')), (v) => String(v ?? ''), (v) => v, async (a, b) => switches.push([a, b]), () => {});
    return { Z, t, logs, switches };
  };

  // A click writes the live chat into lastScope; unified reads must not call that a switch.
  let f = make();
  await f.Z();
  const unified = f.t.lastScope.sessionId;
  f.t.lastScope = { ...f.t.lastScope, chatIndex: 0, sessionId: 'risu_char0|chat0', liveChat: true };
  await f.Z(); await f.Z(); await f.Z({ useOverride: false }); await f.Z();
  assert.deepEqual(f.switches, [], 'live selection and unified reads took turns "switching" the session');
  assert.equal(f.t._uiSessionId, unified);

  // A failed host read keeps the known session instead of inventing char_0 / chat_0.
  f = make(); await f.Z();
  const kept = f.t.lastScope;
  host.failChat = true;
  assert.equal(await f.Z({ useOverride: false }), kept, 'failed chat read must keep the known scope');
  host.failChat = false; host.failChar = true;
  await f.Z(); await f.Z();
  assert.deepEqual(f.switches, [], 'failed character read must not switch the session');
  assert.ok(f.logs.some(line => line.includes('host read failed')));
  host.failChar = false;

  // A real character change still switches, after the usual two confirming reads.
  host.char = 1; await f.Z(); await f.Z();
  assert.equal(f.switches.length, 1, 'a real character change must switch once');
  host.char = 0;
}

// --- nxScopeCheckSoon(): no whole-character read while the character is the same
{
  let index = 0, reads = 0;
  const t = { jobsInFlight: new Map(), lastScope: { charIndex: 0, sessionId: 'u0' } };
  const check = new Function('t', 'k', 'Z', 'formatViewerJob', 'nxScrollDbg', grab('  function nxScopeCheckSoon() {') + '\nreturn nxScopeCheckSoon;')(
    t, { getCurrentCharacterIndex: async () => index }, async () => { reads++; }, () => null, () => {});
  for (let i = 0; i < 5; i++) { t._scopeCheckAt = 0; check(); await tick(); }
  assert.equal(reads, 0, 'same character: the index answers, nothing else is read');
  index = 1; t._scopeCheckAt = 0; check(); await tick();
  assert.equal(reads, 1, 'a different character index runs the full scope read');
}

// --- Risu settings watch: poll fast only while open or right after a tap -------
{
  let fn = null, syncs = 0;
  const t = {};
  const start = new Function('t', 'setInterval', 'clearInterval', 'syncFloatingViewerForRisuSettings', grab('  function startRisuSettingsViewerWatch() {') + '\nreturn startRisuSettingsViewerWatch;')(
    t, (cb) => { fn = cb; return 1; }, () => {}, async () => { syncs++; });
  start();
  for (let i = 0; i < 16; i++) fn();
  assert.equal(syncs, 2, 'closed and untouched: one check per 3.2s');
  t._hostTapAt = Date.now(); syncs = 0;
  for (let i = 0; i < 4; i++) fn();
  assert.equal(syncs, 4, 'right after a tap: every 400ms');
  t._hostTapAt = 0; t._viewerHiddenForRisuSettings = true; syncs = 0;
  for (let i = 0; i < 4; i++) fn();
  assert.equal(syncs, 4, 'while Risu settings are open: every 400ms');
}

// --- Retired pins: no segment interval, no ancestor scroll listeners -----------
{
  const t = { backendSettings: { card: { overlay_markers: false } }, overlayUi: { onStickyScroll: () => {} } };
  let intervals = 0, listens = 0;
  new Function('t', 'setInterval', grab('  function Gt() {') + '\nreturn Gt;')(t, () => { intervals++; return 1; })();
  assert.equal(intervals, 0, 'pin segment watch must not run without pins');
  const Ha = new Function('t', 'zt', 'fe', 'y', grab('  async function Ha(e) {') + '\nreturn Ha;')(t, async () => {}, async () => { listens++; return 1; }, () => {});
  await Ha({ getParent: async () => null });
  assert.equal(listens, 0, 'no ancestor scroll listeners without pins');
  assert.ok(dist.includes('b = null, C = await fe(e, "scroll", u, !0)'), 'one document scroll listener for the overlay handler');
}

console.log('Host traffic: unified session bookkeeping, failed reads, index-only scope checks, tap-driven settings watch and retired pin listeners passed.');
