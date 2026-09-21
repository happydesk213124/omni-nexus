import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { repairSettingsSave } from '../tools/vendor-patches/settings-save.mjs';

const runtime = readFileSync(new URL('../tools/vendor-patches/settings-save.js', import.meta.url), 'utf8');
const bundle = await build({ stdin: { contents: `
  export { persistSettingsSnapshot } from './src/services/settings-persistence.ts';
  export { getConfig } from './src/services/context.ts';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'Subject' });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; }

function backend() {
  const stored = new Map(), writes = [], reads = [];
  const state = { block: null, fail: false, drop: false, moduleReads: 0 };
  const context = { console, performance, TextEncoder, TextDecoder, URL, setTimeout, clearTimeout,
    risuai: {
      pluginStorage: {
        getItem: async key => { reads.push(key); return structuredClone(stored.get(key) ?? null); },
        setItem: async (key, value) => {
          writes.push(structuredClone(value));
          if (state.block) await state.block.promise;
          if (state.fail) throw Error('write rejected');
          if (!state.drop) stored.set(key, structuredClone(value));
        },
      },
      getDatabase: async () => { state.moduleReads++; return { modules: [], enabledModules: [] }; },
      setDatabase: async () => {},
    },
  };
  runInNewContext(bundle.outputFiles[0].text, context);
  return { ...context.Subject, stored, writes, reads, state };
}

function ui() {
  const t = { uiOpen: true, backendSettings: { card: { image_min: 1 } }, _settingsConfirmed: { card: { image_min: 1 } }, prompts: [], promptDrafts: {}, lastScope: { sessionId: 'a' } };
  const puts = [], messages = [], fields = new Map(), timers = new Map();
  let nextTimer = 0, commits = 0;
  const state = { block: null, fail: false, failCommit: false, card: null };
  const mergeSettingsPatch = (a, b) => {
    const out = { ...a || {} };
    for (const [key, value] of Object.entries(b || {})) out[key] = value && typeof value === 'object' && !Array.isArray(value) ? mergeSettingsPatch(out[key], value) : value;
    return out;
  };
  const globals = { __INLAY_NATIVE__: { flushSettings: async () => { commits++; if (state.failCommit) throw Error('disk full'); } } };
  const context = {
    t, globalThis: globals, document: { getElementById: id => fields.get(id), querySelector: () => null },
    Mt: () => state.card, Ct: () => null, ba: () => null, oe: () => [], withRootSessions: body => body,
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    mergeSettingsPatch, z: String, y: () => {}, $e: message => messages.push(message), nxHostToast: async message => messages.push(message),
    P: async () => {}, syncQuickSettingsButton: async () => {},
    pe: async patch => {
      puts.push(structuredClone(patch));
      if (state.block) await state.block.promise;
      if (state.fail) throw Error('request failed');
      t._settingsConfirmed = mergeSettingsPatch(t._settingsConfirmed, patch);
    },
    K: async (path, opts) => {
      puts.push({ path, body: structuredClone(opts.body) });
      if (state.block) await state.block.promise;
      if (state.fail) throw Error('request failed');
      return {};
    },
  };
  runInNewContext(runtime + '\nthis.subject = {flushSettingsSave, omniCaptureSettingsSave, omniEnqueueLiveWrite, omniFlushLiveWrites, omniLiveWrites, xa};', context);
  return { ...context.subject, context, t, puts, messages, fields, state, timers, get commits() { return commits; } };
}

test('unchanged saves do no host read/write and unrelated settings do not recheck display modules', async () => {
  const f = backend();
  await f.persistSettingsSnapshot(false); await tick();
  const reads = f.reads.length, writes = f.writes.length, modules = f.state.moduleReads;
  await f.persistSettingsSnapshot(false); await tick();
  assert.equal(f.reads.length, reads); assert.equal(f.writes.length, writes);
  f.getConfig().card.image_min += 1;
  await f.persistSettingsSnapshot(false); await tick();
  assert.equal(f.writes.length, writes + 1);
  assert.equal(f.state.moduleReads, modules);
  f.getConfig().card.inline_chat_scale_pct = 150;
  await f.persistSettingsSnapshot(false); await tick();
  assert.equal(f.state.moduleReads, modules + 1);
});

test('a blocked storage write is followed only by the latest merged snapshot', async () => {
  const f = backend();
  f.state.block = deferred();
  const first = f.persistSettingsSnapshot(false); await tick();
  f.getConfig().card.image_min = 2;
  const second = f.persistSettingsSnapshot(false);
  f.getConfig().card.image_min = 3;
  f.getConfig().card.image_max = 5;
  const third = f.persistSettingsSnapshot(true);
  assert.equal(f.writes.length, 1);
  f.state.block.resolve();
  await Promise.all([first, second, third]);
  assert.equal(f.writes.length, 2);
  assert.equal(f.stored.get('onx_native_settings').card.image_min, 3);
  assert.equal(f.stored.get('onx_native_settings').card.image_max, 5);
});

test('failed storage writes invalidate the cache and can be retried', async () => {
  const f = backend(); f.state.fail = true;
  await assert.rejects(f.persistSettingsSnapshot(false), /write rejected/);
  f.state.fail = false;
  await f.persistSettingsSnapshot(true);
  assert.equal(f.writes.length, 2);
  assert.ok(f.stored.has('onx_native_settings'));
});

test('a silently discarded ordinary setting fails verification and remains retryable', async () => {
  const f = backend();
  await f.persistSettingsSnapshot(true);
  f.getConfig().card.image_min += 1;
  f.state.drop = true;
  await assert.rejects(f.persistSettingsSnapshot(true), /설정 저장 실패/);
  f.state.drop = false;
  await f.persistSettingsSnapshot(true);
  assert.equal(f.stored.get('onx_native_settings').card.image_min, f.getConfig().card.image_min);
});

test('close capture merges pending edits into one delta; an unchanged close performs no save', async () => {
  const f = ui();
  f.state.card = { image_min: 2 };
  f.t.settingsSavePending = { card: { image_min: 2, image_max: 4 } };
  f.omniCaptureSettingsSave();
  assert.equal(await f.xa({ silent: true, captured: true }), true);
  assert.deepEqual(f.puts, [{ card: { image_min: 2, image_max: 4 } }]);
  assert.equal(f.commits, 1);
  await f.xa({ silent: true });
  assert.equal(f.puts.length, 1); assert.equal(f.commits, 1);
});

test('rapid controls retain a debounce and flush only the latest value', async () => {
  const source = readFileSync(new URL('../dist/omninexus.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function queueSettingsSave(');
  const end = source.indexOf('\n  }', start) + '\n  }'.length;
  assert.ok(start >= 0 && end > start);
  const f = ui();
  const context = { ...f.context, flushSettingsSave: f.flushSettingsSave, omniSaveError: () => {} };
  runInNewContext(source.slice(start, end) + '\nthis.queue = queueSettingsSave;', context);
  for (let value = 2; value <= 20; value++) context.queue({ card: { image_min: value } });
  assert.equal(f.puts.length, 0);
  assert.equal(f.timers.size, 1);
  assert.ok([...f.timers.values()][0].ms > 0, 'direct slider events must not write on every event');
  await f.flushSettingsSave();
  assert.deepEqual(f.puts, [{ card: { image_min: 20 } }]);
  assert.equal(f.timers.size, 0);
});

test('edits during an in-flight settings request merge and flush without stale overwrite', async () => {
  const f = ui(); f.state.block = deferred();
  f.t.settingsSavePending = { card: { image_min: 2 } };
  const first = f.flushSettingsSave(); await tick();
  f.t.settingsSavePending = { card: { image_min: 3, image_max: 5 } };
  const second = f.flushSettingsSave();
  f.state.block.resolve(); await Promise.all([first, second]);
  assert.deepEqual(f.puts, [{ card: { image_min: 2 } }, { card: { image_min: 3, image_max: 5 } }]);
  assert.equal(f.commits, 1);
});

test('failed requests retain edits, newer values win on retry, and closed UI reports durable failure', async () => {
  const f = ui(); f.state.fail = true;
  f.t.settingsSavePending = { card: { image_min: 2 } };
  await assert.rejects(f.flushSettingsSave(), /request failed/);
  assert.equal(f.t.settingsSavePending.card.image_min, 2);
  f.state.fail = false; f.state.failCommit = true; f.t.uiOpen = false;
  f.t.settingsSavePending.card.image_min = 3;
  assert.equal(await f.xa({ silent: true, captured: true }), false);
  assert.match(f.messages.at(-1), /disk full/);
  f.state.failCommit = false;
  assert.equal(await f.xa({ silent: true, captured: true }), true);
  assert.equal(f.puts.length, 2, 'durability retry must not repeat an accepted PUT');
  assert.equal(f.t._settingsConfirmed.card.image_min, 3);
});

test('queued prompt writes coalesce; failure stays retryable', async () => {
  const f = ui(), blocker = deferred(), values = [];
  f.omniLiveWrites().writes = blocker.promise;
  f.omniEnqueueLiveWrite('prompt:a', async () => values.push('old'));
  const first = f.omniFlushLiveWrites();
  f.omniEnqueueLiveWrite('prompt:a', async () => values.push('new'));
  blocker.resolve(); await first;
  assert.deepEqual(values, ['new']);
  let fail = true;
  f.omniEnqueueLiveWrite('prompt:a', async () => { if (fail) throw Error('failed'); values.push('retry'); });
  await assert.rejects(f.omniFlushLiveWrites(), /failed/);
  fail = false; await f.omniFlushLiveWrites();
  assert.deepEqual(values, ['new', 'retry']);
});

test('shared character-editor queue failures cannot be reported as a successful flush', async () => {
  const f = ui();
  f.omniLiveWrites().writes = Promise.reject(Error('character save failed'));
  await assert.rejects(f.omniFlushLiveWrites(), /character save failed/);
  f.omniEnqueueLiveWrite('characters:a', async () => {});
  await f.omniFlushLiveWrites();
});

test('prompt undo during in-flight save is captured before DOM removal and wins', async () => {
  const f = ui(); f.t.prompts = [{ key: 'a', text: 'original' }];
  f.state.block = deferred();
  f.fields.set('nx-prompt-a', { value: 'edited' });
  f.omniCaptureSettingsSave(); const first = f.omniFlushLiveWrites(); await tick();
  f.fields.set('nx-prompt-a', { value: 'original' });
  f.omniCaptureSettingsSave(); f.fields.clear();
  const second = f.omniFlushLiveWrites();
  f.state.block.resolve(); await Promise.all([first, second]);
  assert.deepEqual(f.puts.map(put => put.body.text), ['edited', 'original']);
  assert.equal(f.t.prompts[0].text, 'original');
});

test('dirty character snapshot stays with its original scope after closing and switching bots', async () => {
  const f = ui();
  f.t._charsDirty = true;
  f.t.charactersSession = [{ id: 'one', name: 'edited' }];
  f.t.charactersGlobal = [];
  f.omniCaptureSettingsSave();
  f.t.lastScope = { sessionId: 'b' };
  f.t.charactersSession = [{ id: 'two', name: 'other bot' }];
  await f.omniFlushLiveWrites();
  assert.equal(f.puts.length, 1);
  assert.equal(f.puts[0].body.session_id, 'a');
  assert.equal(f.puts[0].body.characters[0].name, 'edited');
  assert.equal(f.t.charactersSession[0].name, 'other bot');
});

test('settings-close handler dispatches hide before blocked persistence and stale restore is cancelled on reopen', async () => {
  const source = readFileSync(new URL('../dist/omninexus.js', import.meta.url), 'utf8');
  const start = source.indexOf('document.getElementById("nx-close")?.addEventListener("click", async () => {');
  const end = source.indexOf('\n    }),', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end) + '\n    });';
  const f = ui(), hiding = deferred(), events = [];
  let click;
  f.state.card = { image_min: 7 };
  const context = { ...f.context, document: { ...f.context.document, getElementById: id => id === 'nx-close' ? { addEventListener: (_event, fn) => { click = fn; } } : null },
    omniCaptureSettingsSave: f.omniCaptureSettingsSave, xa: async () => { events.push('save'); return new Promise(() => {}); },
    k: { hideContainer: () => { events.push('hide'); f.fields.clear(); return hiding.promise; } },
    clearInterval: () => {}, invalidateOverlayLayoutCache: () => events.push('restore'),
  };
  runInNewContext(body, context);
  const closing = click();
  assert.deepEqual(events, ['hide']);
  assert.equal(f.t.settingsSavePending.card.image_min, 7);
  for (const { fn } of [...f.timers.values()]) fn();
  assert.deepEqual(events, ['hide', 'save']);
  f.t.uiOpen = true; f.t._settingsCloseEpoch++;
  hiding.resolve(); await closing;
  assert.deepEqual(events, ['hide', 'save']);
});

test('save patch rejects a missing vendor seam rather than applying vacuously', () => {
  assert.throws(() => repairSettingsSave(''), /region drift/);
});
