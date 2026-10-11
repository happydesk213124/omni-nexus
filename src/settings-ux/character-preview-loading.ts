import type { CharacterRecord } from '../core/types';
import { sniffImageMime } from '../core/util/bytes';
import { getCharRefAssetBytes } from '../services/char-ref-module';
import { warmCharacterImagePreviews, type CharacterPreviewTarget } from '../services/character-image-hydration';
import { RailImageCache } from '../storage/rail-image-cache';
import { applyImage } from './reference-progress';

const bytes = new RailImageCache();
let release: (() => void) | undefined;
export function releaseCharacterPreviews(): void { release?.(); release = undefined; }

/** Queue the whole roster; bounded workers load it without waiting for scroll. */
export function loadCharacterPreviews(root: HTMLElement): {
  request: (card: HTMLElement) => void;
} {
  releaseCharacterPreviews();
  let active = true, frame = 0;
  const queued = new Set<HTMLElement>();
  const requested = new Set<string>();
  const urls = new Map<string, string>();
  const load = async (hash: string): Promise<string> => {
    if (!active) return '';
    const hit = urls.get(hash);
    if (hit) return hit;
    const image = await bytes.read({readImage: async () => {
      const raw = await getCharRefAssetBytes(hash);
      return raw ? new Blob([raw], {type: sniffImageMime(raw)}) : null;
    }}, hash);
    if (!active || !image) return '';
    const url = urls.get(hash) || (typeof image === 'string' ? image : URL.createObjectURL(image));
    urls.set(hash, url);
    return url;
  };
  const flush = () => {
    frame = 0;
    if (!active || !root.isConnected) return;
    const bridge = globalThis as typeof globalThis & {
      __OMNI_CHARACTER_ROWS__?: () => {session: CharacterRecord[]; global: CharacterRecord[]};
    };
    const rows = bridge.__OMNI_CHARACTER_ROWS__?.();
    const targets: CharacterPreviewTarget[] = [];
    for (const card of queued) {
      const id = card.dataset.charId || '', scope = card.dataset.charRefScope || '';
      const row = rows?.[card.dataset.charScope === 'global' ? 'global' : 'session'].find(row => row.id === id);
      if (!row || !scope) continue;
      for (const kind of ['ref', 'example'] as const) {
        const hash = String(kind === 'ref' ? row.ref_hash || '' : row.example_hash || '');
        const key = JSON.stringify([scope, id, kind, hash]);
        if (!hash || requested.has(key)) continue;
        requested.add(key);
        targets.push({scope, id, hash, kind});
      }
    }
    queued.clear();
    const delivered = new Set<string>();
    void warmCharacterImagePreviews(targets, {load, ready: (target, url) => {
      if (active && root.isConnected) {
        delivered.add(JSON.stringify([target.scope, target.id, target.kind, target.hash]));
        applyImage({...target, url, configured: true}, false);
      }
    }}).finally(() => {
      for (const target of targets) {
        const key = JSON.stringify([target.scope, target.id, target.kind, target.hash]);
        if (!delivered.has(key)) requested.delete(key);
      }
    });
  };
  const request = (card: HTMLElement) => {
    if (!active) return;
    queued.add(card);
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const detached = new MutationObserver(() => { if (!root.isConnected) dispose(); });
  const dispose = () => {
    active = false; cancelAnimationFrame(frame); detached.disconnect(); queued.clear();
    for (const url of urls.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    urls.clear();
  };
  detached.observe(document.body, {childList:true, subtree:true});
  release = dispose;
  return {request};
}
