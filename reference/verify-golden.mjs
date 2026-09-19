/**
 * Compare built inlaynexusnative.js to the golden 구버전 file (LF-normalized).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const built = path.join(ROOT, "inlaynexusnative.js");
const goldenName = fs.existsSync(path.join(ROOT, ".golden-plugin"))
  ? fs.readFileSync(path.join(ROOT, ".golden-plugin"), "utf8").trim()
  : fs.readdirSync(ROOT).find((n) => n.includes("구버전") && n.endsWith(".js"));

if (!goldenName) {
  console.error("FAIL: golden 구버전 file not found");
  process.exit(1);
}

const goldenPath = path.join(ROOT, goldenName);
const norm = (s) => s.replace(/\r\n/g, "\n");
const a = norm(fs.readFileSync(built, "utf8"));
const b = norm(fs.readFileSync(goldenPath, "utf8"));
const ha = crypto.createHash("sha256").update(a).digest("hex");
const hb = crypto.createHash("sha256").update(b).digest("hex");

const aRaw = fs.readFileSync(built);
const bRaw = fs.readFileSync(goldenPath);
const haRaw = crypto.createHash("sha256").update(aRaw).digest("hex");
const hbRaw = crypto.createHash("sha256").update(bRaw).digest("hex");

console.log("built :", built, a.length, "raw", aRaw.length);
console.log("golden:", goldenPath, b.length, "raw", bRaw.length);
console.log("sha256 LF    built/golden:", ha, ha === hb ? "MATCH" : "DIFF");
console.log("sha256 raw   built/golden:", haRaw, haRaw === hbRaw ? "MATCH" : "DIFF");

if (Buffer.compare(aRaw, bRaw) === 0) {
  console.log("OK: raw bytes match golden 구버전 exactly");
  process.exit(0);
}

if (a === b) {
  console.error("FAIL: LF match but raw bytes differ (line endings?)");
  process.exit(1);
}

// Show first diff for debugging
const max = Math.min(a.length, b.length);
let i = 0;
for (; i < max; i++) {
  if (a[i] !== b[i]) break;
}
console.error(`FAIL: differ at index ${i}`);
console.error("built snippet :", JSON.stringify(a.slice(Math.max(0, i - 40), i + 80)));
console.error("golden snippet:", JSON.stringify(b.slice(Math.max(0, i - 40), i + 80)));
process.exit(1);
