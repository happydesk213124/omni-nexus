import type { SoundItem } from '../core/sound-types';
import { ttsBytes, ttsFetch } from '../providers/tts/http';
import { sniffAudioMime } from '../domain/sound/audio';
import { soundData } from '../storage/sound-store';
import { readSoundAsset } from '../storage/sound-module';
import { bgmDeviceCache } from '../storage/bgm-cache';
import { dbg } from '../core/debug';
import { joinSfxClips } from '../domain/sound/combo';
import { decodeAudio } from '../providers/sound/decode';
import { encodeSfxWav, sfxWindow } from '../domain/sound/clip';

/**
 * The sound bytes behind playback: fetched or stored audio, and effects cut and
 * levelled (silence, loudness, longest length) or joined from a compound's
 * parts, each done once per settings.
 */
/** Fetched or read audio, newest last; bounded so a long session does not grow without limit. */
const CACHE_LIMIT = 48 * 1024 * 1024;
const cache = new Map<string, { bytes: ArrayBuffer; mime: string }>();
let cached = 0;
export function rememberAudio(key: string, bytes: ArrayBuffer, mime: string): void {
  if (cache.has(key)) return;
  cache.set(key, { bytes, mime }); cached += bytes.byteLength;
  for (const [old, row] of cache) { if (cached <= CACHE_LIMIT) break; cache.delete(old); cached -= row.bytes.byteLength; }
}

export async function downloadAudio(url: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  if (!/^https:\/\//i.test(url)) throw new Error('https:// 로 시작하는 오디오 파일 주소를 넣어 주세요.');
  const bytes = await ttsBytes(await ttsFetch(url, { method: 'GET' }));
  const mime = sniffAudioMime(bytes);
  if (!mime) throw new Error('오디오 파일이 아닙니다. 페이지 주소가 아니라 파일 자체를 가리키는 주소인지 확인해 주세요.');
  return { bytes, mime };
}
export async function audioOf(item: SoundItem): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const hit = cache.get(item.key);
  if (hit) return hit;
  let row: { bytes: ArrayBuffer; mime: string };
  if (item.source === 'asset') {
    const bytes = await readSoundAsset(item.assetPath || '');
    if (!bytes) throw new Error(`${item.name}: 모듈에 저장한 파일을 읽지 못했습니다.`);
    row = { bytes, mime: item.mime || sniffAudioMime(bytes) || 'audio/mpeg' };
  } else {
    // A BGM link: this device first; a fresh download is kept there for next time.
    const kept = item.kind === 'bgm' ? await bgmDeviceCache.get(item.url || '').catch(() => null) : null;
    row = kept ?? await downloadAudio(item.url || '');
    if (!kept && item.kind === 'bgm') void bgmDeviceCache.put(item.url || '', row.bytes, row.mime).catch(error => dbg('bgm.cache.put', { message: String(error) }, 'warn'));
  }
  rememberAudio(item.key, row.bytes, row.mime);
  return row;
}
/** Fetches a BGM link ahead into the device store, without filling memory. true when it was fetched now. */
export async function prefetchAudio(item: SoundItem): Promise<boolean> {
  if (item.kind !== 'bgm' || item.source !== 'url' || !item.url || cache.has(item.key) || await bgmDeviceCache.has(item.url)) return false;
  const row = await downloadAudio(item.url);
  await bgmDeviceCache.put(item.url, row.bytes, row.mime);
  return true;
}


type Clip = { bytes: ArrayBuffer; mime: string };
const clips = new Map<string, Promise<Clip>>();
function keep(key: string, job: Promise<Clip>): Promise<Clip> {
  clips.set(key, job);
  job.catch(() => clips.delete(key));
  while (clips.size > 24) clips.delete(clips.keys().next().value!);
  return job;
}
/** An effect cut and levelled once per settings (silence, loudness, longest length); the bytes are the played clip. */
export function effectClip(item: SoundItem): Promise<Clip> {
  const s = soundData().settings, options = { maxSeconds: s.sfxMaxSec, trim: s.sfxTrim, normalize: s.sfxNormalize };
  const key = JSON.stringify([item.key, options]);
  let job = clips.get(key);
  if (!job) {
    job = (async () => {
      const audio = await audioOf(item);
      try {
        const pcm = await decodeAudio(audio.bytes);
        return { bytes: encodeSfxWav(pcm.channels, pcm.sampleRate, sfxWindow(pcm.channels, pcm.sampleRate, options)), mime: 'audio/wav' };
      } catch { return audio; } // This browser cannot decode it: it plays as it is, if it can play it at all.
    })();
    keep(key, job);
  }
  return job;
}

/** One effect is its own clip; a compound's parts are cut to their shares and joined into one. */
export function planClip(plan: ReadonlyArray<{ item: SoundItem; seconds?: number }>): Promise<Clip> {
  if (plan.length === 1 && plan[0]!.seconds === undefined) return effectClip(plan[0]!.item);
  const s = soundData().settings, options = { trim: s.sfxTrim, normalize: s.sfxNormalize };
  const key = JSON.stringify(['combo', plan.map(row => [row.item.key, Math.round((row.seconds ?? 0) * 100)]), options]);
  let job = clips.get(key);
  if (!job) {
    job = (async () => {
      try {
        const pcm = await Promise.all(plan.map(async row => decodeAudio((await audioOf(row.item)).bytes)));
        const rate = pcm[0]!.sampleRate;
        const joined = joinSfxClips(pcm.map((part, i) => ({ channels: part.channels, window: sfxWindow(part.channels, part.sampleRate, { ...options, maxSeconds: plan[i]!.seconds ?? s.sfxMaxSec }) })), rate);
        return { bytes: encodeSfxWav(joined, rate, { start: 0, end: joined[0]!.length, cut: false, gain: 1 }), mime: 'audio/wav' };
      } catch { return effectClip(plan[0]!.item); } // A part this browser cannot decode: the first effect alone.
    })();
    keep(key, job);
  }
  return job;
}
