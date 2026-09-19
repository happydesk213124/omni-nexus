import test from "node:test";
import assert from "node:assert/strict";

import {
  SHOT_ASSET_PREFIX,
  SHOT_MODULE_ID,
  SHOT_MODULE_NS,
  castFromShotAssetName,
  idFromShotAssetName,
  isShotAssetName,
  normalizeAssetPath,
  parseShotModuleAssets,
  sanitizeShotId,
  sessionFromShotAssetName,
  shotAssetName,
  bounceEnabledModuleIds,
} from "../.test-build/shot-assets.mjs";

test("shot asset names stay in a gallery-only prefix", () => {
  assert.equal(SHOT_MODULE_ID, "inlay-gallery");
  assert.equal(SHOT_MODULE_NS, "inlay.gallery");
  assert.equal(shotAssetName("card-1", "webp"), `${SHOT_ASSET_PREFIX}card-1.webp`);
  assert.equal(isShotAssetName("inxshot_card-1.webp"), true);
  assert.equal(isShotAssetName("inxref_deadbeef.webp"), false);
  assert.equal(idFromShotAssetName("inxshot_card-1.webp"), "card-1");
  assert.equal(sanitizeShotId("a/b c"), "a_b_c");
  assert.equal(normalizeAssetPath("assets\\x.webp"), "assets/x.webp");
});

// The asset list is the only card inventory we can read without loading a room
// pack, so the room has to be recoverable from the name. `.` is the separator
// because `sanitizeShotId` strips it, which makes the split unambiguous even for
// an id that already contains underscores.
test("a shot asset name carries its room and still yields the card id", () => {
  const name = shotAssetName("card-1", "webp", "risu_f3bc3a029c755829");

  assert.equal(name, "inxshot_card-1.srisu_f3bc3a029c755829.webp");
  assert.equal(isShotAssetName(name), true);
  assert.equal(idFromShotAssetName(name), "card-1");
  assert.equal(sessionFromShotAssetName(name), "risu_f3bc3a029c755829");
});

test("names written before rooms were stamped still parse", () => {
  assert.equal(idFromShotAssetName("inxshot_card-1.webp"), "card-1");
  assert.equal(sessionFromShotAssetName("inxshot_card-1.webp"), "");
  assert.equal(shotAssetName("card-1", "webp"), "inxshot_card-1.webp");
  assert.equal(shotAssetName("card-1", "webp", ""), "inxshot_card-1.webp");
});

test("an id holding underscores is not mistaken for a room stamp", () => {
  const name = shotAssetName("a__sb", "webp", "risu_1");

  assert.equal(idFromShotAssetName(name), "a__sb");
  assert.equal(sessionFromShotAssetName(name), "risu_1");
  assert.equal(idFromShotAssetName("inxshot_a__sb.webp"), "a__sb");
  assert.equal(sessionFromShotAssetName("inxshot_a__sb.webp"), "");
});

test("bounceEnabledModuleIds drops gallery ids then puts them back", () => {  const { off, on } = bounceEnabledModuleIds(["other", "inlay-gallery", "inlay.gallery"]);
  assert.deepEqual(off, ["other"]);
  assert.ok(on.includes("other"));
  assert.ok(on.includes("inlay-gallery"));
  assert.ok(!off.includes("inlay-gallery"));
});

test("parseShotModuleAssets accepts tuples and named objects", () => {
  const rows = parseShotModuleAssets([
    ["inxshot_a.webp", "assets/1.webp", "inxshot_a.webp"],
    { name: "inxshot_b.webp", path: "assets/2.webp" },
  ]);
  assert.deepEqual(rows.map((r) => r[1]), ["assets/1.webp", "assets/2.webp"]);
});

// The cast rides in a `.c<id-id>` segment after the session segment so the
// fullscreen overlay can resolve chips from the filename alone. Cast-less
// names (never shipped) parse to an empty cast.
test("a shot asset name carries its cast after the room and still parses", () => {
  const name = shotAssetName("card-1", "webp", "risu_f3bc3a029c755829", ["a51b", "e456"]);

  assert.equal(name, "inxshot_card-1.srisu_f3bc3a029c755829.ca51b-e456.webp");
  assert.equal(isShotAssetName(name), true);
  assert.equal(idFromShotAssetName(name), "card-1");
  assert.equal(sessionFromShotAssetName(name), "risu_f3bc3a029c755829");
  assert.deepEqual(castFromShotAssetName(name), ["a51b", "e456"]);
  assert.deepEqual(castFromShotAssetName("inxshot_card-1.srisu_x.webp"), []);
  assert.deepEqual(castFromShotAssetName("inxshot_card-1.webp"), []);
  assert.equal(shotAssetName("card-1", "webp", "risu_x"), "inxshot_card-1.srisu_x.webp");
});
