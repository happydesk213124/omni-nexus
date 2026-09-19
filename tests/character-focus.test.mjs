import test from "node:test";
import assert from "node:assert/strict";

import {
  applyFocusOutOfFrame,
  focusOutOfFrameTag,
  manualFocusIndexesByGender,
  parseFocusIndexes,
  parseFocusToken,
} from "../.test-build/character-focus.mjs";

test("parseFocusToken accepts 1-based numbers and charN", () => {
  assert.equal(parseFocusToken(1, 3), 0);
  assert.equal(parseFocusToken("2", 3), 1);
  assert.equal(parseFocusToken("char3", 3), 2);
  assert.equal(parseFocusToken("CHAR1", 3), 0);
  assert.equal(parseFocusToken(0, 3), null);
  assert.equal(parseFocusToken(4, 3), null);
  assert.equal(parseFocusToken("", 3), null);
  assert.equal(parseFocusToken("alice", 3), null);
});

test("parseFocusIndexes accepts single, list, and comma strings", () => {
  assert.deepEqual(parseFocusIndexes(1, 4), [0]);
  assert.deepEqual(parseFocusIndexes("char2", 4), [1]);
  assert.deepEqual(parseFocusIndexes([1, 2], 4), [0, 1]);
  assert.deepEqual(parseFocusIndexes("1,2", 4), [0, 1]);
  assert.deepEqual(parseFocusIndexes(["char1", "char3"], 4), [0, 2]);
  assert.deepEqual(parseFocusIndexes("1, 99, char2", 4), [0, 1]);
  assert.deepEqual(parseFocusIndexes("", 4), []);
  assert.deepEqual(parseFocusIndexes(null, 4), []);
  assert.deepEqual(parseFocusIndexes([1, 1, 2], 4), [0, 1]);
});

test("focusOutOfFrameTag: ≤1 bare, >1 weighted (decimals ok)", () => {
  assert.equal(focusOutOfFrameTag(0), "out of frame");
  assert.equal(focusOutOfFrameTag(1), "out of frame");
  assert.equal(focusOutOfFrameTag(2), "2::out of frame::");
  assert.equal(focusOutOfFrameTag(2.5), "2.5::out of frame::");
  assert.equal(focusOutOfFrameTag(5), "5::out of frame::");
  assert.equal(focusOutOfFrameTag(99), "5::out of frame::");
  assert.equal(focusOutOfFrameTag(undefined), "2::out of frame::");
});

test("manualFocusIndexesByGender keeps preferred gender only", () => {
  const chars = [
    { name: "Alice", gender: "girl" },
    { name: "Bob", gender: "boy" },
    { name: "Carol", gender: "girl" },
  ];
  const roster = [
    { id: "a", name: "Alice", gender: "girl" },
    { id: "b", name: "Bob", gender: "boy" },
    { id: "c", name: "Carol", gender: "girl" },
  ];
  assert.deepEqual(manualFocusIndexesByGender(chars, roster, "female"), [0, 2]);
  assert.deepEqual(manualFocusIndexesByGender(chars, roster, "male"), [1]);
  assert.deepEqual(
    manualFocusIndexesByGender([{ name: "Alice", gender: "girl" }], roster, "female"),
    [],
  );
});

test("applyFocusOutOfFrame tags non-focus captions only", () => {
  const caps = [
    { prompt: "red hair", uc: "" },
    { prompt: "blue hair", uc: "" },
    { prompt: "green hair", uc: "" },
  ];
  const out = applyFocusOutOfFrame(caps, [0], 2);
  assert.equal(out[0].prompt, "red hair");
  assert.match(out[1].prompt, /blue hair/);
  assert.match(out[1].prompt, /2::out of frame::/);
  assert.match(out[2].prompt, /out of frame/);

  const soft = applyFocusOutOfFrame(caps, [0], 1);
  assert.equal(soft[0].prompt, "red hair");
  assert.equal(soft[1].prompt, "blue hair, out of frame");

  const duo = applyFocusOutOfFrame(caps, [0, 1], 3);
  assert.equal(duo[0].prompt, "red hair");
  assert.equal(duo[1].prompt, "blue hair");
  assert.match(duo[2].prompt, /3::out of frame::/);

  assert.deepEqual(applyFocusOutOfFrame(caps, []), caps);
});
