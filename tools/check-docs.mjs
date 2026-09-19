/**
 * Verifies that every repo path the documentation names actually exists.
 *
 * The docs exist so that whoever changes this code next can find the right
 * module. A path that has silently moved is worse than no doc at all: it sends
 * the reader somewhere confidently wrong. This is cheap to check, so it is
 * checked.
 *
 *   node tools/check-docs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every markdown file outside node_modules. */
const docs = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === 'inlaynex2.0-마이그레이션 이전버전' || e.name.startsWith('.')) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? docs(p) : e.name.endsWith('.md') ? [p] : [];
  });

// Paths inside backticks that look like repo files or directories, e.g.
// `src/api/router.ts`, `tools/parity/scenario.mjs`, `prompts/tagger.txt`.
const PATH_RE = /`([a-z_][\w.-]*(?:\/[\w.*-]+)+)`/g;
const ROOTS = new Set(['src', 'tools', 'tests', 'docs', 'prompts', 'vendor', 'reference', 'dist']);

const failures = [];
let checked = 0;

for (const file of docs(root)) {
  const text = fs.readFileSync(file, 'utf8');
  const seen = new Set();
  for (const [, spec] of text.matchAll(PATH_RE)) {
    if (seen.has(spec)) continue;
    seen.add(spec);
    const top = spec.split('/')[0];
    if (!ROOTS.has(top)) continue;
    checked += 1;
    // Globs stand for a set; check the directory holds at least one match.
    if (spec.includes('*')) {
      const dir = path.join(root, path.dirname(spec));
      const pattern = new RegExp(`^${path.basename(spec).replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
      if (!fs.existsSync(dir) || !fs.readdirSync(dir).some((f) => pattern.test(f))) {
        failures.push(`${path.relative(root, file)}: nothing matches ${spec}`);
      }
      continue;
    }
    // Archived plans describe the historical filename; validate the current artifact instead.
    const target = spec === 'dist/inlaynexus2.0.js' && file.includes(path.join('docs','superpowers')) ? 'dist/omninexus.js' : spec;
    if (!fs.existsSync(path.join(root, target))) {
      failures.push(`${path.relative(root, file)}: ${spec} does not exist`);
    }
  }
}

if (failures.length) {
  for (const f of failures) console.error(`[docs] FAIL: ${f}`);
  console.error(`[docs] ${failures.length} stale path reference(s)`);
  process.exit(1);
}
if (checked < 20) {
  console.error(`[docs] FAIL: only ${checked} path(s) checked — the extractor is probably broken`);
  process.exit(1);
}
console.log(`[docs] ok — ${checked} referenced path(s) all exist`);
