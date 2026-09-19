import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const built = await build({ stdin: { contents: `export * from './src/domain/nai-meta/generation-data.ts';
export * from './src/domain/nai-meta/encode-generation.ts'; export * from './src/domain/nai-meta/index.ts';`,
  resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
// A real 1x1 WebP; no alpha-based metadata is needed by the round trip.
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const metadata = { version: 1, recipe: { Comment: { prompt: 'scene', uc: 'bad', seed: 123,
  v4_prompt: { caption: { base_caption: 'scene', char_captions: [{ char_caption: 'first' }, { char_caption: 'second' }] } } } },
characters: [{ scope: 'chat-a', id: '2', name: '동일' }, { scope: '__global__', id: '1', name: '동일' }], generatedAt: 1700000000123 };

test('recipe, ordered scoped associations, timestamp and image chunks survive round trip', async () => {
  const out = api.writeGenerationImageData(webp, metadata);
  assert.deepEqual(api.readGenerationImageData(out), metadata);
  assert.deepEqual(await api.extractNaiMetadata(out), metadata.recipe);
  assert.deepEqual(new Uint8Array(out).slice(12, webp.length), new Uint8Array(webp).slice(12));
  assert.equal(new DataView(out).getUint32(4, true), out.byteLength - 8);
  assert.equal(out.byteLength % 2, 0);
});

test('reattachment replaces one owned chunk; existing WebP wrapper preserves association order', async () => {
  const first = api.writeGenerationImageData(webp, metadata);
  const second = await api.encodeGenerationWebp(first);
  assert.deepEqual(new Uint8Array(second), new Uint8Array(first));
  const changed = api.writeGenerationImageData(second, { ...metadata, generatedAt: 42 });
  assert.equal(api.readGenerationImageData(changed).generatedAt, 42);
  assert.equal(Buffer.from(changed).toString().split('onxD').length - 1, 1);
});

test('preserveImageMetadata hydrates cast from original and supports explicit overrides', async () => {
  const original = api.writeGenerationImageData(webp, metadata);
  const saved = await api.preserveImageMetadata(original, webp);
  assert.deepEqual(api.readGenerationImageData(saved), metadata);
  const cleared = await api.preserveImageMetadata(original, webp, { characters: [], generatedAt: null });
  assert.deepEqual(api.readGenerationImageData(cleared), { ...metadata, characters: [], generatedAt: null });
});

test('corrupt chunk lengths and invalid schema are rejected', () => {
  const corrupt = Buffer.from(webp); corrupt.writeUInt32LE(0xffffffff, 16);
  assert.throws(() => api.readGenerationImageData(corrupt), /Truncated/);
  assert.throws(() => api.writeGenerationImageData(webp, { ...metadata, generatedAt: NaN }), /schema/);
  assert.throws(() => api.writeGenerationImageData(webp, { ...metadata, characters: [{ name: 'missing identity' }] }), /schema/);
  const future = Buffer.from(api.writeGenerationImageData(webp, metadata));
  const offset = future.indexOf('"version":1'); future[offset + 10] = 50;
  assert.throws(() => api.readGenerationImageData(future), /schema/);
});

test('wrapper encodes at 0.9 and attaches metadata after canvas alpha is lost', async () => {
  const prevBitmap = globalThis.createImageBitmap, prevCanvas = globalThis.OffscreenCanvas;
  let quality;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  globalThis.OffscreenCanvas = class { getContext() { return { drawImage() {} }; }
    async convertToBlob(opts) { quality = opts.quality; return new Blob([webp], { type: 'image/webp' }); } };
  try {
    const source = png;
    const out = await api.encodeGenerationWebp(source, metadata);
    assert.equal(quality, 0.9);
    assert.deepEqual(api.readGenerationImageData(out), metadata);
  } finally { globalThis.createImageBitmap = prevBitmap; globalThis.OffscreenCanvas = prevCanvas; }
});

test('strict replay preserves explicit flags and rejects missing recipe values', () => {
  const request = { prompt: 'scene', negative_prompt: '', width: 832, height: 1216,
    steps: 28, cfg_scale: 5, cfg_rescale: 0, sampler: 'k_euler', scheduler: 'native',
    model: 'nai-diffusion-4-5-full', var_plus: true, use_coords: false,
    characters: [{ prompt: 'first', uc: '', center_x: 0.2, center_y: 0.5 }] };
  const scene = api.requireNaiReplayScene(request);
  const replay = api.t2iRequestFromScene(scene, 42);
  assert.equal(replay.var_plus, true); assert.equal(replay.use_coords, false);
  assert.equal(replay.characters[0].prompt, 'first'); assert.equal(replay.seed, 42);
  for (const key of ['width', 'steps', 'cfg_scale', 'sampler', 'scheduler', 'model', 'negative_prompt']) {
    const incomplete = { ...request }; delete incomplete[key];
    assert.throws(() => api.requireNaiReplayScene(incomplete), /Incomplete NAI recipe/, key);
  }
  const wire = { input: request.prompt, model: request.model, parameters: { ...request, scale: 5, noise_schedule: 'native' } };
  assert.equal(api.requireNaiReplayScene(wire).var_plus, true);
  assert.throws(() => api.requireNaiReplayScene({ workflow: {} }), /Incomplete NAI recipe/);
  const legacy = { ...request }; delete legacy.var_plus; delete legacy.use_coords; delete legacy.cfg_rescale;
  const legacyScene = api.requireNaiReplayScene(legacy);
  assert.equal(legacyScene.var_plus, false); assert.equal(legacyScene.cfg_rescale, 0);
});

test('PNG fallback preserves associations without canvas and detects corrupted metadata CRC', async () => {
  const prev = globalThis.createImageBitmap;
  globalThis.createImageBitmap = undefined;
  try {
    const out = await api.encodeGenerationWebp(png, metadata);
    assert.deepEqual(api.readGenerationImageData(out), metadata);
    assert.deepEqual(await api.extractNaiMetadata(out), metadata.recipe);
    const buffer = Buffer.from(out);
    const start = buffer.indexOf('onXd') - 4;
    assert.deepEqual(buffer.subarray(0, start), png.subarray(0, png.length - 12));
    assert.deepEqual(buffer.subarray(buffer.length - 12), png.subarray(png.length - 12));
    const again = await api.encodeGenerationWebp(out);
    assert.deepEqual(Buffer.from(again), buffer);
    buffer[start + 8] ^= 1;
    assert.throws(() => api.readGenerationImageData(buffer), /CRC mismatch/);
    globalThis.createImageBitmap = async () => { throw new Error('decode rejected'); };
    assert.deepEqual(api.readGenerationImageData(await api.encodeGenerationWebp(png, metadata)), metadata);
  } finally { globalThis.createImageBitmap = prev; }
});

test('explicit requests cannot copy secret, pixel or workflow fields into metadata', async () => {
  const recipe = { prompt: 'scene', seed: 12, api_key: 'SECRET', image: 'PIXELS', workflow: { nodes: 'WORKFLOW' },
    parameters: { steps: 28, headers: { authorization: 'SECRET' }, reference_image: 'PIXELS' },
    v4_prompt: { caption: { base_caption: 'scene', char_captions: [{ char_caption: 'first', password: 'SECRET' }] } } };
  const out = await api.preserveImageMetadata(png, png, { recipe, characters: metadata.characters });
  const saved = api.readGenerationImageData(out);
  assert.deepEqual(saved.recipe, { prompt: 'scene', seed: 12, parameters: { steps: 28 },
    v4_prompt: { caption: { base_caption: 'scene', char_captions: [{ char_caption: 'first' }] } } });
  assert.doesNotMatch(JSON.stringify(saved), /SECRET|PIXELS|WORKFLOW/);
});
