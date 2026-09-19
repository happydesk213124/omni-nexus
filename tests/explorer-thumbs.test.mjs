import test from "node:test";
import assert from "node:assert/strict";
import { resolveExplorerThumbUrl } from "../.test-build/explorer-thumbs.mjs";

test("resolveExplorerThumbUrl is empty when nothing is cached", () => {
  assert.equal(resolveExplorerThumbUrl(""), "");
  assert.equal(resolveExplorerThumbUrl("missing-id"), "");
  assert.equal(resolveExplorerThumbUrl({ id: "also-missing" }), "");
});
