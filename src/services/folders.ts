import { FOLDERS_KEY, GLOBAL_SCOPE } from '../core/constants';
import { cleanText } from '../core/util/text';
import { folderBrief, folderNamed, folderOf, moveToFolder, normalizeFolderData, normalizeFolderList, withFolderLooks, type FolderData, type FolderLookField, type ItemFolder, type LookFolder } from '../domain/character/folders';
import { psGet, psSet } from '../storage/device-store';
import { characterIdForRosterScope } from '../storage/character-roster';

/**
 * 폴더 of the 캐릭터 tab (per bot, and one list for 전역 로스터) and of the 스타일 프리셋 tab. Kept in plugin storage,
 * beside the rosters and never in them: filing a character rewrites no bot, and a save with no folder is as it was.
 */
let cache: FolderData | null = null;
let writes: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

async function load(): Promise<FolderData> { return cache ??= normalizeFolderData(await psGet(FOLDERS_KEY)); }
function save(): Promise<void> {
  const data = cache!;
  const done = writes.then(() => psSet(FOLDERS_KEY, data)).then(() => undefined);
  writes = done.catch(() => undefined);
  for (const listener of listeners) listener();
  return done;
}
/** The 캐릭터 or 프리셋 tab redraws when folders change under it (a new character filed by the LLM). */
export function onFoldersChange(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** A roster's folder list: 전역 로스터's, or the bot's that owns the roster scope (any of its ids). */
async function ownerKey(scope: string, characterId = ''): Promise<string> {
  if (scope === GLOBAL_SCOPE) return GLOBAL_SCOPE;
  return cleanText(characterId, 200) || await characterIdForRosterScope(scope).catch(() => '') || '';
}
export async function characterFolders(scope: string, characterId = ''): Promise<LookFolder[]> {
  const key = await ownerKey(scope, characterId);
  return key ? (await load()).characters[key] || [] : [];
}
export async function saveCharacterFolders(scope: string, characterId: string, folders: unknown): Promise<LookFolder[]> {
  const key = await ownerKey(scope, characterId);
  if (!key) throw new Error('폴더를 저장할 캐릭터 목록을 찾지 못했습니다.');
  const data = await load(), list = normalizeFolderList(folders, true);
  if (list.length) data.characters[key] = list; else delete data.characters[key];
  await save();
  return list;
}
export async function presetFolders(): Promise<ItemFolder[]> { return (await load()).presets; }
export async function savePresetFolders(folders: unknown): Promise<ItemFolder[]> {
  const data = await load();
  data.presets = normalizeFolderList(folders, false);
  await save();
  return data.presets;
}

type Row = { id?: string; scope?: string } & Partial<Record<FolderLookField, unknown>>;
/**
 * The roster as a shot is built from it: each filed character with its folder's shared looks joined in. A copy, never
 * the saved rows (those come back through the roster writes). With no folder anywhere the rows return as they came.
 */
export async function rosterWithFolderLooks<T extends Row>(rows: T[], characterId: string): Promise<T[]> {
  const data = await load();
  const own = data.characters[cleanText(characterId, 200)] || [], shared = data.characters[GLOBAL_SCOPE] || [];
  if (!own.length && !shared.length) return rows;
  return rows.map(row => {
    const id = cleanText(row.id, 200);
    if (!id) return row;
    // A row says whose it is; one that does not is looked for in the bot's folders, then 전역 로스터's.
    const folder = row.scope === GLOBAL_SCOPE ? folderOf(shared, id) : folderOf(own, id) || (row.scope ? undefined : folderOf(shared, id));
    return withFolderLooks(row, folder);
  });
}
/** The folders the character LLM may file a new person in: none listed when the roster has none (the request is as before). */
export async function folderListForLlm(scope: string, characterId: string): Promise<Array<{ name: string; looks?: string }>> {
  return folderBrief(await characterFolders(scope, characterId));
}
/** A person the LLM just made, filed in the folder it named. Someone already in a folder stays there. */
export async function fileNewCharacter(scope: string, characterId: string, memberId: string, folderName: unknown): Promise<void> {
  const key = await ownerKey(scope, characterId);
  if (!key || !memberId) return;
  const data = await load(), folders = data.characters[key] || [], target = folderNamed(folders, folderName);
  if (!target || folderOf(folders, memberId)) return;
  data.characters[key] = moveToFolder(folders, [memberId], target.id);
  await save();
}
/** For tests: forget what was read. */
export function resetFolderCache(): void { cache = null; }
