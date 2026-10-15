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
/** One regex that marks sound-effect words in a reply (e.g. §덜컹§). */
export interface SfxRule { id: string; name: string; pattern: string; flags: string; enabled: boolean }
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
  /** Ask the chat model for [[bgm:mood,place,tempo]] on the first line. */
  bgmPrompt: boolean;
  sfxRules: SfxRule[];
  /** 'reply': a new reply and continuous reading play effects; 'button': only a tap does. */
  sfxAutoPlay: 'reply' | 'button';
  listBgm: boolean;
  listSfx: boolean;
  /** The TTS viewer shows its BGM bar (opened from the header ♪). */
  viewerBgm: boolean;
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
