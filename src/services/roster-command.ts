import type { ApiResult, CharacterRecord } from '../core/types';
import { cleanText, stripCbs } from '../core/util/text';
import { parseJsonLoose } from '../core/util/object';
import { applyCharacterCommandDeltas, characterCommandSnapshot, formatCommandDeltaLog } from '../domain/character/command-edit';
import { characterTriggers } from '../domain/character/roster';
import { parseRosterCommandReply, rosterAddsInstruction, rosterCommandMessages, ROSTER_COMMAND_LIMIT } from '../domain/character/roster-command';
import { characterLoreReference } from '../domain/lore/character-reference';
import { authorNoteSystemContent } from '../domain/tagging/session-note';
import { mutateCharacterRoster } from '../storage/character-roster';
import { characterLoreFor } from './char-command';
import { createCharactersFromDescription } from './character-create';
import { listCharacters, upsertCharacter } from './characters';
import { getConfig } from './context';
import { callLlm } from './llm-call';
import { chatNoteSessionId, sessionAuthorNoteLlmContent } from './session-author-note';
import { getPrompt } from './settings';

/**
 * 「LLM한테 시키기」 over the roster: a plan first, shown to the user, then applied.
 * The plan carries each edited character in full, so applying it never asks the
 * model again for edits; adds go through character creation at apply time.
 */
interface Target { scope: string; characterId: string; sessionId: string }
function target(body: Record<string, unknown>): Target {
  const scope = cleanText(body.scope, 200);
  if (!scope) throw new Error('캐릭터 목록을 먼저 골라 주세요.');
  return { scope, characterId: cleanText(body.character_id, 200), sessionId: cleanText(body.session_id, 200) };
}
const ids = (value: unknown): string[] => (Array.isArray(value) ? value : []).map(id => cleanText(id, 80)).filter(Boolean);

export async function planRosterCommand(body: Record<string, unknown>): Promise<ApiResult> {
  const { scope, characterId, sessionId } = target(body);
  const instruction = cleanText(body.instruction, ROSTER_COMMAND_LIMIT);
  if (!instruction) throw new Error('명령을 적어 주세요.');
  const rows = await listCharacters(scope);
  const picked = new Set(ids(body.ids));
  // Picked characters only, or the whole list when none were picked.
  const targets = picked.size ? rows.filter(row => picked.has(row.id)) : rows;
  const reference = body.xnai === true || body.lore === true
    ? characterLoreReference(await characterLoreFor(characterId || scope), targets.flatMap(row => characterTriggers(row)), { xnai: body.xnai === true, lore: body.lore === true })
    : {};
  const notes = [
    authorNoteSystemContent("Global Author's Note", await getPrompt('global_author_note')),
    authorNoteSystemContent("Asset Author's Note", await getPrompt('asset_author_note')),
    await sessionAuthorNoteLlmContent(chatNoteSessionId(sessionId || scope, { character_id: characterId })),
  ];
  const messages = rosterCommandMessages({
    instruction,
    editRules: stripCbs(await getPrompt('command_char_edit')),
    characters: targets.map(row => ({ id: row.id, ...characterCommandSnapshot(row) })),
    notes,
    reference: reference as Record<string, unknown>,
  });
  const reply = parseRosterCommandReply(parseJsonLoose(await callLlm(getConfig().llm, messages.map(message => ({ ...message })))), new Set(targets.map(row => row.id)));
  const byId = new Map(targets.map(row => [row.id, row]));
  const plan = {
    edits: reply.edits.map(edit => ({
      id: edit.id,
      name: byId.get(edit.id)!.name,
      log: formatCommandDeltaLog(edit.deltas),
      character: applyCharacterCommandDeltas(byId.get(edit.id)!, edit.deltas),
    })),
    deletes: reply.deletes.map(id => ({ id, name: byId.get(id)!.name })),
    adds: reply.adds,
  };
  return { ok: true, plan, empty: !plan.edits.length && !plan.deletes.length && !plan.adds.length, targets: targets.length };
}

export async function applyRosterCommand(body: Record<string, unknown>): Promise<ApiResult> {
  const { scope, characterId, sessionId } = target(body);
  const plan = body.plan && typeof body.plan === 'object' ? body.plan as Record<string, unknown> : {};
  const known = new Set((await listCharacters(scope)).map(row => row.id));
  let edited = 0;
  for (const raw of Array.isArray(plan.edits) ? plan.edits : []) {
    const edit = raw as { id?: unknown; character?: unknown };
    const id = cleanText(edit.id, 80);
    if (!known.has(id) || !edit.character || typeof edit.character !== 'object') continue;
    if (await upsertCharacter(scope, { ...(edit.character as Partial<CharacterRecord>), id })) edited++;
  }
  const deleting = new Set((Array.isArray(plan.deletes) ? plan.deletes : []).map(row => cleanText((row as { id?: unknown })?.id, 80)).filter(id => known.has(id)));
  if (deleting.size) await mutateCharacterRoster(scope, rows => rows.filter(row => !deleting.has(row.id)));
  const adds = (Array.isArray(plan.adds) ? plan.adds : []).filter(add => add && typeof add === 'object' && cleanText((add as { name?: unknown }).name, 200)) as Array<{ name: string; description: string }>;
  let added = 0;
  if (adds.length) {
    const created = await createCharactersFromDescription({ character_id: characterId, session_id: sessionId || scope, scope, instruction: rosterAddsInstruction(adds) });
    added = Number((created as { added?: unknown }).added) || 0;
  }
  return { ok: true, edited, deleted: deleting.size, added, characters: await listCharacters(scope) };
}
