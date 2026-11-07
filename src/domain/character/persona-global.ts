import { compactText } from '../../core/util/text';
import { characterTriggers } from './roster';
import type { CharacterInput } from './identity';

/** A name this much of the persona's, or the other way round, counts as theirs (`미나` for `미나코`, not `김` for `김미나`). */
const NAME_SHARE = 0.5;

/** How well one global character answers to a persona's name: the whole name, then a share of it, then an alias. 0: not at all. */
function personaScore(char: CharacterInput, persona: string): number {
  const name = compactText(char.name), wanted = compactText(persona);
  if (!name || !wanted) return 0;
  if (name === wanted) return 3;
  const [short, long] = name.length < wanted.length ? [name, wanted] : [wanted, name];
  const share = short.length / long.length;
  if (short.length >= 2 && long.includes(short) && share >= NAME_SHARE) return 1 + share;
  return characterTriggers(char).some(trigger => compactText(trigger) === wanted) ? 1 : 0;
}

/** The one global character the selected persona is: the best answer to its name, the first in the list on a tie. */
export function personaGlobalMatch<T extends CharacterInput>(globals: readonly T[], persona: string): T | null {
  let best: T | null = null, bestScore = 0;
  for (const char of globals) {
    const score = personaScore(char, persona);
    if (score > bestScore) { best = char; bestScore = score; }
  }
  return best;
}
