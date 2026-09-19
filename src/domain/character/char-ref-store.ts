/**
 * Pure rules for the module-backed character reference store.
 * Bytes live in a Risu module; the roster only keeps a content hash.
 */
import { cleanText } from '../../core/util/text.ts';

export {
  CHAR_REF_STORE_MAX_WIDTH,
  CHAR_REF_STORE_WEBP_QUALITY,
  charRefStoreSize,
} from '../../core/util/char-ref-size.ts';

export const CHAR_REF_ASSET_PREFIX = 'inxref_';
export const CHAR_REF_MODULE_ID = 'inlay-char-ref';
export const CHAR_REF_MODULE_NS = 'inlay.char_ref';
export const CHAR_REF_MODULE_NAME = '⚛️Omni Nexus 참고이미지';

export function isCharRefAssetName(name: unknown): boolean {
  const n = cleanText(name, 400).toLowerCase();
  return n.startsWith(CHAR_REF_ASSET_PREFIX);
}

export function charRefAssetName(hash: string, ext = 'webp'): string {
  const h = sanitizeHash(hash);
  const e = String(ext || 'webp').toLowerCase().replace(/[^a-z0-9]/g, '') || 'webp';
  return h ? `${CHAR_REF_ASSET_PREFIX}${h}.${e}` : '';
}

export function hashFromCharRefAssetName(name: unknown): string {
  const n = cleanText(name, 400);
  const lower = n.toLowerCase();
  if (!lower.startsWith(CHAR_REF_ASSET_PREFIX)) return '';
  return sanitizeHash(n.slice(CHAR_REF_ASSET_PREFIX.length).replace(/\.[a-z0-9]+$/i, ''));
}

/** Risu getDatabase may wrap arrays; accept array-likes and {name,path} rows. */
export function asUnknownArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && typeof (raw as { length?: unknown }).length === 'number') {
    try {
      return Array.from(raw as ArrayLike<unknown>);
    } catch {
      return [];
    }
  }
  return [];
}

export function parseCharRefModuleAssets(raw: unknown): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  for (const row of asUnknownArray(raw)) {
    if (Array.isArray(row) && row.length >= 2) {
      const name = cleanText(row[0], 400);
      const path = cleanText(row[1], 800);
      const ext = cleanText(row[2], 400) || extFromName(name);
      if (name && path) out.push([name, path, ext]);
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const name = cleanText(rec.name ?? rec.assetName ?? rec.fileName, 400);
    const path = cleanText(rec.key ?? rec.path ?? rec.id ?? rec.asset, 800);
    const ext = cleanText(rec.ext ?? rec.type, 400) || extFromName(name);
    if (name && path) out.push([name, path, ext]);
  }
  return out;
}

function extFromName(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return (m?.[1] || 'webp').toLowerCase();
}

export function sanitizeHash(raw: unknown): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-f0-9]/g, '')
    .slice(0, 64);
}
