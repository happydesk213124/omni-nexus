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

// --- The floating viewer hears the chat screen check: hidden while it is gone, back with it, nothing polled ---
{
  const subs = [], hides = [], restores = [], ensures = [];
  globalThis.__OMNI_CHAT_SCREEN__ = { watch: (fn) => { const sub = { fn, live: true }; subs.push(sub); return () => { sub.live = false; }; } };
  const t = { backendSettings: { card: {} } };
  let sync = null;
  // As the shipped two do: the flag first, then the subscription is synced.
  const hide = async () => { if (t._viewerHiddenForRisuSettings) return; hides.push(1); t._viewerHiddenForRisuSettings = true; sync(); };
  const restore = async () => { if (!t._viewerHiddenForRisuSettings) return; restores.push(1); t._viewerHiddenForRisuSettings = false; sync(); };
  sync = new Function('t', 'hideFloatingViewerForRisuSettings', 'restoreFloatingViewerAfterRisuSettings', 'nxFloatBlocked', 'nxFloatEnsure',
    grab('  function syncChatScreenWatch() {') + '\nreturn syncChatScreenWatch;')(t, hide, restore, () => !!t._hostChromeBlocked, async () => { ensures.push(1); });
  const live = () => subs.filter(s => s.live);
  const screen = (present, width = 400, drawn = 0) => ({ present, left: 0, top: 0, width: present ? width : 0, height: present ? 800 : 0, drawn });
  sync(); sync();
  assert.equal(live().length, 1, 'the viewer on: one subscription, however often it is synced');
  live()[0].fn(screen(true));
  assert.deepEqual([hides.length, restores.length, ensures.length], [0, 0, 0], 'first told the chat is up: nothing to do (the boot mounts the viewer)');
  live()[0].fn(screen(false));
  assert.deepEqual([hides.length, t._chatScreenGone], [1, true], 'the chat screen gone (Risu settings drawn in its place): the viewer hides');
  live()[0].fn(screen(true));
  assert.deepEqual([restores.length, ensures.length, t._chatScreenGone], [1, 0, false], 'the chat screen back: so is the viewer');
  // What the old poll's mount caught, told now: a turned phone, a chat screen drawn anew.
  live()[0].fn(screen(true, 800));
  live()[0].fn(screen(true, 800, 1));
  assert.equal(ensures.length, 2, 'moved or drawn anew: the viewer is laid out on it again');
  // Our settings are a frame over the page: they hide the viewer themselves, and read where they close onto.
  t._hostChromeBlocked = true;
  live()[0].fn(screen(false));
  assert.deepEqual([hides.length, t._chatScreenGone], [1, true], 'under our settings the hiding is theirs; the chat screen is noted gone');
  live()[0].fn(screen(true)); live()[0].fn(screen(true, 500));
  assert.equal(ensures.length, 2, 'nor is the viewer laid out under them');
  t._hostChromeBlocked = false;
  // The viewer off: nothing is heard for it.
  t.backendSettings.card.floating_viewer = false; sync();
  assert.equal(live().length, 0, 'the viewer off: no subscription');
  assert.equal(t._chatScreenGone, false, 'and nothing stale left for our settings to read');
  // Off, but hidden for a page with no chat (our settings closed onto Risu's): heard until the chat is back, so the
  // flag (which hides the TTS window too) is let go.
  await hide();
  assert.equal(live().length, 1, 'hidden for a page with no chat: heard');
  live()[0].fn(screen(false)); live()[0].fn(screen(true));
  assert.deepEqual([t._viewerHiddenForRisuSettings, live().length], [false, 0], 'the chat back: the flag let go, and the subscription');
  t.backendSettings.card.floating_viewer = true; sync();
  t.unloading = true; sync();
  assert.equal(live().length, 0, 'unloading: let go');
  delete globalThis.__OMNI_CHAT_SCREEN__;
  assert.ok(!dist.includes('syncFloatingViewerForRisuSettings') && !dist.includes('_hostTapAt'), 'nothing polls Risu settings');
  assert.ok(dist.includes('globalThis.__OMNI_CHAT_SCREEN__?.soon?.();'), 'a click asks for the chat screen soon');
  assert.ok(dist.includes('typeof t._risuSettingsWatch == "function" && (t._risuSettingsWatch(), t._risuSettingsWatch = null)'), 'unload lets go of it');
  assert.equal(dist.split('let stayInRisu = !!t._viewerHiddenForRisuSettings || !!t._chatScreenGone;').length - 1, 2, 'both settings closes read where they close onto');
  // The other thing the poll's mount caught: another chat. The viewer's own pass mounts it afresh when it sees one.
  assert.ok(dist.includes('if (scope.sessionId !== nxFloatSession) { if (scope.sessionId) void nxFloatEnsure().catch(() => {}); return; }'), 'another chat: mounted afresh');
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

console.log('Host traffic: unified session bookkeeping, failed reads, index-only scope checks, the chat screen watch for the floating viewer and retired pin listeners passed.');
