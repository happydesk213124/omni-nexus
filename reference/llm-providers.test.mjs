import test from "node:test";
import assert from "node:assert/strict";

import {
  applyReasoningToBody,
  defaultEndpointForProvider,
  ensureLlmRequestUrl,
  normalizeLlmProvider,
  normalizeReasoningEffort,
  shouldAutoReplaceEndpoint,
} from "../src/llm-providers.js";

test("normalizeLlmProvider maps legacy and aliases", () => {
  assert.equal(normalizeLlmProvider("openai_compatible"), "openrouter");
  assert.equal(normalizeLlmProvider("Google AI"), "google_ai");
  assert.equal(normalizeLlmProvider("vertex_ai"), "vertex");
  assert.equal(normalizeLlmProvider("claude"), "anthropic_compatible");
});

test("default endpoints follow Archive-style presets", () => {
  assert.equal(
    defaultEndpointForProvider("openrouter"),
    "https://openrouter.ai/api/v1/chat/completions",
  );
  assert.equal(
    defaultEndpointForProvider("google_ai"),
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  );
  assert.equal(
    defaultEndpointForProvider("vertex", { region: "europe-west1" }),
    "https://europe-west1-aiplatform.googleapis.com",
  );
});

test("shouldAutoReplaceEndpoint only when empty or known preset", () => {
  assert.equal(shouldAutoReplaceEndpoint(""), true);
  assert.equal(shouldAutoReplaceEndpoint("https://openrouter.ai/api/v1/chat/completions"), true);
  assert.equal(shouldAutoReplaceEndpoint("https://my-proxy.example/v1/chat/completions"), false);
});

test("ensureLlmRequestUrl appends chat/completions or messages", () => {
  assert.equal(
    ensureLlmRequestUrl("https://openrouter.ai/api/v1", "openrouter"),
    "https://openrouter.ai/api/v1/chat/completions",
  );
  assert.equal(
    ensureLlmRequestUrl("https://api.anthropic.com/v1", "anthropic_compatible"),
    "https://api.anthropic.com/v1/messages",
  );
  assert.match(
    ensureLlmRequestUrl("", "vertex", { region: "us-central1", projectId: "demo" }),
    /projects\/demo\/locations\/us-central1\/endpoints\/openapi\/chat\/completions$/,
  );
});

test("reasoning effort default omits body field; none/medium attach reasoning", () => {
  assert.deepEqual(applyReasoningToBody({ model: "x" }, "default"), { model: "x" });
  assert.deepEqual(applyReasoningToBody({ model: "x" }, "none"), {
    model: "x",
    reasoning: { effort: "none" },
  });
  assert.deepEqual(applyReasoningToBody({ model: "x" }, "medium"), {
    model: "x",
    reasoning: { effort: "medium" },
  });
  assert.equal(normalizeReasoningEffort("HIGH"), "high");
});
