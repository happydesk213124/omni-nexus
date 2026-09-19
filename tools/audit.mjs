/**
 * Structural checks that the parity harness cannot make.
 *
 * Parity proves the backend still *behaves* the same. This proves the bundle is
 * still *shaped* right: that the UI-contract globals expose every name the frozen
 * UI probes for, and that the composed output is a loadable plugin.
 *
 * The UI probes those globals defensively (`typeof VC?.foo === 'function'`), so a
 * missing name silently disables a feature instead of throwing. Nothing else in
 * the test suite would catch that, which is why this check exists.
 *
 *   node tools/audit.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY_BUNDLE = path.join(root, 'reference/old-built-plugin.js');
const OUT_FILE = path.join(root, 'dist/omninexus.js');
const PKG = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const VERSION = String(PKG.version);

/** Globals the frozen UI reads. Anything else 1.x published was internal. */
const UI_GLOBALS = ['__INLAY_VIEWER_CORE__', '__INLAY_LLM__', '__INLAY_LORE_EXTRA__', '__INLAY_EXPLORER__'];

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);

// ── 1. what 1.x published ──────────────────────────────────────────────────

/**
 * Reads `globalThis.__X__ = { a, b, c };` out of the legacy bundle. The list is
 * always shorthand properties, so the names can be lifted directly.
 */
function legacyGlobalNames(source, name) {
  const anchor = source.indexOf(`globalThis.${name} = {`);
  if (anchor < 0) return null;
  const open = source.indexOf('{', anchor);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  return source
    .slice(open + 1, end)
    .split(',')
    .map((s) => s.trim().split(':')[0].trim())
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
}

// ── 2. what 2.0 publishes ──────────────────────────────────────────────────

/** Bundles and evaluates the entry so the globals can be read as objects. */
async function loadBackendGlobals() {
  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/main.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    minify: false,
    define: { __PLUGIN_ID__: '"omni-nexus"', __PLUGIN_VERSION__: JSON.stringify(VERSION) },
  });
  // Enough of a host that module top-level code can run; no behaviour is exercised.
  globalThis.risuai = { pluginStorage: {}, async getLocalPluginStorage() { return {}; } };
  vm.runInThisContext(result.outputFiles[0].text, { filename: 'audit-bundle.js' });
  return result.outputFiles[0].text;
}

const bundleSource = await loadBackendGlobals();

if (!globalThis.__INLAY_NATIVE__) fail('__INLAY_NATIVE__ was never published');
else {
  // Shape of the bridge itself, per docs/UI-CONTRACT.md.
  const required = [
    ['VERSION', 'string'],
    ['ready', 'function'],
    ['fetch', 'function'],
    ['resolveImageUrl', 'function'],
    ['refPreviewUrl', 'function'],
    ['vibePreviewUrl', 'function'],
    ['ensureImageUrl', 'function'],
    ['warmImages', 'function'],
    ['pinImageUrls', 'function'],
    ['prioritizeWarmFocus', 'function'],
    ['clearWarmFocus', 'function'],
    ['warmProgress', 'function'],
    ['warmFocusProgress', 'function'],
    ['debug', 'function'],
    ['clearDebug', 'function'],
  ];
  for (const [key, type] of required) {
    const actual = typeof globalThis.__INLAY_NATIVE__[key];
    if (actual !== type) fail(`__INLAY_NATIVE__.${key} is ${actual}, expected ${type}`);
  }
}

if (!fs.existsSync(LEGACY_BUNDLE)) {
  notes.push(`legacy bundle absent (${path.relative(root, LEGACY_BUNDLE)}) — skipped global-name diff`);
} else {
  const legacy = fs.readFileSync(LEGACY_BUNDLE, 'utf8');
  for (const name of UI_GLOBALS) {
    const expected = legacyGlobalNames(legacy, name);
    if (!expected) {
      fail(`could not read ${name} from the legacy bundle`);
      continue;
    }
    const actual = globalThis[name];
    if (!actual || typeof actual !== 'object') {
      fail(`${name} was never published`);
      continue;
    }
    const missing = expected.filter((k) => !(k in actual));
    if (missing.length) fail(`${name} is missing ${missing.length}: ${missing.join(', ')}`);
    const added = Object.keys(actual).filter((k) => !expected.includes(k));
    if (added.length) notes.push(`${name} adds ${added.length} new name(s): ${added.join(', ')}`);
  }
}

// ── 3. the embedded prompt pack ────────────────────────────────────────────

/** Lifts `globalThis.__INLAY_NATIVE_PROMPTS__ = {...};` out of a built plugin. */
function promptPackRaw(source) {
  const marker = 'globalThis.__INLAY_NATIVE_PROMPTS__ = ';
  const at = source.indexOf(marker);
  if (at < 0) return null;
  try {
    return JSON.parse(source.slice(at + marker.length, source.indexOf(';\n', at)));
  } catch {
    return null;
  }
}

/**
 * Keep in sync with `src/config/prompt-codec.ts`.
 * Opaque pack is XOR+base64; legacy 1.x packs are plaintext objects.
 */
function decodePromptPack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.__enc === 'string') {
    const key = 'inlay-nexus-prompt-pack-v1';
    const buf = Buffer.from(raw.__enc, 'base64');
    const out = Buffer.alloc(buf.length);
    const keyBuf = Buffer.from(key, 'utf8');
    for (let i = 0; i < buf.length; i += 1) out[i] = buf[i] ^ keyBuf[i % keyBuf.length];
    try {
      return JSON.parse(out.toString('utf8'));
    } catch {
      return null;
    }
  }
  return raw;
}

function promptPack(source) {
  return decodePromptPack(promptPackRaw(source));
}

/**
 * The prompts are the plugin's actual behaviour, and the backend falls back to
 * one-line stubs when they are absent — so a build that forgets to embed them
 * still loads, still generates, and produces garbage. Nothing else catches it:
 * the parity harness drives the backend directly and never sees this bundle.
 */
function auditPromptPack(out) {
  const raw = promptPackRaw(out);
  const pack = decodePromptPack(raw);
  if (!pack) {
    fail('bundle does not install a readable __INLAY_NATIVE_PROMPTS__');
    return;
  }
  if (!raw || typeof raw.__enc !== 'string') {
    fail('bundle prompt pack is plaintext — expected opaque {__enc,__v} embedding');
  }
  // Casual greps of the shipped file must not hit prompt body text.
  if (out.includes('RESTRICTIONS_LIFTED_FOR_LABELING') || out.includes('# Image Tagging System')) {
    fail('bundle still contains plaintext prompt body markers');
  }
  const promptsDir = path.join(root, 'prompts');
  for (const file of fs.readdirSync(promptsDir).filter((f) => f.endsWith('.txt'))) {
    const key = path.basename(file, '.txt');
    if (!(key in pack)) {
      fail(`prompts/${file} exists but is not embedded (add it to PROMPT_KEYS in vite.config.ts)`);
      continue;
    }
    // Verbatim comparison: line endings are part of what gets sent to the LLM.
    const disk = fs.readFileSync(path.join(promptsDir, file), 'utf8');
    if (pack[key] !== disk) {
      fail(`embedded prompt "${key}" differs from prompts/${file} (${pack[key].length} vs ${disk.length} chars)`);
    }
  }
  if (!fs.existsSync(LEGACY_BUNDLE)) return;
  const legacy = promptPack(fs.readFileSync(LEGACY_BUNDLE, 'utf8'));
  if (!legacy) {
    notes.push('legacy bundle has no prompt pack — skipped prompt diff');
    return;
  }
  const dropped = Object.keys(legacy).filter((k) => !(k in pack));
  if (dropped.length) fail(`prompt(s) present in 1.x but missing here: ${dropped.join(', ')}`);
  // Intentional 2.0 prompt edits vs 1.x — each key needs a justifying comment.
  // Unexplained drift still fails the audit (AGENTS.md §5).
  const INTENTIONAL_PROMPT_DRIFT = new Set([
    // Compact English prompts: field rules live in tagger; format is schema-only;
    // appearance/lore injects are short wrappers (token cut, same semantics).
    'tagger',
    'format',
    'appearance_inject',
    'lore_inject',
    // Vision autotag now also returns gender (female|male) for actor routing.
    'autotag',
    // User recommended pack (2026-09-19): the author's live prompt edits
    // adopted as new defaults — author_note filled in (was empty), small
    // wording trims in char_inject/preprocess/prefill/preset_1.
    'author_note',
    'char_inject',
    'preprocess',
    'prefill',
    'preset_1',
  ]);
  const changed = Object.keys(legacy).filter((k) => k in pack && legacy[k] !== pack[k]);
  const unexplained = changed.filter((k) => !INTENTIONAL_PROMPT_DRIFT.has(k));
  const expected = changed.filter((k) => INTENTIONAL_PROMPT_DRIFT.has(k));
  if (expected.length) {
    notes.push(
      `intentional prompt drift vs 1.x: ${expected.map((k) => `${k} (${legacy[k].length}→${pack[k].length})`).join(', ')}`,
    );
  }
  if (unexplained.length) {
    fail(`prompt(s) differ from 1.x: ${unexplained.map((k) => `${k} (${legacy[k].length}→${pack[k].length})`).join(', ')}`);
  }
}

// ── 4. the composed output ─────────────────────────────────────────────────

if (!fs.existsSync(OUT_FILE)) {
  notes.push(`${path.relative(root, OUT_FILE)} not built yet — skipped bundle checks (run npm run build)`);
} else {
  const out = fs.readFileSync(OUT_FILE, 'utf8');
  if (!out.startsWith('//@name')) fail('bundle does not start with the //@name plugin header');
  for (const tag of ['//@api', '//@version']) {
    if (!out.includes(tag)) fail(`bundle header is missing ${tag}`);
  }
  if (!out.includes(`//@version ${VERSION}`)) fail(`bundle header version is not ${VERSION}`);
  if (!/__INLAY_NATIVE__/.test(out)) fail('bundle does not reference __INLAY_NATIVE__');
  auditPromptPack(out);
  // The vendor UI shows this string in its own header; the build rewrites it so
  // the UI does not report 1.3.0 while running on a 2.0 backend.
  const escaped = VERSION.replace(/\./g, '\\.');
  if (!new RegExp(`=\\s*"${escaped}"`).test(out)) fail(`vendor UI version string was not patched to ${VERSION}`);
  // The vendor UI declares top-level names like `style` and `Zt` in the same
  // module scope, so everything ahead of it must add none of its own. The only
  // two things allowed there are the prompt pack (an assignment to globalThis,
  // which binds no name) and the backend IIFE.
  const preamble = out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('/*'));
  const promptAt = preamble.findIndex((l) => l.startsWith('globalThis.__INLAY_NATIVE_PROMPTS__'));
  if (promptAt > 0) fail(`something precedes the prompt pack: ${preamble[0].slice(0, 60)}`);
  const backendLine = preamble[promptAt + 1];
  if (!backendLine) fail('no backend code follows the prompt pack');
  else if (!/^\(function|^\(\(\)\s*=>|^\(\(\)=>/.test(backendLine)) {
    fail(`backend is not wrapped in an IIFE (starts with: ${backendLine.slice(0, 60)})`);
  }
}

// ── 5. layering ────────────────────────────────────────────────────────────

// `core/` is the bottom of the stack: if it reaches upward the dependency graph
// has a cycle and module init order becomes load-order dependent.
const coreDir = path.join(root, 'src/core');
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
for (const file of walk(coreDir)) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
    const spec = m[1];
    if (/^\.\.\/(storage|services|providers|domain|api|bridge|config|ui-contract)\b/.test(spec)) {
      fail(`${path.relative(root, file)} imports upward from core: ${spec}`);
    }
  }
}

// Nothing may import from `vendor/`; it is appended by the build, never bundled.
for (const m of bundleSource.matchAll(/vendor\/inlay-nexus-ui/g)) {
  void m;
  fail('the backend bundle references vendor/inlay-nexus-ui — it must only be concatenated by the build');
}

// ── report ─────────────────────────────────────────────────────────────────

for (const note of notes) console.log(`[audit] note: ${note}`);
if (failures.length) {
  for (const f of failures) console.error(`[audit] FAIL: ${f}`);
  console.error(`[audit] ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('[audit] ok');
