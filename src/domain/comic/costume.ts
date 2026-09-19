/**
 * Comic slot costume: catalog name expands stored tags; otherwise the LLM
 * string is used as-is. Empty → roster active (avoid a nude default).
 */
import type { CharacterRecord } from '../../core/types.ts';
import { cleanText } from '../../core/util/text.ts';
import { ensureCostumes, resolveCostumeIndex, resolveCostumeFields } from '../character/costume.ts';
import { formatWearStateForPrompt } from '../character/wear-state.ts';

export type ComicCostumeMode = 'named' | 'raw' | 'fallback';

export interface ComicSlotWear {
  attire: string;
  bottoms: string;
  accessories: string;
  mode: ComicCostumeMode;
  name: string;
}

export function resolveComicSlotCostume(
  stored: Partial<CharacterRecord> | null | undefined,
  pick: unknown,
): ComicSlotWear {
  const { costumes, active_costume } = ensureCostumes(stored || {});
  const idx = resolveCostumeIndex(costumes, pick);
  if (idx >= 0) {
    const c = costumes[idx]!;
    return {
      ...resolveCostumeFields(c, costumes[0]!),
      mode: 'named',
      name: c.name,
    };
  }
  const text = cleanText(pick, 4000);
  if (text) {
    return { attire: text, bottoms: '', accessories: '', mode: 'raw', name: '' };
  }
  const fallback = costumes[active_costume] || costumes[0];
  return {
    ...resolveCostumeFields(fallback!, costumes[0]!),
    mode: 'fallback',
    name: fallback?.name || 'default',
  };
}

/**
 * What this cast member is wearing right now (previous shot / continuity).
 * Catalog stays reference-only; the LLM should keep `costume` = now_wearing
 * unless the prose changes clothes.
 */
export function formatComicNowWearingBlock(opts: {
  costumeName?: unknown;
  wearState?: unknown;
  accessories?: unknown;
} = {}): string {
  const costume = cleanText(opts.costumeName, 200) || 'default';
  const wear = formatWearStateForPrompt(opts.wearState);
  const acc = cleanText(opts.accessories, 400);
  return [
    `now_wearing: ${costume}`,
    `wear_state: ${wear}`,
    `accessories: ${acc ? `on (${acc})` : 'off'}`,
  ].join('\n');
}

/** Full catalog for the comic LLM (reference only — not pasted into NAI). */
export function formatComicCostumeCatalog(
  stored: Partial<CharacterRecord> | null | undefined,
): string {
  const { costumes } = ensureCostumes(stored || {});
  return costumes
    .map((c, i) => {
      const clothes = [c.attire, c.accessories].filter(Boolean).join(', ');
      const note = cleanText(c.note, 80);
      return `${c.name}[${i}]${note ? ` (${note})` : ''}: ${clothes || '(empty)'}`;
    })
    .join('\n');
}
