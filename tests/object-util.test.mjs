import test from "node:test";
import assert from "node:assert/strict";

import { parseJsonLoose, parseTaggerJsonAfterRetry } from "../.test-build/object-util.mjs";

test("parseJsonLoose throws on non-JSON tagger replies", () => {
  assert.throws(() => parseJsonLoose("그냥 설명만 있습니다"), /태거 JSON 파싱 실패/);
});

test("parseTaggerJsonAfterRetry turns a second parse miss into JSON 오류 · 생성실패", () => {
  assert.throws(() => parseTaggerJsonAfterRetry("또 깨진 답"), { message: "JSON 오류 · 생성실패" });
  assert.deepEqual(parseTaggerJsonAfterRetry('{"shots":[]}'), { shots: [] });
});
