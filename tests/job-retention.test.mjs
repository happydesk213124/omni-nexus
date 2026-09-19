import test from "node:test";
import assert from "node:assert/strict";

import {
  JOB_RETENTION_LIMIT,
  ORPHAN_JOB_ERROR,
  jobIdsToPrune,
  jobRetentionStamp,
  orphanJobIds,
} from "../.test-build/job-retention.mjs";

test("the finished-row cap is zero: no survival window after a terminal state", () => {
  assert.equal(JOB_RETENTION_LIMIT, 0);
});

function row(id, state, created_at, updated_at) {
  return { id, state, created_at, updated_at };
}

test("finished rows are dropped immediately; only live rows survive", () => {
  // Reroll reads image metadata through its own logic now, so a finished job
  // row has no readers left. The cap is zero: every finished row is pruned.
  for (const terminal of ["done", "error", "cancelled"]) {
    assert.deepEqual(jobIdsToPrune([row("fresh", terminal, 9999)]), ["fresh"]);
  }
  assert.deepEqual(jobIdsToPrune([row("live", "generating", 1)]), []);
});

test("never drops an in-flight job, however many finished rows pile up", () => {
  const rows = [
    row("old-gen", "generating", 1),
    ...Array.from({ length: 20 }, (_, i) => row(`done${i}`, "done", 100 + i)),
  ];
  const drop = new Set(jobIdsToPrune(rows));
  assert.equal(drop.has("old-gen"), false);
  // Finished rows are all dropped; the live row never counts against anything.
  assert.equal(drop.size, 20);
  assert.equal(drop.has("done19"), true);
});

test("a job that just finished is dropped even with live rows around", () => {
  // With a zero cap there is no survival window: the write that moves a job
  // to a terminal state is the write that deletes it. The poller must read
  // the terminal state before the next job write lands.
  const zombies = [row("z0", "tagging", 1), row("z1", "generating", 2)];
  for (const terminal of ["error", "done", "cancelled"]) {
    assert.deepEqual(jobIdsToPrune([...zombies, row("fresh", terminal, 9999)]), ["fresh"], `${terminal} row is dropped`);
  }
});

test("orphanJobIds is exactly the in-flight rows", () => {
  const rows = [
    row("q", "queued", 1),
    row("t", "tagging", 2),
    row("g", "generating", 3),
    row("d", "done", 4),
    row("e", "error", 5),
    row("c", "cancelled", 6),
  ];
  assert.deepEqual(orphanJobIds(rows), ["q", "t", "g"]);
  assert.deepEqual(orphanJobIds([]), []);
  assert.equal(typeof ORPHAN_JOB_ERROR, "string");
  assert.ok(ORPHAN_JOB_ERROR.length > 0);
});

test("drop ranking still prefers updated_at, even though all finished rows drop", () => {
  const fresh = [row("fresh0", "done", 1, 10), row("fresh1", "done", 1, 11)];
  const rows = [row("stale", "done", 999, 1), ...fresh];
  // Every finished row is dropped; the stale one sorts first.
  assert.deepEqual(jobIdsToPrune(rows), ["stale", "fresh0", "fresh1"]);
});

test("jobRetentionStamp falls back to created_at", () => {
  assert.equal(jobRetentionStamp({ id: "a", updated_at: 8, created_at: 2 }), 8);
  assert.equal(jobRetentionStamp({ id: "a", created_at: 2 }), 2);
  assert.equal(jobRetentionStamp({ id: "a" }), 0);
});
