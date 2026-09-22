import { readFileSync } from 'node:fs';

/** Replace only asserted boundaries after the legacy compatibility patches land. */
export function repairProgressToast(source) {
  let out = source;
  const replace = (needle, value) => {
    if (out.split(needle).length !== 2) throw new Error('[progress toast] drift: ' + needle.slice(0, 90));
    out = out.replace(needle, () => value);
  };
  const section = (start, end, value) => {
    if (out.split(start).length !== 2 || out.split(end).length !== 2) throw new Error('[progress toast] boundary drift: ' + start);
    const a = out.indexOf(start), b = out.indexOf(end, a);
    if (b <= a) throw new Error('[progress toast] boundary order: ' + start);
    out = out.slice(0, a) + value + out.slice(b);
  };
  section('  const PROGRESS_TOAST_HIDE_MS = 2e3;', '  /** risutts-style one-shot host toast',
    readFileSync(new URL('./progress-toast-runtime.js', import.meta.url), 'utf8') + '\n');
  section('  async function syncProgressToast() {', '  async function Se() {', '');
  section('  async function withImageRerollToast(e, n, opts = {}) {', '  function messageCardsByY(',
    readFileSync(new URL('./progress-reroll-runtime.js', import.meta.url), 'utf8') + '\n');
  // Failed slots are attempts, not completed images. Keep the next slot index
  // separate from the number of successful replacements.
  const batchStart = out.indexOf('  async function rerollMessageImagesLive(');
  const batchEnd = out.indexOf('  async function dismissProgressToast()', batchStart);
  if (batchStart >= 0 && batchEnd > batchStart) {
    const batch = out.slice(batchStart, batchEnd);
    for (const needle of ['shot_done: i\n', 'shot_done: i + 1\n']) {
      if (batch.split(needle).length !== 2) throw new Error('[progress toast] reroll count drift');
    }
    out = out.slice(0, batchStart) + batch.replace('shot_done: i\n', 'shot_done: cards.length\n').replace('shot_done: i + 1\n', 'shot_done: cards.length\n') + out.slice(batchEnd);
  } else throw new Error('[progress toast] reroll batch drift');
  replace('k.onUnload(async () => {', 'k.onUnload(async () => {\n      await nxDisposeProgressToast();');
  // Wrap the user actions before they read the message or scan the viewport.
  // The inner functions retain their existing validation and failure handling.
  for (const [name, args] of [['omniFooterAction', 'kind,key'], ['nxFloatClick', 'kind']]) {
    replace(`async function ${name}(${args}) {`, `async function ${name}(${args}) {
  return kind === 'tag' ? nxWithScenePreparation(() => ${name}Prepared(${args})) : ${name}Prepared(${args});
}
async function ${name}Prepared(${args}) {`);
  }
  return out;
}
