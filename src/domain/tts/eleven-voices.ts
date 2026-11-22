import type { TtsVoice } from '../../core/tts-types';

/**
 * ElevenLabs's voices as presets, the way Gemini's listed ones are: a name, a gender and tags the assignment engines
 * choose by, over the voice's id. Pure: the rows come from `GET /v2/voices` (or one voice's own `GET /v1/voices/{id}`).
 */
export const ELEVEN_KEY_PREFIX = 'eleven:';
/** An ElevenLabs voice id: twenty letters and digits (a pasted library link's last part reads as one too). */
export function elevenVoiceId(input: string): string {
  const value = String(input || '').trim(), last = value.split(/[/?#=]/).filter(Boolean).pop() ?? '';
  return /^[A-Za-z0-9]{16,40}$/.test(value) ? value : /^[A-Za-z0-9]{16,40}$/.test(last) ? last : '';
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
// ElevenLabs writes label values in snake_case (middle_aged, narrative_story): spaced, as a tag is read.
const word = (value: unknown): string => typeof value === 'string' ? value.trim().replace(/_/g, ' ').replace(/\s+/g, ' ') : '';
/** One voice of the account's list as a preset; null for a row with no id. */
export function elevenListedVoice(row: Record<string, unknown>): TtsVoice | null {
  const id = typeof row.voice_id === 'string' ? row.voice_id.trim() : '';
  if (!id) return null;
  const labels = object(row.labels), gender = word(labels.gender ?? row.gender).toLowerCase();
  const name = word(row.name).slice(0, 200) || id;
  // What the list says of the voice in a word or two: its age, its manner, its accent, what it is for. The long
  // description is a sentence, kept apart (the embedding reads it when there are no tags).
  const tags = [...new Set([labels.age, labels.descriptive ?? labels.description, labels.accent, labels.use_case].map(word).filter(tag => tag && tag.length <= 40))].slice(0, 8);
  const about = typeof row.description === 'string' ? row.description.trim().replace(/\s+/g, ' ').slice(0, 300) : '';
  const verified = Array.isArray(row.verified_languages) ? row.verified_languages.map(v => word(object(v).language).toLowerCase()) : [];
  const languages = [...new Set([word(labels.language).toLowerCase(), ...verified].map(code => code.split(/[-_ ]/)[0]!).filter(code => /^[a-z]{2,3}$/.test(code)))].slice(0, 8);
  return {
    key: `${ELEVEN_KEY_PREFIX}${id}`, name, fishId: id, tags, folder: '',
    gender: gender.startsWith('f') ? 'female' : gender.startsWith('m') ? 'male' : 'unknown',
    ...(about ? { caption: about } : {}), ...(languages.length ? { languages } : {}),
  };
}
