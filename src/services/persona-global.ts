import { dbg } from '../core/debug';
import { hostHas, risuHost } from '../core/host';
import type { CharacterRecord } from '../core/types';
import { personaGlobalMatch } from '../domain/character/persona-global';
import { activeRoster } from '../domain/character/roster';
import { pickPersonaName, pickSelectedPersona } from '../domain/tagging/char-user-info';
import { getConfig } from './context';

async function selectedPersonaName(): Promise<string> {
  if (!hostHas('getDatabase')) return '';
  try {
    return pickPersonaName(pickSelectedPersona(await risuHost()!.getDatabase!(['personas', 'selectedPersona'])));
  } catch (error) {
    dbg('persona.global', { message: String(error) }, 'warn');
    return '';
  }
}

/** The global character the persona selected in Risu is. 비활성화 stays the user's word: a switched-off row is not it. */
export async function personaGlobalRow(globals: CharacterRecord[]): Promise<CharacterRecord | null> {
  return personaGlobalMatch(activeRoster(globals), await selectedPersonaName());
}

/**
 * 「전역 캐릭터는 현재 페르소나만」: the global list as tagging sees it. `persona_active` rides on the copy, never saved
 * (the roster keeps a fixed set of fields): it tells the taggers to offer this one even where the text only says you or I.
 */
export async function personaGlobals(globals: CharacterRecord[]): Promise<CharacterRecord[]> {
  if (getConfig().card?.user_info_persona_only !== true) return globals;
  const row = await personaGlobalRow(globals);
  return row ? [{ ...row, persona_active: true }] : [];
}
