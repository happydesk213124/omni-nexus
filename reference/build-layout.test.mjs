import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outNative = path.join(root, "inlaynexusnative.js");
const vendorPath = path.join(root, "vendor", "Inlay Nexus.js");
const promptsDir = path.join(root, "prompts");

test("create-risu-style layout: vendor UI + prompts exist", () => {
  assert.ok(fs.existsSync(vendorPath), "missing vendor/Inlay Nexus.js");
  assert.ok(fs.existsSync(path.join(promptsDir, "tagger.txt")), "missing prompts/tagger.txt");
});

test("npm run build writes inlaynexusnative.js", () => {
  assert.ok(fs.existsSync(outNative), "missing inlaynexusnative.js — run npm run build");
});

test("built plugin embeds native backend and patched UI constants", () => {
  const native = fs.readFileSync(outNative, "utf8");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const ver = String(pkg.version || "").replace(/\./g, "\\.");
  assert.match(native, /\/\/@name inlay-nexus-native/);
  assert.match(native, new RegExp(`//@version ${ver}`));
  assert.match(native, /globalThis\.__INLAY_NATIVE_PROMPTS__/);
  assert.match(native, /globalThis\.__INLAY_NATIVE__/);
  assert.match(native, /var Zt = "inlay-nexus-native"/);
});

test("build uses local vendor/prompts and writes create-risu out path", () => {
  const build = fs.readFileSync(path.join(root, "build.mjs"), "utf8");
  assert.doesNotMatch(build, /path\.resolve\(ROOT,\s*"\.\.",\s*"Inlay-Nexus-0\.1"\)/);
  assert.match(build, /path\.join\(ROOT,\s*"vendor"/);
  assert.match(build, /path\.join\(ROOT,\s*"prompts"\)/);
  assert.match(build, /inlaynexusnative\.js/);
  assert.doesNotMatch(build, /inlaynexus\.js/);
});
