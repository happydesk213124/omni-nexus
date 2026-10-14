import type { LlmSettings } from './types';

export type TtsGender = 'female' | 'male' | 'unknown';
/** Characters may also be 'other' (non-human, genderless): any voice may speak for them. */
export type TtsCharacterGender = TtsGender | 'other';
export interface TtsVoice {
  key: string;
  name: string;
  fishId: string;
  tags: string[];
  gender: TtsGender;
  folder: string;
  /** Language codes the voice speaks (Fish metadata, else guessed from its title). */
  languages?: string[];
  error?: { count: number; lastAt: number; status: number };
}
export interface TtsCharacter {
  id: string;
  scope: string;
  name: string;
  surname: string;
  givenName: string;
  surnameAliases: string[];
  givenAliases: string[];
  triggers: string[];
  tags: string[];
  gender: TtsCharacterGender;
  voiceKey: string;
  fishId: string;
  fixed: boolean;
  gain: number;
  /** true: leave loudness to automatic normalization and ignore gain. Absent on older rows (nonzero gain = manual). */
  autoGain?: boolean;
  /** Own translation target: '' follows the settings, 'original' never translates. */
  language?: string;
  /** Narrator / monologue cards always exist (global, plus one per bot) and are never matched by name. */
  role?: 'narrator' | 'monologue';
  /** Bot-scoped role card only: true (default) defers to the global card. */
  followGlobal?: boolean;
  /** Role card only: borrow the voice of this ordinary character. */
  followId?: string;
  /** Own playback speed; absent follows the player speed. */
  rate?: number;
}
export interface TtsSegment {
  id: string;
  text: string;
  speaker: string;
  tone: string;
  kind: 'dialogue' | 'narration' | 'illustration' | 'audition';
  /** A whole line in single quotes with no speaker: spoken by the monologue card. */
  monologue?: boolean;
  start: number;
  end: number;
}
export interface TtsSettings {
  enabled: boolean;
  narration: boolean;
  narrationVoice: string;
  autoAssign: boolean;
  selector: 'llm' | 'jev';
  clickPlay: boolean;
  hoverPlay: boolean;
  autoReply: boolean;
  continuous: boolean;
  illustration: boolean;
  hideName: boolean;
  hideTone: boolean;
  passageLine: boolean;
  excludeText: string;
  /** 1 once the default status-panel terms were merged into excludeText. */
  excludeSeed: number;
  /** Legacy preference, used only when migrating to omitCharacters. */
  stripBrackets: boolean;
  /** Comma-separated literal text omitted from speech, never from the chat. */
  omitCharacters: string;
  /** Skip lines that hold only digits and symbols ([00:10… 00:09…]). */
  skipSymbolOnly: boolean;
  skipChars: number;
  toast: boolean;
  viewer: boolean;
  minimized: boolean;
  viewerAnchor: { right: number; top: number } | null;
  panel: '' | 'audio' | 'cache' | 'list';
  /** Character tab scope filter, remembered like the other view choices. */
  characterFilter: 'all' | 'chat' | 'global';
  /** Voice folder searched by LLM / JEV assignment: '*' all, '' unfiled, else the folder name. */
  characterFolder: string;
  rate: number;
  rates: number[];
  volume: number;
  normalize: boolean;
  prefetch: number;
  concurrency: number;
  background: number;
  cacheMb: number;
  fish: { url: string; key: string; model: string };
  llm: LlmSettings;
  translation: {
    provider: 'off' | 'llm' | 'google-free' | 'google' | 'deepl';
    language: string;
    /** '' follows dialogue, 'original' keeps narration untranslated. */
    narrationLanguage: string;
    url: string;
    key: string;
    llm: LlmSettings;
  };
  jev: { url: string; key: string; model: string; format: 'openrouter' | 'typesafe' };
}
export interface TtsData {
  version: 1;
  settings: TtsSettings;
  voices: TtsVoice[];
  folders: string[];
  characters: TtsCharacter[];
}
