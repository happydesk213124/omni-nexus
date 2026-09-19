import test from "node:test";
import assert from "node:assert/strict";

import {
  parseStreamKeywords,
  haystackHasStreamKeyword,
} from "../.test-build/stream-keywords.mjs";

test("parseStreamKeywords splits commas, trims, drops under 3 chars", () => {
  assert.deepEqual(parseStreamKeywords(""), []);
  assert.deepEqual(parseStreamKeywords("  "), []);
  assert.deepEqual(parseStreamKeywords("ab, xy"), []);
  assert.deepEqual(parseStreamKeywords("future plan, RP-Guide"), ["future plan", "RP-Guide"]);
  assert.deepEqual(parseStreamKeywords("  future plan , , ok , RP-Guide "), ["future plan", "RP-Guide"]);
});

test("parseStreamKeywords dedupes case-insensitively", () => {
  assert.deepEqual(parseStreamKeywords("Foo, foo, FOO"), ["Foo"]);
});

test("haystackHasStreamKeyword is case-insensitive substring", () => {
  const keys = parseStreamKeywords("future plan, RP-Guide");
  assert.equal(haystackHasStreamKeyword("I love you fu", keys), false);
  assert.equal(haystackHasStreamKeyword("I love you future plan tonight", keys), true);
  assert.equal(haystackHasStreamKeyword("see the rp-guide now", keys), true);
  assert.equal(haystackHasStreamKeyword("", keys), false);
  assert.equal(haystackHasStreamKeyword("anything", []), false);
});
