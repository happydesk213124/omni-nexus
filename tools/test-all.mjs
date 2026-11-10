/**
 * `npm test`, laid out to finish sooner. The same steps as `npm run test:serial`, but
 * what waits on nothing runs beside what does: one after another they took about 5½
 * minutes on a 12-thread PC, much of it waiting.
 *
 *   1. the preview CSS extracted (the build and the type check read it), then the type
 *      check and the unit bundles side by side
 *   2. the tests, six files at once (more only slowed each one, the browsers sharing the
 *      cores, and timing-tight tests began to flake); beside them parity, the gallery
 *      bench and the host-read count (each builds its own bundle and counts calls, not time), the bundle build,
 *      and once it is built every check of it (audit, smoke, the settings checks), three
 *      at a time
 *   3. the tests named SafeDOM, alone: they time real taps and frames and go flaky
 *      under load. Every test runs in 2 or 3, none in both, none in neither.
 *
 * A failing step prints its tail at once; every step's output is written to
 * .test-build/logs/<step>.log at the end (the unit bundles' build empties .test-build
 * first). Exit code 1 when any step failed. A step still running after
 * TEST_STEP_TIMEOUT_MS (15 minutes; the slowest, the tests, takes about 3½) is stopped
 * with everything it started, and fails.
 *
 *   node tools/test-all.mjs            (= npm test)
 */
import { spawn, spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const cores = availableParallelism();
const TEST_CONCURRENCY = Math.max(2, Math.min(6, cores - 2));
const settings = JSON.parse(readFileSync('package.json', 'utf8')).scripts['test:settings-ux'].split(' && ').filter(cmd => !cmd.includes('extract-preview-ux'));
const checks = [['audit', 'npm run audit'], ['smoke', 'npm run smoke'], ...settings.map(cmd => [cmd.replace(/^node tools\//, '').replace(/\.mjs$/, ''), cmd])];

// A step that never ends held `npm test` silent for two hours: smoke and audit end only once nothing the bundle
// started is still running, and the bundle had kept a timer.
const STEP_TIMEOUT_MS = Number(process.env.TEST_STEP_TIMEOUT_MS) || 15 * 60_000;

/** The step's shell and all it started: stopping only the shell leaves its node and browsers running. */
function stopTree(pid) {
  if (process.platform === 'win32') { spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' }); return; }
  for (const kid of spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).stdout?.split(/\s+/).filter(Boolean) ?? []) stopTree(Number(kid));
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
}

const results = [];
const logName = name => `.test-build/logs/${name.replace(/[^a-zA-Z0-9.-]+/g, '_')}.log`;
function run(name, cmd) {
  const started = Date.now();
  return new Promise(resolve => {
    const child = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      out.push(Buffer.from(`\n[test-all] ${name} still running after ${STEP_TIMEOUT_MS / 1000}s: stopped, with everything it started\n`));
      stopTree(child.pid);
      // Something that outlived the stop must not keep the pipes, and so the step, open.
      child.stdout.destroy(); child.stderr.destroy();
    }, STEP_TIMEOUT_MS);
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => out.push(chunk));
    child.on('close', code => {
      clearTimeout(timer);
      const row = { name, ok: code === 0 && !timedOut, ms: Date.now() - started, log: Buffer.concat(out).toString('utf8') };
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
  run('reads', 'npm run reads'),
  run('build', 'npx vite build').then(built => built.ok ? pool(checks, 3) : undefined),
]);
await run('SafeDOM tests', 'node --test --test-concurrency=3 --test-timeout=120000 --test-name-pattern=SafeDOM tests/*.test.mjs');

mkdirSync('.test-build/logs', { recursive: true });
for (const r of results) writeFileSync(logName(r.name), r.log);
const failed = results.filter(r => !r.ok);
console.log(`\n${failed.length ? `✖ ${failed.length} step(s) failed: ${failed.map(r => r.name).join(', ')}` : '✔ all steps passed'} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed.length ? 1 : 0);
