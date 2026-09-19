import test from "node:test";
import assert from "node:assert/strict";
import {
  imageUrlSubCount,
  notifyImageUrl,
  resetImageUrlSubs,
  subscribeImageUrl,
} from "../.test-build/image-url-subs.mjs";

test("notifies only the id that resolved", () => {
  resetImageUrlSubs();
  const seen = [];
  const stop = subscribeImageUrl(["a", "b"], (id, url) => seen.push(`${id}=${url}`));
  notifyImageUrl("a", "data:image/webp;base64,AA");
  assert.deepEqual(seen, ["a=data:image/webp;base64,AA"]);
  notifyImageUrl("z", "data:image/webp;base64,ZZ");
  assert.equal(seen.length, 1);
  stop();
});

test("replays ids that were already cached", () => {
  resetImageUrlSubs();
  const seen = [];
  const cached = (id) => (id === "hot" ? "data:hot" : "");
  const stop = subscribeImageUrl(["hot", "cold"], (id, url) => seen.push(`${id}=${url}`), cached);
  // Without replay a late subscriber waits forever: the encode already happened
  // and no further event will fire for that id.
  assert.deepEqual(seen, ["hot=data:hot"]);
  notifyImageUrl("cold", "data:cold");
  assert.deepEqual(seen, ["hot=data:hot", "cold=data:cold"]);
  stop();
});

test("unsubscribe stops delivery and leaves no watchers", () => {
  resetImageUrlSubs();
  let hits = 0;
  const stop = subscribeImageUrl(["a", "b"], () => (hits += 1));
  assert.equal(imageUrlSubCount(), 2);
  stop();
  assert.equal(imageUrlSubCount(), 0);
  notifyImageUrl("a", "data:a");
  assert.equal(hits, 0);
  // Idempotent: a paint pass may unsubscribe on both abort and completion.
  stop();
  assert.equal(imageUrlSubCount(), 0);
});

test("a throwing listener does not stop the others", () => {
  resetImageUrlSubs();
  let ok = 0;
  const stopBad = subscribeImageUrl(["a"], () => {
    throw new Error("painter blew up");
  });
  const stopGood = subscribeImageUrl(["a"], () => (ok += 1));
  notifyImageUrl("a", "data:a");
  assert.equal(ok, 1);
  stopBad();
  stopGood();
});

test("a listener may unsubscribe itself from inside the notification", () => {
  resetImageUrlSubs();
  let hits = 0;
  let stop = () => {};
  stop = subscribeImageUrl(["a"], () => {
    hits += 1;
    stop();
  });
  notifyImageUrl("a", "data:a");
  notifyImageUrl("a", "data:a");
  assert.equal(hits, 1);
  assert.equal(imageUrlSubCount(), 0);
});

test("empty ids and empty urls are no-ops", () => {
  resetImageUrlSubs();
  let hits = 0;
  const stop = subscribeImageUrl([], () => (hits += 1));
  assert.equal(imageUrlSubCount(), 0);
  stop();
  const stop2 = subscribeImageUrl(["a"], () => (hits += 1));
  notifyImageUrl("a", "");
  assert.equal(hits, 0);
  stop2();
});
