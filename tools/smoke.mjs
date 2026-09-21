/**
 * Executes the *built* plugin and drives a few real requests through it.
 *
 * This closes a specific gap. The parity harness bundles `src/main.ts` fresh and
 * installs the prompt pack itself, so it proves the backend logic is right but
 * says nothing about the artifact users actually load. The audit reads that
 * artifact, but only as text. Neither one runs it.
 *
 * A build that composed the bundle wrongly — or forgot to embed the prompts —
 * therefore passed everything while shipping a plugin that generates garbage.
 * That happened once; this exists so it cannot happen quietly again.
 *
 *   node tools/smoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installHost, PNG_1X1 } from './parity/host.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(root, 'dist/omninexus.js');
const VENDOR_UI = path.join(root, 'vendor/inlay-nexus-ui.js');

const failures = [];
const check = (ok, label) => {
  if (!ok) failures.push(label);
};

if (!fs.existsSync(OUT_FILE)) {
  console.error('[smoke] FAIL: dist/omninexus.js is missing — run npm run build');
  process.exit(1);
}

{
  const syn = spawnSync(process.execPath, ['--check', OUT_FILE], { encoding: 'utf8' });
  if (syn.status !== 0) {
    console.error('[smoke] FAIL: dist/omninexus.js failed node --check (plugin would not load)');
    console.error(syn.stderr || syn.stdout || '');
    process.exit(1);
  }
}

/**
 * Our half of the composed file.
 *
 * The vendor UI cannot run here: it touches the DOM and ends in a top-level
 * await. So the bundle is cut at the point the UI begins, located by matching the
 * UI file's own opening line rather than by guessing an offset.
 */
function backendHalf() {
  const composed = fs.readFileSync(OUT_FILE, 'utf8');
  const vendorHead = fs.readFileSync(VENDOR_UI, 'utf8').replace(/\r\n/g, '\n').slice(0, 120);
  const at = composed.indexOf(vendorHead);
  if (at < 0) throw new Error('[smoke] cannot locate the vendor UI inside the built bundle');
  return composed.slice(0, at);
}

// No `promptsDir`: whatever prompts exist must come from the bundle itself.
installHost({ seed: 0x5eed });
check(
  globalThis.__INLAY_NATIVE_PROMPTS__ === undefined,
  'the harness leaked a prompt pack — this test would prove nothing',
);

vm.runInThisContext(backendHalf(), { filename: 'omninexus.js' });

// ── the prompt pack the bundle installed ───────────────────────────────────

const pack = globalThis.__INLAY_NATIVE_PROMPTS__;
check(pack && typeof pack === 'object', 'the built bundle did not install __INLAY_NATIVE_PROMPTS__');
check(typeof pack?.__enc === 'string', 'the built prompt pack is not opaque ({__enc})');

/** Keep in sync with `src/config/prompt-codec.ts`. */
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

const decoded = decodePromptPack(pack);
check(!!decoded, 'opaque prompt pack failed to decode');
if (decoded) {
  for (const file of fs.readdirSync(path.join(root, 'prompts')).filter((f) => f.endsWith('.txt'))) {
    const key = path.basename(file, '.txt');
    const disk = fs.readFileSync(path.join(root, 'prompts', file), 'utf8');
    check(decoded[key] === disk, `prompt "${key}" in the bundle does not match prompts/${file}`);
  }
}

// ── the bridge, actually running ───────────────────────────────────────────

const N = globalThis.__INLAY_NATIVE__;
check(!!N, '__INLAY_NATIVE__ was never published');

if (N) {
  const get = (p) => N.fetch(p, { method: 'GET' });
  const post = (p, body) => N.fetch(p, { method: 'POST', body });

  check((await N.ready()) === true, 'ready() did not resolve true');

  const health = await get('/v1/health');
  check(health?.health?.version === JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
    `health reported version ${health?.health?.version}`);

  const savedChars = await post('/v1/characters', {
    session_id: 'smoke-character-save',
    characters: [{
      id: 'smoke-char',
      name: 'Smoke Character',
      appearance: 'silver hair, amber eyes',
      attire: 'white shirt',
      accessories: 'holding staff',
      costumes: [{ name: 'default', attire: 'white shirt', accessories: 'holding staff' }],
      active_costume: 0,
      gender: 'girl',
    }],
  });
  const savedChar = savedChars?.characters?.find((row) => row.id === 'smoke-char');
  check(savedChar?.appearance === 'girl, silver hair, amber eyes',
    `character save did not preserve looks with its gender default: ${savedChar?.appearance}`);
  check(savedChar?.attire === 'white shirt', `character save lost attire: ${savedChar?.attire}`);
  check(savedChar?.accessories === 'holding staff',
    `character save lost accessories: ${savedChar?.accessories}`);
  const savedAt = savedChar?.updated_at;
  const readBack = await get('/v1/characters?session_id=smoke-character-save');
  const readChar = readBack?.characters?.find((row) => row.id === 'smoke-char');
  check(readChar?.updated_at === savedAt, 'character GET rewrote the stored row');

  const popupSave = await post('/v1/characters', {
    session_id: 'smoke-character-save',
    scope: 'smoke-character-save',
    character: {
      id: 'smoke-char',
      name: 'Smoke Character',
      appearance: 'violet hair, green eyes',
      attire: 'black coat',
      accessories: 'sword',
      gender: 'boy',
    },
  });
  const popupChar = popupSave?.characters?.find((row) => row.id === 'smoke-char');
  check(popupChar?.appearance === 'boy, violet hair, green eyes',
    `popup save did not preserve looks with its gender default: ${popupChar?.appearance}`);
  check(popupChar?.attire === 'black coat', `popup save lost attire: ${popupChar?.attire}`);
  check(popupChar?.accessories === 'sword', `popup save lost accessories: ${popupChar?.accessories}`);
  check(popupChar?.costumes?.[0]?.attire === 'black coat',
    `popup save did not preserve/update default costume: ${popupChar?.costumes?.[0]?.attire}`);

  let missingSessionRejected = false;
  try {
    await post('/v1/characters', { characters: [] });
  } catch (error) {
    missingSessionRejected = error?.status === 400;
  }
  check(missingSessionRejected, 'character list save silently accepted a missing session_id');

  // The route that reads the prompt pack. Compared against the compiled-in
  // fallback rather than the file on disk, because `cleanText` normalises
  // whitespace on the way out — so the served text is close to, but not equal to,
  // the file. What matters is that it is the real prompt and not the stub.
  const prompts = await get('/v1/prompts');
  const tagger = prompts?.prompts?.find((p) => p.key === 'tagger');
  check(!!tagger, '/v1/prompts did not return a tagger entry');
  const fallback = JSON.parse(fs.readFileSync(path.join(root, 'src/config/prompt-fallbacks.json'), 'utf8'));
  const onDisk = fs.readFileSync(path.join(root, 'prompts/tagger.txt'), 'utf8').replace(/\r\n/g, '\n');
  check(tagger?.text !== fallback.tagger, 'the plugin served the fallback stub instead of prompts/tagger.txt');
  check(
    tagger?.text?.slice(0, 60) === onDisk.slice(0, 60),
    'the served tagger does not begin with the text in prompts/tagger.txt: ' + JSON.stringify([tagger?.text?.slice(0,60),onDisk.slice(0,60)]),
  );
  // Whitespace collapsing only ever shortens, and never by much.
  const ratio = (tagger?.text?.length ?? 0) / onDisk.length;
  check(ratio > 0.95 && ratio <= 1, `served tagger is ${tagger?.text?.length} chars against ${onDisk.length} on disk`);

  // A write, a read-back, and an image round trip — enough to prove storage and
  // the router are wired, not just present.
  const saved = await N.fetch('/v1/settings', { method: 'PUT', body: { card: { inline_thumb_pct: 42 } } });
  check(Number(saved?.settings?.card?.inline_thumb_pct) === 42, 'settings PUT did not take effect');
  const reread = await get('/v1/settings');
  check(Number(reread?.settings?.card?.inline_thumb_pct) === 42, 'settings did not survive a re-read');

  const ref = await post('/v1/nai/reference', {
    image_b64: `data:image/png;base64,${Buffer.from(PNG_1X1).toString('base64')}`,
  });
  check(ref?.ok === true, 'setting a reference image failed');
  check(String(N.refPreviewUrl() || '').startsWith('data:image/'), 'reference preview is not a data: URL');

  const gallery = await get('/v1/gallery?session_id=smoke&limit=5');
  check(Array.isArray(gallery?.items), '/v1/gallery did not return items');

  let threw = false;
  try {
    await get('/v1/nope');
  } catch (err) {
    threw = err?.status === 404;
  }
  check(threw, 'an unknown route did not raise a 404');
}

if (failures.length) {
  for (const f of failures) console.error(`[smoke] FAIL: ${f}`);
  console.error(`[smoke] ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('[smoke] ok — the built bundle boots, serves routes, and carries its prompts');
