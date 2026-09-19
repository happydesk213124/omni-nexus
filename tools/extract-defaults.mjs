/**
 * One-shot extractor: lifts the literal data blocks out of the 1.x backend into
 * JSON assets.
 *
 * Hand-transcribing `DEFAULT_CONFIG` (which embeds eight multi-kilobyte style
 * presets) is the highest-risk part of the port, so we do not transcribe it — we
 * evaluate the original literal and serialise the result. Re-run after touching
 * `reference/native-backend.js`.
 *
 * Do not overwrite `src/config/default-settings.json` or
 * `src/config/reset-factory.json` with this tool. The factory pack is
 * reset-factory.json; default-settings.json is the first-boot floor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'reference/native-backend.js'), 'utf8');

/** Slices a top-level `const <name> = <literal>;` by brace/bracket balance. */
function sliceLiteral(name, open) {
  const start = source.indexOf(`const ${name} = ${open}`);
  if (start < 0) throw new Error(`could not find ${name}`);
  const from = start + `const ${name} = `.length;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = null;
  let escaped = false;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inString) { if (ch === inString) inString = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  throw new Error(`unbalanced literal for ${name}`);
}

const evalLiteral = (text) => {
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${text});`)();
};

const targets = [
  { name: 'DEFAULT_CONFIG', open: '{', out: 'src/config/default-settings.json' },
  { name: 'PROMPT_FALLBACKS', open: '{', out: 'src/config/prompt-fallbacks.json' },
  { name: 'QUALITY_TAGS', open: '{', out: 'src/config/quality-tags.json' },
  { name: 'UC_PRESETS', open: '{', out: 'src/config/uc-presets.json' },
  { name: 'MODELS', open: '{', out: 'src/config/models.json' },
  { name: 'CLOTHING_HINTS', open: '[', out: 'src/config/clothing-hints.json' },
  { name: 'ACCESSORY_HINTS', open: '[', out: 'src/config/accessory-hints.json' },
];

for (const { name, open, out } of targets) {
  const value = evalLiteral(sliceLiteral(name, open));
  const dest = path.join(root, out);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(value, null, 2)}\n`);
  const size = Array.isArray(value) ? `${value.length} items` : `${Object.keys(value).length} keys`;
  console.log(`${name.padEnd(18)} -> ${out}  (${size})`);
}
