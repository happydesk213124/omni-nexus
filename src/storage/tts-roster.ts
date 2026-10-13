import { risuHost } from '../core/host';
import type { TtsCharacter } from '../core/tts-types';
import { serializeSessionStorage } from './chat-session-store';

/**
 * A bot's TTS characters live in that bot's own lorebook, next to the
 * illustration roster (`omni.nexus.data.global`): one disabled entry with an
 * empty key, so Risu never injects it and it travels with the bot. Global TTS
 * characters stay in plugin storage.
 */
export const TTS_ROSTER_LORE = 'omni.nexus.tts';
export const ttsBotScope = (characterId: string): string => `bot:${characterId}`;
type Row = Record<string, unknown>;
const object = (v: unknown): Row | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Row : null;
const strings = (v: unknown): boolean => Array.isArray(v) && v.every(s => typeof s === 'string');

export function validTtsCharacter(value: unknown): value is TtsCharacter {
  const c = object(value);
  return !!c && ['id', 'scope', 'name', 'surname', 'givenName', 'voiceKey', 'fishId'].every(k => typeof c[k] === 'string')
    && strings(c.triggers) && strings(c.tags) && strings(c.surnameAliases) && strings(c.givenAliases)
    && ['female', 'male', 'unknown'].includes(String(c.gender)) && typeof c.fixed === 'boolean' && Number.isFinite(c.gain);
}

async function locate(characterId: string): Promise<{ index: number; char: Row } | null> {
  const host = risuHost();
  const read = async (index: number) => {
    const char = object(await host?.getCharacterFromIndex?.(index));
    return char && String(char.chaId || char.id || '') === characterId ? { index, char } : null;
  };
  const current = Number(await host?.getCurrentCharacterIndex?.());
  if (Number.isInteger(current) && current >= 0) { const hit = await read(current); if (hit) return hit; }
  const db = await host?.getDatabase?.(['characters']);
  const list = Array.isArray(db?.characters) ? db.characters : [];
  const index = list.findIndex((value: unknown) => { const c = object(value); return String(c?.chaId || c?.id || '') === characterId; });
  return index >= 0 ? read(index) : null;
}
function entry(char: Row): { entries: unknown[]; at: number; rows: TtsCharacter[] } {
  if (char.globalLore != null && !Array.isArray(char.globalLore)) throw new Error('Invalid character lorebook');
  const entries = [...(char.globalLore as unknown[] || [])];
  const hits = entries.map((value, at) => object(value)?.comment === TTS_ROSTER_LORE ? at : -1).filter(at => at >= 0);
  if (hits.length > 1) throw new Error(`Duplicate ${TTS_ROSTER_LORE}`);
  if (!hits.length) return { entries, at: -1, rows: [] };
  const content = String(object(entries[hits[0]!])?.content ?? '').trim();
  if (!content) return { entries, at: hits[0]!, rows: [] };
  let data: Row | null;
  try { data = object(JSON.parse(content)); } catch { data = null; }
  // Corrupt content is left untouched rather than replaced by an empty list.
  if (data?.version !== 1 || !Array.isArray(data.characters) || !data.characters.every(validTtsCharacter)) {
    throw new Error(`TTS 캐릭터 저장 데이터 오류 · ${String(char.name || '')} · ${TTS_ROSTER_LORE} 내용을 읽을 수 없습니다. 원본은 보존했습니다.`);
  }
  return { entries, at: hits[0]!, rows: data.characters as TtsCharacter[] };
}

/** Null when the bot is not in Risu's list (deleted or not yet loaded). */
export async function readBotTtsCharacters(characterId: string): Promise<TtsCharacter[] | null> {
  const found = await locate(characterId);
  if (!found) return null;
  const scope = ttsBotScope(characterId);
  return entry(found.char).rows.map(row => ({ ...row, scope }));
}

export function writeBotTtsCharacters(characterId: string, rows: readonly TtsCharacter[]): Promise<void> {
  // Same queue as the illustration roster: both rewrite this bot's lorebook.
  return serializeSessionStorage(async () => {
    const host = risuHost();
    if (!host?.setCharacterToIndex) throw new Error('Character lorebook writing unavailable');
    const found = await locate(characterId);
    if (!found) throw new Error('TTS 캐릭터를 저장할 Risu 봇을 찾지 못했습니다.');
    const scope = ttsBotScope(characterId), next = rows.map(row => ({ ...row, scope }));
    const { entries, at, rows: previous } = entry(found.char);
    if (JSON.stringify(previous.map(row => ({ ...row, scope }))) === JSON.stringify(next)) return;
    const value = { ...(at >= 0 ? object(entries[at]) : {}), comment: TTS_ROSTER_LORE, key: '', secondkey: '', alwaysActive: false, selective: false, mode: 'normal', insertorder: 0,
      content: JSON.stringify({ version: 1, characterId, characters: next }) };
    if (at < 0) entries.push(value); else entries[at] = value;
    await host.setCharacterToIndex(found.index, { ...found.char, globalLore: entries });
    const saved = await readBotTtsCharacters(characterId);
    if (JSON.stringify(saved) !== JSON.stringify(next)) throw new Error('TTS 캐릭터 로어북 저장 확인에 실패했습니다.');
  });
}
