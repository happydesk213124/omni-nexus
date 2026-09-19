import test from "node:test";
import assert from "node:assert/strict";

import { cardMatchesMessageUnlink, resolveStoredContentHash } from "../.test-build/unlink-match.mjs";

test("unlink matches a late comic through its resolved location identity", () => {
  assert.equal(
    cardMatchesMessageUnlink({
      hashes: ["comic-hash"],
      messageIndexes: [4],
      wantHash: "comic-hash",
      wantMessageIndex: 4,
    }),
    true,
  );
  assert.equal(
    cardMatchesMessageUnlink({
      hashes: [""],
      messageIndexes: [4],
      wantHash: "other",
      wantMessageIndex: 4,
    }),
    true,
  );
  assert.equal(
    cardMatchesMessageUnlink({
      hashes: ["other"],
      messageIndexes: [-1],
      wantHash: "want",
      wantMessageIndex: 4,
    }),
    false,
  );
});

test("unlink matches the host message id even when hash and index drifted", () => {
  assert.equal(
    cardMatchesMessageUnlink({
      hashes: ["old-hash"],
      messageIndexes: [4],
      hostIds: ["risu-m1"],
      wantHash: "new-hash",
      wantMessageIndex: 9,
      wantHostId: "risu-m1",
    }),
    true,
  );
  assert.equal(
    cardMatchesMessageUnlink({
      hashes: ["same"],
      messageIndexes: [4],
      hostIds: ["other"],
      wantHash: "same",
      wantMessageIndex: 4,
      wantHostId: "risu-m1",
    }),
    false,
  );
});

test("cleared location hash does not revive the meta hash", () => {
  assert.equal(resolveStoredContentHash({ content_hash: "" }, { content_hash: "old" }), "");
  assert.equal(resolveStoredContentHash({}, { content_hash: "old" }), "old");
  assert.equal(resolveStoredContentHash({ content_hash: "live" }, { content_hash: "old" }), "live");
});

test("stored message index isolates duplicate messages with the same hash", () => {
  assert.equal(
    cardMatchesMessageUnlink({
      hashes: ["same-hash"],
      messageIndexes: [4],
      wantHash: "same-hash",
      wantMessageIndex: 7,
    }),
    false,
  );
  assert.equal(
    cardMatchesMessageUnlink({
      hashes: ["same-hash"],
      messageIndexes: [-1],
      wantHash: "same-hash",
      wantMessageIndex: 7,
    }),
    true,
    "hash remains the compatibility fallback when the card has no usable index",
  );
});

test("resolved location identity outranks stale metadata and explicit unlink stays unlinked", () => {
  assert.equal(
    cardMatchesMessageUnlink({
      hashes: ["live-hash", "stale-hash", "live-hash"],
      messageIndexes: [4, 7, 4],
      wantHash: "stale-hash",
      wantMessageIndex: 7,
    }),
    false,
  );
  assert.equal(
    cardMatchesMessageUnlink({
      hashes: ["", "stale-hash", ""],
      messageIndexes: [-1, 7, -1],
      wantHash: "stale-hash",
      wantMessageIndex: 7,
    }),
    false,
  );
});
