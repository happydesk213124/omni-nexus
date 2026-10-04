import type { CharacterRecord, LoreEntry } from '../../core/types';
import { parseJsonLoose } from '../../core/util/object';
import { cleanText, parseAliasList } from '../../core/util/text';
import { normalizeCharacterRecord } from './roster';
import { characterHasAppearance } from './tags';

export const CHARACTER_CREATE_TEXT_LIMIT = 20_000;

export function characterCreateInstruction(value: unknown): string {
  const text = cleanText(value, CHARACTER_CREATE_TEXT_LIMIT + 1);
  if (!text) throw new Error('추가할 캐릭터의 이름과 외형을 적어 주세요.');
  if (text.length > CHARACTER_CREATE_TEXT_LIMIT) throw new Error('캐릭터 설명은 20,000자 이내로 적어 주세요.');
  return text;
}

export function characterCreateMessages(input: {
  instruction: string;
  sharedPrompt: string;
  notes: readonly string[];
  roster: readonly CharacterRecord[];
  lore: readonly LoreEntry[];
}): Array<{ role: 'system' | 'user'; content: string }> {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [{
    role: 'system',
    content: `${input.sharedPrompt}\n\nCreate all characters explicitly requested in the user's description, together in one new_characters array. `
      + 'References may explain a requested person, but do not add other people merely mentioned in references. '
      + 'For newly created characters, automatically complete unspecified visual design fields (gender, hair, eyes, stable appearance, upper/lower clothing and accessories). '
      + 'Use matching lorebook/roster references first; if they contain no such information, choose a restrained coherent design compatible with the description. Preserve explicit user-provided design details. '
      + 'In this freeform creation task, age and height may also be chosen coherently when absent from both the description and matching references; this overrides the shared rule to leave those optional fields empty for new characters only. '
      + 'Never invent source-character identities/original tags or unsupported anatomy. '
      + 'Keep the supplied name in name. Include its Korean spelling and a recognizable English spelling/transliteration in aliases where applicable. '
      + 'For Korean names, fill given_name and given_name_variants (a string array), surname and surname_variants (a string array) only as supported; never invent a surname. '
      + 'Never use placeholder identities such as New character or single-letter aliases. '
      + 'Use existing roster names/aliases as references; preserve the requested full name and requested look in the returned record even when the person is already listed. The application preserves existing names, aliases and default looks and stores the returned design as an additional costume. Do not generate person-name prefixes in costume notes; the application adds them. '
      + 'Return only {"new_characters":[...]} with the shared character fields, no scenes.',
  }];
  for (const note of input.notes) if (note.trim()) messages.push({ role: 'system', content: note });
  const roster = input.roster.map(row => ({
    name: row.name, aliases: row.aliases, original: row.original,
    gender: row.gender, surname: row.surname, given_name: row.given_name,
    surname_variants: row.surname_variants, given_name_variants: row.given_name_variants,
    appearance: row.appearance, hair_color: row.hair_color, hair_style: row.hair_style,
    eye_color: row.eye_color, height: row.height, age: row.age,
    attire: row.attire, bottoms: row.bottoms, accessories: row.accessories, costumes: row.costumes,
  }));
  messages.push({ role: 'user', content: '# Reference: current character roster\n' + JSON.stringify(roster) });
  if (input.lore.length) {
    messages.push({ role: 'user', content: '# Reference: trigger-matched lorebook\n' + JSON.stringify(input.lore) });
  }
  messages.push({ role: 'user', content: '# Characters to add\n' + input.instruction });
  return messages;
}

/** Validate the entire reply before any write so a malformed batch cannot partly register. */
export function parseCharacterCreateReply(raw: unknown): Partial<CharacterRecord>[] {
  const parsed: unknown = parseJsonLoose(String(raw ?? ''));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('LLM 응답에 new_characters 배열이 없습니다.');
  const list = (parsed as Record<string, unknown>).new_characters;
  if (!Array.isArray(list) || !list.length) throw new Error('LLM 응답에 추가할 new_characters가 없습니다.');
  return list.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('캐릭터 응답 형식이 올바르지 않습니다.');
    const record = value as Record<string, unknown>;
    if (typeof record.name !== 'string' || !record.name.trim()) throw new Error('이름이 없는 캐릭터가 반환됐습니다.');
    const row = normalizeCharacterRecord(record);
    if (!row || !characterHasAppearance(row)) throw new Error(`${record.name}: 외형 정보가 없는 캐릭터가 반환됐습니다.`);
    return { ...row, aliases: parseAliasList([row.name, ...row.aliases]) };
  });
}
