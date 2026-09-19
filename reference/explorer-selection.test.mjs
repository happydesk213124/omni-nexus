import test from "node:test";
import assert from "node:assert/strict";
import {
  applyExplorerClick,
  selectAll,
  clearSelection,
  createSelectionState,
  moveFocus,
  sortExplorerItems,
  reorderByIds,
  thumbMinWidth,
} from "../src/explorer-selection.js";

test("click selects single", () => {
  const s = applyExplorerClick(createSelectionState(), "a", { ids: ["a", "b", "c"] });
  assert.deepEqual([...s.selected], ["a"]);
  assert.equal(s.anchorId, "a");
});

test("ctrl toggles", () => {
  let s = applyExplorerClick(createSelectionState(), "a", { ids: ["a", "b", "c"] });
  s = applyExplorerClick(s, "c", { ids: ["a", "b", "c"], ctrl: true });
  assert.deepEqual([...s.selected].sort(), ["a", "c"]);
  s = applyExplorerClick(s, "a", { ids: ["a", "b", "c"], ctrl: true });
  assert.deepEqual([...s.selected], ["c"]);
});

test("shift selects range from anchor", () => {
  let s = applyExplorerClick(createSelectionState(), "a", { ids: ["a", "b", "c", "d"] });
  s = applyExplorerClick(s, "c", { ids: ["a", "b", "c", "d"], shift: true });
  assert.deepEqual([...s.selected], ["a", "b", "c"]);
});

test("selectAll and clear", () => {
  const ids = ["a", "b"];
  const all = selectAll(createSelectionState(), ids);
  assert.equal(all.selected.size, 2);
  assert.equal(clearSelection(all).selected.size, 0);
});

test("moveFocus wraps at edges by clamp", () => {
  assert.equal(moveFocus(["a", "b", "c"], "a", 1), "b");
  assert.equal(moveFocus(["a", "b", "c"], "c", 1), "c");
  assert.equal(moveFocus(["a", "b", "c"], "", 1), "a");
});

test("sortExplorerItems newest/message", () => {
  const items = [
    { id: "1", created_at: 10, message_index: 2, shot_index: 0 },
    { id: "2", created_at: 30, message_index: 0, shot_index: 1 },
    { id: "3", created_at: 20, message_index: 1, shot_index: 0 },
  ];
  assert.deepEqual(sortExplorerItems(items, "newest").map((x) => x.id), ["2", "3", "1"]);
  assert.deepEqual(sortExplorerItems(items, "message").map((x) => x.id), ["2", "3", "1"]);
});

test("reorderByIds and thumb size", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(reorderByIds(list, ["c", "a"]).map((x) => x.id), ["c", "a", "b"]);
  assert.equal(thumbMinWidth("s"), 96);
  assert.equal(thumbMinWidth("l"), 200);
});
