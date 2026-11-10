/**
 * Test files run in the order chosen here: the slowest first.
 *
 * `node --test` runs files by name. With six at once, a slow file late in the alphabet (write-scroll, a minute)
 * started when the rest were nearly through and finished alone with five places idle: 229 s for work that fits in
 * about 150. `run()` takes its files as listed, so a stage starts with what takes longest. How long each file took
 * is written to .test-times.json after a run (yours, not committed); tools/test-times.json (committed: the files
 * that take two seconds or more) stands in on a fresh checkout. A file neither has timed is taken for five
 * seconds: after the slow ones, where a slow newcomer is not left to finish alone, and ahead of the quick.
 *
 *   node tools/run-tests.mjs --skip=SafeDOM --concurrency=6     every file, the tests named SafeDOM left out
 *   node tools/run-tests.mjs --only=SafeDOM --concurrency=3     the tests named SafeDOM
 *   node tools/run-tests.mjs tests/a.test.mjs tests/b.test.mjs  these files
 *
 * Each file's tests share one browser (tools/shared-browser.mjs: a launch is seconds, and most tests made their
 * own); --own-browsers gives each test its own again.
 *
 * --only=NAME also leaves out every file that does not contain NAME. Each file is a process of its own, and most
 * of the SafeDOM stage was 220 of them starting up (many building a bundle first) to find none of their tests
 * wanted. A test named NAME is in a file that contains NAME, so none is lost.
 */
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const flags = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--')).map(arg => { const [key, value = ''] = arg.slice(2).split('='); return [key, value]; }));
const named = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const only = flags.only || '', skip = flags.skip || '';
const stage = only ? `only:${only}` : skip ? `skip:${skip}` : 'all';

let files = named.length ? named : readdirSync('tests').filter(name => name.endsWith('.test.mjs')).map(name => `tests/${name}`);
if (only) files = files.filter(file => readFileSync(file, 'utf8').includes(only));
// A stage with nothing in it would pass: a mistyped name must not look like green tests.
if (!files.length) { console.error(`[run-tests] ${stage}: no test file to run`); process.exit(1); }

const LOCAL = '.test-times.json', SHIPPED = 'tools/test-times.json';
const read = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } };
const known = { ...(read(SHIPPED)[stage] || {}), ...(read(LOCAL)[stage] || {}) };
// Never timed: taken for five seconds (see above).
const seconds = file => known[basename(file)] ?? 5;
files.sort((a, b) => seconds(b) - seconds(a) || a.localeCompare(b));

const took = {}, began = new Map(), open = new Set();
let failed = false, ran = 0, heard = Date.now();
const timeout = Number(flags.timeout) || 120_000;
const stop = new AbortController();
const stream = run({
  files: files.map(file => resolve(file)),
  concurrency: Number(flags.concurrency) || 4,
  timeout,
  signal: stop.signal,
  // One browser per file instead of one per test (tools/shared-browser.mjs).
  ...(flags['own-browsers'] === undefined ? { execArgv: ['--import', pathToFileURL(resolve('tools/shared-browser.mjs')).href] } : {}),
  ...(only ? { testNamePatterns: [only] } : {}),
  ...(skip ? { testSkipPatterns: [skip] } : {}),
});
// A listener is handed the event's data itself (the `data` stream event wraps it as { type, data }).
stream.on('test:fail', () => { failed = true; heard = Date.now(); });
stream.on('test:pass', test => { heard = Date.now(); if (test.name !== test.file && !test.skip) ran++; });
// A file is itself a test, named by its path: from its process starting to its ending, the bundle it builds first
// and the browser it opens included (the times its own tests report leave those out).
stream.on('test:dequeue', test => { heard = Date.now(); if (test.name === test.file) { began.set(test.file, performance.now()); open.add(test.file); } });
stream.on('test:complete', test => {
  heard = Date.now();
  if (test.name !== test.file) return;
  open.delete(test.file);
  if (began.has(test.file)) took[basename(test.file)] = Math.round((performance.now() - began.get(test.file)) / 100) / 10;
});
// A test is stopped at its timeout, a file is not: one whose process never ends (a browser left open) held the
// whole run, silent, until the step's own quarter of an hour was up. No test starting or ending for a timeout and
// a minute more means just that: the files still open are named and stopped.
const watch = setInterval(() => {
  if (Date.now() - heard < timeout + 60_000) return;
  console.error(`\n[run-tests] ${stage}: nothing has started or ended for ${Math.round((Date.now() - heard) / 1000)} s; stopped with these still open: ${[...open].map(file => basename(file)).join(', ') || 'none'}`);
  failed = true;
  stop.abort();
  setTimeout(() => process.exit(1), 5_000).unref();
}, 5_000);
watch.unref();
stream.compose(spec).pipe(process.stdout);
stream.on('end', () => {
  clearInterval(watch);
  const all = read(LOCAL);
  all[stage] = { ...(all[stage] || {}), ...took };
  // A file that is gone takes its time with it.
  if (!named.length) for (const name of Object.keys(all[stage])) if (!existsSync(`tests/${name}`)) delete all[stage][name];
  try { writeFileSync(LOCAL, JSON.stringify(all, null, 1) + '\n'); } catch { /* a read-only checkout still tests */ }
  const slowest = Object.entries(took).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, s]) => `${name.replace('.test.mjs', '')} ${s}s`).join(', ');
  console.log(`[run-tests] ${stage}: ${Object.keys(took).length} file(s); slowest ${slowest || 'none'}`);
  // A whole stage in which nothing ran is a mistake, not a pass. (Files named by hand may hold no test of this stage.)
  const empty = !ran && !named.length;
  if (!failed && empty) console.error(`[run-tests] ${stage}: no test ran`);
  process.exitCode = failed || empty ? 1 : 0;
});
