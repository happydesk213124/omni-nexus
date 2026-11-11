import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';

const built = await build({ stdin: { contents: `export * from './src/storage/sound-store';export * from './src/config/sound-samples';export * from './src/config/sound-eleven-pack';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.txt': 'text' }, logLevel: 'silent' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text + '\n//# sourceURL=sound-samples-notes.mjs').toString('base64'));
const shipped = JSON.parse(fs.readFileSync('src/config/sound-samples/sfx.json', 'utf8'));

test('every example effect has its sound words, its 상황 and the same in English; the new ones are links of their own', () => {
  for (const item of shipped.items) {
    assert.ok(item.note && item.note.length >= 3, `${item.key}: 상황`);
    assert.ok(item.en && /^[a-z]/i.test(item.en), `${item.key}: English`);
    assert.ok(item.tags.length >= 2, `${item.key}: sound words`);
  }
  assert.equal(new Set(shipped.items.map(item => item.url)).size, shipped.items.length, 'no link twice');
  assert.equal(new Set(shipped.items.map(item => item.key)).size, shipped.items.length);
  const names = new Set(shipped.items.map(item => item.name));
  for (const name of ['찔걱찔걱', '맨살 찰싹', '숨소리', '새근새근', '삐걱임']) assert.ok(names.has(name), name);
  assert.ok(shipped.folders.includes('친밀'));
  // English never goes into the save: it is read from the shipped list while the 상황 is still the shipped one.
  const kiss = shipped.items.find(item => item.key === 'sfx_kiss');
  assert.equal('en' in api.sampleSoundData().sfx.find(item => item.key === 'sfx_kiss'), false);
  assert.equal(api.sampleSfxEnglish(kiss.url, kiss.note), kiss.en);
  assert.equal(api.sampleSfxEnglish(kiss.url, '내가 고친 상황'), '', 'an edited 상황 is the reader\'s alone');
});

test('a save from before 1.4.14: example effects take the shipped words and 상황, keep their own, and the new ones join', () => {
  const door = shipped.items.find(item => item.key === 'sfx_door_slam');
  const old = { version: 2, sfx: [
    { key: 'mine', name: '문 쾅', tags: ['쾅', '내 단어'], folder: '문', source: 'url', url: door.url },
    { key: 'own', name: '내 효과음', tags: ['뿅'], folder: '', source: 'url', url: 'https://example.com/own.mp3' },
  ], folders: { bgm: [], sfx: ['문'] } };
  const data = api.normalizeSoundData(old);
  assert.equal(data.version, 4);
  assert.equal(api.upgradeSampleSfx(data), true);
  const kept = data.sfx.find(item => item.key === 'mine');
  assert.ok(kept.tags.includes('내 단어') && kept.tags.includes('콰앙'), kept.tags.join(','));
  assert.equal(kept.note, door.note);
  assert.ok(data.sfx.some(item => item.name === '찔걱찔걱' && item.note), 'the new examples came');
  assert.ok(data.folders.sfx.includes('친밀'));
  assert.equal(data.sfx.filter(item => item.url === door.url).length, 1, 'an example already there is not added twice');
  assert.equal(api.upgradeSampleSfx(data), false, 'once is enough: nothing more the second time');
  // A 상황 of the reader's own stays.
  const edited = api.normalizeSoundData({ sfx: [{ ...old.sfx[0], note: '내 상황' }] });
  api.upgradeSampleSfx(edited);
  assert.equal(edited.sfx[0].note, '내 상황');
  // Effects all of the reader's own: nothing is added.
  const own = api.normalizeSoundData({ sfx: [old.sfx[1]] });
  assert.equal(api.upgradeSampleSfx(own), false);
  assert.equal(own.sfx.length, 1);
});

test('stored effects keep their 상황; 임베딩만 is a way of matching effects only', () => {
  const data = api.normalizeSoundData({ sfx: [{ key: 'a', name: 'A', tags: ['a'], note: '  상황  ', folder: '', source: 'url', url: 'https://x.test/a.mp3' }], settings: { sfxMatcher: 'embedding-only', bgmMatcher: 'embedding-only' } });
  assert.equal(data.sfx[0].note, '상황');
  assert.equal(data.settings.sfxMatcher, 'embedding-only');
  assert.equal(data.settings.bgmMatcher, 'embedding', 'BGM has no glossary to leave out');
});

test('the ElevenLabs bundle: sound words, 상황 and an English prompt each, short, in one folder', () => {
  assert.ok(api.ELEVEN_PACK.length >= 15);
  for (const row of api.ELEVEN_PACK) {
    assert.ok(row.tags.length >= 3 && row.note && /^[a-z]/.test(row.prompt) && /no music/.test(row.prompt), row.name);
    assert.ok(row.duration > 0 && row.duration <= 5, row.name);
  }
  assert.equal(new Set(api.ELEVEN_PACK.map(row => row.name)).size, api.ELEVEN_PACK.length);
  assert.ok(api.ELEVEN_PACK.some(row => row.tags.includes('찔걱')) && api.ELEVEN_PACK.some(row => row.tags.includes('츄릅')));
});
