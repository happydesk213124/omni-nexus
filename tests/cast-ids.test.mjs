import test from "node:test";
import assert from "node:assert/strict";

import {
  seedCastId,
  randomCastId,
  sanitizeCastId,
  formatCastSegment,
  parseCastSegment,
} from "../.test-build/cast-ids.mjs";

// Cast ids are 4 lowercase hex chars, stamped into the webp filename so the
// fullscreen overlay can resolve the cast without any card metadata.
test("seedCastId is stable and 4-hex", () => {
  const a = seedCastId("이름|alias|외형");
  const b = seedCastId("이름|alias|외형");
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{4}$/);
  assert.notEqual(seedCastId("다른"), a);
});

test("randomCastId is 4-hex and varies", () => {
  const ids = new Set(Array.from({ length: 20 }, () => randomCastId()));
  for (const id of ids) assert.match(id, /^[0-9a-f]{4}$/);
  assert.ok(ids.size > 1);
});

test("sanitizeCastId keeps 4-hex only", () => {
  assert.equal(sanitizeCastId("a51B"), "a51b");
  assert.equal(sanitizeCastId("xyz"), "");
  assert.equal(sanitizeCastId("a51b-extra"), "");
  assert.equal(sanitizeCastId(null), "");
});

test("format/parse cast segment round-trips", () => {
  assert.equal(formatCastSegment(["a51b", "e456"]), "ca51b-e456");
  assert.deepEqual(parseCastSegment("ca51b-e456"), ["a51b", "e456"]);
  assert.equal(formatCastSegment([]), "");
  assert.deepEqual(parseCastSegment(""), []);
  assert.deepEqual(parseCastSegment("srisu_x"), []);
  assert.deepEqual(parseCastSegment("cZZZZ"), []);
});
