/**
 * Runs the parity scenario against one backend and writes a transcript.
 *
 *   node tools/parity/run.mjs --target=old --out=.parity/old.json
 *   node tools/parity/run.mjs --target=new --out=.parity/new.json
 *
 * Each target runs in its own process so module-level state cannot leak.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { installHost } from './host.mjs';
import { runScenario } from './scenario.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const target = arg('target', 'new');
const outPath = path.resolve(root, arg('out', `.parity/${target}.json`));

/** Legacy backend: publish the helper cores as globals, then eval the IIFE. */
async function loadOldBackend() {
  const ref = (f) => path.join(root, 'reference', f);
  const [identity, settingsSchema, viewerCore, llm, loreExtra, galleryZip, rosterMerge, explorer] = await Promise.all([
    import(`file://${ref('character-identity.js')}`),
    import(`file://${ref('settings-schema.js')}`),
    import(`file://${ref('viewer-core.js')}`),
    import(`file://${ref('llm-providers.js')}`),
    import(`file://${ref('lore-extra.js')}`),
    import(`file://${ref('gallery-zip.js')}`),
    import(`file://${ref('roster-merge.js')}`),
    import(`file://${ref('explorer-selection.js')}`),
  ]);
  Object.assign(globalThis, {
    __INLAY_IDENTITY__: identity,
    __INLAY_SETTINGS_SCHEMA__: settingsSchema,
    __INLAY_VIEWER_CORE__: viewerCore,
    __INLAY_LLM__: llm,
    __INLAY_LORE_EXTRA__: loreExtra,
    __INLAY_GALLERY_ZIP__: galleryZip,
    __INLAY_ROSTER_MERGE__: rosterMerge,
    __INLAY_EXPLORER__: explorer,
  });
  const code = fs.readFileSync(ref('native-backend.js'), 'utf8');
  vm.runInThisContext(code, { filename: 'native-backend.js' });
}

/** 2.0 backend: bundle the TS entry to an IIFE with esbuild, then eval it. */
async function loadNewBackend() {
  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/main.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    minify: false,
    loader: { '.txt': 'text' },
    define: { __PLUGIN_ID__: '"omni-nexus"', __PLUGIN_VERSION__: '"2.0.8"' },
  });
  const code = result.outputFiles[0].text;
  vm.runInThisContext(code, { filename: 'inlay-nexus-2.0.js' });
}

const handles = installHost({ promptsDir: path.join(root, 'prompts') });

if (target === 'old') await loadOldBackend();
else await loadNewBackend();

const N = globalThis.__INLAY_NATIVE__;
if (!N) throw new Error(`[parity] ${target}: __INLAY_NATIVE__ was never published`);

const wallStart = Date.now();
const transcript = await runScenario(N, handles);
const wallMs = Date.now() - wallStart;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ target, transcript }, null, 2));

// Cost report lives outside the transcript on purpose: parity must hold, but cost
// is expected to improve, so comparing it as behaviour would be wrong.
const { perf } = handles;
const perfReport = {
  target,
  wallMs,
  storageWrites: perf.writes,
  storageWrittenBytes: perf.writtenBytes,
  storageReads: perf.reads,
  hottestKeys: [...perf.byKey.entries()]
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 8)
    .map(([key, v]) => ({ key: key.replace(/^inx_nximg_.*/, 'inx_nximg_*'), writes: v.writes, kb: Math.round(v.bytes / 1024) })),
};
fs.writeFileSync(outPath.replace(/\.json$/, '.perf.json'), JSON.stringify(perfReport, null, 2));

const failed = transcript.filter((t) => !t.ok);
console.log(`[parity] ${target}: ${transcript.length} steps, ${failed.length} threw, ${wallMs}ms`);
console.log(`[parity] ${target}: ${perf.writes} storage writes, ${Math.round(perf.writtenBytes / 1024)}KB written`);
process.exit(0);
