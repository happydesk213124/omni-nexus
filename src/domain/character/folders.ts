import { splitTagTokens } from '../../core/util/text';

/**
 * Folders of the 캐릭터 tab and the 스타일 프리셋 tab. A folder holds its members' ids; a character's own record is
 * never touched, so a roster with no folder reads, saves and exports exactly as before.
 *
 * A character folder may also carry looks its members share (폴더 공통 태그). They are joined to a member only as a
 * shot is built, on a copy of the roster: nothing is written into the member, so editing the folder changes every
 * member's next picture, and a member moved out is itself again.
 */
export const FOLDER_LOOK_FIELDS = ['appearance', 'hair_color', 'hair_style', 'eye_color', 'height', 'age', 'attire', 'bottoms', 'accessories'] as const;
export type FolderLookField = typeof FOLDER_LOOK_FIELDS[number];
export interface ItemFolder { id: string; name: string; members: string[] }
export type LookFolder = ItemFolder & Partial<Record<FolderLookField, string>>;
/** `order`: the 캐릭터 tab's tiles as the user arranged them, per roster (ids; anyone not listed follows in the roster's own order). */
export interface FolderData { version: 1; characters: Record<string, LookFolder[]>; presets: ItemFolder[]; order?: Record<string, string[]> }

const text = (value: unknown, max: number): string => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const FOLDER_MAX = 200, MEMBER_MAX = 2000;

function folder(raw: unknown, looks: boolean, seen: Set<string>, taken: Set<string>): LookFolder | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>, id = text(row.id, 80), name = text(row.name, 80);
  if (!id || !name || seen.has(id)) return null;
  seen.add(id);
  // One folder per item: the first folder that names it keeps it.
  const members = (Array.isArray(row.members) ? row.members : []).map(v => text(v, 200)).filter(member => member && !taken.has(member) && (taken.add(member), true)).slice(0, MEMBER_MAX);
  const out: LookFolder = { id, name, members };
  if (looks) for (const field of FOLDER_LOOK_FIELDS) { const value = text(row[field], 2000); if (value) out[field] = value; }
  return out;
}
export function normalizeFolderList(raw: unknown, looks: boolean): LookFolder[] {
  const seen = new Set<string>(), taken = new Set<string>();
  return (Array.isArray(raw) ? raw : []).flatMap(row => { const made = folder(row, looks, seen, taken); return made ? [made] : []; }).slice(0, FOLDER_MAX);
}
export function normalizeFolderData(raw: unknown): FolderData {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const lists = data.characters && typeof data.characters === 'object' && !Array.isArray(data.characters) ? data.characters as Record<string, unknown> : {};
  const characters: Record<string, LookFolder[]> = {};
  for (const [scope, list] of Object.entries(lists)) { const folders = normalizeFolderList(list, true); if (scope && folders.length) characters[scope] = folders; }
  const orders = data.order && typeof data.order === 'object' && !Array.isArray(data.order) ? data.order as Record<string, unknown> : {};
  const order: Record<string, string[]> = {};
  for (const [scope, list] of Object.entries(orders)) { const ids = normalizeOrder(list); if (scope && ids.length) order[scope] = ids; }
  // No order saved: no key, so a save without one is as it was.
  return { version: 1, characters, presets: normalizeFolderList(data.presets, false), ...(Object.keys(order).length ? { order } : {}) };
}

export function normalizeOrder(raw: unknown): string[] {
  return [...new Set((Array.isArray(raw) ? raw : []).map(v => text(v, 200)).filter(Boolean))].slice(0, MEMBER_MAX);
}
/** `ids` as they stand, with `moving` taken out and set down before or after `target`. */
export function reorderIds(ids: readonly string[], moving: readonly string[], target: string, side: 'before' | 'after'): string[] {
  const lifted = new Set(moving), rest = ids.filter(id => !lifted.has(id)), at = rest.indexOf(target);
  if (at < 0 || lifted.has(target)) return [...ids];
  rest.splice(at + (side === 'after' ? 1 : 0), 0, ...ids.filter(id => lifted.has(id)));
  return rest;
}

export const folderOf = <T extends ItemFolder>(folders: readonly T[], member: string): T | undefined => folders.find(f => f.members.includes(member));
/** The members moved into `folderId` ('' : out of every folder), each in one folder only. */
export function moveToFolder<T extends ItemFolder>(folders: readonly T[], members: readonly string[], folderId: string): T[] {
  const moving = new Set(members);
  return folders.map(f => {
    const kept = f.members.filter(member => !moving.has(member));
    return { ...f, members: f.id === folderId ? [...kept, ...members.filter(member => !kept.includes(member))] : kept };
  });
}
/** A folder the LLM named (by its name, case and spacing aside); none when it names nothing we have. */
export function folderNamed<T extends ItemFolder>(folders: readonly T[], name: unknown): T | undefined {
  const key = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const wanted = key(text(name, 80));
  return wanted ? folders.find(f => key(f.name) === wanted) : undefined;
}
export function folderHasLooks(f: LookFolder): boolean { return FOLDER_LOOK_FIELDS.some(field => !!f[field]); }

type Looks = Partial<Record<FolderLookField, unknown>>;
/**
 * A member as a shot sees it. 외형 태그 are joined (the folder's first, each tag once): they are a list, and a
 * folder's are meant to go with whatever the member has. Every other field is one value (a hair colour, an outfit),
 * so the member's own wins and the folder's fills only what the member left empty.
 */
export function withFolderLooks<T extends Looks>(row: T, f: LookFolder | undefined): T {
  if (!f || !folderHasLooks(f)) return row;
  const out: Looks = { ...row };
  for (const field of FOLDER_LOOK_FIELDS) {
    const shared = f[field];
    if (!shared) continue;
    const own = typeof row[field] === 'string' ? (row[field] as string).trim() : '';
    if (field === 'appearance') {
      const seen = new Set<string>();
      out.appearance = [...splitTagTokens(shared), ...splitTagTokens(own)].filter(tag => { const k = tag.toLowerCase(); return !seen.has(k) && (seen.add(k), true); }).join(', ');
    } else if (!own) out[field] = shared;
  }
  return out as T;
}
/** What the character LLM is shown of the folders: each name, and the looks its members share (to file a new person by). */
export function folderBrief(folders: readonly LookFolder[]): Array<{ name: string; looks?: string }> {
  return folders.map(f => { const looks = FOLDER_LOOK_FIELDS.map(field => f[field]).filter(Boolean).join(', ').slice(0, 300); return looks ? { name: f.name, looks } : { name: f.name }; });
}
