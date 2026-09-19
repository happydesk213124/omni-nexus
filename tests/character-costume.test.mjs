import test from "node:test";
import assert from "node:assert/strict";

import {
  ensureCostumes,
  formatCostumeCatalog,
  mergeCostumeLists,
  promoteCostumeToDefault,
  resolveCostumeIndex,
  resolveCostumeWear,
  syncActiveCostumeFromWear,
  applyCostumeContinuityToShots,
  applyCreatedCostumesToShots,
  collectCostumePairs,
  createdCostumeWearByName,
} from "../.test-build/character-costume.mjs";

import { composeCharacterCaptionTags } from "../.test-build/character-tags.mjs";

test("ensureCostumes preserves named editor drafts and their active index", () => {
  const { costumes, active_costume } = ensureCostumes({
    active_costume: 2,
    costumes: [
      { name: "default", note: "old", attire: "maid outfit, apron", accessories: "feather duster" },
      { name: "school", note: "other", attire: "school uniform", accessories: "" },
      { name: "default01", note: "dup", attire: "apron, maid outfit", accessories: "feather duster" },
      { name: "default012", note: "dup2", attire: "maid outfit, apron", accessories: "feather duster" },
    ],
  });
  assert.equal(costumes.length, 4);
  assert.equal(costumes[0].name, "default");
  assert.equal(costumes[0].note, "old");
  assert.equal(costumes[1].name, "school");
  assert.equal(active_costume, 2);
});

test("ensureCostumes seeds default from attire", () => {
  const { costumes, active_costume } = ensureCostumes({
    attire: "school uniform",
    accessories: "holding bag",
  });
  assert.equal(active_costume, 0);
  assert.equal(costumes.length, 1);
  assert.equal(costumes[0].name, "default");
  assert.equal(costumes[0].attire, "school uniform");
  assert.equal(costumes[0].accessories, "holding bag");
});

test("resolveCostumeIndex accepts name, index, name[index]", () => {
  const list = [
    { name: "default", attire: "a", accessories: "" },
    { name: "swimsuit", note: "beach", attire: "bikini", accessories: "" },
    { name: "bunnycostume", attire: "bunny", accessories: "" },
  ];
  assert.equal(resolveCostumeIndex(list, 1), 1);
  assert.equal(resolveCostumeIndex(list, "2"), 2);
  assert.equal(resolveCostumeIndex(list, "swimsuit"), 1);
  assert.equal(resolveCostumeIndex(list, "swimsuit[1]"), 1);
  assert.equal(resolveCostumeIndex(list, "missing"), -1);
  assert.equal(resolveCostumeIndex(list, ""), -1);
  assert.equal(resolveCostumeIndex(list, { name: "swimsuit", attire: "bikini" }), 1);
});

test("resolveCostumeWear uses active_costume, not silent index 0", () => {
  const stored = {
    attire: "ignored mirror",
    active_costume: 1,
    costumes: [
      { name: "default", attire: "casual clothes", accessories: "bag" },
      { name: "swimsuit", attire: "bikini", accessories: "" },
    ],
  };
  assert.equal(resolveCostumeWear(stored, null).attire, "bikini");
  assert.equal(resolveCostumeWear(stored, "nope").attire, "bikini");
  assert.equal(resolveCostumeWear(stored, "swimsuit").attire, "bikini");
  assert.equal(resolveCostumeWear(stored, 0).attire, "casual clothes");
});

test("resolveCostumeWear keeps bottoms empty on old rows and reads new bottoms", () => {
  const old = resolveCostumeWear({ attire: "shirt", accessories: "bag" }, null);
  assert.equal(old.bottoms, "");
  const wear = resolveCostumeWear({
    active_costume: 0,
    costumes: [{ name: "default", attire: "blouse", bottoms: "skirt", accessories: "" }],
  }, null);
  assert.equal(wear.attire, "blouse");
  assert.equal(wear.bottoms, "skirt");
});

test("applyCostumeContinuityToShots inherits previous then active", () => {
  const shots = [
    { characters: [{ name: "세나", costume: "swimsuit" }] },
    { characters: [{ name: "세나" }] },
    { characters: [{ name: "세나", costume: "" }] },
  ];
  applyCostumeContinuityToShots(shots, () => "schooluniform");
  assert.equal(shots[0].characters[0].costume, "swimsuit");
  assert.equal(shots[1].characters[0].costume, "swimsuit");
  assert.equal(shots[2].characters[0].costume, "swimsuit");
});

test("applyCostumeContinuityToShots uses roster pick when every shot omits costume", () => {
  const shots = [{ characters: [{ name: "세나" }] }];
  applyCostumeContinuityToShots(shots, () => "schooluniform");
  assert.equal(shots[0].characters[0].costume, "schooluniform");
});

test("promoteCostumeToDefault moves current wear to index 0", () => {
  const before = [
    { name: "default", attire: "old default", accessories: "" },
    { name: "swimsuit", attire: "bikini", accessories: "" },
  ];
  const after = promoteCostumeToDefault(before, {
    attire: "new school",
    accessories: "bag",
  });
  assert.equal(after[0].name, "default");
  assert.equal(after[0].attire, "new school");
  assert.equal(after[1].attire, "old default");
  assert.equal(after[2].name, "swimsuit");
});

test("mergeCostumeLists protects default when asked", () => {
  const existing = [
    { name: "default", attire: "base", accessories: "staff" },
  ];
  const merged = mergeCostumeLists(
    existing,
    [{ name: "default", attire: "should not win", accessories: "" }, { name: "swimsuit", attire: "bikini", accessories: "" }],
    { protectDefault: true },
  );
  assert.equal(merged[0].attire, "base");
  assert.equal(merged.length, 2);
  assert.equal(merged[1].name, "swimsuit");
});

test("syncActiveCostumeFromWear updates only active slot", () => {
  const list = [
    { name: "default", attire: "a", accessories: "" },
    { name: "swim", attire: "old", accessories: "" },
  ];
  const next = syncActiveCostumeFromWear(list, 1, { attire: "new bikini", accessories: "towel" });
  assert.equal(next[0].attire, "a");
  assert.equal(next[1].attire, "new bikini");
  assert.equal(next[1].accessories, "towel");
});

test("collectCostumePairs reads new_costumes, new_characters, and shot object picks", () => {
  const pairs = collectCostumePairs({
    new_costumes: [{ name: "세나", costumes: [{ name: "raincoat", attire: "yellow raincoat" }] }],
    new_characters: [{ name: "한진우", costumes: [{ name: "suit", attire: "black suit" }] }],
    shots: [{
      characters: [
        { name: "세나", costume: { name: "hoodie", attire: "gray hoodie" } },
        { name: "미나", costume: "apron", attire: "white apron" },
      ],
    }],
  });
  const byName = Object.fromEntries(pairs.map((row) => [row.name, row.costumes.map((c) => c.name)]));
  assert.deepEqual(byName["세나"], ["raincoat", "hoodie"]);
  assert.deepEqual(byName["한진우"], ["suit"]);
  assert.deepEqual(byName["미나"], ["apron"]);
});

test("created costume pairs wear on shots that omit a pick", () => {
  const pairs = collectCostumePairs({
    new_costumes: [{ name: "세나", costumes: [{ name: "swimsuit", attire: "bikini" }] }],
  });
  const wear = createdCostumeWearByName(pairs);
  const shots = [
    { characters: [{ name: "세나" }, { name: "한진우" }] },
    { characters: [{ name: "세나", costume: "default" }] },
  ];
  applyCreatedCostumesToShots(shots, wear);
  assert.equal(shots[0].characters[0].costume, "swimsuit");
  assert.equal(shots[0].characters[1].costume, undefined);
  assert.equal(shots[1].characters[0].costume, "default");
});

test("formatCostumeCatalog is compact for LLM", () => {
  const text = formatCostumeCatalog([
    { name: "default", note: "angel state", attire: "wings", accessories: "" },
    { name: "casual", attire: "hoodie", accessories: "" },
  ]);
  assert.match(text, /default\[0\] angel state/);
  assert.match(text, /casual\[1\]/);
});

test("composeCharacterCaptionTags uses shot.costume over attire mirror", () => {
  const stored = {
    appearance: "girl, black hair",
    attire: "should not appear",
    accessories: "",
    attire_locked: true,
    costumes: [
      { name: "default", attire: "casual clothes", accessories: "" },
      { name: "swimsuit", attire: "bikini, barefoot", accessories: "" },
    ],
  };
  const withPick = composeCharacterCaptionTags(stored, {
    costume: "swimsuit",
    expression: "smile",
  });
  assert.match(withPick, /bikini/);
  assert.doesNotMatch(withPick, /should not appear/);
  assert.doesNotMatch(withPick, /casual clothes/);

  const fallback = composeCharacterCaptionTags(stored, { expression: "smile" });
  assert.match(fallback, /casual clothes/);
  assert.doesNotMatch(fallback, /bikini/);
});
