import bgm from './sound-samples/bgm.json';
import sfx from './sound-samples/sfx.json';
import type { SoundKind } from '../core/sound-types';
import { youtubeWatchUrl } from '../domain/sound/youtube';

/**
 * Ready-made lists, so installing the plugin is enough to hear something: a
 * first run starts with them (sound-store), and 「예제 불러오기」 adds any that
 * are missing later. Links only — nothing is stored in the save, and a link
 * its host takes down simply stops playing.
 *
 * BGM: Kevin MacLeod (incompetech.com), CC BY 4.0, which asks for the credit
 * the BGM list shows. Each plays from its upload on YouTube (his own channel where
 * there is one), nothing downloaded; its incompetech file stays as the fallback for
 * a Risu where YouTube cannot play. Effects: Google's Actions sound library
 * (actions.google.com).
 *
 * Each track carries 상황 (`note`: the scene it suits), which the embedding reads next to its name and tags when a
 * cue's tags leave several tracks to pick among.
 * Each effect carries the sound words it is heard as (its tags), 상황 (`note`: when it is heard, shown and saved)
 * and `en`, the same in English, which is never saved: the embedding reads it next to the Korean while the
 * effect's 상황 is still the one shipped (sampleSfxEnglish).
 */
interface SampleItem { key: string; name: string; tags: string[]; folder: string; url: string; youtube?: string; note?: string; en?: string }
export const SOUND_SAMPLES: Record<SoundKind, { folders: string[]; items: SampleItem[] }> = { bgm, sfx };
export const BGM_SAMPLE_CREDIT = 'Music by Kevin MacLeod (incompetech.com) · Licensed under Creative Commons: By Attribution 4.0';
export const BGM_SAMPLE_HOST = 'incompetech.com';

/** The examples as stored data, before normalisation. */
export function sampleSoundData(): { bgm: unknown[]; sfx: unknown[]; folders: Record<SoundKind, string[]> } {
  const items = (kind: SoundKind) => SOUND_SAMPLES[kind].items.map(({ youtube, en: _english, ...item }) => youtube
    ? { ...item, kind, source: 'youtube', url: youtubeWatchUrl(youtube), fallbackUrl: item.url }
    : { ...item, kind, source: 'url' });
  return { bgm: items('bgm'), sfx: items('sfx'), folders: { bgm: [...SOUND_SAMPLES.bgm.folders], sfx: [...SOUND_SAMPLES.sfx.folders] } };
}

const SFX_BY_URL = new Map(SOUND_SAMPLES.sfx.items.map(item => [item.url, item] as const));
/** An example effect by its link: its shipped sound words and 상황, for a save made before they were there. */
export const sampleSfxFor = (url: string): SampleItem | undefined => SFX_BY_URL.get(url);
/** The English of an example effect's 상황, while the 상황 is still the one shipped (an edited one is the reader's). */
export function sampleSfxEnglish(url: string, note: string | undefined): string {
  const sample = SFX_BY_URL.get(url);
  return sample?.en && note === sample.note ? sample.en : '';
}

const BGM_BY_LINK = new Map(SOUND_SAMPLES.bgm.items.flatMap(item => [[item.url, item] as const, ...(item.youtube ? [[youtubeWatchUrl(item.youtube), item] as const] : [])]));
/** An example track by its link (its file, or its YouTube video): its shipped 상황, for a save made before it was there. */
export const sampleBgmFor = (...links: Array<string | undefined>): SampleItem | undefined => { for (const link of links) { const hit = link ? BGM_BY_LINK.get(link) : undefined; if (hit) return hit; } return undefined; };

/** An example track's YouTube video, by the file link it was saved with before the examples moved to YouTube. */
const SAMPLE_YOUTUBE = new Map(SOUND_SAMPLES.bgm.items.flatMap(item => item.youtube ? [[item.url, item.youtube] as const] : []));
export const sampleYoutubeFor = (fileUrl: string): string => SAMPLE_YOUTUBE.get(fileUrl) || '';
