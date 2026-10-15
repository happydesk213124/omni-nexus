import type { SoundData, SoundSettings } from '../core/sound-types';
import { BGM_TAGS } from '../domain/sound/tags';

export function soundDefaults(): SoundSettings {
  return {
    bgmEnabled: false, sfxEnabled: false, bgmVolume: .5, sfxVolume: .8, duck: .35, crossfadeMs: 1500,
    bgmMatcher: 'auto', sfxMatcher: 'auto', bgmBasis: 'tags', bgmTags: [...BGM_TAGS], bgmPrompt: true,
    // The common `§덜컹§` style; more rules can be added in settings.
    sfxRules: [{ id: 'section-sign', name: '§ 효과음 §', open: '§', close: '§', enabled: true }],
    sfxCue: true,
    sfxAutoPlay: 'reply', sfxMaxSec: 6, sfxFirst: true, sfxTrim: true, sfxNormalize: true, listBgm: true, listSfx: true, viewerBgm: false, maxFileMb: 8,
    elevenKey: '', sfxAutoCreate: false, sfxPrompt: '{word} sound effect, short and clean, no music, no speech', sfxDuration: 0,
  };
}
export function emptySoundData(): SoundData {
  return { version: 1, settings: soundDefaults(), bgm: [], sfx: [], glossary: [], unknownTerms: [], folders: { bgm: [], sfx: [] } };
}
