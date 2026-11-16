import type { TtsCharacter, TtsSettings, TtsVoice } from '../core/tts-types';
import { dbg } from '../core/debug';
import { GEMINI_PREBUILT_NAMES, geminiPrebuiltVoices } from '../domain/tts/gemini-voices';
import { englishVoiceTags } from '../domain/tts/voice-words';
import { deleteGeminiVoice, designGeminiVoice, geminiReady, listGeminiVoices } from '../providers/tts/gemini';
import { saveTtsData, ttsData, updateTtsSettings } from '../storage/tts-store';

/**
 * Gemini's voices beyond the thirty prebuilt ones (thirty voices over a bot's whole cast is the same few actors again
 * and again): Google's catalog read in by either way in (a key, or a Vertex service account), and a voice of a
 * card's own designed from what the card says of them (voice design: a new voice from a description).
 */
const EMOJI = /\p{Extended_Pictographic}/u;
const GENDER: Record<string, string> = { female: 'female', male: 'male' };
const LANGUAGE: Record<string, string> = { ko: 'ko-KR', ja: 'ja-JP', en: 'en-US' };
/** The language lines are read in: a card's own, else the translation's target, else Korean (the chat's). */
function readLanguage(c?: Pick<TtsCharacter, 'language'>, settings: Pick<TtsSettings, 'translation'> = ttsData().settings): string {
  const read = c?.language && c.language !== 'original' ? c.language : settings.translation.provider !== 'off' ? settings.translation.language : 'ko';
  return String(read || 'ko').toLowerCase().split(/[-_]/)[0] || 'ko';
}
const own = (voice: Pick<TtsVoice, 'fishId'>): boolean => /^voice(key)?_/.test(voice.fishId);
const prebuilt = new Set(GEMINI_PREBUILT_NAMES);
/** A card's traits as a model reads them: English, no emoji, a handful. With none of its own, its Fish voice's. */
function traits(c: Pick<TtsCharacter, 'tags' | 'voiceKey'>): string[] {
  const tags = c.tags.length ? c.tags : ttsData().voices.find(v => v.key === c.voiceKey)?.tags ?? [];
  return englishVoiceTags(tags.filter(tag => !EMOJI.test(tag))).filter(tag => tag.length <= 30).slice(0, 6);
}
/**
 * 캐릭터 특징을 말투에: who speaks, in a few words, sent as the style of each of their lines. Two cards given the same
 * voice (more cards than voices) still sound apart; a voice designed for the card needs none, it is them already.
 */
export function geminiPersona(c: Pick<TtsCharacter, 'tags' | 'voiceKey' | 'gender'> | undefined, voiceId: string): string {
  if (!c || own({ fishId: voiceId })) return '';
  const words = traits(c), gender = GENDER[c.gender];
  return words.length ? `${gender ? `${gender} ` : ''}character voice: ${words.join(', ')}` : '';
}
/** What a card's own voice is designed from: their gender and traits, and the language they are read in. */
export function voiceDesignOf(c: TtsCharacter, settings: Pick<TtsSettings, 'translation'> = ttsData().settings): { name: string; description: string; gender?: 'female' | 'male'; language?: string } {
  const words = traits(c), gender = c.gender === 'female' || c.gender === 'male' ? c.gender : undefined;
  const language = LANGUAGE[readLanguage(c, settings)] ?? LANGUAGE.ko;
  const description = `A distinctive ${gender ? `${gender} ` : ''}voice for a story character${words.length ? `: ${words.join(', ')}` : ''}. Natural and expressive, as a voice actor would play them.`;
  return { name: c.name.slice(0, 80), description, ...(gender ? { gender } : {}), language };
}
/** Whether the card speaks with a voice no other card has. */
function hasOwnVoice(c: TtsCharacter): boolean {
  if (!c.geminiKey || !ttsData().geminiVoices.some(v => v.key === c.geminiKey)) return false;
  return !ttsData().characters.some(other => other.id !== c.id && other.geminiKey === c.geminiKey);
}
/** A bot's people (and the shared ones) with no Gemini voice, or one another card speaks with too: who 「캐릭터마다 새 목소리」 makes one for. */
export function cardsWithoutOwnVoice(scope: string): TtsCharacter[] {
  return ttsData().characters.filter(c => !c.role && !c.fixed && (c.scope === scope || c.scope === 'global') && !hasOwnVoice(c));
}
const designing = new Map<string, Promise<{ voice: TtsVoice; sample?: ArrayBuffer }>>();
/**
 * A voice of the card's own: designed, kept among the presets, and the card's from now on. `description`: in its
 * place, the words to design from (the tab's own form). One at a time a card.
 */
export function designVoiceFor(c: TtsCharacter, description = ''): Promise<{ voice: TtsVoice; sample?: ArrayBuffer }> {
  const running = designing.get(c.id);
  if (running) return running;
  const job = (async () => {
    const design = voiceDesignOf(c), made = await designGeminiVoice({ gemini: ttsData().settings.gemini }, description.trim() ? { ...design, description: description.trim() } : design);
    const data = ttsData(), card = data.characters.find(row => row.id === c.id);
    data.geminiVoices = [...data.geminiVoices.filter(v => v.key !== made.voice.key), { ...made.voice, tags: c.tags.slice(0, 8) }];
    if (card) card.geminiKey = made.voice.key;
    await saveTtsData();
    return made;
  })().finally(() => designing.delete(c.id));
  designing.set(c.id, job);
  return job;
}
/** A voice designed with no card in mind (the tab's + 목소리 만들기): kept among the presets. */
export async function designVoice(input: { name: string; description: string; gender?: 'female' | 'male' }): Promise<{ voice: TtsVoice; sample?: ArrayBuffer }> {
  const made = await designGeminiVoice({ gemini: ttsData().settings.gemini }, { ...input, language: LANGUAGE[readLanguage()] ?? LANGUAGE.ko });
  const data = ttsData();
  data.geminiVoices = [...data.geminiVoices.filter(v => v.key !== made.voice.key), made.voice];
  await saveTtsData();
  return made;
}
/** A preset taken off the list; a designed voice is let go at Google too (its place in the project's 200), and the cards that spoke with it read with the default voice. */
export async function removeGeminiVoice(key: string): Promise<void> {
  const data = ttsData(), voice = data.geminiVoices.find(v => v.key === key);
  if (!voice) return;
  if (own(voice)) await deleteGeminiVoice({ gemini: data.settings.gemini }, voice.fishId).catch(error => dbg('tts.gemini', { message: `목소리 삭제: ${String((error as Error)?.message || error)}` }, 'warn'));
  data.geminiVoices = data.geminiVoices.filter(v => v.key !== key);
  for (const c of data.characters) if (c.geminiKey === key) delete c.geminiKey;
  await saveTtsData();
}
/**
 * The voice list read in: the prebuilt thirty first (cards speak with them), the voices designed here kept, then
 * what the list holds, each once. Kept to `max`: the whole list is saved with the TTS data, and a few thousand rows
 * is a write of half a megabyte every time anything in it changes.
 */
export async function loadGeminiVoiceList(language = '', max = 600): Promise<number> {
  const data = ttsData(), listed = await listGeminiVoices({ gemini: data.settings.gemini }, language, 1000);
  const keep = [...geminiPrebuiltVoices(), ...data.geminiVoices.filter(own)], have = new Set(keep.map(v => v.fishId));
  const bound = new Set(data.characters.map(c => c.geminiKey).filter(Boolean));
  // A voice a card speaks with stays whatever the new list holds.
  const kept = data.geminiVoices.filter(v => bound.has(v.key) && !have.has(v.fishId));
  for (const v of kept) have.add(v.fishId);
  const fresh = listed.filter(v => !have.has(v.fishId) && !prebuilt.has(v.fishId));
  data.geminiVoices = [...keep, ...kept, ...fresh].slice(0, Math.max(max, keep.length + kept.length));
  await saveTtsData();
  return fresh.length;
}
let listing: Promise<void> | undefined;
/**
 * Once, by itself, the first time Gemini is ready to speak: the catalog's voices in the language read (the thirty
 * prebuilt ones are all there is until then). A list that cannot be read is not asked for again by itself (목록
 * 불러오기 still asks).
 */
export function ensureGeminiVoiceList(): Promise<void> {
  const s = ttsData().settings;
  if (s.engine !== 'gemini' || s.gemini.listed || !geminiReady(s)) return Promise.resolve();
  return listing ??= (async () => {
    await updateTtsSettings({ gemini: { ...ttsData().settings.gemini, listed: true } });
    // In the language read first (a voice of that language reads it as its own); a catalog with none so marked, whole.
    const added = await loadGeminiVoiceList(readLanguage(undefined, s), 300) || await loadGeminiVoiceList('', 300);
    dbg('tts.gemini', { message: `목소리 목록 ${added}개를 불러왔습니다.` });
    if (typeof document !== 'undefined') document.dispatchEvent(new Event('omnitts-library'));
  })().catch(error => { dbg('tts.gemini', { message: `목소리 목록: ${String((error as Error)?.message || error)}` }, 'warn'); }).finally(() => { listing = undefined; });
}
