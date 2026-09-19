import test from "node:test";
import assert from "node:assert/strict";

import { naiToComfyEmphasis } from "../.test-build/nai-to-comfy.mjs";
import {
  buildComfyPlaceholderValues,
  buildComfyWorkflowFromTemplate,
  imageGenTokens,
  substituteComfyPlaceholders,
} from "../.test-build/comfy-client.mjs";

test("imageGenTokens skips NAI keys when backend is comfy", () => {
  assert.deepEqual(imageGenTokens("comfy", []), [""]);
  assert.deepEqual(imageGenTokens("comfy", ["sk-a", "sk-b"]), [""]);
  assert.deepEqual(imageGenTokens("nai", ["", "sk-a", "sk-a", "sk-b"]), ["sk-a", "sk-b"]);
  assert.deepEqual(imageGenTokens("nai", []), []);
});

test("naiToComfyEmphasis maps N::tag:: to (tag:N)", () => {
  assert.equal(naiToComfyEmphasis("2::hard::"), "(hard:2)");
  assert.equal(naiToComfyEmphasis("-1.5::foo::"), "(foo:-1.5)");
});

test("naiToComfyEmphasis maps brace stacks to paren stacks", () => {
  assert.equal(naiToComfyEmphasis("{happy}"), "(happy)");
  assert.equal(naiToComfyEmphasis("{{happy}}"), "((happy))");
});

test("naiToComfyEmphasis keeps A1111-style brackets", () => {
  assert.equal(naiToComfyEmphasis("[sad]"), "[sad]");
  assert.equal(naiToComfyEmphasis("[[sad]]"), "[[sad]]");
});

test("naiToComfyEmphasis expands a weighted group per tag", () => {
  assert.equal(naiToComfyEmphasis("3::1girl, 1boy::"), "(1girl:3), (1boy:3)");
});

test("naiToComfyEmphasis converts weight inside braces from the inside", () => {
  assert.equal(naiToComfyEmphasis("{2::smile::}"), "((smile:2))");
});

test("naiToComfyEmphasis keeps commas between mixed tokens", () => {
  assert.equal(
    naiToComfyEmphasis("1girl, 2::hard::, {{happy}}"),
    "1girl, (hard:2), ((happy))",
  );
});

test("naiToComfyEmphasis leaves empty text alone", () => {
  assert.equal(naiToComfyEmphasis(""), "");
  assert.equal(naiToComfyEmphasis("   "), "   ");
});

test("buildComfyPlaceholderValues converts pos/neg/charN", () => {
  const values = buildComfyPlaceholderValues({
    main: "2::hard::, {{happy}}",
    neg: "{ugly}",
    captions: [{ name: "A", prompt: "3::1girl, 1boy::" }],
    nai: { width: 832, height: 1216, steps: 28, cfg_scale: 7 },
    seed: 1,
  });
  assert.equal(values.pos, "(hard:2), ((happy))");
  assert.equal(values.neg, "(ugly)");
  assert.equal(values.char1, "(1girl:3), (1boy:3)");
  assert.equal(values.char2, "");
  assert.equal(values.ref, "");
});

test("buildComfyPlaceholderValues passes through a ref filename", () => {
  const values = buildComfyPlaceholderValues({
    main: "1girl",
    neg: "",
    captions: [],
    nai: { width: 832, height: 1216 },
    seed: 1,
    ref: "inlay-ref.webp",
  });
  assert.equal(values.ref, "inlay-ref.webp");
  assert.equal(values.pos, "1girl");
});

test("substituteComfyPlaceholders fills {{risu_prompt}} and {{risu_neg}}", () => {
  const wf = {
    62: { class_type: "x", inputs: { text: "{{risu_neg}}" } },
    63: { class_type: "x", inputs: { text: "{{risu_prompt}}" } },
  };
  substituteComfyPlaceholders(wf, { pos: "1girl, smile", neg: "lowres" });
  assert.equal(wf[63].inputs.text, "1girl, smile");
  assert.equal(wf[62].inputs.text, "lowres");
});

test("buildComfyWorkflowFromTemplate accepts {{risu_prompt}} instead of [[pos]]", () => {
  const wf = buildComfyWorkflowFromTemplate(
    JSON.stringify({
      1: { class_type: "CLIPTextEncode", inputs: { text: "{{risu_prompt}}" } },
      2: { class_type: "CLIPTextEncode", inputs: { text: "{{risu_neg}}" } },
    }),
    { pos: "cowboy shot", neg: "worst quality" },
  );
  assert.equal(wf[1].inputs.text, "cowboy shot");
  assert.equal(wf[2].inputs.text, "worst quality");
});
