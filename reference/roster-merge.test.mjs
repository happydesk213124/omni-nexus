import test from "node:test";
import assert from "node:assert/strict";

import { mergeSessionAndGlobalRoster } from "../src/roster-merge.js";

function helpers() {
  const key = (v) => String(v || "").trim().toLowerCase();
  return {
    hasAppearance: (c) => !!String(c?.appearance || "").trim(),
    resolve: (name, list) => (list || []).find((c) => key(c.name) === key(name)) || null,
    aliasKeys: (c) => new Set([key(c?.name)].filter(Boolean)),
    normalizeName: key,
    fullTags: (c) => [c?.appearance, c?.attire, c?.accessories].filter(Boolean).join(", "),
    clean: (v) => String(v || "").trim(),
    globalScope: "__global__",
  };
}

test("attire-only session overlay keeps filled global appearance", () => {
  const global = [{
    name: "Alice",
    appearance: "long hair, blue eyes",
    attire: "dress",
    accessories: "",
    scope: "__global__",
  }];
  const session = [{
    name: "Alice",
    appearance: "",
    attire: "school uniform",
    accessories: "ribbon",
  }];
  const merged = mergeSessionAndGlobalRoster(session, global, helpers());
  assert.equal(merged.length, 1);
  assert.equal(merged[0].appearance, "long hair, blue eyes");
  assert.equal(merged[0].attire, "school uniform");
  assert.equal(merged[0].accessories, "ribbon");
  assert.ok(helpers().hasAppearance(merged[0]));
});

test("empty session without global stays incomplete", () => {
  const session = [{ name: "Bob", appearance: "", attire: "" }];
  const merged = mergeSessionAndGlobalRoster(session, [], helpers());
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "Bob");
  assert.equal(helpers().hasAppearance(merged[0]), false);
});

test("empty session does not replace a filled global with blank row", () => {
  const global = [{ name: "Char", appearance: "silver hair", attire: "coat", accessories: "" }];
  const session = [{ name: "Char", appearance: "", attire: "hoodie", accessories: "" }];
  const merged = mergeSessionAndGlobalRoster(session, global, helpers());
  assert.equal(merged.length, 1);
  assert.equal(merged[0].appearance, "silver hair");
  assert.equal(merged[0].attire, "hoodie");
  assert.notEqual(merged[0].appearance, "");
});
