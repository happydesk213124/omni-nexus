import { GLOBAL_SCOPE } from '../core/constants';
import type { ApiResult } from '../core/types';
import { cleanText, unifiedSessionIdForCharacter } from '../core/util/text';
import { characterCreateInstruction, characterCreateMessages, parseCharacterCreateReply } from '../domain/character/create';
import { collectTriggeredLoreKeys, filterLorebookByMessage } from '../domain/lore/assemble';
import { characterImageExtraPriorityNote, isCharacterImageExtraLore, matchCharacterImageSectionTitles } from '../domain/lore/extra';
import { matchCharactersInText } from '../domain/character/roster';
import { resolveLlmRole } from '../domain/llm/roles';
import { authorNoteSystemContent } from '../domain/tagging/session-note';
import { characterPrompt } from './character-prompt';
import { listCharacters, mergeRosterFromTagged, rosterForSession } from './characters';
import { getConfig } from './context';
import { callLlm } from './llm-call';
import { fetchCharacterLorebookEntries } from './lorefilter';
import { chatNoteSessionId, sessionAuthorNoteLlmContent } from './session-author-note';
import { getPrompt } from './settings';

export async function createCharactersFromDescription(body: Record<string, unknown>): Promise<ApiResult> {
  const instruction = characterCreateInstruction(body.instruction);
  const characterId = cleanText(body.character_id, 200);
  const scope = cleanText(body.scope || body.session_id, 200) || unifiedSessionIdForCharacter(characterId);
  if (!scope || (scope !== GLOBAL_SCOPE && !characterId)) throw new Error('캐릭터를 추가할 대상을 선택해 주세요.');
  // The settings picker can target another bot without switching Risu's live chat.
  const lorebook = characterId ? await fetchCharacterLorebookEntries(characterId) : [];
  const [roster, own] = await Promise.all([
    rosterForSession(scope === GLOBAL_SCOPE ? characterId : scope, '', characterId, []),
    listCharacters(scope),
  ]);
  const keys = collectTriggeredLoreKeys(lorebook, instruction);
  const names = matchCharactersInText(instruction, roster).flatMap(row => [row.name || '', ...(row.aliases || [])]);
  for (const entry of lorebook.filter(isCharacterImageExtraLore)) {
    names.push(...matchCharacterImageSectionTitles(entry.content || entry.data, instruction, keys));
  }
  const lore = filterLorebookByMessage(lorebook, instruction, 20, 3000);
  const notes = [
    authorNoteSystemContent("Global Author's Note", await getPrompt('global_author_note')),
    authorNoteSystemContent("Asset Author's Note", await getPrompt('asset_author_note')),
    await sessionAuthorNoteLlmContent(chatNoteSessionId(body.session_id || scope, { character_id: characterId })),
    characterImageExtraPriorityNote(lorebook, [...keys, ...names]),
  ];
  const messages = characterCreateMessages({ instruction, sharedPrompt: await characterPrompt('batch'), notes, roster, lore });
  const raw = await callLlm(resolveLlmRole(getConfig(), 'asset_char'), messages);
  const chars = parseCharacterCreateReply(raw);
  await mergeRosterFromTagged({ sessionId: scope, characterId, tagged: { new_characters: chars, scenes: [] }, shotChars: [] });
  const characters = await listCharacters(scope);
  const previous = new Set(own.map(row => row.id));
  const added = characters.filter(row => !previous.has(row.id));
  return { ok: true, added: added.length, names: added.map(row => row.name), characters, message: added.length ? `${added.length}명 추가됨` : '기존 캐릭터와 연결했습니다.' };
}
