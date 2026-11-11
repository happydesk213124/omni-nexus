import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export {youtubeVideoId,youtubeWatchUrl} from './src/domain/sound/youtube';export {normalizeSoundData} from './src/storage/sound-store';export {sampleSoundData,SOUND_SAMPLES} from './src/config/sound-samples';export {plantYoutubeSeed,YOUTUBE_SEED_HTML} from './src/providers/sound/youtube';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

test('a YouTube link in any form is its video id; anything else is no YouTube track', () => {
  for (const link of ['https://www.youtube.com/watch?v=sMcWOaJFuw0', 'https://youtu.be/sMcWOaJFuw0?si=x', 'https://m.youtube.com/watch?v=sMcWOaJFuw0&t=30', 'https://music.youtube.com/watch?v=sMcWOaJFuw0', 'https://www.youtube.com/embed/sMcWOaJFuw0?rel=0', 'https://www.youtube.com/shorts/sMcWOaJFuw0', 'https://www.youtube-nocookie.com/embed/sMcWOaJFuw0'])
    assert.equal(api.youtubeVideoId(link), 'sMcWOaJFuw0', link);
  for (const link of ['https://incompetech.com/music/royalty-free/mp3-royaltyfree/Carefree.mp3', 'https://www.youtube.com/channel/UCx', 'https://evil.com/watch?v=sMcWOaJFuw0', 'https://www.youtube.com/watch?v=short', 'javascript:alert(1)', ''])
    assert.equal(api.youtubeVideoId(link), '', link);
});

test('the example BGM plays from YouTube, each keeping its file as the fallback; effects stay files', () => {
  // 유튜브 창 숨기기 is on by default; a save from before that (version 1) held the old default and is moved to on, once.
  assert.equal(api.normalizeSoundData({ settings: {} }).settings.youtubeHidden, true);
  assert.equal(api.normalizeSoundData({ version: 2, settings: {} }).settings.youtubeHidden, true, "the default itself, not the move");
  assert.equal(api.normalizeSoundData({ version: 1, settings: { youtubeHidden: false } }).settings.youtubeHidden, true);
  const kept = api.normalizeSoundData({ version: 1, settings: { youtubeHidden: false } });
  assert.equal(kept.version, 3, "saved as the current version (3 since the effects learned their 상황)");
  assert.equal(api.normalizeSoundData({ version: 2, settings: { youtubeHidden: false } }).settings.youtubeHidden, false, 'switched off since: the reader\'s, kept');
  const data = api.normalizeSoundData(api.sampleSoundData());
  assert.equal(data.bgm.length, api.SOUND_SAMPLES.bgm.items.length, 'no example is lost');
  const tube = data.bgm.filter(item => item.source === 'youtube'), uploads = api.SOUND_SAMPLES.bgm.items.filter(item => item.youtube);
  assert.equal(tube.length, uploads.length, 'each example with an upload plays from it');
  assert.ok(uploads.length >= 180, `nearly all of them: ${uploads.length}`);
  assert.equal(new Set(uploads.map(item => item.youtube)).size, uploads.length, 'no two examples share a video');
  for (const item of tube) {
    assert.match(item.url, /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/);
    assert.match(item.fallbackUrl, /^https:\/\/incompetech\.com\//);
  }
  for (const item of data.bgm.filter(item => item.source !== 'youtube')) assert.match(item.url, /^https:\/\/incompetech\.com\//, `${item.name}: no upload that is the track itself, so its file`);
  assert.ok(data.sfx.every(item => item.source === 'url'), 'a short effect through a YouTube window would come late');
});

test('a list saved before the move: its example tracks become their YouTube uploads; other links and YouTube effects do not', () => {
  const sample = api.SOUND_SAMPLES.bgm.items.find(item => item.youtube);
  const saved = { bgm: [
    { key: 'old', kind: 'bgm', name: 'Carefree', tags: ['happy'], folder: '일상', source: 'url', url: sample.url },
    { key: 'mine', kind: 'bgm', name: '내 곡', tags: [], folder: '', source: 'url', url: 'https://example.com/a.mp3' },
    { key: 'tube', kind: 'bgm', name: '유튜브 곡', tags: [], folder: '', source: 'youtube', url: 'https://youtu.be/sMcWOaJFuw0' },
    { key: 'broken', kind: 'bgm', name: '깨진 링크', tags: [], folder: '', source: 'youtube', url: 'https://www.youtube.com/watch?v=nope', fallbackUrl: 'https://example.com/b.mp3' },
  ], sfx: [{ key: 'fx', kind: 'sfx', name: '효과', tags: [], folder: '', source: 'youtube', url: 'https://youtu.be/sMcWOaJFuw0' }] };
  const data = api.normalizeSoundData(saved);
  const by = key => data.bgm.find(item => item.key === key);
  assert.deepEqual([by('old').source, by('old').url, by('old').fallbackUrl], ['youtube', api.youtubeWatchUrl(sample.youtube), sample.url]);
  assert.deepEqual([by('mine').source, by('mine').url], ['url', 'https://example.com/a.mp3']);
  assert.equal(by('tube').url, 'https://www.youtube.com/watch?v=sMcWOaJFuw0', 'kept as one plain watch link');
  assert.deepEqual([by('broken').source, by('broken').url], ['url', 'https://example.com/b.mp3'], 'no video id: its file plays');
  assert.equal(data.sfx[0].source, 'url', 'an effect is never a YouTube track');
});

test('the seed: planted in one drawn message while wanted, and never more often than every few seconds', () => {
  assert.equal(api.plantYoutubeSeed('본문'), '본문', 'not wanted: every draw passes as is');
  assert.match(api.YOUTUBE_SEED_HTML, /^<div data-omni-yt-seed="1" style="display:none"><iframe [^>]*src="https:\/\/www\.youtube\.com\/embed\/[^"]+enablejsapi=1[^"]*"[^>]*loading="lazy"/, 'hidden and lazy: the seed itself never loads');
});
