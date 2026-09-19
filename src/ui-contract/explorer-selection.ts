/** Pure explorer selection + sort helpers (no DOM). */

export interface SelectionState {
  selected: Set<string>;
  anchorId: string;
  focusId: string;
}

/** The only fields the explorer grid reads off a card row. */
export interface ExplorerItem {
  id?: string;
  created_at?: number;
  message_index?: number;
  shot_index?: number;
  [key: string]: unknown;
}

export interface ExplorerClickOptions {
  index?: number;
  ids?: Array<string | number>;
  shift?: boolean;
  ctrl?: boolean;
}

export type ExplorerSortMode = 'newest' | 'oldest' | 'message' | 'shot';

export type ThumbSize = 's' | 'm' | 'l';

/** Fresh selection state seeded with already-selected ids. */
export function createSelectionState(ids: Array<string | number> = []): SelectionState {
  return {
    selected: new Set((ids || []).map(String).filter(Boolean)),
    anchorId: '',
    focusId: '',
  };
}

/** Ids of the currently rendered rows, in render order. */
export function visibleIds(items: Array<ExplorerItem | null | undefined> = []): string[] {
  return (items || []).map((item) => String(item?.id || '')).filter(Boolean);
}

/** Next selection state for a click, honouring shift-range and ctrl-toggle. */
export function applyExplorerClick(
  state: SelectionState | null | undefined,
  id: string,
  { index, ids, shift = false, ctrl = false }: ExplorerClickOptions = {},
): SelectionState {
  const next: SelectionState = {
    selected: new Set(state?.selected || []),
    anchorId: String(state?.anchorId || ''),
    focusId: String(state?.focusId || ''),
  };
  const target = String(id || '');
  if (!target) return next;
  const list = Array.isArray(ids) ? ids.map(String) : [];
  const idx = typeof index === 'number' && Number.isFinite(index) ? index : list.indexOf(target);

  if (shift && next.anchorId && list.length) {
    const a = list.indexOf(next.anchorId);
    const b = idx >= 0 ? idx : list.indexOf(target);
    if (a >= 0 && b >= 0) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      next.selected = new Set(list.slice(lo, hi + 1));
      next.focusId = target;
      return next;
    }
  }

  if (ctrl) {
    if (next.selected.has(target)) next.selected.delete(target);
    else next.selected.add(target);
    next.anchorId = target;
    next.focusId = target;
    return next;
  }

  next.selected = new Set([target]);
  next.anchorId = target;
  next.focusId = target;
  return next;
}

/** Select every visible id, keeping the existing anchor/focus when there is one. */
export function selectAll(state: SelectionState | null | undefined, ids: Array<string | number> = []): SelectionState {
  return {
    selected: new Set((ids || []).map(String).filter(Boolean)),
    anchorId: String(state?.anchorId || ids?.[0] || ''),
    focusId: String(state?.focusId || ids?.[0] || ''),
  };
}

/** Empty selection that keeps the anchor so a following shift-click still works. */
export function clearSelection(state: SelectionState | null = null): SelectionState {
  return {
    selected: new Set<string>(),
    anchorId: String(state?.anchorId || ''),
    focusId: '',
  };
}

/** Id `delta` steps from the focused one, clamped at both ends (no wrap). */
export function moveFocus(ids: Array<string | number> = [], focusId = '', delta = 1): string {
  const list = (ids || []).map(String).filter(Boolean);
  if (!list.length) return '';
  const cur = list.indexOf(String(focusId || ''));
  if (cur < 0) return list[0];
  return list[Math.max(0, Math.min(list.length - 1, cur + delta))];
}

/** Sorted copy of the explorer rows for the selected sort mode. */
export function sortExplorerItems<T extends ExplorerItem>(items: T[] = [], mode: ExplorerSortMode = 'newest'): T[] {
  const list = [...(items || [])];
  if (list.length && list.every(item => typeof item.asset_order === 'number' && typeof item.character_order === 'number')) {
    return list.sort((a,b) => Number(a.character_order) - Number(b.character_order)
      || (mode === 'oldest' ? 1 : -1) * (Number(a.asset_order) - Number(b.asset_order)));
  }
  const num = (v: unknown, d = 0): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  if (mode === 'oldest') {
    return list.sort((a, b) => num(a.created_at) - num(b.created_at) || String(a.id).localeCompare(String(b.id)));
  }
  if (mode === 'message') {
    return list.sort(
      (a, b) =>
        num(a.message_index, 1e9) - num(b.message_index, 1e9) ||
        num(a.shot_index) - num(b.shot_index) ||
        num(b.created_at) - num(a.created_at),
    );
  }
  if (mode === 'shot') {
    return list.sort(
      (a, b) =>
        num(a.shot_index) - num(b.shot_index) ||
        num(a.message_index, 1e9) - num(b.message_index, 1e9) ||
        num(b.created_at) - num(a.created_at),
    );
  }
  // newest (default)
  return list.sort((a, b) => num(b.created_at) - num(a.created_at) || String(b.id).localeCompare(String(a.id)));
}

/** Grid track minimum for the three thumbnail size presets. */
export function thumbMinWidth(size: ThumbSize = 'm'): number {
  if (size === 's') return 96;
  if (size === 'l') return 200;
  return 148;
}

/** How many explorer cards to keep mounted around the scroll position. */
export const EXPLORER_WINDOW_SIZE = 100;

/**
 * Extra grid rows above/below the visible viewport (react-window style overscan).
 * Visible cells + overscan is what real galleries mount — not a fixed “100 around center”.
 */
export const EXPLORER_OVERSCAN_ROWS = 2;

/** One character×chat folder row from `/v1/gallery/explore`. */
export interface ExplorerFolderRow {
  key?: string;
  character_id?: string;
  character_name?: string;
  chat_id?: string;
  chat_name?: string;
  count?: number;
  [key: string]: unknown;
}

/** Character-grouped sidebar node (chats nested under one name). */
export interface ExplorerFolderGroup {
  characterKey: string;
  characterName: string;
  chats: ExplorerFolderRow[];
  count: number;
}

/** Nest explore folders by character_id (fallback: character_name). */
export function groupExplorerFolders(folders: ExplorerFolderRow[] = []): ExplorerFolderGroup[] {
  const map = new Map<string, ExplorerFolderGroup>();
  const order: string[] = [];
  for (const folder of folders || []) {
    if (!folder || typeof folder !== 'object') continue;
    const characterKey =
      String(folder.character_id || folder.character_name || 'unknown').trim() || 'unknown';
    const characterName =
      String(folder.character_name || characterKey).trim() || characterKey;
    let group = map.get(characterKey);
    if (!group) {
      group = { characterKey, characterName, chats: [], count: 0 };
      map.set(characterKey, group);
      order.push(characterKey);
    }
    group.chats.push(folder);
    group.count += Number(folder.count) || 0;
  }
  return order.map((key) => map.get(key)!);
}

/** Prefix for “이 캐릭터 전체보기” folder keys (`__char__:<characterKey>`). */
export const EXPLORER_CHAR_FOLDER_PREFIX = '__char__:';

export function explorerCharFolderKey(characterKey: string): string {
  return `${EXPLORER_CHAR_FOLDER_PREFIX}${String(characterKey || '').trim()}`;
}

export function parseExplorerCharFolderKey(folderKey: unknown): string {
  const cur = String(folderKey || '');
  if (!cur.startsWith(EXPLORER_CHAR_FOLDER_PREFIX)) return '';
  return cur.slice(EXPLORER_CHAR_FOLDER_PREFIX.length).trim();
}

/**
 * Never auto-open 통합보기. Keep `__all__` / `__char__:…` only if valid;
 * empty/invalid → `__pick__` (idle empty grid).
 */
export function defaultExplorerFolderKey(
  folders: Array<{ key?: string; character_id?: string; character_name?: string } | null | undefined> = [],
  current: unknown = '',
): string {
  const cur = String(current || '');
  if (cur === '__all__') return '__all__';
  if (cur === '__pick__' || !cur) return '__pick__';
  const charKey = parseExplorerCharFolderKey(cur);
  if (charKey) {
    if (
      (folders || []).some((f) => {
        if (!f) return false;
        const key = String(f.character_id || f.character_name || '').trim();
        return key === charKey;
      })
    ) {
      return explorerCharFolderKey(charKey);
    }
    return '__pick__';
  }
  if ((folders || []).some((f) => f && String(f.key || '') === cur)) return cur;
  return '__pick__';
}

/**
 * Folder ZIP keys. `__char__:` expands to every chat of that character.
 * `null` means the whole gallery (`__all__` / empty).
 */
export function explorerExportFolderKeys(
  folderKey: unknown,
  folders: Array<{ key?: string; character_id?: string; character_name?: string } | null | undefined> = [],
): string[] | null {
  const key = String(folderKey || '').trim();
  if (!key || key === '__all__') return null;
  if (key === '__pick__') return [];
  const charKey = parseExplorerCharFolderKey(key);
  if (charKey) return explorerFolderKeysForCharacter(folders, charKey);
  return [key];
}

/** Folder keys belonging to one character group (for 전체보기 filter). */
export function explorerFolderKeysForCharacter(
  folders: Array<{ key?: string; character_id?: string; character_name?: string } | null | undefined> = [],
  characterKey: string,
): string[] {
  const ck = String(characterKey || '').trim();
  if (!ck) return [];
  return (folders || [])
    .filter((f) => f && String(f.character_id || f.character_name || '').trim() === ck)
    .map((f) => String(f?.key || ''))
    .filter(Boolean);
}

export interface ExplorerWindowRangeInput {
  columns?: number;
  itemCount?: number;
  scrollTop?: number;
  clientHeight?: number;
  gridWidth?: number;
  thumbMin?: number;
  gap?: number;
  /** @deprecated Ignored — window is viewport + overscanRows (kept for call-site compat). */
  windowSize?: number;
  /** Rows above/below the visible band to keep mounted. */
  overscanRows?: number;
  /** Caption is overlaid on the thumb — no extra row height below the image. */
  cardExtra?: number;
}

export interface ExplorerWindowRange {
  start: number;
  end: number;
  topPad: number;
  bottomPad: number;
  cols: number;
  rowH: number;
}

/**
 * Viewport virtualization for the explorer CSS grid (3:4 thumbs).
 * Mounts only visible rows ± `overscanRows` — the usual gallery pattern
 * (same idea as react-window / virtuoso), not a fixed center batch of 100.
 */
export function explorerWindowRange(input: ExplorerWindowRangeInput = {}): ExplorerWindowRange {
  const count = Math.max(0, Math.floor(Number(input.itemCount) || 0));
  const gap = Math.max(0, Number(input.gap) || 12);
  const thumbMin = Math.max(48, Number(input.thumbMin) || 148);
  const cardExtra = Math.max(0, Number(input.cardExtra) || 0);
  const gridWidth = Math.max(thumbMin, Number(input.gridWidth) || 600);
  const clientHeight = Math.max(1, Number(input.clientHeight) || 620);
  const scrollTop = Math.max(0, Number(input.scrollTop) || 0);
  const overscan = Math.max(0, Math.floor(Number(input.overscanRows) || EXPLORER_OVERSCAN_ROWS));

  const cols = Math.max(1, input.columns || Math.floor((gridWidth + gap) / (thumbMin + gap)));
  // Match .explorer-card img aspect-ratio:4/5 → height = width * 5/4.
  const thumbH = (gridWidth - gap * (cols - 1)) / cols;
  const rowH = thumbH + cardExtra + gap;
  const totalRows = count ? Math.ceil(count / cols) : 0;
  const totalH = totalRows * rowH;

  if (!count) {
    return { start: 0, end: 0, topPad: 0, bottomPad: 0, cols, rowH };
  }

  const firstVisibleRow = Math.min(
    Math.max(0, totalRows - 1),
    Math.floor(scrollTop / rowH),
  );
  const visibleRows = Math.max(1, Math.ceil(clientHeight / rowH) + 1);
  const startRow = Math.max(0, firstVisibleRow - overscan);
  const endRow = Math.min(totalRows, firstVisibleRow + visibleRows + overscan);
  const start = startRow * cols;
  const end = Math.min(count, endRow * cols);
  const topPad = startRow * rowH;
  const bottomPad = Math.max(0, totalH - endRow * rowH);
  return { start, end, topPad, bottomPad, cols, rowH };
}

/** Reorder by an explicit id list; anything not named keeps its relative order at the end. */
export function reorderByIds<T>(list: T[] = [], orderedIds: Array<string | number> = []): T[] {
  // Entries may be card objects or bare ids, so key on `.id` when there is one.
  const keyOf = (item: T): string => {
    const id = item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined;
    return String(id ?? item);
  };
  const map = new Map<string, T>((list || []).map((item) => [keyOf(item), item]));
  const out: T[] = [];
  for (const id of orderedIds || []) {
    const key = String(id);
    if (map.has(key)) {
      out.push(map.get(key) as T);
      map.delete(key);
    }
  }
  for (const item of map.values()) out.push(item);
  return out;
}
