import type { WearState } from './wear-state.ts';

/** What of the viewpoint person a pov shot may show. The tagger names them; nothing else of theirs is sent. */
export type PovPart = 'attire' | 'bottoms' | 'accessories' | 'penis';
const PARTS: readonly PovPart[] = ['attire', 'bottoms', 'accessories', 'penis'];

/**
 * A shot character's `pov`: a list of parts, or `none` when none of them shows. null: not the viewpoint person.
 * An empty string is an unset field, never "nothing shows": a model that leaves keys blank must not lose someone's looks.
 */
export function povParts(value: unknown): Set<PovPart> | null {
  if (value === true) return new Set();
  const words = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const tokens = words.map(word => String(word).trim().toLowerCase()).filter(Boolean);
  if (!tokens.length) return null;
  return new Set(PARTS.filter(part => tokens.includes(part)));
}

/** POV switched off: a `pov` a model sent anyway must change nothing. */
export function dropPov(characters: Array<{ pov?: unknown }> | null | undefined): void {
  for (const character of characters || []) delete character.pov;
}

/** Worn clothes of the viewpoint person, less what their state has off. `nude` keeps them, as it does for anyone. */
export function povWorn(part: 'attire' | 'bottoms', tags: string, state: WearState): string {
  if (state === 'completely') return '';
  if (part === 'attire' && state === 'topless') return '';
  if (part === 'bottoms' && state === 'bottomless') return '';
  return tags;
}
