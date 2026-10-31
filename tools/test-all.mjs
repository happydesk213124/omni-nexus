/**
 * `npm test`, laid out to finish sooner. The same steps as `npm run test:serial`, but
 * what waits on nothing runs beside what does: one after another they took about 5½
 * minutes on a 12-thread PC, much of it waiting.
 *
 *   1. the preview CSS extracted (the build and the type check read it), then the type
 *      check and the unit bundles side by side
 *   2. the tests, six files at once (more only slowed each one, the browsers sharing the
 *      cores, and timing-tight tests began to flake); beside them parity and the gallery
 *      bench (both build their own bundle and count calls, not time), the bundle build,
 *      and once it is built every check of it (audit, smoke, the settings checks), three
 *      at a time
 *   3. the tests named SafeDOM, alone: they time real taps and frames and go flaky
 *      under load. Every test runs in 2 or 3, none in both, none in neither.
 *
 * A failing step prints its tail at once; every step's output is written to
 * .test-build/logs/<step>.log at the end (the unit bundles' build empties .test-build
 * first). Exit code 1 when any step failed.
 *
 *   node tools/test-all.mjs            (= npm test)
 */
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const cores = availableParallelism();
const TEST_CONCURRENCY = Math.max(2, Math.min(6, cores - 2));
const settings = JSON.parse(readFileSync('package.json', 'utf8')).scripts['test:settings-ux'].split(' && ').filter(cmd => !cmd.includes('extract-preview-ux'));
const checks = [['audit', 'npm run audit'], ['smoke', 'npm run smoke'], ...settings.map(cmd => [cmd.replace(/^node tools\//, '').replace(/\.mjs$/, ''), cmd])];

const results = [];
const logName = name => `.test-build/logs/${name.replace(/[^a-zA-Z0-9.-]+/g, '_')}.log`;
function run(name, cmd) {
  const started = Date.now();
  return new Promise(resolve => {
    const child = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => out.push(chunk));
    child.on('close', code => {
      const row = { name, ok: code === 0, ms: Date.now() - started, log: Buffer.concat(out).toString('utf8') };
      results.push(row);
      console.log(`${row.ok ? '✔' : '✖'} ${(row.ms / 1000).toFixed(1).padStart(6)}s  ${name}`);
      if (!row.ok) console.log(row.log.split('\n').slice(-40).map(line => `    ${line}`).join('\n'));
      resolve(row);
    });
  });
}
/** At most `size` at once, in order. */
async function pool(tasks, size) {
  const queue = [...tasks];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => { while (queue.length) { const [name, cmd] = queue.shift(); await run(name, cmd); } }));
}

const t0 = Date.now();
await run('extract-preview-ux', 'node tools/extract-preview-ux.mjs');
await Promise.all([run('typecheck', 'npx tsc --noEmit'), run('build-tests', 'node tools/build-tests.mjs')]);
await Promise.all([
  run('tests', `node --test --test-concurrency=${TEST_CONCURRENCY} --test-timeout=120000 --test-skip-pattern=SafeDOM tests/*.test.mjs`),
  run('parity', 'npm run parity'),
  run('bench', 'npm run bench'),
  run('build', 'npx vite build').then(built => built.ok ? pool(checks, 3) : undefined),
]);
await run('SafeDOM tests', 'node --test --test-concurrency=3 --test-timeout=120000 --test-name-pattern=SafeDOM tests/*.test.mjs');

mkdirSync('.test-build/logs', { recursive: true });
for (const r of results) writeFileSync(logName(r.name), r.log);
const failed = results.filter(r => !r.ok);
console.log(`\n${failed.length ? `✖ ${failed.length} step(s) failed: ${failed.map(r => r.name).join(', ')}` : '✔ all steps passed'} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed.length ? 1 : 0);
