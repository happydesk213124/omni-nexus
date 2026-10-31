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
 */
export const SOUND_SAMPLES: Record<SoundKind, { folders: string[]; items: Array<{ key: string; name: string; tags: string[]; folder: string; url: string; youtube?: string }> }> = { bgm, sfx };
export const BGM_SAMPLE_CREDIT = 'Music by Kevin MacLeod (incompetech.com) · Licensed under Creative Commons: By Attribution 4.0';
export const BGM_SAMPLE_HOST = 'incompetech.com';

/** The examples as stored data, before normalisation. */
export function sampleSoundData(): { bgm: unknown[]; sfx: unknown[]; folders: Record<SoundKind, string[]> } {
  const items = (kind: SoundKind) => SOUND_SAMPLES[kind].items.map(({ youtube, ...item }) => youtube
    ? { ...item, kind, source: 'youtube', url: youtubeWatchUrl(youtube), fallbackUrl: item.url }
    : { ...item, kind, source: 'url' });
  return { bgm: items('bgm'), sfx: items('sfx'), folders: { bgm: [...SOUND_SAMPLES.bgm.folders], sfx: [...SOUND_SAMPLES.sfx.folders] } };
}

/** An example track's YouTube video, by the file link it was saved with before the examples moved to YouTube. */
const SAMPLE_YOUTUBE = new Map(SOUND_SAMPLES.bgm.items.flatMap(item => item.youtube ? [[item.url, item.youtube] as const] : []));
export const sampleYoutubeFor = (fileUrl: string): string => SAMPLE_YOUTUBE.get(fileUrl) || '';
