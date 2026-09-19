import test from "node:test";
import assert from "node:assert/strict";

import { ASSISTANT_PREVIEW_RETENTION, cardIdsToStripPreview } from "../.test-build/preview-retention.mjs";

test("keeps every id when at or under the cap", () => {
  const rows = Array.from({ length: ASSISTANT_PREVIEW_RETENTION }, (_, i) => ({
    id: `c${i}`,
    created_at: i + 1,
  }));
  assert.deepEqual(cardIdsToStripPreview(rows), []);
});

test("strips preview from cards older than the newest 20", () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, created_at: i + 1 }));
  const drop = new Set(cardIdsToStripPreview(rows));
  assert.equal(drop.size, 5);
  for (let i = 0; i < 5; i++) assert.equal(drop.has(`c${i}`), true);
  for (let i = 5; i < 25; i++) assert.equal(drop.has(`c${i}`), false);
});
