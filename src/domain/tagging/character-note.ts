import { cleanText } from '../../core/util/text.ts';

/**
 * 캐릭터 작가의 노트: a note for every session with one bot, kept in that bot's
 * lorebook beside the roster, as a disabled entry Risu never injects. Text only:
 * outfits belong to each session.
 */
export const CHARACTER_NOTE_LORE = 'omni.nexus.note.character';
const LIMIT = 8000;

/** preset_id: the shared note preset last picked on the 캐릭터 tab, shown again next time. */
export interface CharacterNote { prefix: string; suffix: string; preset_id: string }

export function parseCharacterNote(raw: unknown): CharacterNote {
  const text = String(raw ?? '').trim();
  if (!text) return { prefix: '', suffix: '', preset_id: '' };
  try {
    const row = JSON.parse(text) as Record<string, unknown>;
    if (row && typeof row === 'object' && !Array.isArray(row)) return { prefix: cleanText(row.prefix, LIMIT), suffix: cleanText(row.suffix, LIMIT), preset_id: cleanText(row.preset_id, 120) };
  } catch { /* typed into the lorebook by hand: the whole text leads */ }
  return { prefix: cleanText(text, LIMIT), suffix: '', preset_id: '' };
}

/** Empty when there is nothing to say, so the entry can go. */
export function serializeCharacterNote(note: Partial<CharacterNote>): string {
  const prefix = cleanText(note.prefix, LIMIT), suffix = cleanText(note.suffix, LIMIT), presetId = cleanText(note.preset_id, 120);
  return prefix || suffix ? JSON.stringify({ version: 1, prefix, suffix, ...(presetId ? { preset_id: presetId } : {}) }) : '';
}

/** Before the session's own note, which wins where the two disagree. */
export function characterNoteSystemContent(note: Pick<CharacterNote, 'prefix' | 'suffix'>): string {
  if (!note.prefix && !note.suffix) return '';
  return [
    '# 캐릭터 작가의 노트',
    [note.prefix ? `## 선행\n${note.prefix}` : '', note.suffix ? `## 후행\n${note.suffix}` : ''].filter(Boolean).join('\n\n'),
    '> These instructions apply to every session with this bot. A session\'s own instructions below take precedence.',
  ].join('\n');
}
