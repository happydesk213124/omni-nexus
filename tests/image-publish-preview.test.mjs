import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Execute the real delivery module; control only the codec and storage I/O so
// races can be held open without a paid generation or a live Risu database.
const bundle = await build({ entryPoints: ['src/storage/image-urls.ts'], bundle: true, write: false, format: 'esm',
  plugins: [{ name: 'publication-io', setup(b) {
    b.onResolve({ filter: /\/stores$/ }, () => ({ path: 'stores', namespace: 'probe' }));
    b.onResolve({ filter: /\/encode-generation$/ }, () => ({ path: 'codec', namespace: 'probe' }));
    b.onLoad({ filter: /.*/, namespace: 'probe' }, ({ path }) => ({ contents: path === 'codec' ? `
      const state=globalThis.__imagePublishProbe;
      export async function encodeGenerationWebp(bytes,options){state.encodes++;state.events.push('encode');state.options=options;await state.encodeGate;return state.fallback?bytes:state.webp;}
    ` : `
      const state=globalThis.__imagePublishProbe,cache=new Map();
      export const dropBlobUrl=id=>cache.delete(id),getBlobUrl=id=>cache.get(id),setBlobUrl=(id,url)=>cache.set(id,url);
      export const pinBlobUrls=()=>{},retainBlobUrls=()=>{};
      export async function idbGet(){state.reads++;return state.saved.at(-1);}
      export async function idbPut(store,row){state.events.push('store');state.saved.push(row);state.onStore?.();await state.storeGate;if(state.storeError)throw Error('store failed');return row.id;}
    ` }));
  } }],
});
let sequence = 0;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(extra = {}) {
  const state = { reads: 0, encodes: 0, saved: [], events: [], webp: Uint8Array.from([82,73,70,70,16,0,0,0,87,69,66,80,86,80,56,32,4,0,0,0,0,0,0,0]).buffer, ...extra };
  globalThis.__imagePublishProbe = state;
  const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64') + '#' + sequence++);
  delete globalThis.__imagePublishProbe;
  return { api, state };
}
const png = Uint8Array.from([137,80,78,71,13,10,26,10,...new Array(1000).fill(0)]).buffer;

test('preview and saved asset share the one WebP encode and cached data URL', async () => {
  const { api, state } = await fixture();
  let preview;
  const recipe = { prompt: 'retained recipe' };
  const result = await api.publishImage('one', png, {}, { recipe, onPreview: async url => { preview = url; } });
  assert.match(preview, /^data:image\/webp;base64,/);
  assert.equal(result, preview);
  assert.deepEqual(Buffer.from(preview.split(',')[1], 'base64'), Buffer.from(state.saved[0].png));
  assert.equal(state.saved[0].png, state.webp);
  assert.equal(state.encodes, 1);
  assert.equal(state.options.recipe, recipe);
  assert.equal(await api.ensureBlobUrl('one'), preview);
  assert.equal(state.reads, 0);
  assert.equal(api.imageUrlStats().encodes, 1);
});

test('slow painting never blocks storage, and a slow owner/store lookup never blocks preview', async () => {
  const paintGate = deferred(), entered = deferred();
  const { api, state } = await fixture();
  const work = api.publishImage('slow-paint', png, {}, { onPreview: async () => { entered.resolve(); await paintGate.promise; } });
  await entered.promise;
  assert.equal(state.saved.length, 1, 'storage started while the painter is still blocked');
  paintGate.resolve();await work;

  const storeGate = deferred(), previewed = deferred();
  const other = await fixture({ storeGate: storeGate.promise });
  const saving = other.api.publishImage('slow-store', png, {}, { onPreview: async () => previewed.resolve() });
  await previewed.promise;
  assert.equal(other.state.saved.length, 1);
  storeGate.resolve();await saving;
});

test('viewer requests join publication encoding; conversion precedes all preview delivery', async () => {
  const encodeGate = deferred(), storing = deferred();
  const { api, state } = await fixture({ encodeGate: encodeGate.promise, onStore: storing.resolve });
  let previews = 0;
  const work = api.publishImage('join', png, {}, { onPreview: async () => { previews++; } });
  await Promise.resolve();
  assert.equal(previews, 0);
  assert.equal(state.saved.length, 0);
  encodeGate.resolve();await storing.promise;
  const joined = api.ensureBlobUrl('join');
  assert.equal(await joined, await work);
  assert.equal(state.reads, 0);
  assert.equal(api.imageUrlStats().encodes, 1);
});

test('PNG fallback still previews and saves; paint failures do not discard the saved image', async () => {
  const { api, state } = await fixture({ fallback: true });
  const url = await api.publishImage('fallback', png, {}, { onPreview: async () => { throw Error('host paint unavailable'); } });
  assert.match(url, /^data:image\/png;base64,/);
  assert.equal(state.saved[0].png, png);
  const failed = await fixture({ storeError: true });
  await assert.rejects(failed.api.publishImage('bad', png, {}, { onPreview: async () => {} }), /store failed/);
});
