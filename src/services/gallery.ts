/**
 * Session gallery compatibility and character-asset explorer actions.
 * Explorer inventories use only asset names/owners and append order. Image
 * recipes, placement and bytes are deferred until an explicit image action.
 * `folder_key` on an item corresponds to `key` on its folder (frozen UI contract).
 */

import { normalizeShotKind } from '../domain/comic/kind';
import { cardMatchesMessageUnlink } from '../domain/gallery/unlink-match';
import { stripStoredCardMeta } from '../domain/gallery/strip-stored-meta';
import { IMAGE_KEY } from '../core/constants';
import { dbg } from '../core/debug';
import { errorBody } from '../core/errors';
import type { ApiResult, CardRow } from '../core/types';
import { asU8, base64ToBytes, bytesToBase64, u8ToArrayBuffer } from '../core/util/bytes';
import { ASSISTANT_PREVIEW_LIMIT, cleanText, toInt, toOptionalFloat, unifiedSessionIdForCharacter, uuid, writeSessionId } from '../core/util/text';
import { risuHost } from '../core/host';
import { listShotAssets, resolveShotOwner } from '../storage/shot-character';
import { publishImage } from '../storage/image-urls';
import {
  cardsForSession,
  cardsForSessions,
  ensureRoom,
  roomRows,
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  imageMeta,
  imagePng,
  removeCardImageRows,
} from '../storage/stores';
import type { ZipEntryInput } from '../ui-contract/gallery-zip';
import { explorerExportFolderKeys } from '../ui-contract/explorer-selection';
import { assignGalleryExportFiles, buildGalleryManifest, galleryImageExt, lookupZipImage, packGalleryZip, resolveReattach, unpackGalleryZip, withGalleryExt } from '../ui-contract/gallery-zip';
import type { GalleryExportNest } from '../ui-contract/gallery-zip';
import {
  cardMetaFromLocation,
  locationFieldsForCard,
  locationFieldsFrom,
  readImageLocation,
  writeImageLocation,
} from './generation';

/** One chat's bucket in the explorer tree. The UI keys these off `key`. */
type ExploreFolder = {
  key: string;
  character_id: string;
  chat_id: string;
  character_name: string;
  chat_name: string;
  char_index: number;
  chat_index: number;
  count: number;
  storage: string;
};

/** One explorer row. `folder_key` names the `key` of its folder. */
type ExploreRow = {
  asset_order: number;
  character_order: number;
  asset_name: string;
  asset_path: string;
  id: string;
  job_id: string;
  session_id: string;
  folder_key: string;
  shot_index: number;
  paragraph: number;
  y_percent: number | null;
  line?: number | null;
  message_index: number;
  message_role: string;
  content_hash: string;
  host_message_id?: string;
  character_id: string;
  character_name: string;
  chat_id: string;
  chat_name: string;
  char_index: number;
  chat_index: number;
  assistant_preview: string;
  main_prompt: string;
  characters: unknown[];
  seed: number | null;
  created_at: number | undefined;
  storage: string;
  storage_key: string;
  location_file: string;
  png_bytes: number;
};

type ExplorePayload = {
  ok: true;
  folders: ExploreFolder[];
  items: ExploreRow[];
  total: number;
  storage: string;
  storage_api: string;
};

/** One per-session gallery row. Narrower than an explorer row, and unfoldered. */
type GalleryRow = {
  id: string;
  job_id: string;
  shot_index: number;
  paragraph: number;
  y_percent: number | null;
  line?: number | null;
  aspect?: string;
  width?: number;
  height?: number;
  kind?: 'comic';
  message_index: number;
  message_role: string;
  content_hash: string;
  host_message_id?: string;
  character_id: string;
  chat_id: string;
  character_name: string;
  chat_name: string;
  char_index: number;
  chat_index: number;
  assistant_preview: unknown;
  main_prompt: string;
  negative_prompt: string;
  characters: unknown[];
  seed: number | null;
  created_at: number | undefined;
  storage: string;
  storage_key: string;
  png_bytes: number;
};

type DeleteResult =
  | { ok: true; deleted: number; ids: string[] }
  | { ok: false; error: { code: string; message: string } };

export interface RebindArgs {
  session_id?: unknown;
  card_ids?: unknown;
  to_hash?: unknown;
  assistant_preview?: unknown;
}

/** Live chat plus that character's unified id — listing must not rewrite packs. */
function listingSessionIds(liveSid: string): string[] {
  const sid = cleanText(liveSid, 200);
  if (!sid) return [];
  const roomChar = String(roomRows().find((row) => row.session_id === sid)?.character_id || '');
  const unified = writeSessionId({
    sessionId: sid,
    characterId: roomChar,
    unifiedSessionId: unifiedSessionIdForCharacter(roomChar),
  });
  return [...new Set([unified, sid].filter(Boolean))];
}

/**
 * A card's `meta_json`. A `"null"` body yields `{}` here rather than the
 * property-access throw it produced in 1.x.
 */
function parseMeta(row: CardRow): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(row.meta_json || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Placement sidecar, mapped location fields and `png_bytes` from a single index
 * lookup — a listing row needs all three and they live on the same image row.
 *
 * `png_bytes` keeps the 1.x precedence: the stored image's byte length when there
 * is one, else whatever the card recorded. The index holds that byte length, so
 * the precedence survives without hydrating anything.
 */
async function rowLocation(id: string, meta: Record<string, unknown>) {
  const info = await imageMeta(id);
  const sidecar = info?.location || {};
  return {
    sidecar,
    loc: locationFieldsFrom(id, meta, sidecar),
    png_bytes: info?.png_bytes || Number(meta.png_bytes) || 0,
  };
}

/**
 * The explorer listing. Kept internal and typed so export/import can consume the
 * rows directly while `galleryExplore` still hands the UI a plain result.
 */
async function exploreCards(limit: number): Promise<ExplorePayload> {
  const [assets, current] = await Promise.all([listShotAssets(), risuHost()?.getCurrentCharacterIndex?.()]);
  // Directory order and append order are the only known ordering facts. Never
  // invent a timestamp or open chat packs to fill optional legacy UI fields.
  const ordered = assets.map(asset => ({...asset,
    rank:Number(asset.location.char_index) === Number(current) ? -1 : Number(asset.location.char_index),
  })).sort((a,b) => a.rank - b.rank || Number(b.location.asset_order) - Number(a.location.asset_order));
  const folders = new Map<string, ExploreFolder>();
  const items: ExploreRow[] = [];
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Infinity;
  for (const asset of ordered) {
    const loc = asset.location;
    const characterId = String(loc.character_id || 'unknown');
    const chatId = String(loc.chat_id || 'unknown');
    const key = `${characterId}|${chatId}`;
    let folder = folders.get(key);
    if (!folder) {
      folder = {key,character_id:characterId,chat_id:chatId,
        character_name:String(loc.character_name || characterId),
        chat_name:String(loc.chat_name || (chatId === 'unknown' ? '채팅 미확인' : chatId)),
        char_index:Number(loc.char_index ?? -1),chat_index:Number(loc.chat_index ?? -1),
        count:0,storage:'character-assets'};
      folders.set(key,folder);
    }
    folder.count++;
    if (items.length >= cap) continue;
    items.push({id:asset.id,job_id:'',session_id:asset.session,folder_key:key,
      character_id:characterId,chat_id:chatId,character_name:folder.character_name,chat_name:folder.chat_name,
      char_index:folder.char_index,chat_index:folder.chat_index,
      character_order:asset.rank,asset_order:Number(loc.asset_order),asset_name:asset.name,asset_path:asset.path,
      shot_index:-1,paragraph:0,y_percent:null,message_index:-1,message_role:'',content_hash:'',
      assistant_preview:'',main_prompt:'',characters:[],seed:null,created_at:undefined,
      storage:'character-assets',storage_key:IMAGE_KEY(asset.id),location_file:'',png_bytes:0});
  }
  return {ok:true,folders:[...folders.values()],items,total:ordered.length,
    storage:'character-assets',storage_api:'additionalAssets'};
}

export async function galleryExplore(limit = 0): Promise<ApiResult> {
  return exploreCards(limit);
}

/**
 * One session's cards, newest first.
 *
 * `hashes` names messages the caller is about to paint. Their cards ship even
 * when they fell out of the newest-first window — without that, asking for a
 * window instead of the whole session silently stops old shots from attaching,
 * which is why the window was widened to the session ceiling in the first place.
 *
 * `total` lets the caller tell a complete listing from a windowed one, so it
 * knows whether it may replace its cache or has to merge into it.
 */
export async function gallery(
  sessionId: string,
  limit = 40,
  hashes: readonly unknown[] = [],
): Promise<ApiResult> {
  const liveSid = cleanText(sessionId, 200);
  if (liveSid) await ensureRoom(liveSid);
  const sorted = (await cardsForSessions(listingSessionIds(liveSid)))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const window = Math.max(0, Math.min(2000, Math.floor(Number(limit)) || 0));
  const rows = sorted.slice(0, window);
  const want = new Set(hashes.map((h) => cleanText(h, 128)).filter(Boolean));
  if (want.size) {
    // Only the tail is probed, and only when hashes were asked for. `imageMeta`
    // is an index read; `idbGet('images')` here would decode the whole session.
    for (const row of sorted.slice(window)) {
      const meta = parseMeta(row);
      const info = await imageMeta(row.id);
      const hash = cleanText(
        (info?.location as Record<string, unknown> | undefined)?.content_hash || meta.content_hash || '',
        128,
      );
      if (hash && want.has(hash)) rows.push(row);
    }
  }
  const items: GalleryRow[] = [];
  for (const row of rows) {
    const meta = parseMeta(row);
    const { sidecar, loc, png_bytes: pngBytes } = await rowLocation(row.id, meta);
    items.push({
      id: row.id,
      job_id: row.job_id,
      shot_index: loc.shot_index >= 0 ? loc.shot_index : row.shot_index,
      paragraph: Object.keys(sidecar).length ? loc.paragraph : row.paragraph,
      y_percent: loc.y_percent,
      line: loc.line,
      aspect: cleanText(meta.aspect || '', 20) || undefined,
      ...(() => {
        const width = Math.floor(Number(meta.width));
        const height = Math.floor(Number(meta.height));
        return width > 0 && height > 0 ? { width, height } : {};
      })(),
      ...(normalizeShotKind(meta.kind) === 'comic' ? { kind: 'comic' as const } : {}),
      message_index: loc.message_index ?? -1,
      message_role: loc.message_role || '',
      content_hash: loc.content_hash || '',
      ...(loc.host_message_id ? { host_message_id: loc.host_message_id } : {}),
      character_id: loc.character_id || '',
      chat_id: loc.chat_id || '',
      character_name: loc.character_name || '',
      chat_name: loc.chat_name || '',
      char_index: loc.char_index ?? -1,
      chat_index: loc.chat_index ?? -1,
      // Unlike the explorer row this one is not cleaned, and the sidecar is not
      // consulted. Both are 1.x behaviour the UI already renders around.
      assistant_preview: loc.assistant_preview || meta.assistant_preview || '',
      main_prompt: row.main_prompt,
      negative_prompt: row.negative_prompt,
      characters: JSON.parse(row.characters_json || '[]'),
      seed: row.seed as number | null,
      created_at: row.created_at,
      storage: 'indexeddb',
      storage_key: loc.storage_key || IMAGE_KEY(row.id),
      png_bytes: pngBytes,
    });
  }
  // Oldest card the window itself reached. A caller merging a windowed listing
  // into its cache needs this to tell "still there, just older than the window"
  // from "deleted": anything at or above this timestamp that the response omits
  // is gone. Null when the window covered the whole session.
  const windowOldestAt = rows.length && window < sorted.length
    ? Number(sorted[Math.min(window, sorted.length) - 1]?.created_at || 0)
    : null;
  const payload = {
    ok: true,
    session_id: sessionId,
    items,
    total: sorted.length,
    window_oldest_at: windowOldestAt,
    storage: 'indexeddb',
  };
  // Same as explorer: rows carry no display URL; UI `ce()` warms the visible strip.
  return payload;
}

/**
 * One-shot streaming hash upgrade: rewrite content_hash (+ preview) on chosen cards.
 * Client filters by character/chat/msg/role + Dice; server only writes.
 * Also upgrades other cards that share a rebound card's job_id (mid-job siblings
 * that finished on the old streaming hash).
 */
export async function rebindCardsHash(args: RebindArgs = {}): Promise<ApiResult> {
  const sessionId = cleanText(args.session_id, 200);
  const toHash = cleanText(args.to_hash, 128);
  const preview = cleanText(args.assistant_preview || '', ASSISTANT_PREVIEW_LIMIT);
  const ids = (Array.isArray(args.card_ids) ? args.card_ids : []).map((id) => cleanText(id, 80)).filter(Boolean);
  if (!toHash || !ids.length) {
    return { ok: false, ...errorBody('to_hash and card_ids required', 'bad_request'), rebound: 0, ids: [] };
  }
  const want = new Set(ids);
  const jobIds = new Set<string>();
  const readSids = listingSessionIds(sessionId);
  for (const cardId of ids) {
    const row = await idbGet('cards', cardId);
    const jid = cleanText(row?.job_id || '', 80);
    if (jid) jobIds.add(jid);
  }
  if (jobIds.size && sessionId) {
    for (const row of await cardsForSessions(readSids)) {
      const jid = cleanText(row?.job_id || '', 80);
      if (!jid || !jobIds.has(jid)) continue;
      const id = cleanText(row?.id || '', 80);
      if (id) want.add(id);
    }
  }
  const rebound: string[] = [];
  for (const cardId of want) {
    const row = await idbGet('cards', cardId);
    if (!row) continue;
    if (sessionId && !readSids.includes(cleanText(row.session_id || '', 200))) continue;
    const meta = parseMeta(row);
    const existing = await readImageLocation(cardId);
    const already = cleanText(existing.content_hash || meta.content_hash || '', 128);
    if (already === toHash) continue;
    const nextLoc: Record<string, unknown> = {
      ...existing,
      image_id: cardId,
      content_hash: toHash,
    };
    delete nextLoc.assistant_preview;
    await writeImageLocation(cardId, nextLoc);
    meta.content_hash = toHash;
    if (preview) meta.assistant_preview = preview;
    meta.message_role = cleanText(meta.message_role || existing.message_role || '', 40).toLowerCase();
    row.meta_json = JSON.stringify(meta);
    await idbPut('cards', row);
    rebound.push(cardId);
  }
  dbg('gallery.rebind', { n: rebound.length, to: toHash.slice(0, 8) });
  return { ok: true, rebound: rebound.length, ids: rebound, content_hash: toHash };
}

export async function unlinkCardsForMessage(
  sessionId: string,
  contentHash = '',
  messageIndex: unknown = null,
  hostMessageId: unknown = '',
): Promise<ApiResult> {
  const sid = cleanText(sessionId, 200);
  const hash = cleanText(contentHash);
  let msgIdx: number | null = null;
  try {
    // Unparseable input leaves NaN rather than null, so the guard below lets it
    // through and the scan simply matches nothing. 1.x behaviour, preserved.
    if (messageIndex != null && String(messageIndex).trim() !== '') msgIdx = parseInt(String(messageIndex), 10);
  } catch {
    msgIdx = null;
  }
  const hostId = cleanText(hostMessageId, 160);
  if (!sid || (!hash && msgIdx == null && !hostId)) return { ok: true, unlinked: 0, ids: [] };
  // Session index plus a full scan: a late comic save can miss the index.
  const readSids = new Set(listingSessionIds(sid));
  const byId = new Map<string, CardRow>();
  for (const roomSid of readSids) {
    for (const row of await cardsForSession(roomSid)) byId.set(row.id, row);
  }
  for (const row of await idbGetAll('cards')) {
    if (byId.has(row.id)) continue;
    if (!readSids.has(cleanText(row.session_id, 200))) continue;
    byId.set(row.id, row);
  }
  const rows = [...byId.values()].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  const unlinkedIds: string[] = [];
  for (const row of rows) {
    const meta = parseMeta(row);
    const loc = await locationFieldsForCard(row.id, meta);
    const sidecar = await readImageLocation(row.id);
    if (!cardMatchesMessageUnlink({
      // locationFieldsForCard already applies sidecar-presence precedence.
      // Re-adding raw/meta values here can revive an explicitly unlinked card.
      hashes: [loc.content_hash],
      messageIndexes: [loc.message_index],
      hostIds: [loc.host_message_id, meta.host_message_id],
      wantHash: hash,
      wantMessageIndex: msgIdx,
      wantHostId: hostId,
    })) continue;
    const existing = sidecar;
    const cleared = {
      ...existing,
      version: 1,
      image_id: row.id,
      session_id: sid,
      content_hash: '',
      host_message_id: '',
      message_index: -1,
      character_id: '',
      chat_id: '',
      char_index: -1,
      chat_index: -1,
      unlinked_at: Date.now() / 1000,
    };
    await writeImageLocation(row.id, cleared);
    meta.content_hash = '';
    meta.host_message_id = '';
    meta.assistant_preview = '';
    meta.message_index = -1;
    meta.unlinked_at = Date.now() / 1000;
    row.meta_json = JSON.stringify(meta);
    await idbPut('cards', row);
    unlinkedIds.push(row.id);
  }
  return { ok: true, unlinked: unlinkedIds.length, ids: unlinkedIds };
}

/** Shared by the three delete entry points, which all report `ok` per card. */
async function removeCard(cardId: unknown): Promise<DeleteResult> {
  const id = cleanText(cardId, 80);
  if (!id) return { ok: false, ...errorBody('card_id required', 'bad_request') };
  const row = await idbGet('cards', id);
  if (!row) return { ok: false, ...errorBody('card not found', 'not_found') };
  await idbDelete('cards', id);
  // Deleting the image row is also what drops its cached data URL.
  await idbDelete('images', id);
  return { ok: true, deleted: 1, ids: [id] };
}

export async function deleteCard(cardId: string): Promise<ApiResult> {
  return removeCard(cardId);
}

export async function deleteCards(cardIds: unknown[] = []): Promise<ApiResult> {
  const ids = [...new Set((cardIds || []).map((id) => cleanText(id, 80)).filter(Boolean))];
  const deleted = await removeCardImageRows(ids);
  return { ok: true, deleted: deleted.length, ids: deleted };
}

export async function getExplorerFavorites(): Promise<ApiResult> {
  const row = await idbGet('meta', 'explorer_favorites');
  const raw = row?.ids;
  const ids = Array.isArray(raw) ? raw.map((id) => cleanText(id, 80)).filter(Boolean) : [];
  return { ok: true, ids };
}

export async function setExplorerFavorites(ids: unknown[] = []): Promise<ApiResult> {
  const clean = [...new Set((ids || []).map((id) => cleanText(id, 80)).filter(Boolean))];
  await idbPut('meta', { key: 'explorer_favorites', ids: clean, updated_at: Date.now() / 1000 });
  return { ok: true, ids: clean };
}

export async function exportGalleryZip(body: Record<string, unknown> = {}): Promise<ApiResult> {
  const explore = await exploreCards(0);
  let items = explore.items;
  const folderKey = cleanText(body.folder_key || '', 400);
  let nest: GalleryExportNest = 'chat';
  if (body.all) {
    nest = 'character-chat';
  } else if (folderKey) {
    const keys = explorerExportFolderKeys(folderKey, explore.folders);
    if (keys === null) {
      nest = 'character-chat';
    } else {
      const want = new Set(keys);
      items = items.filter((it) => want.has(it.folder_key));
    }
  } else if (Array.isArray(body.card_ids) && body.card_ids.length) {
    const want = new Set(body.card_ids.map((id) => cleanText(id, 80)));
    items = items.filter((it) => want.has(it.id));
    const chars = new Set(items.map((it) => String(it.character_id || it.character_name || '')));
    nest = chars.size > 1 ? 'character-chat' : 'chat';
  } else {
    return { ok: false, ...errorBody('card_ids, folder_key, or all required', 'bad_request') };
  }
  if (!items.length) return { ok: false, ...errorBody('no images to export', 'empty') };
  const numbered = assignGalleryExportFiles(items, { nest });
  const named: typeof numbered = [];
  const imageFiles: ZipEntryInput[] = [];
  for (const item of numbered) {
    const id = String(item.id || '');
    if (!id) continue;
    const raw = await getImageBytes(id);
    if (!raw?.byteLength) continue;
    const file = withGalleryExt(item.file || `images/${id}.webp`, galleryImageExt(raw));
    named.push({ ...item, file });
    imageFiles.push({ name: file, data: asU8(raw) });
  }
  if (!imageFiles.length) return { ok: false, ...errorBody('image bytes missing', 'empty') };
  const manifest = buildGalleryManifest(named);
  const files: ZipEntryInput[] = [
    { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
    ...imageFiles,
  ];
  const zip = packGalleryZip(files);
  return {
    ok: true,
    count: files.length - 1,
    filename: `inlay-gallery-${Date.now()}.zip`,
    zip_base64: bytesToBase64(zip),
    bytes: zip.length,
  };
}

export async function importGalleryZip(body: Record<string, unknown> = {}): Promise<ApiResult> {
  const preferNewIds = body.prefer_new_ids === undefined ? true : body.prefer_new_ids;
  const b64 = String(body.zip_base64 || '').replace(/^data:.*base64,/, '');
  if (!b64) return { ok: false, ...errorBody('zip_base64 required', 'bad_request') };
  let raw: Uint8Array;
  try {
    raw = base64ToBytes(b64);
  } catch (err) {
    return { ok: false, ...errorBody(`invalid base64: ${(err as Error)?.message || err}`, 'bad_request') };
  }
  const { manifest, images } = unpackGalleryZip(raw);
  if (!manifest?.items?.length) return { ok: false, ...errorBody('manifest.items missing', 'bad_request') };
  const owner=await resolveShotOwner({character_id:body.character_id || ''});
  const explore = await exploreCards(0);
  const existing = explore.items;
  const imported: Array<{ id: string; reattach: string; content_hash: string }> = [];
  const report = { exact: 0, candidate: 0, orphan: 0, skipped: 0 };
  for (const item of manifest.items) {
    const png = lookupZipImage(images, item);
    if (!png?.byteLength) {
      report.skipped += 1;
      continue;
    }
    const decision = resolveReattach(item, existing);
    report[decision.status] = (report[decision.status] || 0) + 1;
    const loc = { ...(item.location || {}) };
    // Location is kept even for an orphan, so the UI can still jump to it or fix
    // the link by hand later.
    const newId = preferNewIds ? uuid() : cleanText(item.id || '', 80) || uuid();
    const sessionId = cleanText(loc.session_id || '', 200) || `import_${uuid().replace(/-/g, '').slice(0, 10)}`;
    const location = {
      version: 1,
      image_id: newId,
      session_id: sessionId,
      character_id: cleanText(loc.character_id || '', 200),
      character_name: cleanText(loc.character_name || '', 200),
      chat_id: cleanText(loc.chat_id || '', 200),
      chat_name: cleanText(loc.chat_name || '', 200),
      char_index: toInt(loc.char_index, -1),
      chat_index: toInt(loc.chat_index, -1),
      message_index: toInt(loc.message_index, -1),
      shot_index: toInt(loc.shot_index, 0),
      paragraph: toInt(loc.paragraph, 0),
      y_percent: toOptionalFloat(loc.y_percent),
      content_hash: cleanText(loc.content_hash || '', 128),
      assistant_preview: cleanText(loc.assistant_preview || '', ASSISTANT_PREVIEW_LIMIT),
      asset_owner_character_id: owner.id,
      imported_at: Date.now() / 1000,
      reattach: decision.status,
    };
    const bytes = u8ToArrayBuffer(png);
    await publishImage(newId, bytes, location);
    const meta = cardMetaFromLocation(
      {
        ...(item.meta || {}),
        assistant_preview: location.assistant_preview,
        imported_at: location.imported_at,
        reattach: decision.status,
      },
      location,
      bytes.byteLength || 0,
    );
    await idbPut('cards', {
      id: newId,
      job_id: `import_${newId.slice(0, 8)}`,
      session_id: sessionId,
      shot_index: location.shot_index,
      paragraph: location.paragraph,
      main_prompt: '',
      negative_prompt: '',
      // Same rule as fresh generations: no cast / prompt / hash / preview.
      characters_json: '[]',
      seed: item.meta?.seed ?? 0,
      meta_json: JSON.stringify(stripStoredCardMeta(meta)),
      created_at: Number(item.meta?.created_at) || Date.now() / 1000,
    });
    imported.push({ id: newId, reattach: decision.status, content_hash: location.content_hash });
  }
  return { ok: true, imported: imported.length, items: imported, report };
}

export async function deleteFolder(folderKey: string): Promise<ApiResult> {
  const key = cleanText(folderKey, 400);
  if (!key || !key.includes('|')) return { ok: false, ...errorBody('folder_key required', 'bad_request') };
  const [characterId, chatId] = key.split('|', 2);
  const cid = cleanText(characterId, 200) || 'unknown';
  const chid = cleanText(chatId, 200) || 'unknown';
  const want = (await exploreCards(0)).items.filter(row => row.folder_key === `${cid}|${chid}`).map(row => row.id);
  const deletedIds = await removeCardImageRows(want);
  return { ok: true, deleted: deletedIds.length, ids: deletedIds, folder_key: `${cid}|${chid}` };
}

export async function getImageBytes(cardId: string): Promise<ArrayBuffer | null> {
  return imagePng(cardId);
}
