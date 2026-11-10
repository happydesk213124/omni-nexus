import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: `export { TTS_MODULE_CSS } from './src/domain/tts/module'; export { SOUND_MODULE_CSS } from './src/domain/sound/module';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const { TTS_MODULE_CSS, SOUND_MODULE_CSS } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

const keyframes = (css, name) => {
  const start = css.indexOf(`@keyframes ${name}{`);
  assert.ok(start >= 0, `no ${name}`);
  let depth = 0;
  for (let at = css.indexOf('{', start); at < css.length; at++) {
    if (css[at] === '{') depth++;
    if (css[at] === '}' && --depth === 0) return css.slice(start, at + 1);
  }
  throw new Error(`${name} never closes`);
};

test('the button of the line being played moves by size alone: a shadow or a background repaints Risu\'s page every frame', () => {
  for (const [css, name] of [[TTS_MODULE_CSS, 'omnitts-pulse'], [TTS_MODULE_CSS, 'omnitts-eq'], [SOUND_MODULE_CSS.sfx, 'omni-sfx-pulse'], [SOUND_MODULE_CSS.sfx, 'omni-sfx-eq']]) {
    const rule = keyframes(css, name);
    assert.match(rule, /\bscale:/, name);
    assert.doesNotMatch(rule, /box-shadow|background|width|height/, name);
  }
});
