import { GLOBAL_SCOPE } from '../core/constants';
import { unifiedSessionIdForCharacter } from '../core/util/text';
import { ensureCostumes } from '../domain/character/costume';
import { nudeForbidden } from '../domain/character/tags';
import { underageRules } from '../domain/character/underage';
import { getConfig } from './context';
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
// nude: the TTS characters 감정 에셋's 기본 nude and 천박모드 may draw nude, read with the names (nudeForbidden).
interface Names { tts: Map<string, string[]>; people: Map<string, string[] | null>; nude: Set<string> }
const known = new Map<string, { at: number; names: Names; reading?: Promise<void> }>();
let reads = 0;
const latest = new Map<string, number>();

async function readNames(botId: string, rosterScope: string): Promise<Names> {
  const people = [...await listCharacters(GLOBAL_SCOPE).catch(() => []), ...await listCharacters(unifiedSessionIdForCharacter(botId)).catch(() => [])];
  const names: Names = { tts: new Map(), people: new Map(), nude: new Set() };
  const rules = underageRules(getConfig().card);
  for (const c of ttsData().characters) {
    if (c.role || (c.scope !== 'global' && c.scope !== rosterScope)) continue;
    const person = people.find(p => matchIllustrationSpeaker(p, [c], c.scope) === c);
    if (person) names.tts.set(c.id, ensureCostumes(person).costumes.map(costume => costume.name));
    // ╔══════════════════════════════════════════════════════════════════════════╗
    // ║ [여기부터] 절대 빼거나 약하게 바꾸지 말 것: 나이 제한에 걸리는 캐릭터는 nude 그림으로 보여 주지 않는다 (underage.ts).
    // ╚══════════════════════════════════════════════════════════════════════════╝
    if (person && !nudeForbidden(person, rules)) names.nude.add(c.id);
    // ╔══════════════════════════════════════════════════════════════════════════╗
    // ║ [여기까지] 위 코드는 절대 빼거나 약하게 바꾸지 말 것.
    // ╚══════════════════════════════════════════════════════════════════════════╝
  }
  for (const person of people) {
    const costumes = ensureCostumes(person).costumes.map(costume => costume.name);
    for (const name of new Set(characterTriggers(person).map(ttsNameKey).filter(Boolean))) names.people.set(name, names.people.has(name) ? null : costumes);
  }
  return names;
}

/** `now`: the roster just changed (a cast block registered a costume): read at once, even mid-read. */
export function refreshCostumeNames(botId: string, rosterScope: string, now = false): Promise<void> {
  const held = known.get(botId);
  if (!botId) return Promise.resolve();
  if (held?.reading && !now) return held.reading;
  if (held && !now && Date.now() - held.at < FRESH_MS) return Promise.resolve();
  const names = held?.names ?? { tts: new Map(), people: new Map(), nude: new Set<string>() }, mine = ++reads;
  latest.set(botId, mine);
  const keep = (read: Names) => { if (latest.get(botId) === mine) known.set(botId, { at: Date.now(), names: read }); };
  // A failed read keeps the names it had and is not asked again until they would be stale.
  const reading = readNames(botId, rosterScope).then(keep, () => keep(names));
  known.set(botId, { at: held?.at ?? 0, names, reading });
  return reading;
}

/**
 * Whether this TTS character may be shown nude (기본 nude, 천박모드), as last read: not until their illustration character
 * has been read, and never one 나이 제한 counts as under it. A face is drawn only after its own fresh check (emotion-assets.ts).
 */
export function nudeAllowedFor(botId: string, ttsId: string): boolean {
  return !!known.get(botId)?.names.nude.has(ttsId);
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
