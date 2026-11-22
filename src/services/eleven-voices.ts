import type { TtsVoice } from '../core/tts-types';
import { dbg } from '../core/debug';
import { elevenReady, fetchElevenVoice, listElevenVoices } from '../providers/tts/eleven';
import { saveTtsData, ttsData, updateTtsSettings } from '../storage/tts-store';

/**
 * ElevenLabs's voices as this plugin keeps them: the account's list read in (목록 불러오기, and once by itself the first
 * time a key is there), one added by its id, one taken off. The voices themselves live at ElevenLabs: nothing is made
 * or deleted there from here.
 */
const KEPT = 500;
/**
 * The account's list read in. What the reader changed here stays theirs: a voice already listed keeps its name, tags
 * and gender (they may have been edited to suit a cast); one a card speaks with stays even if the account no longer
 * lists it (the line then fails with ElevenLabs's own 404, which says so). Returns how many were new.
 */
export async function loadElevenVoiceList(): Promise<number> {
  const data = ttsData(), listed = await listElevenVoices({ eleven: data.settings.eleven }, 1000);
  const have = new Map(data.elevenVoices.map(v => [v.fishId, v])), offered = new Set(listed.map(v => v.fishId));
  const bound = new Set(data.characters.map(c => c.elevenKey).filter(Boolean)), fallback = data.settings.eleven.voice.trim();
  const fresh = listed.filter(v => !have.has(v.fishId));
  // Listed ones first, in the account's order (each as it was kept here, else as the list gives it), then those no
  // longer listed that a card or the default voice still names.
  const gone = data.elevenVoices.filter(v => !offered.has(v.fishId) && (bound.has(v.key) || v.fishId === fallback));
  data.elevenVoices = [...listed.map(v => have.get(v.fishId) ?? v), ...gone].slice(0, KEPT);
  await saveTtsData();
  return fresh.length;
}
/** A voice added by its id (one the list did not bring: a library voice added to the account after it was read). */
export async function addElevenVoice(input: string): Promise<TtsVoice> {
  const voice = await fetchElevenVoice(input, { eleven: ttsData().settings.eleven }), data = ttsData();
  const held = data.elevenVoices.find(v => v.fishId === voice.fishId);
  if (held) return held;
  data.elevenVoices = [...data.elevenVoices, voice];
  await saveTtsData();
  return voice;
}
/** A voice taken off the list here (it stays at ElevenLabs); the cards that spoke with it read with the default voice. */
export async function removeElevenVoice(key: string): Promise<void> {
  const data = ttsData();
  if (!data.elevenVoices.some(v => v.key === key)) return;
  data.elevenVoices = data.elevenVoices.filter(v => v.key !== key);
  for (const c of data.characters) if (c.elevenKey === key) delete c.elevenKey;
  await saveTtsData();
}
let listing: Promise<void> | undefined;
/**
 * Once, by itself, the first time ElevenLabs is the engine with a key: the account's voices, so a cast has voices to
 * be given without a visit to the tab. With no default voice chosen yet, the first one read becomes it (a line with
 * no voice of its own would otherwise fail). A list that cannot be read is not asked for again by itself.
 */
export function ensureElevenVoiceList(): Promise<void> {
  const s = ttsData().settings;
  if (s.engine !== 'elevenlabs' || s.eleven.listed || !elevenReady(s)) return Promise.resolve();
  return listing ??= (async () => {
    await updateTtsSettings({ eleven: { ...ttsData().settings.eleven, listed: true } });
    const added = await loadElevenVoiceList(), first = ttsData().elevenVoices[0];
    if (first && !ttsData().settings.eleven.voice.trim()) await updateTtsSettings({ eleven: { ...ttsData().settings.eleven, voice: first.fishId } });
    dbg('tts.eleven', { message: `목소리 목록 ${added}개를 불러왔습니다.` });
    if (typeof document !== 'undefined') document.dispatchEvent(new Event('omnitts-library'));
  })().catch(error => { dbg('tts.eleven', { message: `목소리 목록: ${String((error as Error)?.message || error)}` }, 'warn'); }).finally(() => { listing = undefined; });
}
