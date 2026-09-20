import { risuHost } from '../core/host';
import { parseRisuAssetRows, assetsFromEnabledModules } from '../domain/nai-meta/risu-asset-list';
import { COSTUME_FIELDS } from '../domain/character/costume';

function imageBlob(data: unknown): Blob | null {
  if (data instanceof Blob) return data;
  if (data instanceof Uint8Array) return new Blob([new Uint8Array(data)]);
  if (data instanceof ArrayBuffer) return new Blob([data]);
  if (typeof data === 'string') {
    const match = /^data:(image\/[^;,]+);base64,(.*)$/s.exec(data);
    if (match) return new Blob([Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))], { type: match[1] });
  }
  return null;
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||''));
    reader.onerror=()=>reject(reader.error||new Error('에셋 이미지 인코딩 실패'));
    reader.readAsDataURL(blob);
  });
}

export async function pickCharacterAsset(card: HTMLElement): Promise<void> {
  const host = risuHost();
  // Capture the live Risu selection, independently of the edited roster scope.
  const selection = host?.getCurrentCharacterIndex?.();
  const scope = card.dataset.charRefScope;
  let character: Record<string, unknown> | undefined;
  let assets: ReturnType<typeof parseRisuAssetRows> = [];
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', '캐릭터 에셋 선택');
  dialog.style.cssText = 'box-sizing:border-box;width:min(600px,calc(100vw - 24px));height:min(1000px,90dvh);max-height:calc(100dvh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - 24px);overflow:hidden;background:var(--surface,#171a29);color:var(--text,#eee);border:1px solid #5741d8;border-radius:12px;padding:16px';
  const frame = document.createElement('div');
  frame.style.cssText = 'height:100%;min-height:0;display:flex;flex-direction:column;gap:12px';
  dialog.append(frame);
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = '닫기'; close.onclick = () => dialog.close();
  close.style.cssText = 'align-self:flex-end;flex-shrink:0;border-radius:12px';
  const search = document.createElement('input');
  search.type = 'search'; search.placeholder = '에셋 검색'; search.setAttribute('aria-label', '에셋 검색');
  search.value = card.querySelector<HTMLInputElement>('[data-char-aliases]')?.value || '';
  const costumeLabel = document.createElement('label');
  const asCostume = document.createElement('input'); asCostume.type = 'checkbox';
  costumeLabel.append(asCostume, ' 코스튬으로 추가');
  search.style.cssText = 'flex-shrink:0;width:100%;box-sizing:border-box';
  const status = document.createElement('div');
  status.setAttribute('role', 'status'); status.style.cssText = 'flex-shrink:0';
  const list = document.createElement('div');
  list.style.cssText = 'flex:1 1 0;min-height:0;overflow:auto;overscroll-behavior:contain;display:grid;grid-auto-rows:max-content;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;align-content:start';
  frame.append(close, search, costumeLabel, status, list);
  let closed = false;
  let generation = 0;
  let busy = false;
  let active = 0;
  let queue: Array<() => Promise<void>> = [];
  const urls = new Set<string>();
  const revoke = () => { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
  const pump = () => {
    while (!closed && active < 3 && queue.length) {
      active++;
      void queue.shift()!().finally(() => { active--; pump(); });
    }
  };
  const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer?.unobserve(entry.target);
      const load = loaders.get(entry.target);
      if (load) queue.push(load);
    }
    pump();
  }, { root: list, rootMargin: '80px' });
  const loaders = new WeakMap<Element, () => Promise<void>>();
  const render = () => {
    const version = ++generation;
    observer?.disconnect(); queue = []; revoke(); list.replaceChildren(); list.scrollTop = 0;
    const terms = search.value.toLocaleLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const filtered = assets.filter(asset => !terms.length || terms.some(term => asset.name.toLocaleLowerCase().includes(term)));
    status.textContent = filtered.length ? `${filtered.length}개 에셋` : '일치하는 에셋이 없습니다.';
    for (const asset of filtered) {
      const button = document.createElement('button');
      button.type = 'button';
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
          const blob = imageBlob(await host?.readImage?.(asset.key));
          if (!blob || closed || version !== generation) return;
          const url = URL.createObjectURL(blob); urls.add(url); image.src = url;
        } catch { image.alt = '미리보기 없음'; }
      });
      button.onclick = async () => {
        if (busy) return;
        busy = true; button.disabled = true; status.textContent = '에셋 분석 중…';
        try {
          const blob = imageBlob(await host?.readImage?.(asset.key));
          if (!blob) throw new Error('에셋 이미지 읽기 실패');
          if (closed) return;
          const native=(globalThis as typeof globalThis & {
            __INLAY_NATIVE__?:{fetch?:(path:string,opts:Record<string,unknown>,timeout?:number)=>Promise<Record<string,unknown>>}
          }).__INLAY_NATIVE__;
          if(!native?.fetch)throw new Error('에셋 분석 연결 없음');
          const aliases=card.querySelector<HTMLInputElement>('[data-char-aliases]')?.value||'';
          const rosterName=card.querySelector<HTMLInputElement>('[data-char-name]')?.value||asset.name;
          const hostCharacterId=String(character?.chaId||character?.chid||'');
          const result=await native.fetch('/v1/characters/analyze-asset',{
            method:'POST',
            body:{
              image_b64:await blobDataUrl(blob),
              asset_name:asset.name,
              name:rosterName,
              aliases,
              session_id:scope||'',
              character_id:hostCharacterId,
            },
          },180000);
          if (!result || !COSTUME_FIELDS.some(key => typeof result[key] === 'string' && result[key])) throw new Error('외형 분석 결과가 없습니다.');
          if (closed || !card.isConnected) return;
          const select = card.querySelector<HTMLSelectElement>('[data-char-costume]');
          if (asCostume.checked) {
            if (!select) throw new Error('코스튬 선택 연결 없음');
            select.value = '__add__'; select.dispatchEvent(new Event('change', { bubbles: true }));
          }
          for (const key of COSTUME_FIELDS) {
            const field = card.querySelector<HTMLInputElement>(`[data-char-${key.replaceAll('_', '-')}]`);
            if (!field) continue;
            field.value = result[key] == null ? (asCostume.checked ? '[base]' : '') : String(result[key]);
            field.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if(!asCostume.checked && typeof result.gender==='string' && result.gender) {
            const gender=card.querySelector<HTMLSelectElement>('[data-char-gender]');
            if(gender) { gender.value=result.gender; gender.dispatchEvent(new Event('change',{bubbles:true})); }
          }
          status.textContent=result.source==='metadata'?'메타데이터 · 에셋 태거 완료':'메타데이터 없음 · 이미지 오토태그 완료';
          card.dispatchEvent(new Event('omni-autotag')); dialog.close();
        } catch (error) { status.textContent = String(error); }
        finally { busy = false; button.disabled = false; }
      };
      list.append(button);
      observer?.observe(button);
    }
  };
  search.oninput = render;
  dialog.onclose = () => { closed = true; generation++; queue = []; observer?.disconnect(); revoke(); dialog.remove(); };
  document.body.append(dialog); dialog.showModal();
  status.textContent = '에셋 불러오는 중…';
  try {
    const index = await selection;
    const direct = typeof host?.getCharacterFromIndex === 'function';
    const [current, db] = await Promise.all([
      direct ? host?.getCharacterFromIndex?.(Number(index)) : Promise.resolve(undefined),
      host?.getDatabase?.(direct ? ['modules', 'enabledModules'] : ['characters', 'modules', 'enabledModules']),
    ]);
    if (closed) return;
    character = (direct ? current : db?.characters?.[Number(index)]) as Record<string, unknown> | undefined;
    assets = [...parseRisuAssetRows(character?.additionalAssets), ...assetsFromEnabledModules(db?.modules || [], [...(db?.enabledModules || []), ...(Array.isArray(character?.modules) ? character.modules.map(String) : [])])];
    render();
  } catch (error) { if (!closed) status.textContent = '에셋 불러오기 실패: ' + String(error); }
}
