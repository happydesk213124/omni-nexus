/** NAI5 or NAI4.5 in a style preset tile's top-right corner. */
export function presetModelBadge(family: unknown): HTMLElement {
  const badge = document.createElement('span');
  const v5 = family === 'v5';
  badge.dataset.presetModel = v5 ? 'v5' : 'v4';
  badge.textContent = v5 ? 'NAI5' : 'NAI4.5';
  return badge;
}

export type LookFilter = 'without' | 'with' | null;

/**
 * "참고컷 없는" (or 있는) among a tile search's comma terms is a filter on the
 * reference shot, not text to find: the tiles without one (or with one) remain.
 */
export function splitLookFilter(terms: string[]): { look: LookFilter; terms: string[] } {
  let look: LookFilter = null;
  const rest: string[] = [];
  for (const term of terms) {
    const match = /^참고컷\s*(없|있)/.exec(term.trim());
    if (match) look = match[1] === '없' ? 'without' : 'with';
    else rest.push(term);
  }
  return { look, terms: rest };
}

export const lookFilterAllows = (look: LookFilter, has: boolean): boolean => look === null || (look === 'with') === has;
