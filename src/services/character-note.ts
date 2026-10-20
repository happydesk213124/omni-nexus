import { cleanText } from '../core/util/text';
import type { ApiResult } from '../core/types';
import { readCharacterLoreText, writeCharacterLoreText } from '../storage/character-roster';
import { CHARACTER_NOTE_LORE, characterNoteSystemContent, parseCharacterNote, serializeCharacterNote } from '../domain/tagging/character-note';

/** 캐릭터 작가의 노트: read and saved through the bot's lorebook (one character write per save). */
export async function getCharacterAuthorNote(query: Record<string, unknown>): Promise<ApiResult> {
  const characterId = cleanText(query.character_id, 200);
  if (!characterId) return { ok: false, error: { code: 'bad_request', message: 'character_id required' } };
  const raw = await readCharacterLoreText(characterId, CHARACTER_NOTE_LORE);
  if (raw === null) return { ok: false, error: { code: 'not_found', message: 'Risu 캐릭터를 찾지 못했습니다.' } };
  return { ok: true, character_id: characterId, ...parseCharacterNote(raw) };
}

export async function saveCharacterAuthorNote(body: Record<string, unknown>): Promise<ApiResult> {
  const characterId = cleanText(body.character_id, 200);
  if (!characterId) return { ok: false, error: { code: 'bad_request', message: 'character_id required' } };
  const before = await readCharacterLoreText(characterId, CHARACTER_NOTE_LORE);
  if (before === null) return { ok: false, error: { code: 'not_found', message: 'Risu 캐릭터를 찾지 못했습니다.' } };
  const next = serializeCharacterNote({ prefix: String(body.prefix ?? ''), suffix: String(body.suffix ?? '') });
  // The same text again rewrites nothing.
  if (next !== serializeCharacterNote(parseCharacterNote(before))) await writeCharacterLoreText(characterId, CHARACTER_NOTE_LORE, next);
  return { ok: true, character_id: characterId, ...parseCharacterNote(next) };
}

/** The bot's note for the LLM, or "" when it has none or the bot cannot be read. */
export async function characterNoteLlmContent(characterId: string): Promise<string> {
  if (!characterId) return '';
  try { return characterNoteSystemContent(parseCharacterNote(await readCharacterLoreText(characterId, CHARACTER_NOTE_LORE))); }
  catch { return ''; }
}
