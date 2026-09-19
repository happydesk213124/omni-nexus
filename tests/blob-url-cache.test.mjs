import test from "node:test";
import assert from "node:assert/strict";
import { BlobUrlCache } from "../.test-build/blob-url-cache.mjs";

test("BlobUrlCache evicts LRU unpinned entries when over budget", () => {
  const cache = new BlobUrlCache(20);
  cache.set("a", "a".repeat(10));
  cache.set("b", "b".repeat(10));
  assert.equal(cache.size, 2);
  cache.set("c", "c".repeat(10));
  // a was oldest and unpinned → gone
  assert.equal(cache.get("a"), undefined);
  assert.ok(cache.get("b"));
  assert.ok(cache.get("c"));
});

test("BlobUrlCache never evicts pinned ids", () => {
  const cache = new BlobUrlCache(15);
  cache.set("keep", "k".repeat(10));
  cache.pin(["keep"]);
  cache.set("old", "o".repeat(10));
  cache.set("new", "n".repeat(10));
  assert.ok(cache.get("keep"));
  // Unpinned entries may be dropped to stay near budget; pinned must remain.
  assert.equal(cache.get("keep")?.length, 10);
});

test("BlobUrlCache get touches LRU order", () => {
  const cache = new BlobUrlCache(20);
  cache.set("a", "a".repeat(10));
  cache.set("b", "b".repeat(10));
  cache.get("a"); // a becomes newest
  cache.set("c", "c".repeat(10));
  assert.ok(cache.get("a"));
  assert.equal(cache.get("b"), undefined);
});

test("BlobUrlCache uses byteLen for budget and revokes blob URLs on drop", () => {
  const revoked = [];
  const orig = URL.revokeObjectURL;
  URL.revokeObjectURL = (u) => {
    revoked.push(u);
  };
  try {
    const cache = new BlobUrlCache(15);
    cache.set("a", "blob:http://x/1", 10);
    cache.set("b", "blob:http://x/2", 10);
    assert.equal(cache.get("a"), undefined);
    assert.ok(revoked.includes("blob:http://x/1"));
    cache.drop("b");
    assert.ok(revoked.includes("blob:http://x/2"));
  } finally {
    URL.revokeObjectURL = orig;
  }
});

test("BlobUrlCache pins at most pinCap ids so a wide pin set cannot defeat the budget", () => {
  const cache = new BlobUrlCache(30, 2);
  for (const id of ["a", "b", "c", "d"]) cache.set(id, id.repeat(10));
  // Callers pass focus-first order; only the head of the list gets protection.
  cache.pin(["b", "c", "d"]);
  assert.deepEqual(cache.pinnedIds(), ["b", "c"]);
  cache.set("e", "e".repeat(10));
  assert.ok(cache.get("b"));
  assert.ok(cache.get("c"));
  assert.equal(cache.get("d"), undefined, "the id past the cap must stay evictable");
  assert.deepEqual(cache.stats(), { entries: 3, bytes: 30, budget: 30, pinned: 2, pin_cap: 2 });
});

test("BlobUrlCache retainOnly keeps every retained id even past the pin cap", () => {
  const cache = new BlobUrlCache(1000, 1);
  for (const id of ["a", "b", "c"]) cache.set(id, id.repeat(10));
  cache.retainOnly(["b", "c"]);
  assert.equal(cache.get("a"), undefined);
  assert.ok(cache.get("b"));
  assert.ok(cache.get("c"), "retained ids beyond the pin cap are kept, just not pinned");
  assert.deepEqual(cache.pinnedIds(), ["b"]);
});

test("BlobUrlCache retainOnly drops unpinned immediately", () => {
  const cache = new BlobUrlCache(1000);
  cache.set("a", "a".repeat(10));
  cache.set("b", "b".repeat(10));
  cache.set("c", "c".repeat(10));
  cache.retainOnly(["b"]);
  assert.equal(cache.get("a"), undefined);
  assert.ok(cache.get("b"));
  assert.equal(cache.get("c"), undefined);
  assert.deepEqual(cache.pinnedIds(), ["b"]);
});
