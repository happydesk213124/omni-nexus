import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const native = fs.readFileSync(path.join(root, "inlaynexusnative.js"), "utf8");
const ui = fs.readFileSync(path.join(root, "vendor", "Inlay Nexus.js"), "utf8");

const versionAt = native.indexOf("//@version");
const checks = [
  ["//@version <512B", versionAt >= 0 && versionAt < 512],
  ["starts with //@name", native.startsWith("//@name ")],
  ["prompts embed", native.includes("__INLAY_NATIVE_PROMPTS__") && native.includes("Image Tagging System")],
  ["native API", native.includes("globalThis.__INLAY_NATIVE__")],
  ["K patched", native.includes("Inlay Nexus backend unavailable")],
  ["Ie blob", native.includes("resolveImageUrl")],
  ["ref no ?t=", !/refPreviewUrl\?\. \(\) \|\| ""\)\)\?t=/.test(native)],
  ["plugin name", native.includes("@name inlay-nexus-native")],
  ["jobs create", native.includes("/v1/jobs/create")],
  ["rerollCard", native.includes("rerollCard")],
  ["galleryExplore", native.includes("galleryExplore")],
  ["NAI zip", native.includes("DecompressionStream")],
  ["autotag", native.includes("/v1/autotag")],
  ["unify", native.includes("unifyCharacterSessions")],
  ["global-toggles", native.includes("/v1/characters/global-toggles")],
  ["prompts reset", native.includes("/reset")],
  ["data-url images", /data:image\/(?:png|webp|gif|jpeg);base64,/i.test(native)],
  ["no localhost bridge", !native.includes("BRIDGE_BASE") && !native.includes("START_INLAY_NATIVE_BRIDGE")],
];

let fail = 0;
for (const [k, v] of checks) {
  console.log(`${v ? "OK" : "FAIL"}: ${k}`);
  if (!v) fail++;
}

const paths = [...ui.matchAll(/["'`](\/v1\/[^"'`?]+)/g)].map((m) => m[1]);
const uniq = [...new Set(paths)].sort();
const must = [
  "/v1/health",
  "/v1/settings",
  "/v1/settings/export",
  "/v1/settings/import",
  "/v1/prompts",
  "/v1/jobs/create",
  "/v1/gallery/unlink",
  "/v1/gallery/delete",
  "/v1/gallery/explore",
  "/v1/characters",
  "/v1/characters/global-toggles",
  "/v1/characters/unify",
  "/v1/models/test",
  "/v1/messages/reroll",
  "/v1/nai/test",
  "/v1/nai/reference",
  "/v1/nai/reference/clear",
  "/v1/autotag",
];
for (const p of must) {
  const ok = native.includes(p);
  console.log(`${ok ? "OK" : "FAIL"}: route ${p}`);
  if (!ok) fail++;
}

console.log(`UI path literals: ${uniq.length}`);
console.log(`bytes: ${native.length}`);
process.exit(fail ? 1 : 0);
