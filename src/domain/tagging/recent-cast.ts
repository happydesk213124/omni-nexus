import { cleanText, compactText, normalizeAlias } from '../../core/util/text';
import type { CharacterInput } from '../character/identity';
import { characterTriggers } from '../character/roster';

type Cast = CharacterInput & { id?: unknown };
const idOf = (char: Cast): string => cleanText(char.id || char.name, 200);

/** Where a character is first named in one text, or -1. Two-letter triggers at least, like the message matcher. */
function firstMention(char: Cast, hay: string, hayCompact: string): number {
  let best = -1;
  for (const trigger of characterTriggers(char)) {
    const compact = compactText(trigger);
    if (compact.length < 2) continue;
    const at = hay.indexOf(normalizeAlias(trigger));
    // The compact form has no spaces, so its position only orders names within one text.
    const where = at >= 0 ? at : hayCompact.indexOf(compact);
    if (where >= 0 && (best < 0 || where < best)) best = where;
  }
  return best;
}

/** Ids of the people named in these texts: the newest text first, and in reading order within one. */
export function castInTexts(texts: readonly string[], roster: readonly Cast[]): string[] {
  const out: string[] = [];
  for (const text of texts) {
    const hay = cleanText(text).toLowerCase(), hayCompact = compactText(text);
    if (!hay) continue;
    roster
      .map(char => ({ id: idOf(char), at: firstMention(char, hay, hayCompact) }))
      .filter(row => row.id && row.at >= 0 && !out.includes(row.id))
      .sort((a, b) => a.at - b.at)
      .forEach(row => out.push(row.id));
  }
  return out;
}

/**
 * The chat's running order: who was just named goes to the front, the rest keep
 * the order this chat remembered, and anyone never named follows in roster
 * order. Only the last couple of replies are read each turn; the remembered
 * order carries everything older.
 */
export function orderCast<T extends Cast>(roster: readonly T[], named: readonly string[], remembered: readonly string[]): T[] {
  const byId = new Map(roster.map(char => [idOf(char), char] as const));
  const ids = [...new Set([...named, ...remembered, ...byId.keys()])].filter(id => byId.has(id));
  return ids.map(id => byId.get(id)!);
}
