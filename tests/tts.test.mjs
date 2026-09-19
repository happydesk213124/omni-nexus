import test from "node:test";
import assert from "node:assert/strict";
import { proseForSpeech } from "../.test-build/tts.mjs";

test("proseForSpeech strips bake tokens and CBS", () => {
  const raw = "안녕 [[@inray::abc::inxshot_x]] {{#asset::inxbake_abc.webp}}";
  const out = proseForSpeech(raw);
  assert.ok(!out.includes("inray"));
  assert.ok(!out.includes("inxbake"));
});
