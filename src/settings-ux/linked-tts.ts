import type { TtsCharacter } from '../core/tts-types';
import { ttsNameKey } from '../domain/tts/identity';
import { currentTtsContext } from '../services/tts-context';
import { focusSoundPanel, setSoundPage } from '../sound-ui/page';
import { loadTtsData, ttsData } from '../storage/tts-store';

/**
 * 연결된 TTS, by 삭제 on a roster character's sheet: the TTS character they are (by their name, given name and
 * aliases), whose sheet opens on the TTS 캐릭터 page, as 옴니 뷰어's name tap opens it. The way back is that sheet's
 * 연결된 삽화.
 */
function namesOf(card: HTMLElement): Set<string> {
  const value = (selector: string) => card.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)?.value || '';
  return new Set([value('[data-char-name]'), value('[data-char-given]'), ...[value('[data-char-aliases]'), value('[data-char-given-variants]')].join(',').split(',')]
    .map(name => ttsNameKey(name.trim())).filter(Boolean));
}

/** Theirs among the TTS characters: this bot's before a global one. null with none, or before TTS data is read. */
export function linkedTts(card: HTMLElement | undefined, rosterScope = ''): TtsCharacter | null {
  if (!card) return null;
  let roster: TtsCharacter[];
  try { roster = ttsData().characters; } catch { return null; }
  const names = namesOf(card);
  const theirs = roster.filter(c => !c.role && [c.name, ...c.triggers].some(name => names.has(ttsNameKey(name))));
  return theirs.find(c => c.scope === rosterScope) ?? theirs.find(c => c.scope === 'global') ?? theirs[0] ?? null;
}

/** The TTS data, read once if it was not yet (the settings window may open before anything voiced). */
export async function ttsReady(): Promise<void> {
  try { ttsData(); } catch { await loadTtsData(); }
}

export async function openLinkedTts(card: HTMLElement | undefined): Promise<void> {
  await ttsReady();
  const scope = (await currentTtsContext().catch(() => null))?.rosterScope || '', person = linkedTts(card, scope);
  if (!person) return;
  const open = Reflect.get(globalThis, '__OMNI_OPEN_TTS__');
  if (typeof open !== 'function') throw new Error('TTS 설정을 열 수 없습니다.');
  focusSoundPanel('tts-characters', person.name, { sheet: { id: person.id, name: person.name } });
  setSoundPage('people');
  await open();
}
