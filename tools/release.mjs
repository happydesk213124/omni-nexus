// node tools/release.mjs <version> <notes.json> [--dry] [--build]
//
// One release bump, every place the version and its notes live:
//   vite.config.ts        PLUGIN_VERSION, a changelog card above the last one, the header help line
//   src/core/constants.ts the fallback version
//   package.json, package-lock.json
// Each place is found by the current version and must be there exactly once (twice in the lock file): a needle
// that drifted stops the release with nothing written, instead of a half-bumped tree.
//
// notes.json:
//   { "title":   "card title, after the version",
//     "summary": "one line after the date",
//     "items":   [["굵은 말", "설명"], "굵은 말 없는 줄"],
//     "help":    "the header help line (the title when left out)",
//     "date":    "2026.11.11" (today when left out) }
// Text is plain: it is escaped for the card. --dry shows what would change; --build runs `npm run build` after.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flags = new Set(args.filter(arg => arg.startsWith('--'))), [version, notesFile] = args.filter(arg => !arg.startsWith('--'));
const fail = message => { console.error(`release: ${message}`); process.exit(1); };
if (!version || !notesFile) fail('usage: node tools/release.mjs <version> <notes.json> [--dry] [--build]');
if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(version)) fail(`"${version}" is not a version (1.5.0)`);

const notes = JSON.parse(fs.readFileSync(path.resolve(notesFile), 'utf8'));
const items = Array.isArray(notes.items) ? notes.items : [];
if (!notes.title || !notes.summary || !items.length) fail('notes need a title, a summary and at least one item');
const help = String(notes.help || notes.title);
// The help line sits in a JS string inside a template literal of vite.config.ts.
if (/["\\`]|\$\{/.test(help)) fail('the help line cannot hold a double quote, a backslash, a backtick or ${');
const now = new Date(), date = notes.date || `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
const html = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const config = read('vite.config.ts'), current = (/const PLUGIN_VERSION = '([^']+)';/.exec(config) || [])[1];
if (!current) fail('PLUGIN_VERSION not found in vite.config.ts');
if (current === version) fail(`already at ${version}`);

const card = [
  '        <div class="card" style="margin-top:14px">',
  `          <strong>${version} · ${html(notes.title)}</strong>`,
  `          <div class="muted" style="margin-top:8px">${date} · ${html(notes.summary)}</div>`,
  '          <ul style="margin:10px 0 0;padding-left:18px;line-height:1.55;color:#c9d4e6;font-size:13px">',
  ...items.map(item => Array.isArray(item) ? `            <li><strong>${html(item[0])}</strong>: ${html(item[1])}</li>` : `            <li>${html(item)}</li>`),
  '          </ul>',
  '        </div>',
  '',
].join('\n');
const lastCard = `        <div class="card" style="margin-top:14px">\n          <strong>${current} · `;

/** [file, [needle, replacement, how many times it must be there]…] */
const plan = [
  ['vite.config.ts', [
    [`const PLUGIN_VERSION = '${current}';`, `const PLUGIN_VERSION = '${version}';`, 1],
    [lastCard, card + lastCard, 1],
    [`    body: "${current} · `, `    body: "${version} · ${help} · ${current} · `, 1],
  ]],
  ['src/core/constants.ts', [[`__PLUGIN_VERSION__ : '${current}';`, `__PLUGIN_VERSION__ : '${version}';`, 1]]],
  ['package.json', [[`"version": "${current}"`, `"version": "${version}"`, 1]]],
  // The lock names the package twice at its top (the root and packages[""]); a dependency at the same version would be a third.
  ['package-lock.json', [[`"version": "${current}"`, `"version": "${version}"`, 2]]],
];

const out = [];
for (const [file, edits] of plan) {
  let text = read(file);
  const crlf = text.includes('\r\n'), eol = value => crlf ? value.replace(/\n/g, '\r\n') : value;
  for (const [needle, replacement, count] of edits) {
    const found = text.split(eol(needle)).length - 1;
    if (found !== count) fail(`${file}: expected ${count} of ${JSON.stringify(needle.slice(0, 70))}, found ${found}. Nothing was written.`);
    text = text.split(eol(needle)).join(eol(replacement));
  }
  out.push([file, text]);
}
if (flags.has('--dry')) { console.log(`release (dry): ${current} → ${version}\n${card}\nhelp: ${version} · ${help}\nfiles: ${out.map(([file]) => file).join(', ')}`); process.exit(0); }
for (const [file, text] of out) fs.writeFileSync(path.join(root, file), text);
console.log(`release: ${current} → ${version} in ${out.map(([file]) => file).join(', ')}`);
if (flags.has('--build')) execSync('npm run build', { cwd: root, stdio: 'inherit' });
else console.log('next: npm run build, npm test, commit with dist/');
