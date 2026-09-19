import { risuHost } from '../core/host';

/** Use the vendor scope selector: it flushes edits and selects the bot-owned lorebook. */
export async function selectRisuScope(select: HTMLSelectElement, value: string): Promise<boolean> {
  if (value !== '__global__' && ![...select.options].some(option => option.value === value)) return false;
  const bridge=(globalThis as typeof globalThis & {
    __OMNI_SELECT_CHARACTER_SCOPE__?:(value:string)=>Promise<{stale?:boolean;ok?:boolean}>;
  }).__OMNI_SELECT_CHARACTER_SCOPE__;
  if(bridge) {
    const result=await bridge(value);
    return result?.ok!==false && result?.stale!==true;
  }
  if(value==='__global__')return true;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

const cleanups = new WeakMap<HTMLElement, () => void>();

type RailRow = { value: string; label: string; path?: string };
/**
 * Tile descriptors + thumbnail URLs outlive P() re-renders. Reopening the
 * rail rebuilds synchronously from cache: no loading flash, no re-download.
 * Descriptors refresh from the host when older than the TTL.
 */
let railRows: RailRow[] | null = null;
let railRowsAt = 0;
const RAIL_ROWS_TTL_MS = 30_000;
const railImageUrls = new Map<string, string>();
let pendingSelection: { value: string; generation: number } | null = null;
let switchGeneration = 0;
let liveIndex = '';

async function readRailImage(
  host: { readImage?: (path: string) => Promise<unknown> },
  path: string,
): Promise<string> {
  const hit = railImageUrls.get(path);
  if (hit) return hit;
  const bytes: unknown = await host.readImage!(path);
  const blob = bytes instanceof Blob ? bytes : bytes instanceof Uint8Array
    ? new Blob([new Uint8Array(bytes)]) : bytes instanceof ArrayBuffer ? new Blob([bytes]) : null;
  const src = blob ? URL.createObjectURL(blob) : typeof bytes === 'string' && bytes.startsWith('data:image/') ? bytes : '';
  if (src) railImageUrls.set(path, src);
  return src;
}

function paintRailImage(button: HTMLButtonElement, src: string): void {
  const image = document.createElement('img');
  image.src = src; image.alt = ''; image.loading = 'lazy';
  button.prepend(image);
}

async function mountRailTiles(
  box: HTMLElement,
  bar: HTMLElement | null,
  select: HTMLSelectElement | null,
  rows: RailRow[],
): Promise<void> {
  let disposed = false;
  const observers: IntersectionObserver[] = [];
  const paint = () => paintSelection(box, document.getElementById('nx-char-scope-bar'), document.querySelector('#nx-scope-char'), liveIndex);
  cleanups.set(box, () => {
    disposed = true;
    observers.forEach(observer => observer.disconnect());
    select?.removeEventListener('change', paint);
    bar?.removeEventListener('omni-roster-scope', paint);
  });
  try {
    // Build synchronously first so a fresh box never shows an empty flash;
    // the live index lands a tick later and only retouches selection marks.
    if (disposed || !box.isConnected) return;
    if (!select) throw new Error('작업 범위 선택기를 찾을 수 없습니다.');
    box.replaceChildren();
    select.addEventListener('change', paint);
    bar?.addEventListener('omni-roster-scope', paint);
    const host = risuHost();
    for (const row of rows) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'risu-tile';
      button.dataset.risuValue = row.value;
      const label = document.createElement('span');
      label.textContent = row.label;
      button.append(label);
      button.addEventListener('click', async () => {
        // The rail survives content renders; resolve the current form at click time.
        const select = document.querySelector<HTMLSelectElement>('#nx-scope-char');
        const bar = document.getElementById('nx-char-scope-bar');
        if (!select) return;
        // Same-selection no-op: clicking the already-active tile only repaints.
        const alreadyGlobal = bar?.dataset.uxSelectedScope === 'global';
        const alreadyChosen = select?.value === 'live' ? liveIndex : select?.value;
        const alreadyOn = alreadyGlobal
          ? row.value === '__global__'
          : row.value !== 'live' && row.value === alreadyChosen;
        if (alreadyOn && !pendingSelection) { paint(); return; }
        const own=++switchGeneration;
        const previousScope=bar?.dataset.uxSelectedScope || 'session';
        const scope = row.value === '__global__' ? 'global' : 'session';
        const value = row.value === 'live' ? liveIndex : row.value;
        pendingSelection = { value: value || 'live', generation: own };
        paint();
        button.setAttribute('aria-busy','true');
        button.classList.toggle('pending',true);
        try {
          bar?.querySelector<HTMLElement>(`[data-ux-scope="${scope}"]`)?.click();
          {
            const applied=await selectRisuScope(select,value || 'live');
            if(!applied || own!==switchGeneration || disposed)return;
          }
          if(own===switchGeneration && !disposed)paint();
        } catch(error) {
          if(own===switchGeneration)document.querySelector<HTMLElement>(`#nx-char-scope-bar [data-ux-scope="${previousScope}"]`)?.click();
          if(own===switchGeneration) window.alert(`캐릭터 전환 실패: ${String(error)}`);
        } finally {
          if (pendingSelection?.generation === own) { pendingSelection = null; paint(); }
          if(button.isConnected) {
            button.setAttribute('aria-busy','false');
            button.classList.toggle('pending',false);
          }
        }
      });
      box.append(button);
      if (!row.path) continue;
      const path = row.path;
      const cached = railImageUrls.get(path);
      if (cached) { paintRailImage(button, cached); continue; }
      if (!host?.readImage || typeof IntersectionObserver === 'undefined') continue;
      const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        void (async () => {
          const src = await readRailImage(host, path);
          if (!src || disposed || !button.isConnected) return;
          paintRailImage(button, src);
        })().catch(() => { /* Missing images must not disable scope selection. */ });
      }, { root: box });
      observers.push(observer);
      observer.observe(button);
    }
    paint();
    // Live index lands after first paint so tile clicks during the gap still
    // work; only the 'live' tile mark waits a tick.
    void (async () => {
      try {
        const index = await risuHost()?.getCurrentCharacterIndex?.();
        if (disposed) return;
        liveIndex = index == null ? '' : String(index);
        paint();
      } catch { /* Selection paint must never block the rail. */ }
    })();
  } catch (error) {
    if (!disposed && box.isConnected) box.textContent = `목록을 못 읽었습니다: ${String(error)}`;
  }
}

/** Selection-only repaint shared by the cheap rail reopen and the full build. */
function paintSelection(
  box: HTMLElement,
  bar: HTMLElement | null,
  select: HTMLSelectElement | null,
  liveIndex: string,
): void {
  const global = pendingSelection ? pendingSelection.value === '__global__' : bar?.dataset.uxSelectedScope === 'global';
  const current = document.getElementById('nx-risu-current');
  const value = pendingSelection?.value || select?.value;
  const chosen = value === 'live' ? liveIndex : value;
  if (current) current.textContent = global ? '전역 로스터' : [...(select?.options || [])].find(option => option.value === chosen)?.textContent?.trim() || '현재 캐릭터 챗';
  box.querySelectorAll<HTMLElement>('[data-risu-value]').forEach(tile => {
    const on = global ? tile.dataset.risuValue === '__global__' : tile.dataset.risuValue !== 'live' && tile.dataset.risuValue === chosen;
    tile.classList.toggle('on', on);
    tile.setAttribute('aria-pressed', String(on));
  });
}

export async function fillRisuTiles(box: HTMLElement | null): Promise<void> {
  if (!box) return;
  const select = document.querySelector<HTMLSelectElement>('#nx-scope-char');
  const bar = document.getElementById('nx-char-scope-bar');
  // Load once per mount: reopening only repaints the selection marks with a
  // cheap live-index read. Tiles and their image URLs stay mounted, so the
  // rail never flickers or re-downloads. New bots appear on next settings open.
  if (box.querySelectorAll('[data-risu-value]').length > 0) {
    paintSelection(box, bar, select, liveIndex);
    if (select?.value !== 'live') return;
    try {
      const index = await risuHost()?.getCurrentCharacterIndex?.();
      liveIndex = index == null ? '' : String(index);
      paintSelection(box, bar, select, liveIndex);
    } catch { /* Selection paint must never block the rail. */ }
    return;
  }
  // Fresh mount after a P() re-render: rebuild synchronously from the
  // descriptor cache when it is still warm — no loading flash, thumbnails
  // come from the URL cache without re-downloading.
  if (railRows && Date.now() - railRowsAt < RAIL_ROWS_TTL_MS) {
    await mountRailTiles(box, bar, select, railRows);
    return;
  }
  cleanups.get(box)?.();
  box.textContent = '불러오는 중…';
  try {
    const host = risuHost();
    const db = await host?.getDatabase?.(['characters']);
    const characters = Array.isArray(db?.characters) ? db.characters : [];
    // Global roster is local navigation; it must not change the bot-owned lorebook.
    const rows: RailRow[] = [
      { value: 'live', label: '현재 캐릭터 챗' },
      { value: '__global__', label: '전역 로스터' },
      ...[...(select?.options || [])].filter(option => option.value !== 'live').map(option => {
        const character = /^\d+$/.test(option.value) ? characters[Number(option.value)] : undefined;
        const path = character && typeof character === 'object' && 'image' in character
          ? (character as { image?: unknown }).image
          : undefined;
        return {
          value: option.value,
          label: option.textContent || '',
          ...(typeof path === 'string' && path ? { path } : {}),
        };
      }),
    ];
    railRows = rows;
    railRowsAt = Date.now();
    await mountRailTiles(box, bar, select, rows);
  } catch (error) {
    if (box.isConnected) box.textContent = `목록을 못 읽었습니다: ${String(error)}`;
  }
}
