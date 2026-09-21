/**
 * The two singleton NovelAI reference images.
 *
 * Image reference and vibe transfer are one image each rather than a
 * collection, so they live in `meta` under fixed keys instead of the image
 * store, and their preview data URLs sit in `context` so the settings payload
 * can report them without touching storage.
 *
 * Vibe transfer additionally needs a server-side encode, which is a NovelAI
 * round trip. Preset vibe upload stores the PNG only. `ensure*VibeEncoded`
 * is the generate-time path: it encodes when the blob is missing or the
 * model / extraction level moved.
 */

import { dbg } from '../core/debug';
import type { ApiResult, MetaRow } from '../core/types';
import { u8ToArrayBuffer } from '../core/util/bytes';
import {
  GLOBAL_SCOPE,
  isCharRefMetaKey,
  isVibePresetMetaKey,
  normalizeCharRefScope,
  presetIdFromVibeMetaKey,
  vibePresetMetaKey,
} from '../core/constants';
import { cleanText } from '../core/util/text';
import { publishCharacterImage } from '../core/character-ui-events';
import { refSeedTargets } from '../domain/character/char-ref-seed';
import type { ReferenceCandidate } from '../domain/nai-meta/reference-search';
import { sanitizeHash } from '../domain/character/char-ref-store';
import { referenceLooksForTargets } from './reference-assets';
import { vibeEncodeToken } from '../domain/nai/keys';
import { modelToNaia, resolveModel, supportsVibeTransfer } from '../providers/nai/payload';
import { encodeVibe } from '../providers/nai/vibe';
import { pngToDataUrl } from '../storage/image-urls';
import { characterSource } from './character-source';
import { characterIdForRosterScope, rosterOwnerScopesForSession } from '../storage/character-roster';
import { idbDelete, idbGet, idbGetAll, idbPut } from '../storage/stores';
import {
  clearAllCharRefPreviewUrls,
  getCharRefPreviewUrl,
  getConfig,
  getExamplePreviewUrl,
  setExamplePreviewUrl,
  getPresetVibePreviewUrl,
  getRefPreviewUrl,
  getVibePreviewUrl,
  setCharRefPreviewUrl,
  setPresetVibePreviewUrl,
  setRefPreviewUrl,
  setVibePreviewUrl,
} from './context';
import {
  getCharRefAssetBytes,
  putCharRefAsset,
  refreshCharRefAssetIndex,
  resetCharRefLibrary,
} from './char-ref-module';
import { saveConfig } from './settings';

const CHAR_REF_VIBE_PREFIX = 'char_ref_vibe_';

/** Both images are inlined into request payloads as base64, so they stay small. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Anything smaller than this cannot be a real image header. */
const MIN_IMAGE_BYTES = 32;

function requireVibeEncodeToken(forUpload: boolean): string {
  const token = vibeEncodeToken(getConfig().nai);
  if (!token) {
    throw new Error(
      forUpload
        ? 'NAI api_key가 설정되지 않았습니다. encode-vibe에 키가 필요합니다.'
        : 'NAI api_key가 설정되지 않았습니다.',
    );
  }
  return token;
}

// ── image reference ────────────────────────────────────────────────────────

/**
 * Presence check for synchronous callers. The preview URL is set whenever the
 * image is stored, so it doubles as the in-memory "configured" flag.
 */
export function hasReferenceImageSync(): boolean {
  return Boolean(getRefPreviewUrl());
}

export async function hasReferenceImage(): Promise<boolean> {
  const ref = await idbGet('meta', 'reference_image');
  return Boolean(ref?.png && ref.png.byteLength > MIN_IMAGE_BYTES);
}

export async function getReferenceImageBytes(): Promise<ArrayBuffer | null> {
  const ref = await idbGet('meta', 'reference_image');
  return ref?.png || null;
}

export async function setReferenceImage(png: ArrayBuffer): Promise<ApiResult> {
  if (!png || png.byteLength < MIN_IMAGE_BYTES) throw new Error('참조 이미지가 비어 있습니다');
  if (png.byteLength > MAX_IMAGE_BYTES) throw new Error('참조 이미지가 너무 큽니다 (최대 12MB)');
  await idbPut('meta', { key: 'reference_image', png });
  setRefPreviewUrl(pngToDataUrl(png));
  getConfig().nai.image_reference = 'file';
  await saveConfig();
  return {
    ok: true,
    image_reference: 'file',
    configured: true,
    bytes: png.byteLength,
    // The UI treats this as an opaque marker; the bytes come from the route.
    preview_url: '/v1/nai/reference.png',
  };
}

export async function clearReferenceImage(): Promise<ApiResult> {
  await idbDelete('meta', 'reference_image');
  setRefPreviewUrl('');
  getConfig().nai.image_reference = 'none';
  await saveConfig();
  return { ok: true, image_reference: 'none', configured: false };
}

// ── vibe transfer ──────────────────────────────────────────────────────────

export function hasVibeTransferSync(): boolean {
  return Boolean(getVibePreviewUrl());
}

export async function hasVibeTransfer(): Promise<boolean> {
  const vibe = await idbGet('meta', 'vibe_transfer');
  return Boolean(vibe?.encoded && vibe?.png && vibe.png.byteLength > MIN_IMAGE_BYTES);
}

export async function getVibeTransfer(): Promise<MetaRow | null> {
  return (await idbGet('meta', 'vibe_transfer')) || null;
}

export async function getVibeImageBytes(): Promise<ArrayBuffer | null> {
  const vibe = await idbGet('meta', 'vibe_transfer');
  return vibe?.png || null;
}

export interface VibeOptions {
  model?: unknown;
  information_extracted?: unknown;
  strength?: unknown;
}

/** Clamped to the range NovelAI accepts; anything unparseable falls back to full. */
function normalizeInformationExtracted(value: unknown): number {
  let ie = Number(value ?? 1.0);
  if (Number.isNaN(ie)) ie = 1.0;
  return Math.max(0, Math.min(1, ie));
}

export async function setVibeTransfer(png: ArrayBuffer, opts: VibeOptions = {}): Promise<ApiResult> {
  if (!png || png.byteLength < MIN_IMAGE_BYTES) throw new Error('Vibe 이미지가 비어 있습니다');
  if (png.byteLength > MAX_IMAGE_BYTES) throw new Error('Vibe 이미지가 너무 큽니다 (최대 12MB)');
  const cfg = getConfig();
  const token = requireVibeEncodeToken(true);
  const model = modelToNaia(opts.model || cfg.nai.model || 'nai-diffusion-4-5-full');
  const ie = normalizeInformationExtracted(opts.information_extracted ?? cfg.nai.vibe_transfer_information_extracted);
  const encoded = await encodeVibe(token, png, model, ie);
  await idbPut('meta', {
    key: 'vibe_transfer',
    png,
    encoded,
    model: resolveModel(model),
    information_extracted: ie,
  });
  setVibePreviewUrl(pngToDataUrl(png));
  cfg.nai.vibe_transfer = 'file';
  if (opts.strength != null && !Number.isNaN(Number(opts.strength))) {
    cfg.nai.vibe_transfer_strength = Math.max(0, Math.min(1, Number(opts.strength)));
  }
  cfg.nai.vibe_transfer_information_extracted = ie;
  await saveConfig();
  return {
    ok: true,
    vibe_transfer: 'file',
    configured: true,
    bytes: png.byteLength,
    encoded_bytes: encoded.length,
    model: resolveModel(model),
    information_extracted: ie,
    preview_url: '/v1/nai/vibe.png',
  };
}

export async function clearVibeTransfer(): Promise<ApiResult> {
  await idbDelete('meta', 'vibe_transfer');
  setVibePreviewUrl('');
  getConfig().nai.vibe_transfer = 'none';
  await saveConfig();
  return { ok: true, vibe_transfer: 'none', configured: false };
}

/**
 * The stored vibe blob, re-encoding it first if the configured model or
 * extraction level has moved since it was made. Returns null when no vibe image
 * is stored, so callers can treat "not configured" and "nothing to send" alike.
 */
export async function ensureVibeEncoded(encodeModel?: string): Promise<MetaRow | null> {
  const vibe = await getVibeTransfer();
  if (!vibe?.png || vibe.png.byteLength < MIN_IMAGE_BYTES) return null;
  const cfg = getConfig();
  const token = requireVibeEncodeToken(false);
  const model = resolveModel(modelToNaia(encodeModel || cfg.nai.model || 'nai-diffusion-4-5-full'));
  const ie = normalizeInformationExtracted(cfg.nai.vibe_transfer_information_extracted);
  if (!supportsVibeTransfer(model)) return vibe;
  const needEncode =
    !cleanText(vibe.encoded) ||
    cleanText(vibe.model) !== model ||
    Math.abs(Number(vibe.information_extracted ?? 1) - ie) > 0.001;
  if (!needEncode) return vibe;
  const encoded = await encodeVibe(token, vibe.png, model, ie);
  const next: MetaRow = { ...vibe, key: 'vibe_transfer', encoded, model, information_extracted: ie };
  await idbPut('meta', next);
  return next;
}

// ── per-style-preset vibe transfer ─────────────────────────────────────────

export async function hasPresetVibeTransfer(presetId: string): Promise<boolean> {
  const id = cleanText(presetId, 120);
  if (!id) return false;
  const vibe = await idbGet('meta', vibePresetMetaKey(id));
  return Boolean(vibe?.png && vibe.png.byteLength > MIN_IMAGE_BYTES);
}

export async function getPresetVibeTransfer(presetId: string): Promise<MetaRow | null> {
  const id = cleanText(presetId, 120);
  if (!id) return null;
  return (await idbGet('meta', vibePresetMetaKey(id))) || null;
}

export async function getPresetVibeImageBytes(presetId: string): Promise<ArrayBuffer | null> {
  const vibe = await getPresetVibeTransfer(presetId);
  return vibe?.png || null;
}

export async function setPresetVibeTransfer(
  presetId: string,
  png: ArrayBuffer,
  opts: VibeOptions = {},
): Promise<ApiResult> {
  const id = cleanText(presetId, 120);
  if (!id) throw new Error('preset_id required');
  if (!png || png.byteLength < MIN_IMAGE_BYTES) throw new Error('Vibe 이미지가 비어 있습니다');
  if (png.byteLength > MAX_IMAGE_BYTES) throw new Error('Vibe 이미지가 너무 큽니다 (최대 12MB)');
  const cfg = getConfig();
  const ie = normalizeInformationExtracted(opts.information_extracted ?? cfg.nai.vibe_transfer_information_extracted);
  const metaKey = vibePresetMetaKey(id);
  // Store only — encode-vibe waits until a V4 shot actually uses this preset.
  await idbPut('meta', {
    key: metaKey,
    png,
    encoded: '',
    model: '',
    information_extracted: ie,
  });
  const preview = pngToDataUrl(png);
  setPresetVibePreviewUrl(id, preview);
  return {
    ok: true,
    preset_id: id,
    vibe_transfer: 'file',
    configured: true,
    bytes: png.byteLength,
    encoded_bytes: 0,
    information_extracted: ie,
    preview_url: preview,
  };
}

export async function clearPresetVibeTransfer(presetId: string): Promise<ApiResult> {
  const id = cleanText(presetId, 120);
  if (!id) throw new Error('preset_id required');
  await idbDelete('meta', vibePresetMetaKey(id));
  setPresetVibePreviewUrl(id, '');
  return { ok: true, preset_id: id, vibe_transfer: 'none', configured: false };
}

/** Copy vibe bytes from one preset id to another (duplicate preset). */
export async function copyPresetVibeTransfer(fromId: string, toId: string): Promise<boolean> {
  const src = await getPresetVibeTransfer(fromId);
  if (!src?.png || src.png.byteLength < MIN_IMAGE_BYTES) return false;
  const dest = cleanText(toId, 120);
  if (!dest) return false;
  await idbPut('meta', {
    key: vibePresetMetaKey(dest),
    png: src.png,
    encoded: src.encoded || '',
    model: src.model || '',
    information_extracted: src.information_extracted ?? 1.0,
  });
  const preview = getPresetVibePreviewUrl(fromId) || (src.png ? pngToDataUrl(src.png) : '');
  if (preview) setPresetVibePreviewUrl(dest, preview);
  return true;
}

/**
 * Preset vibe for generation: re-encode when model / IE drifted. Returns null
 * when this preset has no vibe image (caller should fall back to NAI default).
 */
export async function ensurePresetVibeEncoded(presetId: string, encodeModel?: string): Promise<MetaRow | null> {
  const vibe = await getPresetVibeTransfer(presetId);
  if (!vibe?.png || vibe.png.byteLength < MIN_IMAGE_BYTES) return null;
  const cfg = getConfig();
  const token = requireVibeEncodeToken(false);
  const model = resolveModel(modelToNaia(encodeModel || cfg.nai.model || 'nai-diffusion-4-5-full'));
  const ie = normalizeInformationExtracted(cfg.nai.vibe_transfer_information_extracted);
  if (!supportsVibeTransfer(model)) return vibe;
  const needEncode =
    !cleanText(vibe.encoded) ||
    cleanText(vibe.model) !== model ||
    Math.abs(Number(vibe.information_extracted ?? 1) - ie) > 0.001;
  if (!needEncode) return vibe;
  const encoded = await encodeVibe(token, vibe.png, model, ie);
  const metaKey = vibePresetMetaKey(cleanText(presetId, 120));
  const next: MetaRow = { ...vibe, key: metaKey, encoded, model, information_extracted: ie };
  await idbPut('meta', next);
  return next;
}

/** Warm preview URLs for any preset vibe rows already in memory after boot. */
export async function hydratePresetVibePreviews(): Promise<void> {
  for (const preset of getConfig().card?.presets || []) {
    const row = await idbGet('meta',vibePresetMetaKey(String(preset.id || '')));
    if(!row)continue;
    const key = String((row as MetaRow)?.key || '');
    if (!isVibePresetMetaKey(key)) continue;
    const png = (row as MetaRow).png;
    if (!png || png.byteLength < MIN_IMAGE_BYTES) continue;
    setPresetVibePreviewUrl(presetIdFromVibeMetaKey(key), pngToDataUrl(png));
  }
}

// ── per-character refs: roster hash + Risu module webp ──

export type CharRefHydrateRow = {
  id: string;
  scope: string;
  hash: string;
  configured: boolean;
  preview_url: string;
  example_hash: string;
  example_configured: boolean;
  example_preview_url: string;
};

type CharRefRosterRow = { ref_hash?: unknown } | null;

function withoutLegacyRefPath<T extends object>(row: T): Omit<T, 'ref_path'> {
  const next = { ...row } as T & { ref_path?: unknown };
  delete next.ref_path;
  return next;
}

async function readRosterRefHash(
  scope: unknown,
  characterId: string,
): Promise<string> {
  const id = cleanText(characterId, 200);
  const sc = normalizeCharRefScope(scope);
  if (!id || !sc) return '';
  const row = await idbGet('characters', { scope: sc, id });
  return sanitizeHash((row as CharRefRosterRow)?.ref_hash);
}

async function writeRosterRefHash(
  scope: unknown,
  characterId: string,
  hash: string,
): Promise<void> {
  const id = cleanText(characterId, 200);
  const sc = normalizeCharRefScope(scope);
  if (!id || !sc) throw new Error('character_id/scope required');
  const row = await idbGet('characters', { scope: sc, id });
  if (!row) throw new Error('캐릭터가 없습니다');
  const h = sanitizeHash(hash);
  const next = withoutLegacyRefPath({
    ...row,
    ref_hash: h,
    updated_at: Date.now() / 1000,
  });
  await idbPut('characters', next);
}

export function hasCharRefImageSync(scope: unknown, characterId: string): boolean {
  return Boolean(getCharRefPreviewUrl(normalizeCharRefScope(scope), characterId));
}

export async function hasCharRefImage(scope: unknown, characterId: string): Promise<boolean> {
  return Boolean(await readRosterRefHash(scope, characterId));
}

export async function ensureCharRefPreviewUrl(scope: unknown, characterId: string): Promise<string> {
  const id = cleanText(characterId, 200);
  const sc = normalizeCharRefScope(scope);
  if (!id) return '';
  const existing = getCharRefPreviewUrl(sc, id);
  if (existing) return existing;
  const bytes = await getCharRefImageBytes(sc, id);
  if (!bytes || bytes.byteLength < MIN_IMAGE_BYTES) return '';
  const preview = pngToDataUrl(bytes);
  setCharRefPreviewUrl(sc, id, preview);
  return preview;
}

export async function getCharRefImageBytes(scope: unknown, characterId: string): Promise<ArrayBuffer | null> {
  const hash = await readRosterRefHash(scope, characterId);
  return hash ? getCharRefAssetBytes(hash) : null;
}

/** Fill empty ref slots from name-triggered Risu assets. Never overwrites a hash. */
export async function seedCharRefsFromLooks(characters: readonly unknown[], sourceCharacterId = '', captured?: readonly ReferenceCandidate[]): Promise<number> {
  const targets = refSeedTargets(characters);
  if (!targets.length) return 0;
  // Capture the live source once, only for global rows without a caller-owned source.
  const current = !sourceCharacterId && targets.some(t => t.scope === GLOBAL_SCOPE)
    ? await characterSource() : null;
  const globalSource = String(current?.chaId || current?.id || '');
  const groups = new Map<string, typeof targets>();
  const owners = new Map<string, string>();
  for (const target of targets) {
    if (!owners.has(target.scope)) owners.set(target.scope, sourceCharacterId ||
      (target.scope === GLOBAL_SCOPE ? globalSource : await characterIdForRosterScope(target.scope)));
    const owner = owners.get(target.scope)!;
    if (!owner) continue;
    const group = groups.get(owner) || [];
    group.push(target); groups.set(owner, group);
  }
  let seeded = 0;
  for (const [characterId, group] of groups) {
    try {
      const looks = await referenceLooksForTargets(group, characterId, captured);
      for (const target of group) {
        const bytes = looks.find(look => look.targetId === target.id && look.scope === target.scope)?.bytes;
        if (!bytes?.byteLength) continue;
        try {
          const saved = await setCharRefImage(target.scope, target.id, u8ToArrayBuffer(bytes), {
            overwrite: false,
          }) as { ok?: unknown; skipped?: unknown; preview_url?: string; ref_hash?: string };
          if (saved?.ok && !saved.skipped) {
            seeded += 1;
            publishCharacterImage({ scope: target.scope, id: target.id, kind: 'ref',
              url: saved.preview_url || '', hash: saved.ref_hash, configured: true });
          }
        } catch (err) {
          dbg('char_ref.seed.put.fail', { character_id: target.id, message: String((err as Error)?.message || err) }, 'warn');
        }
      }
    } catch (err) {
      dbg('char_ref.seed.looks.fail', { character_id: characterId, message: String((err as Error)?.message || err) }, 'warn');
    }
  }
  if (seeded) dbg('char_ref.seed', { seeded, targets: targets.length });
  return seeded;
}

export async function setCharRefImage(
  scope: unknown,
  characterId: string,
  bytes: ArrayBuffer,
  opts: { overwrite?: boolean; quality?: number } = {},
): Promise<ApiResult> {
  const id = cleanText(characterId, 200);
  const sc = normalizeCharRefScope(scope);
  if (!id) throw new Error('character_id required');
  if (!sc) throw new Error('scope required');
  if (!bytes || bytes.byteLength < MIN_IMAGE_BYTES) throw new Error('참고 이미지가 비어 있습니다');
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('참고 이미지가 너무 큽니다 (최대 12MB)');
  if (opts.overwrite === false) {
    const existing = await readRosterRefHash(sc, id);
    if (existing) {
      const preview = await ensureCharRefPreviewUrl(sc, id);
      return {
        ok: true,
        character_id: id,
        scope: sc,
        configured: true,
        skipped: true,
        ref_hash: existing,
        preview_url: preview,
      };
    }
  }
  const stored = await putCharRefAsset(bytes, opts.quality != null ? { quality: opts.quality } : undefined);
  await writeRosterRefHash(sc, id, stored.hash);
  const preview = pngToDataUrl(stored.bytes);
  setCharRefPreviewUrl(sc, id, preview);
  return {
    ok: true,
    character_id: id,
    scope: sc,
    configured: true,
    ref_hash: stored.hash,
    bytes: stored.bytes.byteLength,
    preview_url: preview,
  };
}

export async function clearCharRefImage(scope: unknown, characterId: string): Promise<ApiResult> {
  const id = cleanText(characterId, 200);
  const sc = normalizeCharRefScope(scope);
  if (!id) throw new Error('character_id required');
  if (!sc) throw new Error('scope required');
  const row = await idbGet('characters', { scope: sc, id });
  if (row) {
    const next = withoutLegacyRefPath({ ...row, ref_hash: '', updated_at: Date.now() / 1000 });
    await idbPut('characters', next);
  }
  setCharRefPreviewUrl(sc, id, '');
  return { ok: true, character_id: id, scope: sc, configured: false };
}

export async function copyCharRefImage(
  fromScope: unknown,
  fromId: string,
  toScope: unknown,
  toId: string,
): Promise<boolean> {
  const hash = await readRosterRefHash(fromScope, fromId);
  if (!hash) return false;
  const dest = cleanText(toId, 200);
  const destScope = normalizeCharRefScope(toScope);
  if (!dest || !destScope) return false;
  await writeRosterRefHash(destScope, dest, hash);
  const fromSc = normalizeCharRefScope(fromScope);
  const preview = getCharRefPreviewUrl(fromSc, fromId) || (await ensureCharRefPreviewUrl(fromSc, fromId));
  if (preview) setCharRefPreviewUrl(destScope, dest, preview);
  return true;
}

export async function ensureCharRefVibeEncoded(
  scope: unknown,
  characterId: string,
  informationExtracted?: number,
  encodeModel?: string,
): Promise<MetaRow | null> {
  const hash = await readRosterRefHash(scope, characterId);
  const png = hash ? await getCharRefImageBytes(scope, characterId) : null;
  if (!hash || !png || png.byteLength < MIN_IMAGE_BYTES) return null;
  const cfg = getConfig();
  const token = requireVibeEncodeToken(false);
  const model = resolveModel(modelToNaia(encodeModel || cfg.nai.model || 'nai-diffusion-4-5-full'));
  if (!supportsVibeTransfer(model)) return null;
  const ie = normalizeInformationExtracted(
    informationExtracted ?? cfg.card?.char_ref_fidelity ?? 1,
  );
  const vibeKey = `${CHAR_REF_VIBE_PREFIX}${hash}`;
  const cached = await idbGet('meta', vibeKey);
  const needEncode =
    !cleanText(cached?.encoded) ||
    cleanText(cached?.model) !== model ||
    Math.abs(Number(cached?.information_extracted ?? 1) - ie) > 0.001;
  if (!needEncode && cached) return { ...cached, png };
  const encoded = await encodeVibe(token, png, model, ie);
  const next: MetaRow = { key: vibeKey, png, encoded, model, information_extracted: ie };
  await idbPut('meta', { key: vibeKey, encoded, model, information_extracted: ie });
  return next;
}

export async function hydrateCharRefs(opts: {
  sessionId?: string;
  characterId?: string;
  scope?: string;
} = {}): Promise<{ session: CharRefHydrateRow[]; global: CharRefHydrateRow[] }> {
  await refreshCharRefAssetIndex();
  const wantId = cleanText(opts.characterId || '', 200);
  const wantScope = normalizeCharRefScope(opts.scope || '');
  const sessionId = cleanText(opts.sessionId || '', 200);
  const rows = await idbGetAll('characters');
  // Lorebook session rows carry the bot-level unified scope, not the chat
  // session id the tab asks with. Without the owner set the entry filter
  // below matches zero session rows (proven red by tools/repro-hydrate.mjs).
  const ownerScopes = !wantId && sessionId
    ? await rosterOwnerScopesForSession(sessionId).catch(() => [] as string[])
    : [];
  const ownerSet = new Set(ownerScopes);
  const matches = (row: { id?: unknown; scope?: unknown }): boolean => {
    const id = cleanText(row.id, 200);
    const scope = normalizeCharRefScope(row.scope);
    if (!id || !scope) return false;
    if (wantId && id !== wantId) return false;
    if (wantScope && scope !== wantScope && !(wantScope !== GLOBAL_SCOPE && scope !== GLOBAL_SCOPE && sessionId && ownerSet.has(scope))) return false;
    if (!wantId && !wantScope && sessionId && scope !== sessionId && scope !== GLOBAL_SCOPE && !ownerSet.has(scope)) return false;
    return true;
  };
  // UI cards, the single-ref route and the payload preview lookup all key by
  // the requested chat session id. Canonicalize owner-unified rows to it so
  // warm, publish and the memory cache share one key the tab can paint.
  const effScopeOf = (storedScope: string): string =>
    storedScope === GLOBAL_SCOPE ? storedScope : (sessionId || storedScope);
  // Empty-slot seeding must not block the tab paint. The single-ref route and
  // explicit import-fill still seed on demand; hydrate only backfills.
  const sourceCharacterId = await characterIdForRosterScope(sessionId || wantScope);
  void seedCharRefsFromLooks(rows.filter(matches).map((row) => ({ ...row, scope: effScopeOf(normalizeCharRefScope(row.scope)) })), sourceCharacterId).catch((err) => {
    dbg('char_ref.seed.hydrate.fail', { message: String((err as Error)?.message || err) }, 'warn');
  });
  const session: CharRefHydrateRow[] = [];
  const global: CharRefHydrateRow[] = [];
  const missing: Array<{ scope: string; id: string; hash: string }> = [];
  const missingExample: Array<{ scope: string; id: string; hash: string }> = [];
  for (const row of rows) {
    if (!matches(row)) continue;
    const id = cleanText((row as { id?: unknown }).id, 200);
    const scope = effScopeOf(normalizeCharRefScope((row as { scope?: unknown }).scope));
    const hash = sanitizeHash((row as { ref_hash?: unknown }).ref_hash);
    // Fast path: cached preview only. A miss returns '' so the tab paints
    // names/status immediately; visible thumbs fill via the single-ref route
    // (GET /v1/characters/ref) or the background warm below.
    const preview = hash ? getCharRefPreviewUrl(scope, id) || '' : '';
    if (hash && !preview) missing.push({ scope, id, hash });
    // Example-shot had no warm path at all: its preview stayed '' until the
    // character's own card was opened (single example-shot fetch), so tiles
    // only appeared after leaving and re-entering the tab. Warm it here too.
    const exHash = sanitizeHash((row as { example_hash?: unknown }).example_hash);
    const exPreview = exHash ? getExamplePreviewUrl(scope, id) || '' : '';
    if (exHash && !exPreview) missingExample.push({ scope, id, hash: exHash });
    const item: CharRefHydrateRow = {
      id,
      scope,
      hash,
      configured: Boolean(hash),
      preview_url: preview,
      example_hash: exHash,
      example_configured: Boolean(exHash),
      example_preview_url: exPreview,
    };
    if (scope === GLOBAL_SCOPE) global.push(item);
    else session.push(item);
  }
  // Background warm (max 4 concurrent) so scrolling fills thumbnails without
  // blocking the first paint. Fire-and-forget by design. Each warmed preview
  // is published so open tabs paint it immediately — without this the tab
  // would stay imageless until the next full repaint (tab switch), because
  // the fast path above already answered '' for these rows.
  if (missing.length || missingExample.length) {
    void (async () => {
      const POOL = 4;
      // Ref and example warms run concurrently so a slow ref queue cannot
      // starve example tiles (or vice versa).
      const warmRefs = (async () => {
        for (let i = 0; i < missing.length; i += POOL) {
          await Promise.all(
            missing.slice(i, i + POOL).map(async (m) => {
              const url = await ensureCharRefPreviewUrl(m.scope, m.id).catch(() => '');
              if (!url) return;
              // The row may have been re-saved while warming; never publish a
              // preview for a hash that is no longer current.
              const current = await readRosterRefHash(m.scope, m.id).catch(() => '');
              if (!current || current !== m.hash) return;
              publishCharacterImage({ scope: m.scope, id: m.id, kind: 'ref', url, hash: m.hash, configured: true });
            }),
          );
        }
      })();
      const warmExamples = (async () => {
        for (let i = 0; i < missingExample.length; i += POOL) {
          await Promise.all(
            missingExample.slice(i, i + POOL).map(async (m) => {
              const bytes = await getCharRefAssetBytes(m.hash).catch(() => null);
              if (!bytes || bytes.byteLength < MIN_IMAGE_BYTES) return;
              const url = pngToDataUrl(bytes);
              setExamplePreviewUrl(m.scope, m.id, url);
              const row = await idbGet('characters', { scope: m.scope, id: m.id }).catch(() => null);
              const current = sanitizeHash((row as { example_hash?: unknown } | null)?.example_hash);
              if (!current || current !== m.hash) return;
              publishCharacterImage({ scope: m.scope, id: m.id, kind: 'example', url, hash: m.hash, configured: true });
            }),
          );
        }
      })();
      await Promise.all([warmRefs, warmExamples]);
    })();
  }
  return { session, global };
}

/** @deprecated Boot no longer decodes every ref. Kept so callers compile. */
export async function hydrateCharRefPreviews(): Promise<void> {
  return;
}

export async function resetAllCharacterRefs(): Promise<ApiResult> {
  const rows = await idbGetAll('characters');
  let cleared = 0;
  for (const row of rows) {
    const hasLegacyPath = Object.prototype.hasOwnProperty.call(row, 'ref_path');
    if (!sanitizeHash(row.ref_hash) && !row.ref_hash && !hasLegacyPath) continue;
    const next = withoutLegacyRefPath({ ...row, ref_hash: '', updated_at: Date.now() / 1000 });
    await idbPut('characters', next);
    cleared += 1;
  }
  for (const row of await idbGetAll('meta')) {
    const key = String((row as MetaRow)?.key || '');
    if (isCharRefMetaKey(key) || key.startsWith(CHAR_REF_VIBE_PREFIX) || key.startsWith('char_ref_')) {
      await idbDelete('meta', key);
    }
  }
  clearAllCharRefPreviewUrls();
  const library = await resetCharRefLibrary();
  return { ok: true, cleared, removed: (library as { removed?: number }).removed || 0 };
}
