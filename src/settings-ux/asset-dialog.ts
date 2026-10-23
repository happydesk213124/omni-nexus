import { risuHost } from '../core/host';
import { parseRisuAssetRows, type RisuNamedAsset } from '../domain/nai-meta/risu-asset-list';
import { rankedReferenceAssets } from '../domain/nai-meta/reference-search';
import { MODULE_ASSET_RETRIES, moduleAssetManifest, moduleAssetsMissing, refillModuleAssets } from '../storage/module-assets';

export function imageBlob(data: unknown): Blob | null {
  if (data instanceof Blob) return data;
  if (data instanceof Uint8Array) return new Blob([new Uint8Array(data)]);
  if (data instanceof ArrayBuffer) return new Blob([data]);
  if (typeof data === 'string') {
    const match = /^data:(image\/[^;,]+);base64,(.*)$/s.exec(data);
    if (match) return new Blob([Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))], { type: match[1] });
  }
  return null;
}

/** What a caller of the dialog can do while it is open. */
export interface AssetDialogUi {
  status: (text: string) => void;
  close: () => void;
  closed: () => boolean;
  /** One asset's image, through Risu. */
  read: (asset: RisuNamedAsset) => Promise<Blob | null>;
  /** The assets the search matches, before `visible` is applied. */
  matched: () => RisuNamedAsset[];
  /** Draw the tiles again (after `visible` changed its mind). */
  render: () => void;
  /** Bumped by every render: work started for an older one should stop. */
  generation: () => number;
}

export interface AssetDialogOptions {
  source: 'character' | 'module';
  label: string;
  /** The Risu character whose assets (or enabled modules) are listed. */
  characterIndex: Promise<unknown>;
  search?: string;
  /** Controls placed under the search box. */
  extras?: Node[];
  /** A tile is drawn only when this allows it. */
  visible?: (asset: RisuNamedAsset) => boolean;
  /** The status line after a render, from the number of tiles drawn. */
  describe?: (count: number, ui: AssetDialogUi) => string;
  /** After every render, with the tiles in place. */
  onRender?: (ui: AssetDialogUi) => void;
  /** False once what the dialog was opened for is gone (another card chosen). */
  current?: () => boolean;
  onCharacter?: (character: Record<string, unknown> | undefined) => void;
  /** A tile was tapped. The dialog stays open unless this closes it. */
  pick: (asset: RisuNamedAsset, blob: Blob, ui: AssetDialogUi) => Promise<void>;
}

/**
 * Risu's character assets, or one enabled module's, as square tiles with lazy
 * previews (three reads at a time, only for tiles in view). Shared by the
 * 캐릭터 tab's 에셋에서·모듈에서 and the 스타일 프리셋 tab's.
 */
export async function openAssetDialog(opts: AssetDialogOptions): Promise<void> {
  const host = risuHost();
  let assets: RisuNamedAsset[] = [];
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', opts.label);
  dialog.style.cssText = 'box-sizing:border-box;width:min(600px,calc(100vw - 24px));height:min(1000px,90dvh);max-height:calc(100dvh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - 24px);overflow:hidden;background:var(--surface,#171a29);color:var(--text,#eee);border:1px solid #5741d8;border-radius:12px;padding:16px';
  const frame = document.createElement('div');
  frame.style.cssText = 'height:100%;min-height:0;display:flex;flex-direction:column;gap:12px';
  dialog.append(frame);
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = '닫기';
  close.style.cssText = 'align-self:flex-end;flex-shrink:0;border-radius:12px';
  const search = document.createElement('input');
  search.type = 'search'; search.placeholder = '에셋 검색'; search.setAttribute('aria-label', '에셋 검색');
  search.value = opts.search || '';
  search.style.cssText = 'flex-shrink:0;width:100%;box-sizing:border-box';
  const status = document.createElement('div');
  status.setAttribute('role', 'status'); status.style.cssText = 'flex-shrink:0';
  const list = document.createElement('div');
  list.style.cssText = 'flex:1 1 0;min-height:0;overflow:auto;overscroll-behavior:contain;display:grid;grid-auto-rows:max-content;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;align-content:start';
  const moduleSelect = document.createElement('select');
  moduleSelect.setAttribute('aria-label', '활성 모듈');
  moduleSelect.hidden = opts.source !== 'module';
  frame.append(close, moduleSelect, search, ...(opts.extras || []), status, list);
  let closed = false, generation = 0, busy = false, active = 0;
  let queue: Array<() => Promise<void>> = [];
  const urls = new Set<string>();
  const revoke = () => { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
  const pump = () => {
    while (!closed && active < 3 && queue.length) {
      active++;
      void queue.shift()!().finally(() => { active--; pump(); });
    }
  };
  const loaders = new WeakMap<Element, () => Promise<void>>();
  const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer?.unobserve(entry.target);
      const load = loaders.get(entry.target);
      if (load) queue.push(load);
    }
    pump();
  }, { root: list, rootMargin: '80px' });
  const terms = () => search.value.toLocaleLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const ui: AssetDialogUi = {
    status: text => { status.textContent = text; },
    close: () => dialog.close(),
    closed: () => closed,
    read: async asset => imageBlob(await host?.readImage?.(asset.key)),
    matched: () => rankedReferenceAssets(assets, terms()),
    render: () => render(),
    generation: () => generation,
  };
  const render = () => {
    const version = ++generation;
    observer?.disconnect(); queue = []; revoke(); list.replaceChildren(); list.scrollTop = 0;
    const shown = ui.matched().filter(asset => opts.visible?.(asset) ?? true);
    status.textContent = opts.describe ? opts.describe(shown.length, ui) : shown.length ? `${shown.length}개 에셋` : '일치하는 에셋이 없습니다.';
    for (const asset of shown) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.assetKey = asset.key;
      button.style.cssText = 'box-sizing:border-box;align-self:start;position:relative;width:100%;min-width:0;min-height:0;aspect-ratio:1;overflow:hidden;display:block;background:var(--surface-2,#222538);color:inherit;border:1px solid var(--border,#42465d);border-radius:12px;padding:0';
      const image = document.createElement('img');
      image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
      image.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain';
      const label = document.createElement('span'); label.textContent = asset.name;
      label.style.cssText = 'position:absolute;bottom:0;left:0;right:0;padding:6px;background:#101114cc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px';
      button.title = asset.name;
      button.append(image, label);
      loaders.set(button, async () => {
        if (closed || version !== generation) return;
        try {
          const blob = await ui.read(asset);
          if (!blob || closed || version !== generation) return;
          const url = URL.createObjectURL(blob); urls.add(url); image.src = url;
        } catch { image.alt = '미리보기 없음'; }
      });
      button.onclick = async () => {
        if (busy) return;
        busy = true; button.disabled = true;
        try {
          const blob = await ui.read(asset);
          if (!blob) throw new Error('에셋 이미지 읽기 실패');
          if (!closed) await opts.pick(asset, blob, ui);
        } catch (error) { status.textContent = String(error); }
        finally { busy = false; button.disabled = false; }
      };
      list.append(button);
      observer?.observe(button);
    }
    opts.onRender?.(ui);
  };
  search.oninput = render;
  const dispose = () => { if (closed) return; closed = true; generation++; queue = []; observer?.disconnect(); revoke(); dialog.remove(); };
  dialog.onclose = dispose;
  close.onclick = () => { dialog.close(); dispose(); };
  document.body.append(dialog); dialog.showModal();
  status.textContent = '에셋 불러오는 중…';
  try {
    const index = await opts.characterIndex;
    const direct = typeof host?.getCharacterFromIndex === 'function';
    const [selectedCharacter, db] = await Promise.all([
      direct ? host?.getCharacterFromIndex?.(Number(index)) : Promise.resolve(undefined),
      host?.getDatabase?.(direct ? ['modules', 'enabledModules'] : ['characters', 'modules', 'enabledModules']),
    ]);
    if (closed) return;
    const character = (direct ? selectedCharacter : db?.characters?.[Number(index)]) as Record<string, unknown> | undefined;
    opts.onCharacter?.(character);
    if (opts.current && !opts.current()) { dialog.close(); return; }
    if (opts.source === 'module') {
      const enabled = new Set([...(db?.enabledModules || []), ...(Array.isArray(character?.modules) ? character.modules.map(String) : [])]);
      const chats = Array.isArray(character?.chats) ? character.chats as Record<string, unknown>[] : [];
      const chat = chats[Number(character?.chatPage) || 0];
      if (Array.isArray(chat?.modules)) for (const id of chat.modules) enabled.add(String(id));
      const seen = new Set<string>();
      const modules = (db?.modules || []).filter(mod => {
        const id = String(mod.id || mod.namespace || '');
        if (!id || seen.has(id) || (!enabled.has(id) && !enabled.has(String(mod.namespace || '')))) return false;
        seen.add(id); return true;
      });
      moduleSelect.add(new Option('모듈을 선택하세요', ''));
      modules.forEach((mod, i) => moduleSelect.add(new Option(String(mod.name || mod.id), String(i))));
      let picking = 0;
      moduleSelect.onchange = async () => {
        const token = ++picking;
        const mod = moduleSelect.value === '' ? undefined : modules[Number(moduleSelect.value)];
        if (mod && moduleAssetsMissing(mod)) {
          // PocketRisu keeps a module's asset list on the server and fills it into
          // getDatabase() on the way out; a slow link can fail that fill, and the
          // module then arrives with only its descriptor. Ask again a few times.
          assets = []; generation++; list.replaceChildren();
          const filled = await refillModuleAssets(mod, attempt => {
            if (token === picking && !closed) status.textContent = `PocketRisu에서 모듈 에셋 목록을 받는 중… (${attempt}/${MODULE_ASSET_RETRIES})`;
          }, () => closed || token !== picking);
          if (closed || token !== picking) return;
          if (!filled) {
            status.textContent = `PocketRisu가 이 모듈의 에셋 목록(${moduleAssetManifest(mod)?.count ?? '?'}개)을 넘겨주지 못했습니다. 잠시 뒤 다시 열어 보세요.`;
            return;
          }
          mod.assets = filled as typeof mod.assets;
        }
        assets = mod ? parseRisuAssetRows(mod.assets) : [];
        render();
      };
      status.textContent = modules.length ? '모듈을 선택하세요.' : '활성 모듈이 없습니다.';
      return;
    }
    assets = parseRisuAssetRows(character?.additionalAssets);
    render();
  } catch (error) { if (!closed) status.textContent = '에셋 불러오기 실패: ' + String(error); }
}
