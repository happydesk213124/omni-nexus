/** Store-method ZIP + gallery manifest / reattach helpers (no deps). */
import { asU8, concatChunks, sniffImageMime } from '../core/util/bytes.ts';

/** Anything the ported call sites hand over as entry payloads. */
export type ByteSource = Uint8Array | ArrayBufferLike | number[] | null | undefined;

export interface ZipEntryInput {
  name?: string;
  data?: ByteSource;
}

/** One card as it is written into an export manifest. */
export interface GalleryExportItem {
  id?: string;
  file?: string;
  folder_key?: string;
  export_ext?: string;
  character_id?: string;
  chat_id?: string;
  character_name?: string;
  chat_name?: string;
  char_index?: number;
  chat_index?: number;
  message_index?: number;
  content_hash?: string;
  paragraph?: number;
  shot_index?: number;
  y_percent?: number | null;
  assistant_preview?: string;
  session_id?: string;
  main_prompt?: string;
  seed?: number | null;
  created_at?: number | null;
  characters?: unknown[];
  [key: string]: unknown;
}

export interface GalleryManifestLocation {
  character_id: string;
  chat_id: string;
  character_name: string;
  chat_name: string;
  char_index: number;
  chat_index: number;
  message_index: number;
  content_hash: string;
  paragraph: number;
  shot_index: number;
  y_percent: number | null;
  assistant_preview: string;
  session_id: string;
}

export interface GalleryManifestMeta {
  main_prompt: string;
  seed: number | null;
  created_at: number | null;
  characters: unknown[];
}

export interface GalleryManifestEntry {
  id: string;
  file: string;
  location: GalleryManifestLocation;
  meta: GalleryManifestMeta;
}

export interface GalleryManifest {
  format: string;
  version: number;
  exported_at: number;
  items: GalleryManifestEntry[];
}

/** Existing card a manifest item may reattach to. */
export interface ReattachCard {
  id?: string;
  content_hash?: string;
  character_id?: string;
  chat_id?: string;
  message_index?: number;
  [key: string]: unknown;
}

export interface ReattachCandidate {
  id?: string;
  content_hash?: string;
  message_index?: number;
}

export type ReattachResult =
  | { status: 'exact'; matchId: string; content_hash: string }
  | { status: 'candidate'; candidates: ReattachCandidate[]; location: Partial<GalleryManifestLocation> }
  | { status: 'orphan'; location: Partial<GalleryManifestLocation> };

export interface UnpackedGalleryZip {
  /** Parsed straight from `manifest.json`; the shape is not validated. */
  manifest: GalleryManifest | null;
  images: Map<string, Uint8Array>;
  files: Map<string, Uint8Array>;
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function toBytes(value: ByteSource): Uint8Array {
  if (Array.isArray(value)) return new Uint8Array(value);
  return asU8(value);
}

/** CRC-32 (IEEE) of the bytes, as an unsigned 32-bit number. */
export function crc32(bytes: ByteSource): number {
  const u8 = toBytes(bytes);
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i += 1) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n >>> 0, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  return concatChunks(parts, total);
}

function encodeUtf8(text: unknown): Uint8Array {
  return new TextEncoder().encode(String(text ?? ''));
}

/** Language encoding flag — filename/comment are UTF-8. Without this, Explorer reads CP437. */
const ZIP_UTF8_FLAG = 0x0800;

/** Build an uncompressed (store) ZIP from { name, data:Uint8Array } entries. */
export function buildStoreZip(entries: ZipEntryInput[] = []): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encodeUtf8(entry.name || 'file');
    const data = toBytes(entry.data);
    const crc = crc32(data);
    // No 0x7075 Unicode Path extra. Explorer's zip folder treats that extra as
    // a broken archive ("이 파일은 손상된 파일입니다") even though 7-Zip is fine.
    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(ZIP_UTF8_FLAG),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    const central = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(ZIP_UTF8_FLAG),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralDir = concatBytes(centrals);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return concatBytes([...locals, centralDir, end]);
}

function readU16(u8: Uint8Array, off: number): number {
  return u8[off] | (u8[off + 1] << 8);
}

function readU32(u8: Uint8Array, off: number): number {
  return (u8[off] | (u8[off + 1] << 8) | (u8[off + 2] << 16) | (u8[off + 3] << 24)) >>> 0;
}

/** Parse store-method ZIP only (method 0). Returns Map(name -> Uint8Array). */
export function parseStoreZip(bytes: ByteSource): Map<string, Uint8Array> {
  const u8 = toBytes(bytes);
  const files = new Map<string, Uint8Array>();
  let i = 0;
  while (i + 30 <= u8.length) {
    const sig = readU32(u8, i);
    if (sig === 0x02014b50 || sig === 0x06054b50) break;
    if (sig !== 0x04034b50) {
      i += 1;
      continue;
    }
    const method = readU16(u8, i + 8);
    const compSize = readU32(u8, i + 18);
    const nameLen = readU16(u8, i + 26);
    const extraLen = readU16(u8, i + 28);
    const nameStart = i + 30;
    const name = new TextDecoder().decode(u8.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > u8.length) break;
    if (method === 0) files.set(name.replace(/\\/g, '/'), u8.subarray(dataStart, dataEnd));
    i = dataEnd;
  }
  return files;
}

/** Drop `:` `*` and the rest so a character name can be a ZIP folder. */
export function sanitizeZipName(raw: unknown, fallback = 'file'): string {
  const cut = String(raw || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80);
  return cut || fallback;
}

/** Stored shots are WebP; keep PNG/JPEG only when the bytes really are. */
export function galleryImageExt(bytes: ByteSource | null | undefined): 'webp' | 'png' | 'jpg' {
  const mime = sniffImageMime(toBytes(bytes));
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg') return 'jpg';
  return 'png';
}

/** Swap `.png` / `.webp` / `.jpg` on a ZIP path without touching the stem. */
export function withGalleryExt(fileName: unknown, ext: string): string {
  const raw = String(fileName || '').replace(/\\/g, '/');
  const safe = /^(webp|png|jpe?g)$/i.test(ext) ? ext.toLowerCase().replace(/^jpeg$/, 'jpg') : 'webp';
  if (/\.(png|webp|jpe?g)$/i.test(raw)) return raw.replace(/\.(png|webp|jpe?g)$/i, `.${safe}`);
  return raw ? `${raw}.${safe}` : `image.${safe}`;
}

/** The download stem, before the newest-first 000001_ prefix. */
export function originalGalleryFileName(
  item: GalleryExportItem | null | undefined,
  ext: string = 'webp',
): string {
  const char = sanitizeZipName(item?.character_name, 'inlay');
  const msg = Number(item?.message_index);
  const shot = Number(item?.shot_index);
  const msgPart = Number.isFinite(msg) && msg >= 0 ? String(msg + 1) : 'x';
  const shotPart = Number.isFinite(shot) && shot >= 0 ? String(shot + 1) : '1';
  const safe = /^(webp|png|jpe?g)$/i.test(ext) ? ext.toLowerCase().replace(/^jpeg$/, 'jpg') : 'webp';
  return `${char}_msg${msgPart}_s${shotPart}.${safe}`;
}

/** `000001_foo.png` → `foo.png`. Leaves unprefixed names alone. */
export function stripExportSeqPrefix(fileName: unknown): string {
  const raw = String(fileName || '').replace(/\\/g, '/');
  const base = raw.split('/').pop() || raw;
  return base.replace(/^\d{6}_/, '');
}

export type GalleryExportNest = 'chat' | 'character-chat';

function uniqueZipDir(base: string, taken: Set<string>): string {
  const stem = base || 'folder';
  let out = stem;
  let n = 2;
  while (taken.has(out)) out = `${stem}_${n++}`;
  taken.add(out);
  return out;
}

function folderRoomKey(item: GalleryExportItem): string {
  return String(item.folder_key || `${item.character_id || ''}|${item.chat_id || ''}` || '_');
}

function chatZipLeaf(item: GalleryExportItem): string {
  return sanitizeZipName(item.chat_name, '') || sanitizeZipName(item.character_name, 'chat');
}

/**
 * Newest image in each explorer room is `000001_…`.
 * `chat` = `{chat}/000001_…` (한 캐릭터 ZIP).
 * `character-chat` = `{character}/{chat}/000001_…` (전체 ZIP).
 */
export function assignGalleryExportFiles(
  items: GalleryExportItem[] = [],
  { nest = 'chat' }: { nest?: GalleryExportNest } = {},
): GalleryExportItem[] {
  const roomDirs = new Map<string, string>();
  const charDirs = new Map<string, string>();
  const takenChars = new Set<string>();
  const takenChats = new Map<string, Set<string>>();
  const byFolder = new Map<string, GalleryExportItem[]>();
  for (const item of items) {
    const key = folderRoomKey(item);
    const list = byFolder.get(key) || [];
    list.push(item);
    byFolder.set(key, list);
  }
  const out: GalleryExportItem[] = [];
  for (const list of byFolder.values()) {
    list.sort((a, b) => {
      if (typeof a.asset_order === 'number' && typeof b.asset_order === 'number') return b.asset_order - a.asset_order;
      const dt = (Number(b.created_at) || 0) - (Number(a.created_at) || 0);
      if (dt) return dt;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
    const head = list[0] || {};
    const room = folderRoomKey(head);
    let dir = roomDirs.get(room);
    if (!dir) {
      const chat = chatZipLeaf(head);
      if (nest === 'character-chat') {
        const ck = String(head.character_id || head.character_name || 'folder');
        let charDir = charDirs.get(ck);
        if (!charDir) {
          charDir = uniqueZipDir(sanitizeZipName(head.character_name, 'folder'), takenChars);
          charDirs.set(ck, charDir);
        }
        const chats = takenChats.get(charDir) || new Set<string>();
        const chatDir = uniqueZipDir(chat, chats);
        takenChats.set(charDir, chats);
        dir = `${charDir}/${chatDir}`;
      } else {
        const chats = takenChats.get('_') || new Set<string>();
        dir = uniqueZipDir(chat, chats);
        takenChats.set('_', chats);
      }
      roomDirs.set(room, dir);
    }
    list.forEach((item, i) => {
      const seq = String(i + 1).padStart(6, '0');
      const ext = typeof item.export_ext === 'string' ? item.export_ext : 'webp';
      out.push({ ...item, file: `${dir}/${seq}_${originalGalleryFileName(item, ext)}` });
    });
  }
  return out;
}

/** Prefer the manifest path, then the old `images/{id}.png`, then basename / stripped prefix. */
export function lookupZipImage(
  images: Map<string, Uint8Array>,
  item: { file?: string; id?: string } | null | undefined,
): Uint8Array | undefined {
  if (!images?.size) return undefined;
  const file = String(item?.file || '').replace(/\\/g, '/');
  if (file && images.has(file)) return images.get(file);
  const id = String(item?.id || '');
  if (id) {
    for (const ext of ['png', 'webp', 'jpg', 'jpeg']) {
      const legacy = `images/${id}.${ext}`;
      if (images.has(legacy)) return images.get(legacy);
    }
  }
  const wantStem = stripExportSeqPrefix(file.split('/').pop() || '').replace(/\.(png|webp|jpe?g)$/i, '');
  for (const [name, data] of images) {
    const base = name.replace(/\\/g, '/').split('/').pop() || '';
    const stem = stripExportSeqPrefix(base).replace(/\.(png|webp|jpe?g)$/i, '');
    if (id && stem === id) return data;
    if (wantStem && stem === wantStem) return data;
  }
  return undefined;
}

/** Describe an export set: one entry per card, with its file path, location and prompt meta. */
export function buildGalleryManifest(
  items: GalleryExportItem[] = [],
  { exportedAt = Date.now() }: { exportedAt?: number } = {},
): GalleryManifest {
  return {
    format: 'inlay-nexus-gallery',
    version: 1,
    exported_at: exportedAt,
    items: (items || []).map((item) => ({
      id: String(item.id || ''),
      file: String(item.file || `images/${String(item.id || 'unknown')}.png`).replace(/\\/g, '/'),
      location: {
        character_id: item.character_id || '',
        chat_id: item.chat_id || '',
        character_name: item.character_name || '',
        chat_name: item.chat_name || '',
        char_index: item.char_index ?? -1,
        chat_index: item.chat_index ?? -1,
        message_index: item.message_index ?? -1,
        content_hash: item.content_hash || '',
        paragraph: item.paragraph ?? 0,
        shot_index: item.shot_index ?? 0,
        y_percent: item.y_percent ?? null,
        assistant_preview: item.assistant_preview || '',
        session_id: item.session_id || '',
      },
      meta: {
        main_prompt: item.main_prompt || '',
        seed: item.seed ?? null,
        created_at: item.created_at ?? null,
        characters: item.characters || [],
      },
    })),
  };
}

/**
 * Decide reattach status for one manifest item against existing cards.
 * Exact content_hash hit wins; otherwise same character/chat/message rows become
 * candidates, and anything else is an orphan.
 */
export function resolveReattach(
  item: { location?: Partial<GalleryManifestLocation> | null } | null | undefined,
  existingCards: ReattachCard[] = [],
): ReattachResult {
  const loc: Partial<GalleryManifestLocation> = item?.location || {};
  const hash = String(loc.content_hash || '').trim();
  const cards = existingCards || [];
  if (hash) {
    const hit = cards.find((c) => String(c.content_hash || '') === hash);
    if (hit) return { status: 'exact', matchId: String(hit.id), content_hash: hash };
  }
  const cid = String(loc.character_id || '');
  const chid = String(loc.chat_id || '');
  const mi = Number(loc.message_index);
  const candidates = cards.filter((c) => {
    if (cid && String(c.character_id || '') !== cid) return false;
    if (chid && String(c.chat_id || '') !== chid) return false;
    if (Number.isFinite(mi) && mi >= 0 && Number(c.message_index) !== mi) return false;
    return !!(cid || chid || (Number.isFinite(mi) && mi >= 0));
  }).slice(0, 8);
  if (candidates.length) {
    return {
      status: 'candidate',
      candidates: candidates.map((c) => ({ id: c.id, content_hash: c.content_hash, message_index: c.message_index })),
      location: loc,
    };
  }
  return { status: 'orphan', location: loc };
}

/** Pack manifest + image files into the gallery export archive. */
export function packGalleryZip(files: ZipEntryInput[] = []): Uint8Array {
  // files: [{ name, data }]
  return buildStoreZip(files);
}

/** Split a gallery archive into its manifest, its images, and every raw entry. */
export function unpackGalleryZip(bytes: ByteSource): UnpackedGalleryZip {
  const map = parseStoreZip(bytes);
  let manifest: GalleryManifest | null = null;
  const manifestBytes = map.get('manifest.json');
  if (manifestBytes) {
    try {
      manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as GalleryManifest;
    } catch {
      manifest = null;
    }
  }
  const images = new Map<string, Uint8Array>();
  for (const [name, data] of map.entries()) {
    if (name === 'manifest.json') continue;
    if (/\.(png|webp|jpe?g)$/i.test(name)) images.set(name.replace(/\\/g, '/'), data);
  }
  return { manifest, images, files: map };
}
