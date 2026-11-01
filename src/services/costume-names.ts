import { GLOBAL_SCOPE } from '../core/constants';
import { unifiedSessionIdForCharacter } from '../core/util/text';
import { ensureCostumes } from '../domain/character/costume';
import type { CostumesOf } from '../domain/tts/costume-cue';
import { matchIllustrationSpeaker, resolveTtsSpeaker } from '../domain/tts/identity';
import { ttsData } from '../storage/tts-store';
import { listCharacters } from './characters';

/**
 * Each TTS character's costume names, from its illustration character (their numbers are what `이름_2` names), for
 * cues that name a costume by its name (costume-cue.ts). Lines are split as they are read, which cannot wait for
 * storage: the names are read per bot ahead of that, at most every 30 s, and kept.
 */
const FRESH_MS = 30_000;
const known = new Map<string, { at: number; names: Map<string, string[]>; reading?: Promise<void> }>();

async function readNames(botId: string, rosterScope: string): Promise<Map<string, string[]>> {
  const people = [...await listCharacters(GLOBAL_SCOPE).catch(() => []), ...await listCharacters(unifiedSessionIdForCharacter(botId)).catch(() => [])];
  const names = new Map<string, string[]>();
  for (const c of ttsData().characters) {
    if (c.role || (c.scope !== 'global' && c.scope !== rosterScope)) continue;
    const person = people.find(p => matchIllustrationSpeaker(p, [c], c.scope) === c);
    if (person) names.set(c.id, ensureCostumes(person).costumes.map(costume => costume.name));
  }
  return names;
}

export function refreshCostumeNames(botId: string, rosterScope: string): Promise<void> {
  const now = known.get(botId);
  if (!botId || now?.reading) return now?.reading ?? Promise.resolve();
  if (now && Date.now() - now.at < FRESH_MS) return Promise.resolve();
  const names = now?.names ?? new Map<string, string[]>();
  // A failed read keeps the names it had and is not asked again until they would be stale.
  const reading = readNames(botId, rosterScope).then(read => { known.set(botId, { at: Date.now(), names: read }); }, () => { known.set(botId, { at: Date.now(), names }); });
  known.set(botId, { at: now?.at ?? 0, names, reading });
  return reading;
}

/** Who a name is among this bot's TTS characters, and their costume names as last read. */
export function costumesOf(rosterScope: string, botId: string): CostumesOf {
  const names = known.get(botId)?.names;
  return name => {
    const character = resolveTtsSpeaker(name, ttsData().characters, rosterScope);
    return character ? names?.get(character.id) ?? [] : undefined;
  };
}
