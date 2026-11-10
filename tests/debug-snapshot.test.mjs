import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  debugSnapshot,
  holdStallMonitor,
  resetStallWatch,
  setDebugMemory,
  setPrevBootGap,
  stallMonitoring,
  startStallMonitor,
  stopStallMonitor,
} from '../.test-build/debug.mjs';

afterEach(() => {
  resetStallWatch();
  stopStallMonitor();
  setDebugMemory(() => ({}));
  setPrevBootGap(null);
});

test('debugSnapshot carries boot identity and injected memory figures', () => {
  setPrevBootGap(4200);
  setDebugMemory(() => ({ data_urls: { entries: 3, bytes: 300, pinned: 1 } }));

  const snap = debugSnapshot();

  assert.equal(typeof snap.boot.id, 'string');
  assert.ok(snap.boot.id.length > 0);
  assert.equal(typeof snap.boot.at, 'number');
  assert.ok(snap.boot.uptime_ms >= 0);
  assert.equal(snap.boot.prev_boot_gap_ms, 4200);
  assert.deepEqual(snap.mem.data_urls, { entries: 3, bytes: 300, pinned: 1 });
  // Node has no performance.memory; the field must still be present so a user
  // dump has the same shape everywhere.
  assert.ok('js_heap_used' in snap.mem);
  assert.equal(snap.main_thread.monitoring, false);
});

test('stalls are watched for while a job is at work or the report is being read, not all session long', () => {
  // Nothing at work, nobody looking: no timer runs (it ran four times a second from start to end before).
  assert.equal(stallMonitoring(), false);
  // A job holds the watch from its start to its end; with two at work, until the last one ends.
  const one = holdStallMonitor(), two = holdStallMonitor();
  assert.equal(stallMonitoring(), true);
  one(); one();
  assert.equal(stallMonitoring(), true, 'one job ended (told twice): the other still holds it');
  two();
  assert.equal(stallMonitoring(), false, 'the last job ended');
  // A look at the report starts the watch, and says it was not being kept until then.
  assert.equal(debugSnapshot().main_thread.monitoring, false);
  assert.equal(stallMonitoring(), true);
  assert.equal(debugSnapshot().main_thread.monitoring, true);
  // It lingers past a job that ends meanwhile.
  holdStallMonitor()();
  assert.equal(stallMonitoring(), true);
});

test('stall monitor records a blocked main thread and stays quiet otherwise', async () => {
  startStallMonitor();
  // Two idle ticks: nothing may register as a stall.
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(debugSnapshot().main_thread.stalls, 0);

  // Block the loop for longer than the stall threshold. Busy-wait on purpose —
  // a timer would just be another idle tick.
  const t0 = Date.now();
  while (Date.now() - t0 < 500) { /* spin */ }
  await new Promise((r) => setTimeout(r, 300));

  const mt = debugSnapshot().main_thread;
  assert.equal(mt.monitoring, true);
  assert.ok(mt.stalls >= 1, `expected a stall, got ${JSON.stringify(mt)}`);
  assert.ok(mt.stall_max_ms >= 200, `stall_max_ms ${mt.stall_max_ms}`);
  assert.equal(mt.recent_stalls.length, mt.stalls);
  assert.ok('heap' in mt.recent_stalls[0]);
});
