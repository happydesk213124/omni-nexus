/**
 * Pure helpers for deciding whether a card reroll should rebuild `main_prompt`
 * against the active style preset (keeping scene tags) or keep a hand-edited
 * prompt verbatim.
 */

import { cleanText } from '../../core/util/text.ts';

export interface RerollSetupDecision {
  /** Scene tags to pin when rebuilding. Empty when the stored main is kept. */
  lockedSetup: string;
  /** True → reassemble main/neg with the current preset; false → keep main. */
  rebuildMain: boolean;
}

/**
 * Strip known non-scene chunks from a full assembled main prompt to recover
 * the scene-only portion after a prior reroll polluted `meta.setup`.
 */
export function recoverSceneFromMain(
  main: string,
  person: string,
  stylePositives: readonly string[],
  qualitySuffixes: readonly string[],
): string {
  let rest = cleanText(main);
  if (!rest) return '';

  for (const q of qualitySuffixes) {
    const chunk = cleanText(q);
    if (!chunk) continue;
    if (rest.endsWith(chunk)) {
      rest = rest.slice(0, rest.length - chunk.length).replace(/[,\s]+$/g, '');
    } else {
      const idx = rest.lastIndexOf(chunk);
      if (idx >= 0) {
        rest = `${rest.slice(0, idx)}${rest.slice(idx + chunk.length)}`
          .replace(/,\s*,/g, ',')
          .replace(/^[,\s]+|[,\s]+$/g, '');
      }
    }
  }

  const personChunk = cleanText(person);
  if (personChunk) {
    if (rest.startsWith(personChunk)) {
      rest = rest.slice(personChunk.length).replace(/^[,\s]+/g, '');
    } else {
      const idx = rest.indexOf(personChunk);
      if (idx >= 0) {
        rest = `${rest.slice(0, idx)}${rest.slice(idx + personChunk.length)}`
          .replace(/,\s*,/g, ',')
          .replace(/^[,\s]+|[,\s]+$/g, '');
      }
    }
  }

  // Longer style strings first so a subset tag does not leave orphans.
  const styles = [...stylePositives]
    .map((s) => cleanText(s))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const style of styles) {
    const idx = rest.indexOf(style);
    if (idx < 0) continue;
    rest = `${rest.slice(0, idx)}${rest.slice(idx + style.length)}`
      .replace(/,\s*,/g, ',')
      .replace(/^[,\s]+|[,\s]+$/g, '');
  }

  return cleanText(rest);
}

/**
 * Decide how to treat `meta.setup` vs `main_prompt` on a plain (no-override) reroll.
 *
 * - Scene-only setup (≠ main) → rebuild with that setup locked.
 * - setup === main (hand-edit mirror, or prior pollution) → try to recover scene;
 *   if recovery yields a shorter nonempty scene, rebuild; otherwise keep main.
 */
export function resolveRerollLockedSetup(args: {
  setup: unknown;
  main: unknown;
  person?: unknown;
  stylePositives?: readonly string[];
  qualitySuffixes?: readonly string[];
}): RerollSetupDecision {
  const setup = cleanText(args.setup);
  const main = cleanText(args.main);
  if (!main) {
    return { lockedSetup: setup, rebuildMain: true };
  }
  if (setup && setup !== main) {
    return { lockedSetup: setup, rebuildMain: true };
  }

  const person = cleanText(args.person);
  if (person || (args.stylePositives && args.stylePositives.length)) {
    const recovered = recoverSceneFromMain(
      main,
      person,
      args.stylePositives || [],
      args.qualitySuffixes || [],
    );
    if (recovered && recovered !== main) {
      return { lockedSetup: recovered, rebuildMain: true };
    }
  }

  return { lockedSetup: '', rebuildMain: false };
}

/** Collect positive style strings from card.presets / custom_pos for recovery. */
export function collectStylePositives(card: Record<string, unknown> | null | undefined): string[] {
  if (!card || typeof card !== 'object') return [];
  const out: string[] = [];
  const custom = cleanText(card.custom_pos);
  if (custom) out.push(custom);
  const presets = Array.isArray(card.presets) ? card.presets : [];
  for (const item of presets) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const pos = cleanText(p.positive || p.pos);
    if (pos) out.push(pos);
  }
  return out;
}
