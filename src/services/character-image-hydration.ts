import type { CharacterRecord } from '../core/types';
import { beginCharacterImage, publishCharacterImage, type CharacterImageKind } from '../core/character-ui-events';
import { workPool } from '../core/util/work-pool';
import { readCharacterRoster } from '../storage/character-roster';
import { sanitizeHash } from '../domain/character/char-ref-store';
import { getCharRefAssetPreviewUrl } from './char-ref-module';
import { setCharRefPreviewUrl, setExamplePreviewUrl } from './context';

export type CharacterPreviewTarget = { scope: string; id: string; hash: string; kind: CharacterImageKind };
const rosterReads = new Map<string, Promise<CharacterRecord[]>>();
const warming = new Map<string, Promise<void>>();
const pools = { ref: workPool(4), example: workPool(4) };

function currentRoster(scope: string): Promise<CharacterRecord[]> {
  let read = rosterReads.get(scope);
  if (!read) {
    // Only share in-flight reads. The next wave sees edits made in the host.
    read = readCharacterRoster(scope).finally(() => { rosterReads.delete(scope); });
    rosterReads.set(scope, read);
  }
  return read;
}

export async function warmCharacterImagePreviews(targets: CharacterPreviewTarget[], display?: {
  load: (hash: string) => Promise<string>;
  ready: (target: CharacterPreviewTarget, url: string) => void;
}): Promise<void> {
  await Promise.all(targets.map(target => {
    const key = JSON.stringify([target.scope, target.id, target.kind, target.hash]);
    const pending = display ? undefined : warming.get(key);
    if (pending) return pending;
    const current = beginCharacterImage(target.scope, target.id, target.kind, false);
    const warm = pools[target.kind](async () => {
      if (!current()) return;
      const url = await (display ? display.load(target.hash) : getCharRefAssetPreviewUrl(target.hash));
      if (!url || !current()) return;
      const row = (await currentRoster(target.scope)).find(row => row.id === target.id);
      const hash = sanitizeHash(target.kind === 'ref' ? row?.ref_hash : row?.example_hash);
      // Validate before caching too; a deleted/replaced image must not reappear
      // on a later render through the identity preview cache.
      if (hash !== target.hash || !current()) return;
      // Display-owned blob URLs must never enter API/base64 caches or outlive their tab.
      if (display) { display.ready(target, url); return; }
      (target.kind === 'ref' ? setCharRefPreviewUrl : setExamplePreviewUrl)(target.scope, target.id, url);
      publishCharacterImage({ ...target, url, configured: true });
    }).catch(() => {}).finally(() => { if (!display) warming.delete(key); });
    if (!display) warming.set(key, warm);
    return warm;
  }));
}
