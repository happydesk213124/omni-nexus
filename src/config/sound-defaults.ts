import type { SoundData, SoundSettings } from '../core/sound-types';
import { BGM_TAGS } from '../domain/sound/tags';

export function soundDefaults(): SoundSettings {
  return {
    bgmEnabled: false, sfxEnabled: false, bgmVolume: .5, sfxVolume: .8, duck: .35, crossfadeMs: 1500,
    bgmMatcher: 'auto', sfxMatcher: 'auto', bgmTags: [...BGM_TAGS], bgmPrompt: true,
    // The common `§덜컹§` style; more rules can be added in settings.
    sfxRules: [{ id: 'section-sign', name: '§ 효과음 §', pattern: '§([^§\\n]{1,60})§', flags: '', enabled: true }],
    sfxAutoPlay: 'reply', listBgm: true, listSfx: true, maxFileMb: 8,
  };
}
export function emptySoundData(): SoundData {
  return { version: 1, settings: soundDefaults(), bgm: [], sfx: [], glossary: [], unknownTerms: [], folders: { bgm: [], sfx: [] } };
}
