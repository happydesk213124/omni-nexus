/**
 * Per-character 예제샷. Separate from ref_hash / vibe.
 */

import type { ApiResult, CharacterRecord } from '../core/types';
import { GLOBAL_SCOPE, normalizeCharRefScope } from '../core/constants';
import { PRESET_LOOK_WEBP_QUALITY } from '../core/util/char-ref-size';
import { base64ToBytes, bytesToBase64, u8ToArrayBuffer } from '../core/util/bytes';
import { cleanText } from '../core/util/text';
import { sanitizeHash } from '../domain/character/char-ref-store';
import { pngToDataUrl } from '../storage/image-urls';
import { getCharRefAssetBytes, putCharRefAsset } from './char-ref-module';
import { generateCharacterPreview } from './character-preview';
import { listCharacters, upsertCharacter } from './characters';
import { getExamplePreviewUrl, setExamplePreviewUrl } from './context';

const MIN_IMAGE_BYTES = 32;

async function findRow(scope: string, characterId: string): Promise<CharacterRecord | null> {
  const id = cleanText(characterId, 80);
  if (!id) return null;
  const scopes = [scope, GLOBAL_SCOPE].filter(Boolean);
  for (const s of [...new Set(scopes)]) {
    const hit = (await listCharacters(s)).find((c) => c.id === id);
    if (hit) return { ...hit, scope: hit.scope || s };
  }
  return null;
}

async function persistHash(scope: string, characterId: string, hash: string, preview: string): Promise<void> {
  const row = await findRow(scope, characterId);
  if (!row) throw new Error('character not found');
  await upsertCharacter(String(row.scope || scope), { ...row, example_hash: hash });
  setExamplePreviewUrl(scope, characterId, preview);
}

export async function getCharacterExample(scope: unknown, characterId: unknown): Promise<ApiResult> {
  const sid = normalizeCharRefScope(scope) || cleanText(scope, 200);
  const cid = cleanText(characterId, 80);
  if (!cid) throw new Error('character_id required');
  if (!sid) throw new Error('scope required');
  const row = await findRow(sid, cid);
  const hash = sanitizeHash(row?.example_hash);
  if (!hash) {
    return { ok: true, character_id: cid, scope: sid, configured: false, preview_url: '', example_hash: '' };
  }
  let preview = getExamplePreviewUrl(sid, cid);
  if (!preview) {
    const bytes = await getCharRefAssetBytes(hash);
    if (bytes && bytes.byteLength >= MIN_IMAGE_BYTES) {
      preview = pngToDataUrl(bytes);
      setExamplePreviewUrl(sid, cid, preview);
    }
  }
  return {
    ok: true,
    character_id: cid,
    scope: sid,
    configured: true,
    example_hash: hash,
    preview_url: preview,
    image_b64: preview ? preview.split(',', 2)[1] || '' : '',
  };
}

export async function setCharacterExample(
  scope: unknown,
  characterId: unknown,
  png: ArrayBuffer,
): Promise<ApiResult> {
  const sid = normalizeCharRefScope(scope) || cleanText(scope, 200);
  const cid = cleanText(characterId, 80);
  if (!cid) throw new Error('character_id required');
  if (!sid) throw new Error('scope required');
  if (!png || png.byteLength < MIN_IMAGE_BYTES) throw new Error('예제샷이 비어 있습니다');
  const stored = await putCharRefAsset(png, { quality: PRESET_LOOK_WEBP_QUALITY });
  const preview = pngToDataUrl(stored.bytes);
  await persistHash(sid, cid, stored.hash, preview);
  return {
    ok: true,
    character_id: cid,
    scope: sid,
    configured: true,
    example_hash: stored.hash,
    preview_url: preview,
    image_b64: bytesToBase64(stored.bytes),
    bytes: stored.bytes.byteLength,
  };
}

export async function clearCharacterExample(scope: unknown, characterId: unknown): Promise<ApiResult> {
  const sid = normalizeCharRefScope(scope) || cleanText(scope, 200);
  const cid = cleanText(characterId, 80);
  if (!cid) throw new Error('character_id required');
  if (!sid) throw new Error('scope required');
  const row = await findRow(sid, cid);
  if (row) await upsertCharacter(String(row.scope || sid), { ...row, example_hash: '' });
  setExamplePreviewUrl(sid, cid, '');
  return { ok: true, character_id: cid, scope: sid, configured: false, preview_url: '', example_hash: '' };
}

export async function generateCharacterExample(body: Record<string, unknown>): Promise<ApiResult> {
  const fromChar = body.character && typeof body.character === 'object'
    ? (body.character as { id?: unknown }).id
    : '';
  const cid = cleanText(body.character_id || body.characterId || body.id || fromChar, 80);
  const sid = normalizeCharRefScope(body.scope, body.session_id) || cleanText(body.session_id || body.scope, 200);
  const shot = await generateCharacterPreview({ ...body, example_shot: true }) as Record<string, unknown>;
  const b64 = String(shot.image_b64 || '');
  if (!b64) throw new Error('예제샷 생성 실패');
  const bytes = u8ToArrayBuffer(base64ToBytes(b64));
  if (cid && sid) return setCharacterExample(sid, cid, bytes);
  return shot;
}
