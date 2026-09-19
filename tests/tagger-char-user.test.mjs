import test from "node:test";
import assert from "node:assert/strict";

import { mergeTaggerCharUserFields, pickSelectedPersona } from "../.test-build/tagger-char-user.mjs";

test("pickSelectedPersona uses selectedPersona index", () => {
  const p = pickSelectedPersona({
    selectedPersona: 1,
    personas: [{ personaPrompt: "a" }, { personaPrompt: "b", note: "n" }],
  });
  assert.equal(p?.personaPrompt, "b");
});

test("user info uses personaPrompt, never request personality", () => {
  const out = mergeTaggerCharUserFields({
    charInfoOn: false,
    userInfoOn: true,
    requestChar: "",
    requestPersona: "캐릭터 성격 필드",
    hostChar: null,
    hostPersona: { personaPrompt: "나는 방문자다", note: "메모" },
  });
  assert.equal(out.persona_description, "나는 방문자다");
  assert.equal(out.character_description, "");
});

test("user info falls back to persona note when prompt is empty", () => {
  const out = mergeTaggerCharUserFields({
    charInfoOn: false,
    userInfoOn: true,
    requestChar: "",
    requestPersona: "personality",
    hostChar: null,
    hostPersona: { personaPrompt: "  ", note: "노트만" },
  });
  assert.equal(out.persona_description, "노트만");
});

test("user info stays empty when toggle is off even if persona exists", () => {
  const out = mergeTaggerCharUserFields({
    charInfoOn: false,
    userInfoOn: false,
    requestChar: "",
    requestPersona: "personality",
    hostChar: null,
    hostPersona: { personaPrompt: "페르소나" },
  });
  assert.equal(out.persona_description, "");
});

test("char info keeps a non-empty request desc", () => {
  const out = mergeTaggerCharUserFields({
    charInfoOn: true,
    userInfoOn: false,
    requestChar: "요청 CharInfo",
    requestPersona: "",
    hostChar: { desc: "호스트 desc" },
    hostPersona: null,
  });
  assert.equal(out.character_description, "요청 CharInfo");
});

test("char info fills from host desc when request is empty", () => {
  const out = mergeTaggerCharUserFields({
    charInfoOn: true,
    userInfoOn: false,
    requestChar: "  ",
    requestPersona: "",
    hostChar: { description: "", desc: "카드 CharInfo" },
    hostPersona: null,
  });
  assert.equal(out.character_description, "카드 CharInfo");
});
