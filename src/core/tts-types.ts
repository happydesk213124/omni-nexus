import type { LlmSettings } from './types';

export type TtsGender = 'female' | 'male' | 'unknown';
export interface TtsVoice {
  key: string;
  name: string;
  fishId: string;
  tags: string[];
  gender: TtsGender;
  folder: string;
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
  gender: TtsGender;
  voiceKey: string;
  fishId: string;
  fixed: boolean;
  gain: number;
}
export interface TtsSegment {
  id: string;
  text: string;
  speaker: string;
  tone: string;
  kind: 'dialogue' | 'narration' | 'illustration' | 'audition';
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
  skipChars: number;
  toast: boolean;
  viewer: boolean;
  minimized: boolean;
  viewerAnchor: { right: number; top: number } | null;
  panel: '' | 'audio' | 'cache' | 'list';
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
