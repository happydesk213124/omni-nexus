import { GLOBAL_SCOPE } from '../core/constants';
import { unifiedSessionIdForCharacter } from '../core/util/text';
import { ensureCostumes } from '../domain/character/costume';
import { characterTriggers } from '../domain/character/roster';
import type { CostumesOf } from '../domain/tts/costume-cue';
import { matchIllustrationSpeaker, resolveTtsSpeaker, ttsNameKey } from '../domain/tts/identity';
import { ttsData } from '../storage/tts-store';
import { listCharacters } from './characters';

/**
 * Costume names (their numbers are what `이름_2` names), for cues that name a costume by its name (costume-cue.ts):
 * each TTS character's, from its illustration character, and each illustration character's by its names, for one
 * who speaks before they are a TTS character. Lines are split as they are read, which cannot wait for storage: the
 * names are read per bot ahead of that, at most every 30 s, and kept.
 */
const FRESH_MS = 30_000;
// A name two illustration characters share says neither: null.
interface Names { tts: Map<string, string[]>; people: Map<string, string[] | null> }
const known = new Map<string, { at: number; names: Names; reading?: Promise<void> }>();

async function readNames(botId: string, rosterScope: string): Promise<Names> {
  const people = [...await listCharacters(GLOBAL_SCOPE).catch(() => []), ...await listCharacters(unifiedSessionIdForCharacter(botId)).catch(() => [])];
  const names: Names = { tts: new Map(), people: new Map() };
  for (const c of ttsData().characters) {
    if (c.role || (c.scope !== 'global' && c.scope !== rosterScope)) continue;
    const person = people.find(p => matchIllustrationSpeaker(p, [c], c.scope) === c);
    if (person) names.tts.set(c.id, ensureCostumes(person).costumes.map(costume => costume.name));
  }
  for (const person of people) {
    const costumes = ensureCostumes(person).costumes.map(costume => costume.name);
    for (const name of new Set(characterTriggers(person).map(ttsNameKey).filter(Boolean))) names.people.set(name, names.people.has(name) ? null : costumes);
  }
  return names;
}

export function refreshCostumeNames(botId: string, rosterScope: string): Promise<void> {
  const now = known.get(botId);
  if (!botId || now?.reading) return now?.reading ?? Promise.resolve();
  if (now && Date.now() - now.at < FRESH_MS) return Promise.resolve();
  const names = now?.names ?? { tts: new Map(), people: new Map() };
  // A failed read keeps the names it had and is not asked again until they would be stale.
  const reading = readNames(botId, rosterScope).then(read => { known.set(botId, { at: Date.now(), names: read }); }, () => { known.set(botId, { at: Date.now(), names }); });
  known.set(botId, { at: now?.at ?? 0, names, reading });
  return reading;
}

/** Who a name is: a TTS character of this bot, else an illustration character not yet one; their costume names as last read. */
export function costumesOf(rosterScope: string, botId: string): CostumesOf {
  const names = known.get(botId)?.names;
  return name => {
    const character = resolveTtsSpeaker(name, ttsData().characters, rosterScope);
    const theirs = character ? names?.tts.get(character.id) : undefined;
    return theirs ?? names?.people.get(ttsNameKey(name)) ?? (character ? [] : undefined);
  };
}
