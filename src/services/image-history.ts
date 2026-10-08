import type { ApiResult } from '../core/types';
import { imageHistoryRoot, nextImageRevision } from '../domain/gallery/image-history';
import { idbGet, idbGetAll, imageLocation, imageAssetRef } from '../storage/stores';
import { findAssetMessage } from '../storage/asset-message';
import { rewriteBakedCardInChatMessage } from './chat-bake';

// Serialize revision allocation through publication, including studio generation.
import { Mutex } from '../core/util/async';
export const imageRevisionLock = new Mutex();

export async function allocateImageRevision(id: string, kind: 'r' | 's'): Promise<string> {
  return nextImageRevision(id, kind, (await idbGetAll('cards')).map(row => row.id));
}

export async function locateImageRevision(id: string, hint: Record<string, unknown>): Promise<{ id: string; location: Record<string, unknown> } | null> {
  const exact = await findAssetMessage(id, hint);
  if (exact) return { id, location: exact };
  const root = imageHistoryRoot(id);
  for (const row of await idbGetAll('cards')) {
    if (imageHistoryRoot(row.id) !== root || row.id === id) continue;
    const location = await findAssetMessage(row.id, hint);
    if (location) return { id: row.id, location };
  }
  return null;
}

export async function readImageHistory(id: string): Promise<ApiResult> {
  const source = await idbGet('cards', id);
  if (!source) return { ok: false, error: { code: 'not_found', message: 'card not found' } };
  const root = imageHistoryRoot(id);
  const rows = (await idbGetAll('cards')).filter(row => row.session_id === source.session_id && imageHistoryRoot(row.id) === root)
    .sort((a,b) => Number(b.created_at) - Number(a.created_at) || b.id.localeCompare(a.id, undefined, { numeric: true }));
  const cards = await Promise.all(rows.map(async row => {
    const asset = await imageAssetRef(row.id);
    const meta = JSON.parse(row.meta_json || '{}');
    return { id: row.id, seed: row.seed, asset_name: asset?.name || '', asset_path: asset?.path || '', width: meta.width, height: meta.height };
  }));
  return { ok: true, root, cards };
}

export function pinImageRevision(id: string): Promise<ApiResult> {
  return imageRevisionLock.run(() => pinRevision(id));
}
async function pinRevision(id: string): Promise<ApiResult> {
  const row = await idbGet('cards', id);
  if (!row) return { ok: false, error: { code: 'not_found', message: 'card not found' } };
  const history = await readImageHistory(id) as { cards: Array<{ id: string }> };
  const hint = await imageLocation(id);
  for (const card of history.cards) {
    const loc = await findAssetMessage(card.id, hint);
    if (!loc) continue;
    const ok = await rewriteBakedCardInChatMessage({ charIndex: Number(loc.char_index), chatIndex: Number(loc.chat_index),
      messageIndex: Number(loc.message_index), characterId: String(loc.character_id), chatId: String(loc.chat_id),
      prevCardId: card.id, nextCardId: id, pin: true });
    return { ok, card_id: id };
  }
  return { ok: false, error: { code: 'not_found', message: '고정할 메시지를 찾지 못했습니다.' } };
}
