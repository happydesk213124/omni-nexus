/** BGM and sound effects: their own data, modules and player, next to TTS. */
export type SoundKind = 'bgm' | 'sfx';
/** How a BGM tag set or a sound-effect word picks an item. 'auto' = tag, then embedding, then JEV. */
export type SoundMatcher = 'auto' | 'tag' | 'embedding' | 'jev' | 'llm';

export interface SoundItem {
  key: string;
  kind: SoundKind;
  name: string;
  tags: string[];
  folder: string;
  /** 'url': fetched from a direct audio link. 'asset': stored in the kind's Risu module. */
  source: 'url' | 'asset';
  url?: string;
  /** Module asset name and the path saveAsset returned. */
  assetName?: string;
  assetPath?: string;
  mime?: string;
  bytes?: number;
}
/** The marks around sound-effect words in a reply: `open`덜컹`close` (e.g. §덜컹§). */
export interface SfxRule { id: string; name: string; open: string; close: string; enabled: boolean }
/** Glossary row: words that all mean one sound effect. */
export interface SfxTerm { id: string; terms: string[]; sfxKey: string; enabled: boolean }

export interface SoundSettings {
  bgmEnabled: boolean;
  sfxEnabled: boolean;
  bgmVolume: number;
  sfxVolume: number;
  /** BGM level while TTS speaks, as a fraction of the normal level. */
  duck: number;
  crossfadeMs: number;
  bgmMatcher: SoundMatcher;
  sfxMatcher: SoundMatcher;
  /** The vocabulary the chat model chooses BGM tags from (three per reply). */
  bgmTags: string[];
  /** Ask the chat model for [[bgm:mood,place,tempo]] before the line where the music should change. */
  bgmPrompt: boolean;
  sfxRules: SfxRule[];
  /** Ask the chat model to mark sound effects with the first rule in use (§word§ by default). */
  sfxCue: boolean;
  /** 'reply': a new reply and continuous reading play effects; 'button': only a tap does. */
  sfxAutoPlay: 'reply' | 'button';
  /** Longest effect in seconds (a longer one fades out there); 0 plays it to the end. */
  sfxMaxSec: number;
  /** Skip the silence before and after each effect. */
  sfxTrim: boolean;
  /** Level every effect to the same loudness, like TTS's automatic loudness. */
  sfxNormalize: boolean;
  /** BGM cues and effects join the TTS viewer list and continuous reading. */
  listBgm: boolean;
  listSfx: boolean;
  /** The TTS viewer shows its BGM bar (opened from the header ♪). */
  viewerBgm: boolean;
  /** ElevenLabs key, for generating effects (paid). */
  elevenKey: string;
  /** When JEV/LLM says no listed effect fits (or none exist), generate one with ElevenLabs. */
  sfxAutoCreate: boolean;
  /** Prompt for generated effects; {word} is the sound word in English. */
  sfxPrompt: string;
  /** Generated effect length in seconds; 0 lets ElevenLabs decide. */
  sfxDuration: number;
  /** Upper bound for a file stored in a module (megabytes). */
  maxFileMb: number;
}

export interface SoundData {
  version: 1;
  settings: SoundSettings;
  bgm: SoundItem[];
  sfx: SoundItem[];
  glossary: SfxTerm[];
  /** Effect words seen in replies that the glossary does not know yet. */
  unknownTerms: string[];
  folders: { bgm: string[]; sfx: string[] };
}
