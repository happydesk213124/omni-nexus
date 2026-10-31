/**
 * The tests a change can break, and only those: for a small fix this takes seconds where
 * `npm test` takes minutes. Run `npm test` once before committing.
 *
 *   node tools/test-related.mjs                 the files changed since the last commit
 *   node tools/test-related.mjs src/viewer/look.ts tests/viewer-look.test.mjs
 *
 * A test is related when it is itself changed, when it names a changed module or any
 * module that imports one (followed through src/ to the top), or when a unit bundle it
 * loads (.test-build, see tools/build-tests.mjs) is built from one of those. The type
 * check runs first, the unit bundles are rebuilt when one is affected, and the tests
 * named SafeDOM run after the rest, three at a time (they time real taps).
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd(), norm = p => relative(root, resolve(p)).replace(/\\/g, '/');
const asked = process.argv.slice(2);
const changed = (asked.length ? asked : execSync('git status --porcelain --untracked-files=all', { encoding: 'utf8' }).split('\n').filter(Boolean).map(line => line.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '')))
  .map(norm).filter(p => existsSync(p) && (/^(src|tests|tools|prompts|vendor)\//.test(p) || ['vite.config.ts', 'package.json', 'tsconfig.json'].includes(p)));

// Who imports whom in src/: each module's importers, to follow a change up to every entry a test bundles.
const walk = dir => readdirSync(dir).flatMap(name => { const p = join(dir, name); return statSync(p).isDirectory() ? walk(p) : /\.(ts|js|json|txt)$/.test(name) ? [norm(p)] : []; });
const sources = walk('src'), importers = new Map();
const resolveImport = (from, spec) => {
  const base = norm(join(dirname(from), spec));
  return [base, `${base}.ts`, `${base}.js`, `${base}/index.ts`].find(p => sources.includes(p));
};
for (const file of sources.filter(f => /\.(ts|js)$/.test(f))) {
  for (const m of readFileSync(file, 'utf8').matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    const target = resolveImport(file, m[1] || m[2]);
    if (target) (importers.get(target) ?? importers.set(target, new Set()).get(target)).add(file);
  }
}
const touched = new Set(changed.filter(p => p.startsWith('src/')));
for (const queue = [...touched]; queue.length;) for (const up of importers.get(queue.pop()) ?? []) if (!touched.has(up)) { touched.add(up); queue.push(up); }
const named = [...touched].map(p => p.replace(/\.(ts|js)$/, ''));

// The unit bundles built from a touched module.
const bundles = [...readFileSync('tools/build-tests.mjs', 'utf8').matchAll(/'([\w-]+)':\s*(\[[^\]]*\]|'[^']*')/g)]
  .filter(([, , list]) => named.some(p => list.includes(`'${p}.ts'`) || list.includes(`'${p}.js'`))).map(([, name]) => name);

const tests = readdirSync('tests').filter(name => name.endsWith('.test.mjs')).map(name => `tests/${name}`).filter(test => {
  if (changed.includes(test)) return true;
  const text = readFileSync(test, 'utf8');
  return named.some(p => text.includes(`./${p}'`) || text.includes(`./${p}"`) || text.includes(`'${p}'`) || text.includes(`/${p}.ts`)) || bundles.some(b => text.includes(`.test-build/${b}.mjs`));
});
console.log(`changed: ${changed.join(', ') || '(nothing)'}\nreaching: ${touched.size} module(s); unit bundles: ${bundles.join(', ') || 'none'}\ntests: ${tests.join(' ') || 'none'}`);

const step = (label, cmd, args) => {
  const t = Date.now(), out = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  console.log(`${out.status === 0 ? '✔' : '✖'} ${((Date.now() - t) / 1000).toFixed(1)}s ${label}`);
  if (out.status !== 0) process.exit(out.status || 1);
};
if (changed.some(p => /\.(ts|tsx)$/.test(p) || p === 'tsconfig.json')) step('typecheck', 'npx', ['tsc', '--noEmit']);
if (bundles.length || tests.some(t => readFileSync(t, 'utf8').includes('.test-build/'))) step('unit bundles', 'node', ['tools/build-tests.mjs']);
if (tests.length) {
  step('tests', 'node', ['--test', '--test-concurrency=4', '--test-timeout=120000', '--test-skip-pattern=SafeDOM', ...tests]);
  step('SafeDOM tests', 'node', ['--test', '--test-concurrency=3', '--test-timeout=120000', '--test-name-pattern=SafeDOM', ...tests]);
}
