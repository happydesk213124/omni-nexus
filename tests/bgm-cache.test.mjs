import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: `export {bgmDeviceCache} from './src/storage/bgm-cache';export {audioOf,prefetchAudio} from './src/services/sound-clips';export {loadSoundData} from './src/storage/sound-store';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', loader: { '.txt': 'text' } });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const mp3 = n => { const b = new Uint8Array(n); b.set([0x49, 0x44, 0x33, 3]); return b; };

test('BGM is kept on this device: a refresh plays it without fetching; oldest go past the limit; nothing ever lists the store', async () => {
  const local = new Map(), fetched = []; let listed = 0;
  globalThis.risuai = {
    pluginStorage: { getItem: async () => null, setItem: async () => {} },
    getLocalPluginStorage: async () => ({ getItem: async k => local.get(k) ?? null, setItem: async (k, v) => { local.set(k, structuredClone(v)); }, removeItem: async k => { local.delete(k); }, keys: async () => { listed++; return [...local.keys()]; } }),
    nativeFetch: async url => { fetched.push(url); return { ok: true, status: 200, data: mp3(1000) }; },
  };
  try {
    await api.loadSoundData();
    const track = n => ({ key: 'k' + n, kind: 'bgm', name: 'T' + n, tags: [], folder: '', source: 'url', url: `https://snd.test/${n}.mp3` });
    await api.bgmDeviceCache.configure(1);
    assert.equal(await api.prefetchAudio(track(1)), true, 'fetched ahead');
    assert.equal(await api.prefetchAudio(track(1)), false, 'kept: not fetched twice');
    assert.deepEqual(fetched, ['https://snd.test/1.mp3']);
    assert.ok([...local.keys()].some(k => k.startsWith('omnisound.bgm.') && k !== 'omnisound.bgm.index'), 'the bytes are in the device store');
    // A refresh: memory is empty, the device still has it.
    const played = await api.audioOf(track(1));
    assert.equal(played.bytes.byteLength, 1000);assert.equal(fetched.length, 1, 'played from the device, not fetched again');
    // Heard once, kept for next time.
    await api.audioOf(track(2)); await new Promise(r => setTimeout(r, 30));
    assert.equal(await api.bgmDeviceCache.has('https://snd.test/2.mp3'), true);
    // Past the limit the least recently played go first.
    await api.bgmDeviceCache.configure(1000 * 4 / 3 * 2.5 / 1048576);
    await api.prefetchAudio(track(3));
    assert.equal(await api.bgmDeviceCache.has('https://snd.test/1.mp3'), false, 'the oldest went');
    assert.equal(await api.bgmDeviceCache.has('https://snd.test/3.mp3'), true);
    // 0 keeps nothing.
    await api.bgmDeviceCache.configure(0);
    assert.equal(api.bgmDeviceCache.count, 0);assert.equal(await api.prefetchAudio(track(4)), true);assert.equal(api.bgmDeviceCache.count, 0, 'limit 0: fetched but not kept');
    await api.bgmDeviceCache.configure(1); await api.prefetchAudio(track(5));
    await api.bgmDeviceCache.clear();
    assert.equal(api.bgmDeviceCache.count, 0);assert.equal([...local.keys()].filter(k => k.startsWith('omnisound.bgm.') && k !== 'omnisound.bgm.index').length, 0, 'cleared through the index');
    assert.equal(listed, 0, 'the whole store is never listed (that walk reads every value)');
  } finally { delete globalThis.risuai; }
});
