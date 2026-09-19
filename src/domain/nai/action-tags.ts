/**
 * Interaction keys → NAI multi-character action tags. Pure — no I/O, no globals.
 *
 * The tagger never learns the `#`-prefixed form (prompts describe only the
 * plain `source` / `target` / `mutual` keys, so the LLM cannot misspell the
 * prefix or leak it into the base prompt). This module is the single place
 * that translates those keys into `source#verb` / `target#verb` /
 * `mutual#verb` caption tags, appended to per-character captions only.
 *
 * Role split (tagger contract): `action` keeps solo acts plus gaze/pose/hands
 * /face/emotion (looking at another person stays there as a fused chunk);
 * verbs where bodies touch go in the three keys instead. A verb that shows up
 * in both is emitted once, in the prefixed form.
 */
import { splitTagTokens } from '../../core/util/text.ts';

/** Per-character tagger output carrying optional interaction keys. */
export interface InteractionKeyInput {
  source?: unknown;
  target?: unknown;
  mutual?: unknown;
  action?: unknown;
}

export interface AppliedInteractionKeys {
  /** `action` with key-covered bare verbs removed (stray inline prefixes kept). */
  action: string;
  /** `source#x, target#y, mutual#z` tags, comma-joined (empty when no keys). */
  tags: string;
}

const PREFIXES = ['source', 'target', 'mutual'] as const;

/** Matches a verb that already carries an interaction prefix (`Source#hug`). */
const PREFIXED_VERB_RE = /^(source|target|mutual)#\s*(.+?)\s*$/i;

/**
 * Normalise one key's raw value into lowercase verbs: comma-split, trimmed,
 * empties and `null`/`none` dropped, duplicates removed, any pre-existing
 * `x#` prefix unfolded back to the bare verb (so `source#hug` typed into the
 * key can never become `source#source#hug`).
 */
function splitKeyVerbs(value: unknown): string[] {
  const verbs: string[] = [];
  const seen = new Set<string>();
  for (const token of splitTagTokens(value)) {
    const t = token.trim().toLowerCase();
    if (!t || t === 'null' || t === 'none') continue;
    const bare = (PREFIXED_VERB_RE.exec(t)?.[2] || t).trim();
    if (!bare || seen.has(bare)) continue;
    seen.add(bare);
    verbs.push(bare);
  }
  return verbs;
}

/**
 * Translate interaction keys to prefixed tags and dedupe against `action`.
 *
 * - Each key's verbs are emitted once even when repeated across keys or when
 *   the mirror side typed the same verb (blind emit: no cross-character
 *   validation here, each caption is built from its own character alone).
 * - A verb already present in `action` as a prefixed tag wins in place: the
 *   key copy is dropped, the inline tag survives untouched.
 * - A verb present in `action` as a BARE token is removed from the returned
 *   action so the final caption carries only the prefixed form.
 */
export function applyInteractionKeys(input: InteractionKeyInput | null | undefined): AppliedInteractionKeys {
  const src = input || {};
  const prefixed = new Set<string>();
  for (const token of splitTagTokens(src.action)) {
    const m = PREFIXED_VERB_RE.exec(token.trim());
    if (m?.[2]) prefixed.add(m[2].trim().toLowerCase());
  }
  const tags: string[] = [];
  const covered = new Set<string>(prefixed);
  for (const prefix of PREFIXES) {
    for (const verb of splitKeyVerbs(src[prefix])) {
      if (covered.has(verb)) continue;
      covered.add(verb);
      tags.push(`${prefix}#${verb}`);
    }
  }
  if (!covered.size) return { action: splitTagTokens(src.action).join(', '), tags: '' };
  const kept: string[] = [];
  for (const token of splitTagTokens(src.action)) {
    const t = token.trim();
    if (!t) continue;
    // Prefixed tags always survive; bare verbs survive only when no key claims them.
    if (PREFIXED_VERB_RE.test(t) || !covered.has(t.toLowerCase())) kept.push(t);
  }
  return { action: kept.join(', '), tags: tags.join(', ') };
}
