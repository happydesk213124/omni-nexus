import test from "node:test";
import assert from "node:assert/strict";

import {
  applyTagDelta,
  commandRewriteHasDeltas,
  mergeCommandRewriteCharacters,
  mergeCommandRewriteDeltas,
  mergeCommandRewriteMain,
  mergeLookLockedCaption,
  resolveGenerationSeed,
} from "../.test-build/command-rewrite.mjs";

test("resolveGenerationSeed prefers plan seed then nai then 0", () => {
  assert.equal(resolveGenerationSeed(12345, 9), 12345);
  assert.equal(resolveGenerationSeed(0, 99), 99);
  assert.equal(resolveGenerationSeed(undefined, 0), 0);
  assert.equal(resolveGenerationSeed(-1, 7), 7);
  assert.equal(resolveGenerationSeed("42.9", 1), 42);
});

test("mergeLookLockedCaption keeps look and appends action when locked", () => {
  assert.equal(
    mergeLookLockedCaption("boy, black hair", "girl, blonde", "smirk, waving", true),
    "boy, black hair, smirk, waving",
  );
  assert.equal(
    mergeLookLockedCaption("boy, black hair", "boy, silver hair, standing", "waving", false),
    "boy, silver hair, standing, waving",
  );
});

test("mergeCommandRewriteCharacters respects look_locked flags", () => {
  const out = mergeCommandRewriteCharacters(
    [
      { name: "A", prompt: "boy, black hair", action: "standing", uc: "" },
      { name: "B", prompt: "girl, red hair", action: "sitting", uc: "lowres" },
    ],
    [
      { index: 0, prompt: "CHANGED", action: "waving", uc: "" },
      { index: 1, prompt: "girl, blue hair, jumping", action: "jumping", uc: "blur" },
    ],
    [true, false],
  );
  assert.equal(out[0].prompt, "boy, black hair, waving");
  assert.equal(out[1].prompt, "girl, blue hair, jumping");
  assert.equal(out[1].uc, "blur");
});

test("applyTagDelta removes then adds comma tags", () => {
  assert.equal(applyTagDelta("cafe, dark room, sitting", { remove: "dark room", add: "smile" }), "cafe, sitting, smile");
  assert.equal(applyTagDelta("cafe, sitting", { add: ["waving, grin"] }), "cafe, sitting, waving, grin");
  assert.equal(applyTagDelta("cafe", {}), "cafe");
});

test("applyTagDelta keeps protected main tags even when listed in remove", () => {
  assert.equal(
    applyTagDelta("1boy, cafe, masterpiece", { remove: "1boy, masterpiece, cafe", add: "library" }, { protect: ["1boy", "masterpiece"] }),
    "1boy, masterpiece, library",
  );
});

test("commandRewriteHasDeltas detects add/remove objects", () => {
  assert.equal(commandRewriteHasDeltas({ setup: "x" }), false);
  assert.equal(commandRewriteHasDeltas({ main: { add: "cafe" } }), true);
  assert.equal(commandRewriteHasDeltas({ characters: [{ index: 0, prompt: { remove: "frown" } }] }), true);
});

test("mergeCommandRewriteDeltas applies field deltas and ignores look-lock removes", () => {
  const out = mergeCommandRewriteDeltas({
    currentMain: "1boy, old scene, masterpiece",
    currentNeg: "lowres, blur",
    currentChars: [
      { name: "A", prompt: "boy, black hair, frown", action: "standing", uc: "lowres" },
      { name: "B", prompt: "girl, red hair", action: "sitting", uc: "" },
    ],
    lookLocked: [true, false],
    parsed: {
      main: { remove: "old scene", add: "cafe" },
      negative: { remove: "blur", add: "worst quality" },
      characters: [
        { index: 0, prompt: { remove: "black hair", add: "smile" }, uc: { add: "jpeg" } },
        { index: 1, prompt: { add: "waving" }, name: "Bee" },
      ],
    },
    protectMain: ["1boy", "masterpiece"],
  });
  assert.equal(out.main_prompt, "1boy, masterpiece, cafe");
  assert.equal(out.negative_prompt, "lowres, worst quality");
  assert.equal(out.characters[0].prompt, "boy, black hair, frown, smile");
  assert.equal(out.characters[0].uc, "lowres, jpeg");
  assert.equal(out.characters[1].name, "Bee");
  assert.equal(out.characters[1].prompt, "girl, red hair, waving");
});

test("mergeCommandRewriteMain uses style+setup or replaces recovered scene", () => {
  assert.equal(
    mergeCommandRewriteMain({
      currentMain: "1boy, style tags, old scene, masterpiece",
      setup: "new scene",
      stylePositive: "artist style",
    }),
    "artist style, new scene",
  );
  assert.equal(
    mergeCommandRewriteMain({
      currentMain: "keep me",
      mainPrompt: "explicit main",
      setup: "ignored",
    }),
    "explicit main",
  );
});
