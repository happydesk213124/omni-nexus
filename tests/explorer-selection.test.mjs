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
  groupExplorerFolders,
  defaultExplorerFolderKey,
  explorerWindowRange,
  EXPLORER_OVERSCAN_ROWS,
  parseExplorerCharFolderKey,
  explorerCharFolderKey,
  explorerFolderKeysForCharacter,
  explorerExportFolderKeys,
  EXPLORER_CHAR_FOLDER_PREFIX,
} from "../.test-build/explorer-selection.mjs";

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

test("groupExplorerFolders nests chats under character", () => {
  const groups = groupExplorerFolders([
    { key: "c1|a", character_id: "c1", character_name: "한규리", chat_name: "chat1", count: 3 },
    { key: "c1|b", character_id: "c1", character_name: "한규리", chat_name: "chat2", count: 2 },
    { key: "c2|a", character_id: "c2", character_name: "다른캐", chat_name: "main", count: 1 },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].characterName, "한규리");
  assert.equal(groups[0].chats.length, 2);
  assert.equal(groups[0].count, 5);
  assert.equal(groups[1].characterKey, "c2");
});

test("defaultExplorerFolderKey never auto __all__", () => {
  const folders = [{ key: "c1|a", character_id: "c1", character_name: "한규리" }];
  assert.equal(defaultExplorerFolderKey(folders, ""), "__pick__");
  assert.equal(defaultExplorerFolderKey(folders, "__pick__"), "__pick__");
  assert.equal(defaultExplorerFolderKey(folders, "__all__"), "__all__");
  assert.equal(defaultExplorerFolderKey(folders, "c1|a"), "c1|a");
  assert.equal(defaultExplorerFolderKey(folders, "missing"), "__pick__");
  assert.equal(defaultExplorerFolderKey(folders, "__char__:c1"), "__char__:c1");
  assert.equal(defaultExplorerFolderKey(folders, "__char__:nope"), "__pick__");
});

test("parseExplorerCharFolderKey uses full __char__: prefix (not slice 8)", () => {
  assert.equal(EXPLORER_CHAR_FOLDER_PREFIX.length, 9);
  assert.equal(parseExplorerCharFolderKey("__char__:abc"), "abc");
  assert.equal(explorerCharFolderKey("c1"), "__char__:c1");
  // Old bug: slice(8) left a leading ':' and matched nothing.
  assert.notEqual("__char__:c1".slice(8), "c1");
  assert.deepEqual(
    explorerFolderKeysForCharacter(
      [
        { key: "c1|a", character_id: "c1" },
        { key: "c1|b", character_id: "c1" },
        { key: "c2|a", character_id: "c2" },
      ],
      "c1",
    ).sort(),
    ["c1|a", "c1|b"],
  );
});

test("explorerExportFolderKeys expands 이캐릭터 전체보기", () => {
  const folders = [
    { key: "c1|a", character_id: "c1" },
    { key: "c1|b", character_id: "c1" },
    { key: "c2|a", character_id: "c2" },
  ];
  assert.deepEqual(explorerExportFolderKeys("__char__:c1", folders).sort(), ["c1|a", "c1|b"]);
  assert.deepEqual(explorerExportFolderKeys("c1|a", folders), ["c1|a"]);
  assert.equal(explorerExportFolderKeys("__all__", folders), null);
});

test("explorerWindowRange uses viewport + overscan (not fixed 100)", () => {
  assert.equal(EXPLORER_OVERSCAN_ROWS, 2);
  const empty = explorerWindowRange({ itemCount: 0 });
  assert.equal(empty.start, 0);
  assert.equal(empty.end, 0);
  const head = explorerWindowRange({
    itemCount: 500,
    scrollTop: 0,
    clientHeight: 620,
    gridWidth: 640,
    thumbMin: 148,
    overscanRows: 2,
  });
  // Only a viewport band should mount — far fewer than the old fixed-100 window.
  assert.ok(head.end - head.start < 80);
  assert.ok(head.end - head.start > 0);
  assert.equal(head.start, 0);
  assert.ok(head.bottomPad > 0);
  const mid = explorerWindowRange({
    itemCount: 500,
    scrollTop: 8000,
    clientHeight: 620,
    gridWidth: 640,
    thumbMin: 148,
    overscanRows: 2,
  });
  assert.ok(mid.start > 0);
  assert.ok(mid.end - mid.start < 80);
  assert.ok(mid.topPad > 0);
});
