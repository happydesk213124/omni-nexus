import type { LlmSettings } from './types';

export type TtsGender = 'female' | 'male' | 'unknown';
/** Characters may also be 'other' (non-human, genderless): any voice may speak for them. */
export type TtsCharacterGender = TtsGender | 'other';
export interface TtsVoice {
  key: string;
  name: string;
  /** The voice's id on its engine: a Fish model id; for an Irodori preset, the voice's id on the user's server. */
  fishId: string;
  tags: string[];
  gender: TtsGender;
  folder: string;
  /** Irodori preset only: the description (Japanese) the voice was designed from, kept to design it again. */
  caption?: string;
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
  /** The Irodori preset the card speaks with while Irodori is the engine; its Fish voice above is kept beside it. */
  irodoriKey?: string;
  /** The Gemini preset the card speaks with while Gemini is the engine (its Fish and Irodori voices kept beside it). */
  geminiKey?: string;
  /** The ElevenLabs voice the card speaks with while ElevenLabs is the engine (its other engines' voices kept beside it). */
  elevenKey?: string;
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
  /** Own base delivery, English Fish cues by comma (`soft tone, slow`); absent or empty uses the settings' one. */
  tone?: string;
  /** Own Fish model (`s2-pro`, `drama-3`, any id); absent or empty follows the model settings. */
  model?: string;
  /** 코스튬에 따라 음성 변경: a line naming a costume (`이름_2`) speaks with that costume's voice, when it has one. */
  costumeVoice?: boolean;
  /** A costume's own Fish voice, by its number in the illustration character's list. */
  costumeFish?: Record<string, string>;
}
export interface TtsSegment {
  id: string;
  text: string;
  speaker: string;
  tone: string;
  /** 'bgm' and 'sfx' are sound cues in the reply: they join the list and continuous reading but are never spoken. */
  kind: 'dialogue' | 'narration' | 'illustration' | 'audition' | 'bgm' | 'sfx';
  /** A whole line in single quotes with no speaker: spoken by the monologue card. */
  monologue?: boolean;
  /** A named cue in single quotes (`이름 (tone): '생각'`): a thought, heard with 생각 에코 when that is on. */
  thought?: boolean;
  /** The costume a cue names (`이름_2 (tone):`): its number in the speaker's illustration character's list; absent, the default one. */
  costume?: number;
  /** The emoji the cue opened with (`👩🥺 하린 (shy):`): 첫 대사 이모지, read by cue-emoji.ts. */
  marks?: string;
  /** The text read aloud when it differs from `text` (marked effect words removed). `text` stays the line as shown, for matching. */
  spoken?: string;
  /** A BGM cue's tags. */
  tags?: string[];
  /** An effect's line with the paragraphs around it, for matching a new word; a BGM cue's scene (what follows it). */
  context?: string;
  start: number;
  end: number;
}
export interface TtsSettings {
  enabled: boolean;
  narration: boolean;
  narrationVoice: string;
  autoAssign: boolean;
  /** Send the message being voiced along when a new speaker's voice is chosen. */
  assignWithChat: boolean;
  /** 첫 대사 이모지: the cue prompt asks for age-gender and personality emoji on each character's first line in a reply; a new character's voice is chosen by them. */
  cueEmoji: boolean;
  /**
   * 대사 중간 감정 태그 (Fish, Gemini): the voice is written into the line as English tags where it changes
   * (`"[sad] 괜찮아… [sobbing] 정말"`), and the cue's parentheses only choose the 감정 에셋 face.
   */
  inlineTags: boolean;
  /** Hide the emoji before a cue's name on screen (화자 이름 숨기기 switches it on with it). */
  hideEmoji: boolean;
  selector: 'llm' | 'jev' | 'embedding';
  clickPlay: boolean;
  hoverPlay: boolean;
  autoReply: boolean;
  continuous: boolean;
  illustration: boolean;
  hideName: boolean;
  hideTone: boolean;
  passageLine: boolean;
  excludeText: string;
  /** JEV 작가의 노트: the user's own guidance, sent with every voice JEV picks. */
  jevNote: string;
  /** 1 once the default status-panel terms were merged into excludeText. */
  excludeSeed: number;
  /** Legacy preference, used only when migrating to omitCharacters. */
  stripBrackets: boolean;
  /** Comma-separated literal text omitted from speech, never from the chat. */
  omitCharacters: string;
  /** 1 once ( and ) were added to an older omit list; later edits win. */
  omitSeed?: number;
  /** Also leave out the words inside parentheses, not just the marks. */
  omitParenText: boolean;
  /** 「재생 버튼 자리 여백」: blocks with a chat control keep a gutter so it never hangs outside. */
  controlGutter: boolean;
  /** Base delivery for every voice, English Fish cues by comma; a character's own replaces it. */
  tone: string;
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
  /** Narration's own level (옴니 뷰어 › 소리, TTS 설정); null: as the voice's. */
  narrationVolume: number | null;
  /** 생각 에코: an echo laid over thoughts (`이름: '생각'`, a nameless `'혼잣말'`) as they play. The audio itself is not remade. */
  thoughtEcho: 'off' | 'light' | 'medium' | 'strong';
  normalize: boolean;
  prefetch: number;
  concurrency: number;
  background: number;
  cacheMb: number;
  /**
   * Fish voices, called on Fish directly or through OpenRouter (`via`); `routerKey`
   * is the OpenRouter key (empty: JEV's, when JEV goes through OpenRouter).
   */
  fish: { url: string; key: string; model: string; via: 'fish' | 'openrouter'; routerKey: string };
  /** Which service speaks: Fish Audio, the user's own Irodori-TTS server, Gemini TTS, or ElevenLabs. */
  engine: 'fish' | 'irodori' | 'gemini' | 'elevenlabs';
  /**
   * Irodori-TTS-Server: self-hosted, the OpenAI speech API, Japanese only. `voice` is the server's voice every line
   * speaks with. The server makes one line at a time unless it is set up for more, hence its own `concurrency`.
   */
  irodori: { url: string; key: string; model: string; voice: string; format: 'mp3' | 'wav'; concurrency: number };
  /**
   * Gemini TTS: by an AI Studio key (`via` 'studio') or a Vertex AI service account's JSON key (`serviceAccountJson`, in
   * `location`). `voice` is the voice a card with no preset speaks with (a prebuilt name, or a `voice_…` id).
   * `persona`: a card's traits go with each of its lines as their style (two cards on one voice sound apart).
   * `assign`: how a speaker with no voice gets one. 'design': a voice designed from their gender and traits (one a
   * combination: the same traits, the same voice); 'list': one picked from the list by the 음성 선택 모델; 'embedding':
   * one picked from Google's list at once, whatever that model is (no wait, no model call): among the voices of their
   * gender and pitch, by the embedding when one is set, else by the words their tags share with the voice. `listed`: the voice list was
   * read in by itself once.
   */
  gemini: { via: 'studio' | 'vertex'; key: string; serviceAccountJson: string; location: string; model: string; voice: string; concurrency: number; persona: boolean; assign: 'design' | 'list' | 'embedding'; listed: boolean };
  /**
   * ElevenLabs: an API key, the model that speaks (`eleven_v3` and the v4 ones take [audio tags] in the text; the
   * multilingual and flash ones read them aloud, so none is sent there) and `voice`, the voice id a card with no voice
   * of its own speaks with. `listed`: the account's voices were read in by themselves once.
   */
  eleven: { key: string; model: string; voice: string; concurrency: number; listed: boolean };
  llm: LlmSettings;
  translation: {
    provider: 'off' | 'llm' | 'google-free' | 'google' | 'deepl';
    language: string;
    /** '' follows dialogue, 'original' keeps narration untranslated. */
    narrationLanguage: string;
    url: string;
    /** The key of the service in use (Google's or DeepL's), '' for the others. */
    key: string;
    /** Each service's own key: switching to another (or off) and back finds it again. */
    googleKey?: string;
    deeplKey?: string;
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
  /** Irodori's own voice presets (Fish's are `voices`): each names a voice kept on the user's server. */
  irodoriVoices: TtsVoice[];
  /** Gemini's voice presets: the prebuilt ones from the start, and those read from its voice list. */
  geminiVoices: TtsVoice[];
  /** ElevenLabs's voices: the account's own (its library, cloned and designed ones), read from its voice list. */
  elevenVoices: TtsVoice[];
}
