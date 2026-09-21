type Pair = { card: HTMLElement; tile: HTMLElement };
let byCard = new WeakMap<HTMLElement, Pair>();
let byTile = new WeakMap<HTMLElement, Pair>();
const byIdentity = new Map<string, Set<Pair>>();
const key = (scope: string, id: string) => JSON.stringify([scope === 'global' ? '__global__' : scope, id]);

/** The form is replaced on a tab/bot render; discard its element references. */
export function resetCharacterPreviewIndex(): void {
  byCard = new WeakMap(); byTile = new WeakMap(); byIdentity.clear();
}

export function registerCharacterPreview(card: HTMLElement, tile: HTMLElement): void {
  unregisterCharacterPreview(card);
  const pair = { card, tile };
  byCard.set(card, pair); byTile.set(tile, pair);
  const id = key(card.dataset.charRefScope || '', card.dataset.charId || '');
  const pairs = byIdentity.get(id) || new Set<Pair>();
  pairs.add(pair); byIdentity.set(id, pairs);
}

export function unregisterCharacterPreview(card: HTMLElement): void {
  const pair=byCard.get(card);
  if(!pair)return;
  const id=key(card.dataset.charRefScope || '',card.dataset.charId || '');
  const pairs=byIdentity.get(id);pairs?.delete(pair);
  if(!pairs?.size)byIdentity.delete(id);
  byCard.delete(card);byTile.delete(pair.tile);
}

export function characterPreviewPairs(scope: string, id: string): Pair[] {
  return [...(byIdentity.get(key(scope, id)) || [])].filter(p => p.card.isConnected && p.tile.isConnected);
}
export function characterCardForTile(tile: HTMLElement): HTMLElement | undefined { return byTile.get(tile)?.card; }
export function characterTileForCard(card: HTMLElement): HTMLElement | undefined { return byCard.get(card)?.tile; }
