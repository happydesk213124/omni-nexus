import test from "node:test";
import assert from "node:assert/strict";

import { joinTags, splitTagTokens, unifiedSessionIdForCharacter, writeSessionId } from "../.test-build/text-util.mjs";

test("splitTagTokens keeps NAI weight groups intact", () => {
  assert.deepEqual(splitTagTokens("5::1girl, 1boy::, from side"), [
    "5::1girl, 1boy::",
    "from side",
  ]);
  assert.deepEqual(splitTagTokens("1girl, 1boy, indoors"), [
    "1girl",
    "1boy",
    "indoors",
  ]);
  assert.deepEqual(splitTagTokens("2::from side::, 2::facing away::"), [
    "2::from side::",
    "2::facing away::",
  ]);
});

test("joinTags does not smash weighted person block", () => {
  assert.equal(
    joinTags("5::1girl, 1boy::", "from side", "1girl, 1boy"),
    "5::1girl, 1boy::, from side, 1girl, 1boy",
  );
  // After strip of bare counts, only the wrapped block remains as person source
  assert.equal(
    joinTags("5::1girl, 1boy::", "from side"),
    "5::1girl, 1boy::, from side",
  );
});

test("writeSessionId prefers the character unified id", () => {
  const unified = unifiedSessionIdForCharacter("char-a");
  assert.match(unified, /^risu_[0-9a-f]+$/);
  assert.equal(writeSessionId({ sessionId: "risu_chat1", characterId: "char-a" }), unified);
  assert.equal(writeSessionId({ sessionId: "risu_chat1" }), "risu_chat1");
});
