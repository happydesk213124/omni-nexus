import type { SoundSettings } from '../core/sound-types';
import { BGM_TAGS } from '../domain/sound/tags';

// Levels and timing from settings tried in play: quiet music under the voice, a short
// crossfade, effects at full level and cut at 3 s. 「자동」 matching: the glossary, then
// JEV, then embedding, then a free guess from names and tags.
export function soundDefaults(): SoundSettings {
  return {
    bgmEnabled: false, sfxEnabled: false, bgmVolume: .29, sfxVolume: 1, duck: .26, crossfadeMs: 500,
    bgmMatcher: 'auto', sfxMatcher: 'auto', bgmBasis: 'tags', bgmTags: [...BGM_TAGS], bgmPrompt: true,
    // The common `§덜컹§` style; more rules can be added in settings.
    sfxRules: [{ id: 'section-sign', name: '§ 효과음 §', open: '§', close: '§', enabled: true }],
    sfxCue: true,
    sfxAutoPlay: 'reply', sfxMaxSec: 3, sfxFirst: true, sfxTrim: true, sfxNormalize: true, listBgm: true, listSfx: true, viewerBgm: false, maxFileMb: 8,
    elevenKey: '', embed: { provider: 'openrouter', model: 'openai/text-embedding-3-small', endpoint: '', key: '' }, sfxAutoCreate: false, sfxPrompt: '{word} sound effect, short and clean, no music, no speech', sfxDuration: 0,
  };
}
