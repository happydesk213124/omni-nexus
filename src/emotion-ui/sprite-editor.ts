/**
 * 감정 에셋 › 편집: one face's picture put in by hand. 에셋에서 (one of the bot's own pictures), 내 파일에서 (a file from
 * this device), 누끼 (its plain background taken: by itself, or white or black as picked, and how close a colour goes);
 * 저장 keeps it as Omni's own face under the name a drawn one has (replaceSprite). A picture brought in has its
 * background taken by itself when 자동 누끼 is on, and is left as it is when it is see-through already or its edge is
 * no one colour.
 */
import type { TtsCharacter } from '../core/tts-types';
import { risuHost } from '../core/host';
import { CUTOUT_TOLERANCE, type CutoutColor } from '../domain/emotion/cutout';
import { botPictureAssets, replaceSprite, type EmotionBot } from '../services/emotion-assets';
import { cutoutBytes, type CutoutOutcome } from '../services/sprite-cutout';
import { emotionData } from '../storage/emotion-store';

export interface SpriteEditTarget { person: TtsCharacter; face: string; label: string; bot: EmotionBot; costume: number; path: string | null }
export interface SpriteEditHost { over: Element | null; thumb: (path: string) => Promise<string>; done: (message: string) => void }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
// The bot's pictures listed at once: a bot with hundreds of them is narrowed by its name box.
const ASSETS_SHOWN = 60;

async function readPicture(path: string): Promise<Uint8Array | null> {
  const raw = await risuHost()?.readImage?.(path).catch(() => null);
  const bytes = raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
  return bytes?.byteLength ? bytes : null;
}
export function cutoutNote(outcome: CutoutOutcome, asked: CutoutColor): string {
  if (outcome.result === 'cut') return `${outcome.color === 'black' ? '검은' : '흰'} 배경을 지웠어요.`;
  if (outcome.result === 'transparent') return '이미 배경이 투명한 그림이에요.';
  if (outcome.result === 'mixed') return asked === 'auto' ? '가장자리 색이 섞여 있어 자동으로는 지우지 않았어요. 흰 배경·검은 배경을 직접 골라 보세요.' : '지울 배경을 찾지 못했어요.';
  return '이 그림은 여기서 읽을 수 없어요.';
}

let openVeil: HTMLElement | null = null;
export function closeSpriteEditor(): void { openVeil?.dispatchEvent(new CustomEvent('emo-edit-close')); }

export function openSpriteEditor(target: SpriteEditTarget, host: SpriteEditHost): void {
  closeSpriteEditor();
  const veil = document.createElement('div');
  veil.className = 'emo-edit-veil';
  veil.innerHTML = `<div class="emo-edit" role="dialog" aria-label="감정 에셋 편집">
<div class="emo-edit-head"><b>편집 · ${esc(target.label)}</b><small>${esc(target.face)}</small><button type="button" data-ee="close" aria-label="닫기">✕</button></div>
<div class="emo-edit-preview"><img data-ee-img alt="" hidden><span data-ee-empty>그림 없음</span></div>
<p class="emo-edit-note" data-ee-note role="status"></p>
<div class="emo-edit-row"><button type="button" data-ee="assets">에셋에서</button><button type="button" data-ee="file">내 파일에서</button><input type="file" accept="image/*" hidden data-ee-file></div>
<div class="emo-edit-assets" data-ee-assets hidden><input data-ee-filter placeholder="에셋 이름으로 찾기" aria-label="에셋 이름으로 찾기"><div class="emo-edit-grid" data-ee-grid></div></div>
<div class="emo-edit-cut"><b>누끼</b><div class="emo-edit-row"><button type="button" data-ee-cut="auto">자동</button><button type="button" data-ee-cut="white">흰 배경</button><button type="button" data-ee-cut="black">검은 배경</button><button type="button" data-ee-cut="none">원본</button></div>
<label class="emo-edit-tol"><span>허용 범위</span><input type="range" min="0" max="100" value="${CUTOUT_TOLERANCE}" data-ee-tol aria-label="누끼 허용 범위"><output data-ee-tolv>${CUTOUT_TOLERANCE}</output></label></div>
<div class="emo-edit-foot"><button type="button" data-ee="cancel">취소</button><button type="button" data-ee="save" class="primary" disabled>저장</button></div>
</div>`;
  const q = <T extends Element>(selector: string) => veil.querySelector<T>(selector)!;
  const img = q<HTMLImageElement>('[data-ee-img]'), empty = q<HTMLElement>('[data-ee-empty]'), note = q<HTMLElement>('[data-ee-note]');
  const save = q<HTMLButtonElement>('[data-ee="save"]'), tol = q<HTMLInputElement>('[data-ee-tol]'), tolv = q<HTMLOutputElement>('[data-ee-tolv]');
  const assetsBox = q<HTMLElement>('[data-ee-assets]'), grid = q<HTMLElement>('[data-ee-grid]'), filter = q<HTMLInputElement>('[data-ee-filter]'), file = q<HTMLInputElement>('[data-ee-file]');
  // base: the picture chosen (the face's own until another is); shown: it as it would be saved.
  let base: Uint8Array | null = null, shown: Uint8Array | null = null, url = '', mode: CutoutColor | 'none' = 'none', changed = false, turn = 0, busy = false;
  const paint = () => {
    if (url) URL.revokeObjectURL(url);
    url = shown ? URL.createObjectURL(new Blob([shown.slice()])) : '';
    img.hidden = !url; empty.hidden = !!url;
    if (url) img.src = url;
    save.disabled = !changed || !shown || busy;
    for (const b of veil.querySelectorAll<HTMLButtonElement>('[data-ee-cut]')) b.setAttribute('aria-pressed', String(b.dataset.eeCut === mode));
  };
  const cut = async (next: CutoutColor | 'none', quiet = false) => {
    if (!base) { note.textContent = '먼저 그림을 고르세요.'; return; }
    const mine = ++turn;
    mode = next;
    if (next === 'none') { shown = base; changed = true; note.textContent = '원본 그대로예요.'; paint(); return; }
    busy = true; note.textContent = '누끼 따는 중…'; paint();
    const outcome = await cutoutBytes(base, { color: next, tolerance: Number(tol.value) });
    if (mine !== turn) return;
    busy = false;
    if (outcome.result === 'cut' || !quiet) changed = true;
    shown = outcome.bytes;
    note.textContent = cutoutNote(outcome, next);
    paint();
  };
  // A picture brought in: as it is, its background taken by itself when 자동 누끼 is on.
  const bring = async (bytes: Uint8Array | null, from: string) => {
    if (!bytes) { note.textContent = `${from}을(를) 읽지 못했어요.`; return; }
    base = bytes; shown = bytes; changed = true; mode = 'none';
    assetsBox.hidden = true;
    if (emotionData().settings.autoCutout) await cut('auto', true);
    else { note.textContent = `${from}을(를) 골랐어요. 누끼가 필요하면 아래에서 고르세요.`; paint(); }
  };
  const listAssets = () => {
    const words = filter.value.trim().toLowerCase(), all = botPictureAssets(target.bot);
    const list = all.filter(a => !words || a.name.toLowerCase().includes(words)).slice(0, ASSETS_SHOWN);
    grid.innerHTML = list.length ? list.map((a, i) => `<button type="button" data-ee-asset="${i}" title="${esc(a.name)}"><span data-ee-pic="${i}"></span><small>${esc(a.name)}</small></button>`).join('')
      : `<small>${all.length ? '맞는 에셋이 없어요.' : '이 봇에는 그림 에셋이 없어요.'}</small>`;
    grid.dataset.list = JSON.stringify(list.map(a => a.key));
    // Their pictures one by one: the list is up at once.
    void (async () => { for (const [i, a] of list.entries()) { const pic = grid.querySelector<HTMLElement>(`[data-ee-pic="${i}"]`); if (!pic || !veil.isConnected) return; const u = await host.thumb(a.key).catch(() => ''); if (u) pic.style.backgroundImage = `url("${u}")`; } })();
  };
  const close = () => {
    if (url) URL.revokeObjectURL(url);
    document.removeEventListener('keydown', onKey, true);
    veil.remove();
    if (openVeil === veil) openVeil = null;
  };
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); } };
  veil.addEventListener('emo-edit-close', close);
  veil.addEventListener('click', ev => {
    const t = ev.target as Element;
    if (t === veil) { close(); return; }
    const act = t.closest?.('[data-ee]')?.getAttribute('data-ee'), cutAs = t.closest?.('[data-ee-cut]')?.getAttribute('data-ee-cut'), asset = t.closest?.('[data-ee-asset]')?.getAttribute('data-ee-asset');
    if (act === 'close' || act === 'cancel') close();
    else if (act === 'file') file.click();
    else if (act === 'assets') { assetsBox.hidden = !assetsBox.hidden; if (!assetsBox.hidden) listAssets(); }
    else if (act === 'save') void (async () => {
      if (!shown || save.disabled) return;
      save.disabled = true; note.textContent = '저장하는 중…';
      try { await replaceSprite(target.person, target.face, target.bot, shown, target.costume); host.done(`${target.label} 그림을 바꿨어요.`); close(); }
      catch (error) { note.textContent = String((error as Error)?.message || error); save.disabled = false; }
    })();
    else if (cutAs) void cut(cutAs as CutoutColor | 'none');
    else if (asset != null) { const keys = JSON.parse(grid.dataset.list || '[]') as string[], key = keys[Number(asset)]; if (key) void readPicture(key).then(bytes => bring(bytes, '에셋')); }
  });
  filter.addEventListener('input', listAssets);
  file.addEventListener('change', () => {
    const picked = file.files?.[0];
    file.value = '';
    if (picked) void picked.arrayBuffer().then(buf => bring(new Uint8Array(buf), '파일'), () => { note.textContent = '파일을 읽지 못했어요.'; });
  });
  tol.addEventListener('input', () => { tolv.textContent = tol.value; });
  tol.addEventListener('change', () => { if (mode !== 'none') void cut(mode); });
  document.addEventListener('keydown', onKey, true);
  (host.over ?? document.body).appendChild(veil);
  openVeil = veil;
  paint();
  // The face's own picture to start from (누끼 on it, as it is).
  if (target.path) void readPicture(target.path).then(bytes => { if (!base && bytes) { base = bytes; shown = bytes; paint(); } });
}
