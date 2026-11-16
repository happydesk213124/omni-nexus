import type { TtsGender, TtsVoice } from '../../core/tts-types';

/**
 * Gemini TTS's prebuilt voices: one name each, and the one word Google gives its manner. They are the voices every
 * Gemini TTS model knows (the Extended Voice Library and voices designed or replicated are read from the voice list).
 * Each is a preset as Irodori's are: a name, a gender and tags the assignment engines choose by, over the voice's id.
 */
const PREBUILT: ReadonlyArray<readonly [string, TtsGender, string, string]> = [
  ['Zephyr', 'female', 'bright', '밝은'], ['Puck', 'male', 'upbeat', '경쾌한'], ['Charon', 'male', 'informative', '또렷한 설명조'],
  ['Kore', 'female', 'firm', '단단한'], ['Fenrir', 'male', 'excitable', '들뜬'], ['Leda', 'female', 'youthful', '어린'],
  ['Orus', 'male', 'firm', '단단한'], ['Aoede', 'female', 'breezy', '산뜻한'], ['Callirrhoe', 'female', 'easy-going', '느긋한'],
  ['Autonoe', 'female', 'bright', '밝은'], ['Enceladus', 'male', 'breathy', '숨결 섞인'], ['Iapetus', 'male', 'clear', '맑은'],
  ['Umbriel', 'male', 'easy-going', '느긋한'], ['Algieba', 'male', 'smooth', '부드러운'], ['Despina', 'female', 'smooth', '부드러운'],
  ['Erinome', 'female', 'clear', '맑은'], ['Algenib', 'male', 'gravelly', '거친'], ['Rasalgethi', 'male', 'informative', '또렷한 설명조'],
  ['Laomedeia', 'female', 'upbeat', '경쾌한'], ['Achernar', 'female', 'soft', '여린'], ['Alnilam', 'male', 'firm', '단단한'],
  ['Schedar', 'male', 'even', '차분한'], ['Gacrux', 'female', 'mature', '성숙한'], ['Pulcherrima', 'female', 'forward', '시원시원한'],
  ['Achird', 'male', 'friendly', '다정한'], ['Zubenelgenubi', 'male', 'casual', '편안한'], ['Vindemiatrix', 'female', 'gentle', '상냥한'],
  ['Sadachbia', 'male', 'lively', '활기찬'], ['Sadaltager', 'male', 'knowledgeable', '지적인'], ['Sulafat', 'female', 'warm', '따뜻한'],
];
export const GEMINI_DEFAULT_VOICE = 'Kore';
export const GEMINI_PREBUILT_NAMES: readonly string[] = PREBUILT.map(([name]) => name);

/** The prebuilt voices as presets, keyed by their names (a voice list read later keeps these keys). */
export function geminiPrebuiltVoices(): TtsVoice[] {
  return PREBUILT.map(([name, gender, manner, korean]) => ({ key: `gemini:${name}`, name: `${name} · ${korean}`, fishId: name, tags: [korean, manner], gender, folder: '' }));
}

/** One voice of Gemini's voice list (`GET /v1beta/voices`), as a preset; null for a row with no id. */
export function geminiListedVoice(row: Record<string, unknown>): TtsVoice | null {
  const pick = (...keys: string[]) => { for (const k of keys) { const v = row[k]; if (typeof v === 'string' && v.trim()) return v.trim(); } return ''; };
  const id = pick('id', 'name', 'voice', 'voiceId', 'voice_id').replace(/^voices\//, '');
  if (!id) return null;
  const shown = pick('display_name', 'displayName') || id, gender = pick('gender').toLowerCase();
  const about = pick('description', 'persona'), accent = pick('accent'), language = pick('language_code', 'languageCode');
  const tags = [...new Set([about, accent, pick('pitch'), pick('persona')].flatMap(t => t.split(/[,;]/)).map(t => t.trim()).filter(t => t && t.length <= 40))].slice(0, 8);
  return {
    key: `gemini:${id}`, name: about && shown !== about ? `${shown} · ${about.slice(0, 40)}` : shown, fishId: id, tags,
    gender: gender.startsWith('f') ? 'female' : gender.startsWith('m') ? 'male' : 'unknown', folder: '',
    ...(language ? { languages: [language.toLowerCase().split(/[-_]/)[0]!] } : {}),
  };
}
