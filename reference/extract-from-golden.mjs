/**
 * Extract src/prompts/vendor from the golden 구버전 plugin JS.
 * Usage: node scripts/extract-from-golden.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const goldenName = fs.readdirSync(ROOT).find((n) => n.includes("구버전") && n.endsWith(".js"));
if (!goldenName) throw new Error("구버전 js not found in project root");
const goldenPath = path.join(ROOT, goldenName);
const text = fs.readFileSync(goldenPath, "utf8");
console.log("golden:", goldenName, "bytes", Buffer.byteLength(text, "utf8"));

const markers = [
  { key: "prompts", start: "/* Embedded Inlay Nexus prompt pack */", end: "/* Embedded character identity core */" },
  { key: "identity", start: "/* Embedded character identity core */", end: "/* Embedded settings schema core */" },
  { key: "settings", start: "/* Embedded settings schema core */", end: "/* Embedded viewer behavior core */" },
  { key: "viewer", start: "/* Embedded viewer behavior core */", end: "/* Embedded LLM provider presets */" },
  { key: "llm", start: "/* Embedded LLM provider presets */", end: "/* Embedded lb-xnai.lb.extra lore helpers */" },
  { key: "lore", start: "/* Embedded lb-xnai.lb.extra lore helpers */", end: "/* Embedded explorer selection helpers */" },
  { key: "explorer", start: "/* Embedded explorer selection helpers */", end: "/* Embedded gallery zip helpers */" },
  { key: "gallery", start: "/* Embedded gallery zip helpers */", end: "/* Embedded roster merge helpers */" },
  { key: "roster", start: "/* Embedded roster merge helpers */", end: "/* Inlay Nexus Backend" },
];

function sliceBetween(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) throw new Error(`missing start: ${start}`);
  const b = src.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`missing end: ${end}`);
  return `${src.slice(a, b).replace(/\s+$/, "")}\n`;
}

const backendStart = text.indexOf("/* Inlay Nexus Backend");
if (backendStart < 0) throw new Error("backend marker missing");
const styleAt = text.indexOf("\nconst style = document.createElement", backendStart);
const ztAt = text.indexOf('\nvar Zt = "inlay-nexus-native"', backendStart);
let uiStart = -1;
if (styleAt >= 0) {
  uiStart = styleAt + 1;
} else if (ztAt >= 0) {
  const close = text.lastIndexOf("})();\n", ztAt);
  uiStart = close >= 0 ? close + "})();\n".length : ztAt + 1;
} else {
  throw new Error("UI start not found");
}

const sections = {};
for (const m of markers) {
  sections[m.key] = sliceBetween(text, m.start, m.end);
}
sections.backend = `${text.slice(backendStart, uiStart).replace(/\s+$/, "")}\n`;
sections.ui = text.slice(uiStart);
if (!sections.ui.endsWith("\n")) sections.ui += "\n";

console.log(
  Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.length])),
);

const pm = sections.prompts.match(
  /globalThis\.__INLAY_NATIVE_PROMPTS__\s*=\s*(\{[\s\S]*\});\s*$/,
);
if (!pm) throw new Error("prompts JSON not found");
const prompts = JSON.parse(pm[1]);
fs.mkdirSync(path.join(ROOT, "prompts"), { recursive: true });
for (const [k, v] of Object.entries(prompts)) {
  fs.writeFileSync(path.join(ROOT, "prompts", `${k}.txt`), v ?? "", "utf8");
  console.log("prompt", k, String(v ?? "").length);
}

function stripEmbed(block, assignKey) {
  let body = block.replace(/^\/\* Embedded[\s\S]*?\*\/\r?\n/, "");
  body = body.replace(new RegExp(`\\r?\\n?globalThis\\.${assignKey}[\\s\\S]*$`), "");
  // Keep the section's last EOL (\r\n vs \n). Stripping all trailing whitespace
  // was collapsing `}\r\n` → `}\n` and breaking golden raw bytes.
  body = body.replace(/[ \t]+$/g, "");
  if (!/\r?\n$/.test(body)) {
    body += body.includes("\r\n") ? "\r\n" : "\n";
  }
  return body;
}

function namesFromAssign(block, key) {
  const m = block.match(new RegExp(`globalThis\\.${key}\\s*=\\s*\\{([^}]+)\\}`));
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function addExports(source, names) {
  let out = source;
  for (const name of names) {
    out = out.replace(new RegExp(`^(function ${name}\\b)`, "m"), "export $1");
    out = out.replace(new RegExp(`^(const ${name}\\b)`, "m"), "export $1");
    out = out.replace(new RegExp(`^(async function ${name}\\b)`, "m"), "export $1");
  }
  return out;
}

const identityBody = stripEmbed(sections.identity, "__INLAY_IDENTITY__");
const settingsBody = stripEmbed(sections.settings, "__INLAY_SETTINGS_SCHEMA__")
  .replaceAll("settingsClone(", "clone(")
  .replace("const settingsClone =", "const clone =");
const viewerBody = stripEmbed(sections.viewer, "__INLAY_VIEWER_CORE__");
const llmBody = stripEmbed(sections.llm, "__INLAY_LLM__");
const loreBody = stripEmbed(sections.lore, "__INLAY_LORE_EXTRA__");
const explorerBody = stripEmbed(sections.explorer, "__INLAY_EXPLORER__");
const galleryBody = stripEmbed(sections.gallery, "__INLAY_GALLERY_ZIP__");
const rosterBody = stripEmbed(sections.roster, "__INLAY_ROSTER_MERGE__");

fs.mkdirSync(path.join(ROOT, "src"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "vendor"), { recursive: true });

const writes = [
  ["character-identity.js", addExports(identityBody, namesFromAssign(sections.identity, "__INLAY_IDENTITY__"))],
  ["settings-schema.js", addExports(settingsBody, namesFromAssign(sections.settings, "__INLAY_SETTINGS_SCHEMA__"))],
  ["viewer-core.js", addExports(viewerBody, namesFromAssign(sections.viewer, "__INLAY_VIEWER_CORE__"))],
  ["llm-providers.js", addExports(llmBody, namesFromAssign(sections.llm, "__INLAY_LLM__"))],
  ["lore-extra.js", addExports(loreBody, namesFromAssign(sections.lore, "__INLAY_LORE_EXTRA__"))],
  ["explorer-selection.js", addExports(explorerBody, namesFromAssign(sections.explorer, "__INLAY_EXPLORER__"))],
  ["gallery-zip.js", addExports(galleryBody, namesFromAssign(sections.gallery, "__INLAY_GALLERY_ZIP__"))],
  ["roster-merge.js", addExports(rosterBody, namesFromAssign(sections.roster, "__INLAY_ROSTER_MERGE__"))],
  ["native-backend.js", sections.backend],
];

for (const [name, body] of writes) {
  fs.writeFileSync(path.join(ROOT, "src", name), body, "utf8");
  console.log("src", name, body.length);
}

fs.writeFileSync(path.join(ROOT, "vendor", "Inlay Nexus.js"), sections.ui, "utf8");
fs.writeFileSync(path.join(ROOT, ".golden-plugin"), goldenName, "utf8");
console.log("vendor UI", sections.ui.length);
console.log("extracted OK");
