import { cleanText, joinTags } from '../core/util/text.ts';
import { resolveCharacter } from '../domain/character/roster.ts';
import type { CharacterInput } from '../domain/character/identity.ts';
import { peelMain, peelStudioCharFields } from './peel.ts';
import {
  CHAR_SLOTS,
  assemble,
  assembleOverrides,
  charList,
  emptyState,
  hydrateFromNai,
  mergeStudioRosterPayloads,
  mergedRoster,
  nextId,
  studioRowIsGlobal,
  type StudioChar,
  type StudioTab,
} from './model.ts';
import {
  commandRewrite,
  loadNaiFromImage,
  loadNaiPrompt,
  loadNaiQuota,
  loadRoster,
  loadSettings,
  saveCharacter,
  saveSettings,
  studioCommit,
  studioGenerate,
} from './api.ts';
import { formatStudioQuota, studioQuotaFillPct } from './quota.ts';
import { replaceInlinePhotoAfterSave } from './replace-inline.ts';
import { tagStudioCss } from './styles.ts';

const MODELS: Array<[string, string]> = [
  ['', ''],
  ['nai-diffusion-4-5-full', 'V4.5'],
  ['nai-diffusion-5-full', 'V5'],
];
const SAMPLERS: Array<[string, string]> = [
  ['', ''],
  ['k_euler_ancestral', 'Euler Ancestral'],
  ['k_euler', 'Euler'],
  ['k_dpmpp_2s_ancestral', 'DPM++ 2S Ancestral'],
  ['k_dpmpp_2m_sde', 'DPM++ 2M SDE'],
  ['k_dpmpp_2m', 'DPM++ 2M'],
  ['k_dpmpp_sde', 'DPM++ SDE'],
];
const SCHEDULERS: Array<[string, string]> = [
  ['', ''], ['karras', 'Karras'], ['native', 'Native'], ['exponential', 'Exponential'],
];
const PERSON_MODES: Array<[string, string]> = [
  ['', ''], ['gender', 'gender'], ['girls', 'girls'], ['people', 'people'], ['off', '안 넣기'],
];
const WEIGHTS: Array<[string, string]> = [
  ['', ''], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'],
];

type StyleRow = Record<string, unknown>;
type CmdRow = { id: string; name: string; cmd: string; cmd_post: string };
type CostumeRow = { name: string; attire: string; bottoms?: string; note: string; accessories: string };
type NativeImg = { ensureImageUrl?: (id: string) => Promise<string> };

let activeClose: (() => void) | null = null;

export function closeTagStudio(): void {
  if (activeClose) activeClose();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c
  ));
}

function opts(pairs: Array<[string, string]>, value: string): string {
  return pairs.map(([v, t]) => (
    `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(t)}</option>`
  )).join('');
}

function errMsg(res: Record<string, unknown>, fallback: string): string {
  const err = asRecord(res.error);
  const msg = cleanText(err.message || res.error || res.message, 400);
  return msg || fallback;
}

function clipLabel(name: string): string {
  return name.length > 6 ? name.slice(0, 6) : name;
}

function namedStyle(list: StyleRow[]): StyleRow[] {
  return list.filter((p) => cleanText(p.id, 120));
}

function namedCmd(list: CmdRow[]): CmdRow[] {
  return list.filter((p) => p.id);
}

function costumesOf(row: CharacterInput | null | undefined): CostumeRow[] {
  const raw = Array.isArray(row?.costumes) ? row.costumes : [];
  const out: CostumeRow[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const rec = c as unknown as Record<string, unknown>;
    out.push({
      name: cleanText(rec.name, 200),
      attire: cleanText(rec.attire, 4000),
      note: cleanText(rec.note, 400),
      accessories: cleanText(rec.accessories, 4000),
    });
  }
  return out;
}

async function resolveCardUrl(id: string, fallback: string): Promise<string> {
  const n = (globalThis as { __INLAY_NATIVE__?: NativeImg }).__INLAY_NATIVE__;
  try {
    const url = await n?.ensureImageUrl?.(id);
    if (url) return url;
  } catch {
    /* card.image_url is enough to paint */
  }
  return fallback;
}

const SHELL = `
  <header class="top">
    <div class="title">
      <b>샷 태그 수정</b>
      <span id="sub">불러오는 중…</span>
    </div>
    <button class="btn" id="close" type="button">닫기</button>
  </header>
  <div class="stage" id="stage">
    <aside class="side" id="left">
      <button class="foldbar" id="leftFold" type="button">▼</button>
      <div class="tabs">
        <div class="tabrow" id="tabrow1">
          <div class="tabscroll" id="tabsBar"></div>
          <div class="pick" id="charPickWrap">
            <select id="charPick"></select>
          </div>
          <button class="tabadd" id="tabAdd" type="button" title="캐릭터 칸 추가">+</button>
        </div>
        <div class="tabrow" id="tabrow2" hidden></div>
      </div>
      <div class="body" id="panel"><p class="hint">불러오는 중…</p></div>
    </aside>
    <main class="center" id="center">
      <div class="cbar">
        <button class="btn sm" data-act="auto" type="button">AI 좌표</button>
        <button class="btn sm" data-act="grid" type="button">좌표보기</button>
        <button class="btn sm" data-act="fit" type="button">화면맞춤</button>
        <button class="btn sm" data-act="peek" type="button">조립</button>
      </div>
      <div class="viewport" id="viewport">
        <div class="frame" id="frame"><canvas id="cv"></canvas></div>
        <div class="dots" id="dots"></div>
      </div>
      <div class="peek" id="peek">
        <h4>조립 미리보기</h4>
        <pre id="assembled"></pre>
      </div>
      <div class="readout">
        <span>확대 <b id="zoom">100%</b></span>
        <span>좌표 <b id="coord">—</b></span>
      </div>
      <div class="spinveil" id="spinveil"><div class="spin" aria-hidden="true"></div></div>
      <button class="handle l" id="hL" type="button">◀</button>
    </main>
    <aside class="side right" id="rightPane">
      <button class="handle r" id="hR" type="button">◀</button>
      <div class="rhead">
        <span>이미지 히스토리</span>
        <span class="count" id="hcount">0</span>
        <button class="btn sm hclose" id="hClose" type="button">▶</button>
      </div>
      <div class="hgrid" id="hgrid"></div>
      <div class="rfoot">
        <button class="btn" id="zip" type="button" style="width:100%">히스토리 zip으로 받기</button>
      </div>
    </aside>
  </div>
  <div class="floor">
    <nav class="tools" id="tools">
      <button class="btn sm" data-act="auto" type="button">AI 좌표</button>
      <button class="btn sm" data-act="grid" type="button">좌표보기</button>
      <button class="btn sm" data-act="fit" type="button">화면맞춤</button>
      <button class="btn sm" data-act="peek" type="button">조립</button>
      <button class="btn sm" data-act="history" type="button">히스토리</button>
      <button class="btn sm loop" id="loop" type="button"><b>연속생성</b> <span class="hint">꺼짐</span></button>
    </nav>
    <footer class="foot">
      <button class="btn loop deskonly" id="loopDesk" type="button"><b>연속생성</b><span class="hint">꺼짐</span></button>
      <button class="btn mobset" data-act="settings" type="button">설정</button>
      <button class="gen" id="gen" type="button">생성</button>
      <button class="btn" id="save" type="button">저장</button>
      <button class="btn" id="cancel" type="button">취소</button>
    </footer>
  </div>
  <div class="ask" id="ask" hidden>
    <div class="askbox">
      <p id="askMsg">삭제할까요?</p>
      <div class="inline">
        <button class="btn" id="askNo" type="button">아니오</button>
        <button class="btn warn" id="askYes" type="button">예</button>
      </div>
    </div>
  </div>
`;

export async function openTagStudio(card: unknown): Promise<void> {
  if (activeClose) activeClose();
  document.getElementById('nx-card-tag-modal')?.remove();
  document.getElementById('nx-tag-studio')?.remove();

  const rec = asRecord(card);
  const cardId = cleanText(rec.id, 80);
  const sessionId = cleanText(rec.session_id, 200);
  const characterId = cleanText(rec.character_id, 200);
  const fallbackUrl = cleanText(rec.image_url, 2_000_000);

  const root = document.createElement('div');
  root.id = 'nx-tag-studio';
  const style = document.createElement('style');
  style.textContent = tagStudioCss();
  root.append(style);
  root.insertAdjacentHTML('beforeend', SHELL);
  document.body.append(root);

  const state = emptyState();
  state.cardId = cardId;
  state.sessionId = sessionId;
  state.characterId = characterId;
  state.comic = cleanText(rec.kind || asRecord(rec.meta).kind, 20) === 'comic';
  const seed0 = Number(rec.seed);
  if (Number.isFinite(seed0) && seed0 > 0) state.gen.seed = Math.floor(seed0);
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
    state.rightFold = true;
  } else {
    state.rightFold = false;
  }

  let rosterPayload: Record<string, unknown> = { characters: [], global: [] };
  let roster: CharacterInput[] = [];
  let cardSettings: Record<string, unknown> = {};
  let stylePresets: StyleRow[] = [];
  let commandPresets: CmdRow[] = [];
  let quotaLabel = '탭해서 할당량 새로고침';
  let quotaFill = -1;
  let quotaBusy = false;
  let currentUrl = fallbackUrl;
  let loaded: HTMLImageElement | null = null;
  let dragging = false;
  let loopTimer: ReturnType<typeof setInterval> | null = null;
  const view = { scale: 1, x: 0, y: 0 };
  const cleanups: Array<() => void> = [];

  const $ = <T extends Element>(sel: string, r: ParentNode = root): T | null => r.querySelector(sel);
  const $$ = <T extends Element>(sel: string, r: ParentNode = root): T[] => [...r.querySelectorAll<T>(sel)];

  const cv = $('#cv') as HTMLCanvasElement;
  const ctx = cv.getContext('2d');
  const viewport = $('#viewport') as HTMLElement;
  const frame = $('#frame') as HTMLElement;
  const dotsEl = $('#dots') as HTMLElement;
  const leftEl = $('#left') as HTMLElement;
  const rightEl = $('#rightPane') as HTMLElement;

  function on<K extends keyof HTMLElementEventMap>(
    el: EventTarget,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void {
    el.addEventListener(type, fn as EventListener, opts);
    cleanups.push(() => el.removeEventListener(type, fn as EventListener, opts));
  }

  function closeStudio(): void {
    if (loopTimer) {
      clearInterval(loopTimer);
      loopTimer = null;
    }
    for (const fn of cleanups.splice(0)) fn();
    root.remove();
    if (activeClose === closeStudio) activeClose = null;
    settle();
  }

  let settled = false;
  let settle: () => void = () => { /* assigned below */ };
  const closed = new Promise<void>((resolve) => {
    settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
  });
  activeClose = closeStudio;

  function toast(msg: string): void {
    root.querySelector('.toast')?.remove();
    const n = document.createElement('div');
    n.className = 'toast';
    n.textContent = msg;
    root.append(n);
    window.setTimeout(() => n.remove(), 2600);
  }

  function askYesNo(msg: string): Promise<boolean> {
    return new Promise((resolve) => {
      const box = $('#ask') as HTMLElement;
      const yes = $('#askYes') as HTMLButtonElement;
      const no = $('#askNo') as HTMLButtonElement;
      const label = $('#askMsg') as HTMLElement;
      label.textContent = msg;
      box.hidden = false;
      const done = (ok: boolean) => {
        box.hidden = true;
        yes.onclick = null;
        no.onclick = null;
        box.onclick = null;
        resolve(ok);
      };
      yes.onclick = () => done(true);
      no.onclick = () => done(false);
      box.onclick = (e) => { if (e.target === box) done(false); };
    });
  }

  function styleById(id: string): StyleRow | undefined {
    return stylePresets.find((p) => cleanText(p.id, 120) === id);
  }

  function cmdById(id: string): CmdRow | undefined {
    return commandPresets.find((p) => p.id === id);
  }

  function rosterById(id: string): CharacterInput | null {
    if (!id) return null;
    return roster.find((r) => cleanText(r.id, 80) === cleanText(id, 80)) || null;
  }

  function rowIsGlobal(row: CharacterInput | null | undefined): boolean {
    const globals = Array.isArray(rosterPayload.global) ? rosterPayload.global : [];
    return studioRowIsGlobal(row, globals);
  }

  function liveUiRuntime(): Record<string, unknown> {
    const g = globalThis as { INLAY_NEXUS_RUNTIME?: unknown };
    return asRecord(g.INLAY_NEXUS_RUNTIME);
  }

  function liveUiScope(): { sessionId: string; characterId: string; unified: boolean } {
    const last = asRecord(liveUiRuntime().lastScope);
    return {
      sessionId: cleanText(last.sessionId, 200),
      characterId: cleanText(last.characterId, 200),
      unified: last.unified === true,
    };
  }

  function liveUiRoster(): Record<string, unknown> | null {
    const t = liveUiRuntime();
    const session = Array.isArray(t.charactersSession) ? t.charactersSession : null;
    const global = Array.isArray(t.charactersGlobal) ? t.charactersGlobal : null;
    if (!session && !global) return null;
    return { characters: session || [], global: global || [] };
  }

  function liveChar(id: string): StudioChar | undefined {
    return state.chars[id];
  }

  function activeCharId(): string {
    if (state.active && state.chars[state.active]) return state.active;
    return state.selChar;
  }

  function relabel(): void {
    let i = 0;
    for (const t of state.tabs) {
      if (t.kind !== 'char') continue;
      i += 1;
      if (state.comic) {
        t.label = `C${i}`;
        continue;
      }
      const ch = state.chars[t.id];
      const stored = rosterById(ch?.rosterId || '') || (ch?.charName ? resolveCharacter(ch.charName, roster) : null);
      const name = stored?.name || ch?.charName || '';
      t.label = name ? `C${i} ${clipLabel(name)}` : `C${i}`;
    }
  }

  async function persistCard(patch: Record<string, unknown>): Promise<void> {
    cardSettings = { ...cardSettings, ...patch };
    await saveSettings({ card: { ...cardSettings } });
  }

  function applyNaiPayload(nai: Record<string, unknown>): void {
    hydrateFromNai({
      state,
      nai,
      settings: { card: cardSettings },
      rosterPayload,
      card: rec,
    });
    relabel();
    renderAll();
  }

  function readDroppedImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
      reader.readAsDataURL(file);
    });
  }

  async function ingestDroppedFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/') && !/\.(png|webp|jpe?g)$/i.test(file.name)) {
      toast('이미지 파일만 넣을 수 있습니다.');
      return;
    }
    setBusy(true);
    try {
      const url = await readDroppedImage(file);
      if (!url) throw new Error('이미지를 읽지 못했습니다.');
      state.imageUrl = url;
      currentUrl = url;
      await showImage(url);
      const nai = await loadNaiFromImage(url);
      if (nai.ok === false || nai.error) {
        toast(errMsg(nai, '이미지 메타를 읽지 못했습니다.'));
        return;
      }
      applyNaiPayload(nai);
      toast('드롭한 이미지 메타를 넣었습니다.');
    } catch (err) {
      toast(String((err as Error)?.message || err));
    } finally {
      setBusy(false);
    }
  }

  function paintQuota(): void {
    const fill = quotaFill >= 0
      ? `<span class="qbar"><i style="width:${Math.max(0, Math.min(100, quotaFill))}%"></i></span>`
      : '';
    const html = `${esc(quotaLabel)}${fill}`;
    $$('.quota').forEach((el) => { el.innerHTML = html; });
  }

  async function refreshQuota(): Promise<void> {
    if (quotaBusy) return;
    quotaBusy = true;
    quotaLabel = '조회 중…';
    paintQuota();
    try {
      const res = await loadNaiQuota();
      quotaLabel = formatStudioQuota(res);
      quotaFill = studioQuotaFillPct(res);
    } catch (err) {
      quotaLabel = String((err as Error)?.message || err);
      quotaFill = -1;
    } finally {
      quotaBusy = false;
      paintQuota();
    }
  }

  async function refreshRoster(payload?: Record<string, unknown>): Promise<void> {
    const fetched = payload && (Array.isArray(payload.characters) || Array.isArray(payload.global))
      ? payload
      : await loadRoster(state.sessionId, state.characterId);
    rosterPayload = mergeStudioRosterPayloads(fetched, liveUiRoster());
    roster = mergedRoster(rosterPayload);
  }

  function setBusy(on: boolean): void {
    state.busy += on ? 1 : -1;
    if (state.busy < 0) state.busy = 0;
    $('#spinveil')?.classList.toggle('on', state.busy > 0);
  }

  function applyView(): void {
    frame.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    const zoom = $('#zoom');
    if (zoom) zoom.textContent = `${Math.round(view.scale * 100)}%`;
    dotsEl.style.left = `${view.x}px`;
    dotsEl.style.top = `${view.y}px`;
    dotsEl.style.width = `${cv.width * view.scale}px`;
    dotsEl.style.height = `${cv.height * view.scale}px`;
  }

  function fitView(): void {
    const vp = viewport.getBoundingClientRect();
    const pad = 44;
    const w = Math.max(64, cv.width);
    const h = Math.max(64, cv.height);
    view.scale = Math.min((vp.width - pad * 2) / w, (vp.height - pad * 2) / h, 1.6);
    view.x = (vp.width - w * view.scale) / 2;
    view.y = (vp.height - h * view.scale) / 2;
    applyView();
  }

  function drawStage(): void {
    if (!ctx) return;
    cv.width = Math.max(64, Number(state.gen.w) || 832);
    cv.height = Math.max(64, Number(state.gen.h) || 1216);
    if (loaded) {
      ctx.drawImage(loaded, 0, 0, cv.width, cv.height);
    } else {
      ctx.fillStyle = '#15161c';
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
    fitView();
  }

  function showImage(url: string): Promise<void> {
    currentUrl = url;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        loaded = img;
        state.gen.w = img.naturalWidth || img.width || state.gen.w;
        state.gen.h = img.naturalHeight || img.height || state.gen.h;
        drawStage();
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    });
  }

  function canvasDataUrl(): string {
    if (state.historySel >= 0) {
      const hit = state.history[state.historySel];
      if (hit?.url) return hit.url;
    }
    try {
      return cv.toDataURL('image/png');
    } catch {
      return currentUrl;
    }
  }

  function assembleText(): string {
    const a = assemble(state, roster);
    return [
      `MAIN\n${a.main || '(빈 칸)'}`,
      '',
      `NEG\n${a.neg || '(빈 칸)'}`,
      '',
      a.chars.map((c) => {
        const pos = state.coordMode === 'ai' ? 'NAI AI choice' : `${c.center_x.toFixed(2)}, ${c.center_y.toFixed(2)}`;
        return `CHAR ${c.no} ${c.name} [${pos}]\n${c.prompt}${c.uc ? `\nUC ${c.uc}` : ''}`;
      }).join('\n\n') || 'CHAR\n(없음)',
    ].join('\n');
  }

  function chip(t: string, on: boolean): string {
    return `<span class="chip ${on ? 'on' : ''}">${esc(t)}</span>`;
  }

  function secOpen(id: string): boolean {
    return !state.fold[id];
  }

  function sec(id: string, head: string, bodyHtml: string): string {
    return `<section class="sec ${secOpen(id) ? '' : 'fold'}" data-sec="${esc(id)}">
      <div class="h" data-foldhit="${esc(id)}">${head}<span class="arrow" style="margin-left:auto">▼</span></div>
      <div class="c">${bodyHtml}</div>
    </section>`;
  }

  function optionBar(args: {
    nameAttr: string;
    nameValue: string;
    placeholder: string;
    selectAttr: string;
    options: string;
    saveAct: string;
    delAct: string;
    extra?: string;
    noteAttr?: string;
    noteValue?: string;
    notePlaceholder?: string;
  }): string {
    return `<div class="optstack">
      <div class="optbar">
        <div class="optcombo">
          <input type="text" ${args.nameAttr} value="${esc(args.nameValue)}" placeholder="${esc(args.placeholder)}" />
          <div class="optcaret"><span>▾</span><select ${args.selectAttr}>${args.options}</select></div>
        </div>
        <button class="btn sm" data-act="${esc(args.saveAct)}" type="button">저장</button>
        <button class="btn sm warn" data-act="${esc(args.delAct)}" type="button">삭제</button>
        ${args.extra || ''}
      </div>
      ${args.noteAttr
        ? `<input class="optnote" type="text" ${args.noteAttr} value="${esc(args.noteValue || '')}" placeholder="${esc(args.notePlaceholder || '언제 쓸지')}" />`
        : ''}
    </div>`;
  }

  function optAdd(listHtml: string): string {
    return `<option value="__add__">＋ 추가</option>${listHtml}`;
  }

  function genSettings(): string {
    const g = state.gen;
    const ratio = `${g.w}x${g.h}`;
    return `<div class="seg">
        ${MODELS.filter(([v]) => v).map(([v, t]) => (
          `<button class="${g.model === v ? 'on' : ''}" data-model="${esc(v)}" type="button">${esc(t)}</button>`
        )).join('')}
        <button class="${g.model === '' ? 'on' : ''}" data-model="" type="button">이미지 값</button>
      </div>
      <div class="seg">
        <button class="${ratio === '1216x832' ? 'on' : ''}" data-size="1216x832" type="button">가로</button>
        <button class="${ratio === '832x1216' ? 'on' : ''}" data-size="832x1216" type="button">세로</button>
        <button class="${ratio === '1024x1024' ? 'on' : ''}" data-size="1024x1024" type="button">정사각</button>
      </div>
      <div class="inline">
        <input type="number" data-g="w" value="${esc(g.w)}" />
        <span class="hint">×</span>
        <input type="number" data-g="h" value="${esc(g.h)}" />
      </div>
      <div class="g3">
        <label class="k">steps<input type="number" data-g="steps" value="${esc(g.steps)}" placeholder="이미지" /></label>
        <label class="k">cfg<input type="number" step="0.1" data-g="cfg" value="${esc(g.cfg)}" /></label>
        <label class="k">rescale<input type="number" step="0.1" data-g="rescale" value="${esc(g.rescale)}" /></label>
      </div>
      <div class="inline">
        <button class="btn sm ${g.seedLock ? 'on' : ''}" data-act="seedLock" type="button">고정 ${g.seedLock ? '켬' : '끔'}</button>
        <input type="text" data-g="seed" value="${esc(g.seed)}" placeholder="시드" />
      </div>
      <div class="g2">
        <label class="k">샘플러<select data-g="sampler">${opts(SAMPLERS, g.sampler)}</select></label>
        <label class="k">스케줄<select data-g="scheduler">${opts(SCHEDULERS, g.scheduler)}</select></label>
      </div>
      <button class="quota" data-act="quotaRefresh" type="button">${esc(quotaLabel)}${
        quotaFill >= 0
          ? `<span class="qbar"><i style="width:${Math.max(0, Math.min(100, quotaFill))}%"></i></span>`
          : ''
      }</button>`;
  }

  function panelMain(): string {
    const m = state.main;
    const negPane = m.presetPane === 'neg';
    const n = charList(state).length;
    return [
      `<div class="chips">
        ${chip(m.presetName || '선행 프리셋 없음', !!m.presetId)}
        ${chip(m.autoPerson ? '인원수 자동' : '인원수 수동', m.autoPerson)}
        ${chip(`캐릭터 ${n}`, n > 0)}
      </div>`,
      sec('preset',
        `<span class="name">선행 프리셋</span>
        <span class="grow"></span>
        <button class="btn sm ${m.autoPerson ? 'on' : ''}" data-act="autoPerson" type="button">인원수 자동넣기 ${m.autoPerson ? '켬' : '끔'}</button>`,
        `${optionBar({
          nameAttr: 'data-m="presetName"',
          nameValue: m.presetName,
          placeholder: '프리셋 이름',
          selectAttr: 'data-opt="style"',
          options: optAdd(namedStyle(stylePresets).map((p) => {
            const id = cleanText(p.id, 120);
            return `<option value="${esc(id)}"${id === m.presetId ? ' selected' : ''}>${esc(cleanText(p.name, 200))}</option>`;
          }).join('')),
          saveAct: 'styleSave',
          delAct: 'styleDel',
        })}
        <div class="seg">
          <button class="${negPane ? '' : 'on'}" data-act="presetPos" type="button">선행 프리셋</button>
          <button class="${negPane ? 'on' : ''}" data-act="presetNeg" type="button">네거티브</button>
        </div>
        ${negPane
          ? `<textarea class="t big" data-m="neg" placeholder="이 샷의 네거티브.">${esc(m.neg)}</textarea>`
          : `<textarea class="t big" data-m="presetPrompt" placeholder="선행으로 붙일 태그.">${esc(m.presetPrompt)}</textarea>`}
        <div class="g2">
          <label class="k">인원 태그<select data-m="personMode">${opts(PERSON_MODES, m.personMode)}</select></label>
          <label class="k">강조<select data-m="personWeight">${opts(WEIGHTS, m.personWeight)}</select></label>
        </div>
        <label class="chk"><input type="checkbox" data-m="personSolo" ${m.personSolo ? 'checked' : ''}/> 1명이면 solo</label>`,
      ),
      sec('post', `<span class="name">main 후행</span>`,
        `<textarea class="t big" data-m="post" placeholder="장면·구도·배경. 프리셋에 없는 것들.">${esc(m.post)}</textarea>`),
      sec('gset', `<span class="name">설정</span>`, genSettings()),
    ].join('');
  }

  function panelLlm(): string {
    const l = state.llm;
    return [
      sec('llm',
        `<span class="name">LLM 명령 프리셋</span>
        <span class="grow"></span>
        <button class="btn sm" data-act="llmExport" type="button">내보내기</button>
        <button class="btn sm" data-act="llmImport" type="button">가져오기</button>`,
        `${optionBar({
          nameAttr: 'data-l="presetName"',
          nameValue: l.presetName,
          placeholder: '명령 프리셋 이름',
          selectAttr: 'data-opt="llm"',
          options: optAdd(namedCmd(commandPresets).map((p) => (
            `<option value="${esc(p.id)}"${p.id === l.presetId ? ' selected' : ''}>${esc(p.name)}</option>`
          )).join('')),
          saveAct: 'llmSave',
          delAct: 'llmDel',
        })}
        <label class="k">명령어
          <textarea class="t big" data-l="cmd" placeholder="예: 옷만 교복으로 바꾸고 구도는 그대로.">${esc(l.cmd)}</textarea>
        </label>
        <label class="k">후행 명령어
          <textarea class="t" data-l="cmdPost" placeholder="추가로 지킬 것.">${esc(l.cmdPost)}</textarea>
        </label>
        <button class="btn" data-act="llmRun" type="button" style="width:100%;height:38px">LLM 호출</button>
        <p class="hint">LLM은 프롬프트 칸만 고칩니다. 이미지는 만들지 않습니다.</p>`,
      ),
      sec('llmPeek', `<span class="name">조립 미리보기</span>`,
        `<pre id="assembledLlm" style="margin:0;white-space:pre-wrap;word-break:break-word;font-size:11.5px;color:#c8c6d6;background:rgba(20,22,29,.45);border-radius:8px;padding:8px">${esc(assembleText())}</pre>`),
    ].join('');
  }

  function panelChar(tabId: string): string {
    const c = liveChar(tabId);
    if (!c) return `<p class="hint">없는 칸입니다.</p>`;
    const tab = state.tabs.find((t) => t.id === tabId);
    const stored = rosterById(c.rosterId) || (c.charName ? resolveCharacter(c.charName, roster) : null);
    const costumes = costumesOf(stored).filter((x) => x.name);
    const costume = costumes.find((x) => x.name === (c.costume || c.costumeName))
      || { name: c.costumeName || '', attire: c.costumeTags || '', note: c.costumeNote || '', accessories: '' };
    const coordBody = state.coordMode === 'ai'
      ? `<p class="hint">AI 좌표. 생성할 때 NAI API에 AI choice를 넣습니다. 그림 위 점은 좌표보기에서만 나옵니다.</p>`
      : `<div class="g2">
          <label class="k">x<input type="number" step="0.05" min="0" max="1" data-c="x" data-tab="${esc(tabId)}" value="${c.x.toFixed(2)}"/></label>
          <label class="k">y<input type="number" step="0.05" min="0" max="1" data-c="y" data-tab="${esc(tabId)}" value="${c.y.toFixed(2)}"/></label>
        </div>
        <p class="hint">${state.coordVisible ? '그림 위 C1~C6를 끌어서 옮겨도 됩니다.' : '점·격자는 숨겼습니다. 숫자는 그대로 생성에 넣습니다.'}</p>`;

    if (state.comic) {
      return [
        sec('ap', `<span class="name">${esc(tab?.label || 'C')}</span>`,
          `<textarea class="t big" data-c="tags" data-tab="${esc(tabId)}" placeholder="캡션 태그">${esc(c.tags)}</textarea>`),
        sec('xy', `<span class="name">좌표</span>`, coordBody),
      ].join('');
    }

    return [
      optionBar({
        nameAttr: `data-c="charName" data-tab="${esc(tabId)}"`,
        nameValue: stored?.name || c.charName || '',
        placeholder: '캐릭터 이름',
        selectAttr: `data-opt="char" data-tab="${esc(tabId)}"`,
        options: optAdd(roster.filter((x) => cleanText(x.id, 80) || cleanText(x.name, 200)).map((x) => {
          const id = cleanText(x.id || x.name, 80);
          return `<option value="${esc(id)}"${id === c.rosterId || cleanText(x.name, 200) === c.charName ? ' selected' : ''}>${esc(x.name || id)}</option>`;
        }).join('')),
        saveAct: 'charSave',
        delAct: 'charDel',
      }),
      sec('ap', `<span class="name">${esc(tab?.label || 'C')}</span>`,
        `<textarea class="t big" data-c="tags" data-tab="${esc(tabId)}" placeholder="1girl, long hair, blue eyes …">${esc(c.tags)}</textarea>`),
      sec('po', `<span class="name">${esc((tab?.label || 'C').split(' ')[0] || 'C')} 후행</span>`,
        `<textarea class="t" data-c="post" data-tab="${esc(tabId)}" placeholder="이 샷에서만 더할 것. 표정·상태 같은 것.">${esc(c.post)}</textarea>
         <label class="k">UC
          <textarea class="t" data-c="uc" data-tab="${esc(tabId)}" style="min-height:56px">${esc(c.uc)}</textarea>
         </label>`),
      sec('costume',
        `<span class="name">코스튬</span>`,
        `${optionBar({
          nameAttr: `data-c="costumeName" data-tab="${esc(tabId)}"`,
          nameValue: c.costumeName || costume.name || '',
          placeholder: '코스튬 이름',
          selectAttr: `data-opt="costume" data-tab="${esc(tabId)}"`,
          options: optAdd(costumes.map((x, i) => (
            `<option value="${esc(x.name)}"${x.name === (c.costume || costume.name) ? ' selected' : ''}>${esc(x.name)}[${i}]${x.note ? ` · ${esc(x.note)}` : ''}</option>`
          )).join('')),
          saveAct: 'costumeSave',
          delAct: 'costumeDel',
          noteAttr: `data-c="costumeNote" data-tab="${esc(tabId)}"`,
          noteValue: c.costumeNote || costume.note || '',
          notePlaceholder: '언제 쓸지 · 예: 수영장',
          extra: `<button class="btn sm" data-act="costumeDefault" type="button">기본값으로</button>`,
        })}
        <textarea class="t" data-c="costumeTags" data-tab="${esc(tabId)}" placeholder="school uniform, blue tie …">${esc(c.costumeTags || costume.attire || '')}</textarea>
        <label class="chk"><input type="checkbox" data-c="lock" data-tab="${esc(tabId)}" ${c.lock ? 'checked' : ''}/> 룩 고정</label>`,
      ),
      sec('xy', `<span class="name">좌표</span>`, coordBody),
      sec('gs', `<span class="name">설정</span>`, genSettings()),
    ].join('');
  }

  function tabBtn(t: StudioTab): string {
    const on = state.active === t.id ? 'on' : '';
    const lab = `<span class="lab">${esc(t.label)}</span>`;
    if (t.kind !== 'char') {
      return `<button class="tab ${on}" data-tab="${esc(t.id)}" type="button" title="${esc(t.label)}">${lab}</button>`;
    }
    return `<button class="tab ${on}" data-tab="${esc(t.id)}" type="button" title="${esc(t.label)}">${lab}<span class="x" data-del="${esc(t.id)}">×</span></button>`;
  }

  function renderTabs(): void {
    const bar = $('#tabsBar');
    const row2 = $('#tabrow2') as HTMLElement | null;
    const pickWrap = $('#charPickWrap') as HTMLElement | null;
    const pick = $('#charPick') as HTMLSelectElement | null;
    if (!bar || !row2) return;
    const mains = state.tabs.filter((t) => t.kind !== 'char');
    const chars = state.tabs.filter((t) => t.kind === 'char');
    bar.innerHTML = [...mains, ...chars.slice(0, 3)].map(tabBtn).join('');
    const overflow = chars.slice(3);
    row2.innerHTML = overflow.map(tabBtn).join('');
    row2.hidden = overflow.length === 0;
    if (pickWrap) pickWrap.hidden = state.comic;
    if (pick) {
      const pairs: Array<[string, string]> = [['', '캐릭터 고르기'], ...roster
        .filter((r) => cleanText(r.id, 80) || cleanText(r.name, 200))
        .map((r): [string, string] => [cleanText(r.id || r.name, 80), cleanText(r.name, 200) || cleanText(r.id, 80)])];
      pick.innerHTML = opts(pairs, '');
    }
  }

  function renderPanel(): void {
    const t = state.tabs.find((x) => x.id === state.active) || state.tabs[0];
    const hostEl = $('#panel');
    if (!hostEl || !t) return;
    hostEl.innerHTML = t.kind === 'main' ? panelMain() : t.kind === 'llm' ? panelLlm() : panelChar(t.id);
  }

  function renderHistory(): void {
    const count = $('#hcount');
    const grid = $('#hgrid');
    if (count) count.textContent = String(state.history.length);
    if (!grid) return;
    grid.replaceChildren();
    state.history.forEach((h, i) => {
      const el = document.createElement('div');
      el.className = `hitem${state.historySel === i ? ' on' : ''}`;
      el.dataset.h = String(i);
      const img = document.createElement('img');
      img.alt = '';
      img.src = h.url;
      const b = document.createElement('b');
      b.textContent = h.seed ? `seed ${h.seed}` : '';
      el.append(img, b);
      grid.append(el);
    });
  }

  function renderPeek(): void {
    const text = assembleText();
    const overlay = $('#assembled');
    if (overlay) overlay.textContent = text;
    const side = $('#assembledLlm');
    if (side) side.textContent = text;
    $('#peek')?.classList.toggle('on', state.peek);
    $$('[data-act=peek]').forEach((b) => b.classList.toggle('on', state.peek));
  }

  function renderDots(): void {
    const manual = state.coordMode === 'manual';
    const show = manual && state.coordVisible;
    dotsEl.classList.toggle('hide', !show);
    dotsEl.classList.toggle('grid', show);
    if (show) {
      dotsEl.replaceChildren();
      for (const c of charList(state)) {
        const el = document.createElement('div');
        el.className = ['dot', state.selChar === c.tab.id ? 'sel' : ''].filter(Boolean).join(' ');
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', `C${c.i + 1}`);
        el.dataset.dot = c.tab.id;
        el.dataset.label = `C${c.i + 1}`;
        el.draggable = false;
        el.style.left = `${c.x * 100}%`;
        el.style.top = `${c.y * 100}%`;
        dotsEl.append(el);
      }
    } else {
      dotsEl.replaceChildren();
    }
    const coord = $('#coord');
    if (coord) {
      if (!manual) {
        coord.textContent = 'NAI AI choice';
      } else {
        const c = charList(state).find((x) => x.tab.id === state.selChar);
        coord.textContent = c ? `${c.x.toFixed(2)}, ${c.y.toFixed(2)}` : '—';
      }
    }
    $$('[data-act=auto]').forEach((b) => b.classList.toggle('on', state.coordMode === 'ai'));
    $$('[data-act=grid]').forEach((b) => {
      b.classList.toggle('on', manual && state.coordVisible);
      b.classList.toggle('ok', manual && !state.coordVisible);
    });
    $$('[data-act=history]').forEach((b) => b.classList.toggle('on', !rightEl.classList.contains('collapsed')));
    $$('[data-act=peek]').forEach((b) => b.classList.toggle('on', state.peek));
  }

  function syncLeftFold(): void {
    leftEl.classList.toggle('collapsed', state.leftFold);
    const bar = $('#leftFold');
    if (bar) bar.textContent = state.leftFold ? '▲' : '▼';
    const hL = $('#hL');
    if (hL) hL.textContent = state.leftFold ? '▶' : '◀';
  }

  function syncRightFold(): void {
    rightEl.classList.toggle('collapsed', state.rightFold);
    const hR = $('#hR');
    if (hR) hR.textContent = state.rightFold ? '◀' : '▶';
    const close = $('#hClose');
    if (close) close.textContent = '▶';
  }

  function renderAll(): void {
    const sub = $('#sub');
    if (sub) sub.textContent = state.cardId || '';
    renderTabs();
    renderPanel();
    renderDots();
    renderPeek();
    renderHistory();
    syncLeftFold();
    syncRightFold();
  }

  function canDragCoords(): boolean {
    return state.coordMode === 'manual' && state.coordVisible;
  }

  function dragDot(el: HTMLElement, e: PointerEvent): void {
    const tabId = el.dataset.dot || '';
    const c = liveChar(tabId);
    if (!c) return;
    const pid = e.pointerId;
    state.selChar = tabId;
    dragging = true;
    root.classList.add('is-dragging');
    e.stopPropagation();
    e.preventDefault();
    document.getSelection()?.removeAllRanges();
    try { el.setPointerCapture(pid); } catch { /* capture is optional */ }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      ev.preventDefault();
      const r = dotsEl.getBoundingClientRect();
      if (!r.width || !r.height) return;
      c.x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      c.y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      el.style.left = `${c.x * 100}%`;
      el.style.top = `${c.y * 100}%`;
      const coord = $('#coord');
      if (coord) coord.textContent = `${c.x.toFixed(2)}, ${c.y.toFixed(2)}`;
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      c.x = Math.round(c.x * 10) / 10;
      c.y = Math.round(c.y * 10) / 10;
      el.style.left = `${c.x * 100}%`;
      el.style.top = `${c.y * 100}%`;
      const coord = $('#coord');
      if (coord) coord.textContent = `${c.x.toFixed(2)}, ${c.y.toFixed(2)}`;
      try { el.releasePointerCapture(pid); } catch { /* already released */ }
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      root.classList.remove('is-dragging');
      window.setTimeout(() => { dragging = false; }, 0);
      renderPeek();
      renderPanel();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    move(e);
  }

  function applyStylePreset(p: StyleRow): void {
    state.main.presetId = cleanText(p.id, 120);
    state.main.presetName = cleanText(p.name, 200);
    state.main.presetPrompt = cleanText(p.positive, 8000);
    state.main.neg = cleanText(p.negative, 8000);
    renderPanel();
    renderPeek();
  }

  function applyLlmPreset(p: CmdRow): void {
    state.llm.presetId = p.id;
    state.llm.presetName = p.name;
    state.llm.cmd = p.cmd;
    state.llm.cmdPost = p.cmd_post;
    renderPanel();
  }

  async function saveStylePreset(): Promise<void> {
    const name = cleanText(state.main.presetName, 200);
    if (!name) return toast('프리셋 이름을 적어 주세요.');
    if (!await askYesNo(`「${name}」 선행 프리셋을 저장할까요?`)) return;
    const cur = styleById(state.main.presetId);
    if (cur && cleanText(cur.id, 120)) {
      cur.name = name;
      cur.positive = state.main.presetPrompt;
      cur.negative = state.main.neg;
    } else {
      const id = nextId('p');
      stylePresets.push({ id, name, positive: state.main.presetPrompt, negative: state.main.neg });
      state.main.presetId = id;
      state.main.presetName = name;
    }
    try {
      await persistCard({ presets: stylePresets });
      toast('선행 프리셋을 저장했습니다.');
    } catch (err) {
      toast(String((err as Error).message || err));
    }
    renderPanel();
  }

  async function deleteStylePreset(): Promise<void> {
    const cur = styleById(state.main.presetId);
    if (!cur || !cleanText(cur.id, 120)) return toast('고른 프리셋이 없습니다.');
    if (!await askYesNo(`「${cleanText(cur.name, 200)}」 프리셋을 삭제할까요?`)) return;
    stylePresets = stylePresets.filter((p) => cleanText(p.id, 120) !== cleanText(cur.id, 120));
    state.main.presetId = '';
    state.main.presetName = '';
    try {
      await persistCard({ presets: stylePresets });
      toast('선행 프리셋을 지웠습니다.');
    } catch (err) {
      toast(String((err as Error).message || err));
    }
    renderPanel();
  }

  async function saveLlmPreset(): Promise<void> {
    const name = cleanText(state.llm.presetName, 200);
    if (!name) return toast('명령 프리셋 이름을 적어 주세요.');
    if (!await askYesNo(`「${name}」 명령 프리셋을 저장할까요?`)) return;
    const cur = cmdById(state.llm.presetId);
    if (cur && cur.id) {
      cur.name = name;
      cur.cmd = state.llm.cmd;
      cur.cmd_post = state.llm.cmdPost;
    } else {
      const id = nextId('l');
      commandPresets.push({ id, name, cmd: state.llm.cmd, cmd_post: state.llm.cmdPost });
      state.llm.presetId = id;
      state.llm.presetName = name;
    }
    try {
      await persistCard({ command_presets: commandPresets });
      toast('명령 프리셋을 저장했습니다.');
    } catch (err) {
      toast(String((err as Error).message || err));
    }
    renderPanel();
  }

  async function deleteLlmPreset(): Promise<void> {
    const cur = cmdById(state.llm.presetId);
    if (!cur?.id) return toast('고른 명령 프리셋이 없습니다.');
    if (!await askYesNo(`「${cur.name}」 명령 프리셋을 삭제할까요?`)) return;
    commandPresets = commandPresets.filter((p) => p.id !== cur.id);
    state.llm.presetId = '';
    state.llm.presetName = '';
    try {
      await persistCard({ command_presets: commandPresets });
      toast('명령 프리셋을 지웠습니다.');
    } catch (err) {
      toast(String((err as Error).message || err));
    }
    renderPanel();
  }

  function exportLlmPresets(): void {
    const list = namedCmd(commandPresets).map((p) => ({
      id: p.id, name: p.name, cmd: p.cmd, cmd_post: p.cmd_post,
    }));
    if (!list.length) return toast('내보낼 명령 프리셋이 없습니다.');
    const blob = new Blob([JSON.stringify({ kind: 'inlay-llm-presets', presets: list }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'llm-presets.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`${list.length}개 명령 프리셋을 내보냈습니다.`);
  }

  function importLlmPresets(): void {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0];
      if (!f) return;
      let data: unknown;
      try { data = JSON.parse(await f.text()); }
      catch { return toast('JSON을 읽지 못했습니다.'); }
      const recData = asRecord(data);
      const raw = Array.isArray(data) ? data : recData.presets;
      if (!Array.isArray(raw)) return toast('명령 프리셋 목록이 없습니다.');
      let n = 0;
      for (const row of raw) {
        const item = asRecord(row);
        const name = cleanText(item.name, 200);
        if (!name) continue;
        const cmd = cleanText(item.cmd || item.instruction, 4000);
        const cmdPost = cleanText(item.cmd_post || item.cmdPost, 2000);
        const hit = namedCmd(commandPresets).find((p) => p.name === name);
        if (hit) {
          hit.cmd = cmd;
          hit.cmd_post = cmdPost;
        } else {
          commandPresets.push({ id: nextId('l'), name, cmd, cmd_post: cmdPost });
        }
        n += 1;
      }
      if (!n) return toast('가져온 명령 프리셋이 없습니다.');
      try {
        await persistCard({ command_presets: commandPresets });
        toast(`${n}개 명령 프리셋을 가져왔습니다.`);
      } catch (err) {
        toast(String((err as Error).message || err));
      }
      renderPanel();
    });
    inp.click();
  }

  async function persistCharacter(row: Record<string, unknown>): Promise<Record<string, unknown>> {
    const global = rowIsGlobal(row as CharacterInput);
    const res = await saveCharacter({
      session_id: state.sessionId,
      character_id: state.characterId,
      scope: global ? '__global__' : (state.sessionId || '__global__'),
      character: row,
      stamp_card_id: state.cardId,
    });
    if (res.ok === false) throw new Error(errMsg(res, '캐릭터를 저장하지 못했습니다.'));
    await refreshRoster(res);
    return res;
  }

  async function saveChar(): Promise<void> {
    const id = activeCharId();
    const c = liveChar(id);
    if (!c) return;
    const stored = rosterById(c.rosterId) || (c.charName ? resolveCharacter(c.charName, roster) : null);
    const name = cleanText(c.charName || stored?.name, 200);
    if (!name) return toast('캐릭터 이름을 적어 주세요.');
    if (!await askYesNo(`「${name}」 캐릭터를 저장할까요?`)) return;
    const costumes = costumesOf(stored);
    try {
      await persistCharacter({
        ...asRecord(stored),
        id: stored?.id || c.rosterId || undefined,
        name,
        appearance: c.tags,
        costumes: costumes.length ? costumes : [{ name: 'default', attire: '', note: '', accessories: '' }],
      });
      const next = resolveCharacter(name, roster);
      if (next) {
        c.rosterId = cleanText(next.id || next.name, 80);
        c.charName = next.name || name;
      } else {
        c.charName = name;
      }
      relabel();
      toast('캐릭터를 저장했습니다.');
      renderAll();
    } catch (err) {
      toast(String((err as Error).message || err));
    }
  }

  async function deleteChar(): Promise<void> {
    const id = activeCharId();
    const c = liveChar(id);
    const stored = rosterById(c?.rosterId || '') || (c?.charName ? resolveCharacter(c.charName, roster) : null);
    if (!stored?.id && !stored?.name) return toast('고른 캐릭터가 없습니다.');
    if (!await askYesNo(`「${stored.name || stored.id}」 캐릭터를 삭제할까요?`)) return;
    try {
      if (rowIsGlobal(stored)) {
        const globals = (Array.isArray(rosterPayload.global) ? rosterPayload.global : [])
          .filter((g) => {
            if (!g || typeof g !== 'object') return false;
            const recG = g as CharacterInput;
            return cleanText(recG.id, 80) !== cleanText(stored.id, 80);
          });
        const res = await saveCharacter({ global: globals });
        if (res.ok === false) throw new Error(errMsg(res, '캐릭터를 지우지 못했습니다.'));
        await refreshRoster(res);
      } else {
        const session = (Array.isArray(rosterPayload.characters) ? rosterPayload.characters : [])
          .filter((g) => {
            if (!g || typeof g !== 'object') return false;
            const recG = g as CharacterInput;
            return cleanText(recG.id, 80) !== cleanText(stored.id, 80);
          });
        const res = await saveCharacter({
          session_id: state.sessionId,
          character_id: state.characterId,
          characters: session,
        });
        if (res.ok === false) throw new Error(errMsg(res, '캐릭터를 지우지 못했습니다.'));
        await refreshRoster(res);
      }
      const gone = cleanText(stored.id, 80);
      for (const ch of Object.values(state.chars)) {
        if (cleanText(ch.rosterId, 80) === gone) {
          ch.rosterId = '';
          ch.charName = '';
        }
      }
      relabel();
      toast('캐릭터를 지웠습니다.');
      renderAll();
    } catch (err) {
      toast(String((err as Error).message || err));
    }
  }

  async function saveCostume(): Promise<void> {
    const id = activeCharId();
    const c = liveChar(id);
    const stored = rosterById(c?.rosterId || '') || (c?.charName ? resolveCharacter(c?.charName || '', roster) : null);
    if (!stored?.id && !stored?.name) return toast('먼저 캐릭터를 저장하세요.');
    const name = cleanText(c?.costumeName, 200);
    if (!name || !c) return toast('코스튬 이름을 적어 주세요.');
    if (!await askYesNo(`「${name}」 코스튬을 저장할까요?`)) return;
    const list = costumesOf(stored);
    let slot = list.find((x) => x.name === c.costume);
    if (!slot || !c.costume) {
      slot = { name, attire: c.costumeTags || '', note: c.costumeNote || '', accessories: '' };
      list.push(slot);
    } else {
      slot.name = name;
      slot.attire = c.costumeTags || '';
      slot.note = c.costumeNote || '';
    }
    c.costume = name;
    c.costumeName = name;
    try {
      await persistCharacter({
        ...asRecord(stored),
        id: stored.id,
        name: stored.name,
        costumes: list,
      });
      toast('코스튬을 저장했습니다.');
      renderPanel();
      renderPeek();
    } catch (err) {
      toast(String((err as Error).message || err));
    }
  }

  async function deleteCostume(): Promise<void> {
    const id = activeCharId();
    const c = liveChar(id);
    const stored = rosterById(c?.rosterId || '') || (c?.charName ? resolveCharacter(c?.charName || '', roster) : null);
    if ((!stored?.id && !stored?.name) || !c?.costume) return toast('고른 코스튬이 없습니다.');
    if (!await askYesNo(`「${c.costume}」 코스튬을 삭제할까요?`)) return;
    let list = costumesOf(stored).filter((x) => x.name !== c.costume);
    if (!list.some((x) => x.name)) list = [{ name: 'default', attire: '', note: '', accessories: '' }];
    const next = list.find((x) => x.name);
    c.costume = next?.name || '';
    c.costumeName = next?.name || '';
    c.costumeTags = next?.attire || '';
    c.costumeNote = next?.note || '';
    try {
      await persistCharacter({
        ...asRecord(stored),
        id: stored.id,
        name: stored.name,
        costumes: list,
      });
      toast('코스튬을 지웠습니다.');
      renderPanel();
      renderPeek();
    } catch (err) {
      toast(String((err as Error).message || err));
    }
  }

  async function costumeDefault(): Promise<void> {
    const id = activeCharId();
    const c = liveChar(id);
    const stored = rosterById(c?.rosterId || '') || (c?.charName ? resolveCharacter(c?.charName || '', roster) : null);
    if ((!stored?.id && !stored?.name) || !c?.costume) return toast('고른 코스튬이 없습니다.');
    const list = costumesOf(stored);
    const i = list.findIndex((x) => x.name === c.costume);
    if (i < 0) return toast('고른 코스튬이 없습니다.');
    const [slot] = list.splice(i, 1);
    if (!slot) return;
    const empty = list.findIndex((x) => !x.name);
    if (empty === 0) list.splice(1, 0, slot);
    else list.unshift(slot);
    try {
      await persistCharacter({
        ...asRecord(stored),
        id: stored.id,
        name: stored.name,
        costumes: list,
        attire: slot.attire,
        accessories: slot.accessories,
        promote_costume_default: true,
      });
      toast('이 코스튬을 기본으로 두었습니다.');
      renderPanel();
    } catch (err) {
      toast(String((err as Error).message || err));
    }
  }

  function onOptPick(kind: string, value: string, tabId: string): void {
    if (kind === 'style') {
      if (value === '__add__') {
        state.main.presetId = '';
        state.main.presetName = '';
        renderPanel();
        return;
      }
      const p = styleById(value);
      if (p) applyStylePreset(p);
      return;
    }
    if (kind === 'llm') {
      if (value === '__add__') {
        state.llm.presetId = '';
        state.llm.presetName = '';
        renderPanel();
        return;
      }
      const p = cmdById(value);
      if (p) applyLlmPreset(p);
      return;
    }
    if (kind === 'char') {
      const c = liveChar(tabId);
      if (!c) return;
      if (value === '__add__') {
        c.rosterId = '';
        c.charName = '';
        c.tags = '';
        c.costume = '';
        c.costumeName = '';
        c.costumeTags = '';
        c.costumeNote = '';
        relabel();
        renderAll();
        return;
      }
      const r = rosterById(value) || resolveCharacter(value, roster);
      c.rosterId = cleanText(r?.id || value, 80);
      c.charName = r?.name || '';
      const first = costumesOf(r).find((x) => x.name);
      c.costume = first?.name || '';
      c.costumeName = c.costume;
      c.costumeTags = first?.attire || '';
      c.costumeNote = first?.note || '';
      c.tags = cleanText(r?.appearance, 4000);
      relabel();
      renderAll();
      return;
    }
    if (kind === 'costume') {
      const c = liveChar(tabId);
      const r = rosterById(c?.rosterId || '') || (c?.charName ? resolveCharacter(c.charName, roster) : null);
      if (!c) return;
      if (value === '__add__') {
        c.costume = '';
        c.costumeName = '';
        c.costumeTags = '';
        c.costumeNote = '';
        renderPanel();
        return;
      }
      const slot = costumesOf(r).find((x) => x.name === value);
      c.costume = value;
      c.costumeName = value;
      c.costumeTags = slot?.attire || '';
      c.costumeNote = slot?.note || '';
      renderPanel();
      renderPeek();
    }
  }

  function applyRewrite(res: Record<string, unknown>): void {
    const mainText = cleanText(res.main_prompt, 8000);
    const peeled = peelMain(mainText, stylePresets);
    const hit = stylePresets.find((p) => cleanText(p.id, 120) === peeled.preset.id);
    state.main.presetId = peeled.preset.id;
    state.main.presetName = peeled.preset.name || cleanText(hit?.name, 200);
    state.main.presetPrompt = peeled.preset.positive || cleanText(hit?.positive, 8000);
    state.main.post = peeled.post;
    state.main.neg = peeled.preset.negative || cleanText(res.negative_prompt, 8000);
    state.main.autoPerson = Boolean(peeled.person);
    state.main.personMode = peeled.personMode || '';
    state.main.personWeight = peeled.personWeight;
    state.main.personSolo = peeled.personSolo;
    state.main.quality = peeled.quality;
    const rows = Array.isArray(res.characters) ? res.characters : [];
    charList(state).forEach((c, i) => {
      const ch = liveChar(c.id);
      if (!ch) return;
      const row = asRecord(rows[i]);
      const prompt = cleanText(row.prompt, 4000);
      if ('uc' in row) ch.uc = cleanText(row.uc, 2000);
      if (state.comic) {
        if (prompt) ch.tags = prompt;
        return;
      }
      if (row.name) ch.charName = cleanText(row.name, 200);
      const stored = ch.charName ? resolveCharacter(ch.charName, roster) : null;
      const look = joinTags(stored?.appearance, ch.tags, ch.costumeTags);
      const peeled = peelStudioCharFields({
        slim: null,
        caption: prompt || joinTags(ch.tags, ch.costumeTags, ch.post),
        lookTags: look,
        costumeAttire: ch.costumeTags,
      });
      ch.tags = peeled.tags;
      ch.costumeTags = peeled.costumeTags;
      ch.post = peeled.post;
    });
    relabel();
  }

  async function runLlm(): Promise<void> {
    const instruction = [state.llm.cmd, state.llm.cmdPost].map((s) => String(s || '').trim()).filter(Boolean).join('\n');
    const a = assemble(state, roster);
    setBusy(true);
    try {
      const res = await commandRewrite(state.cardId, {
        main_prompt: a.main,
        negative_prompt: a.neg,
        characters: a.chars.map((c) => ({
          name: c.name,
          prompt: c.prompt,
          uc: c.uc,
          center_x: c.center_x,
          center_y: c.center_y,
        })),
        instruction,
        look_locked: charList(state).map((c) => c.lock),
        preset_id: state.main.presetId,
      });
      if (res.ok === false) {
        toast(errMsg(res, 'LLM 호출에 실패했습니다.'));
        return;
      }
      applyRewrite(res);
      toast('프롬프트를 고쳤습니다.');
      renderAll();
    } catch (err) {
      toast(String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  }

  async function generate(opts: { quiet?: boolean } = {}): Promise<void> {
    if (state.busy) return;
    if (state.coordMode === 'ai' && !opts.quiet) {
      toast('생성 요청에 NAI AI choice 좌표를 넣습니다.');
    }
    setBusy(true);
    try {
      const res = await studioGenerate(state.cardId, assembleOverrides(state, roster));
      if (res.ok === false) {
        stopLoop();
        toast(errMsg(res, state.metaError || '생성에 실패했습니다.'));
        return;
      }
      const url = cleanText(res.image_data_url, 20_000_000);
      const seed = Number(res.seed) || 0;
      if (!url) {
        stopLoop();
        toast('생성 결과가 없습니다.');
        return;
      }
      if (!state.gen.seedLock && seed > 0) state.gen.seed = seed;
      state.history.unshift({ url, seed });
      state.historySel = 0;
      await showImage(url);
      renderAll();
    } catch (err) {
      stopLoop();
      toast(String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  }

  async function commitAndClose(): Promise<void> {
    setBusy(true);
    try {
      const canvasUrl = canvasDataUrl();
      const res = await studioCommit(state.cardId, {
        ...assembleOverrides(state, roster),
        image_data_url: canvasUrl,
      });
      if (res.ok === false) {
        toast(errMsg(res, '저장에 실패했습니다.'));
        return;
      }
      const card = res.card && typeof res.card === 'object' ? res.card as Record<string, unknown> : {};
      // Commit publishes under a new card id (like a reroll): flip the inline
      // slot to the new photo, anchored at the old card. Fall back to the
      // canvas we just committed only when the server echo is empty.
      await replaceInlinePhotoAfterSave(
        cleanText(card.id, 80) || state.cardId,
        cleanText(card.image_url, 20_000_000) || canvasUrl,
        state.cardId,
      );
      closeStudio();
    } catch (err) {
      toast(String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  }

  function downloadHistory(): void {
    if (!state.history.length) return toast('받을 게 없습니다.');
    state.history.forEach((h, i) => {
      window.setTimeout(() => {
        const a = document.createElement('a');
        a.href = h.url;
        a.download = `studio-${String(i + 1).padStart(2, '0')}.png`;
        a.click();
      }, i * 180);
    });
    toast(`${state.history.length}장을 순서대로 내려받습니다. (히스토리만)`);
  }

  function setLoopUi(on: boolean): void {
    state.loop = on;
    ['#loop', '#loopDesk'].forEach((sel) => {
      const b = $(sel);
      if (!b) return;
      b.classList.toggle('on', on);
      const hint = b.querySelector('.hint');
      if (hint) hint.textContent = on ? '켬' : '꺼짐';
    });
  }

  function stopLoop(): void {
    if (loopTimer) {
      clearInterval(loopTimer);
      loopTimer = null;
    }
    setLoopUi(false);
  }

  function toggleLoop(): void {
    if (loopTimer) {
      stopLoop();
      return;
    }
    loopTimer = setInterval(() => { void generate({ quiet: true }); }, 2600);
    setLoopUi(true);
    void generate();
  }

  function toggleHistory(): void {
    state.rightFold = !state.rightFold;
    syncRightFold();
    renderDots();
    window.setTimeout(fitView, 240);
  }

  function toggleLeft(): void {
    state.leftFold = !state.leftFold;
    syncLeftFold();
    window.setTimeout(fitView, 240);
  }

  function addCharTab(rosterId: string): void {
    if (charList(state).length >= 6) return toast('캐릭터 칸은 6개까지');
    const id = nextId('c');
    const r = rosterById(rosterId) || resolveCharacter(rosterId, roster);
    const firstCos = costumesOf(r).find((x) => x.name);
    const slot = CHAR_SLOTS[charList(state).length] || [0.5, 0.5];
    state.chars[id] = {
      rosterId: cleanText(r?.id || rosterId, 80),
      charName: r?.name || '',
      costume: firstCos?.name || '',
      costumeName: firstCos?.name || '',
      costumeTags: firstCos?.attire || '',
      costumeNote: firstCos?.note || '',
      tags: state.comic ? '' : cleanText(r?.appearance, 4000),
      post: '',
      uc: '',
      x: slot[0],
      y: slot[1],
      auto: true,
      lock: false,
      slim: {},
    };
    state.tabs.push({ id, kind: 'char', label: '' });
    relabel();
    state.active = id;
    state.selChar = id;
    renderAll();
  }

  function act(name: string): void {
    switch (name) {
      case 'grid':
        if (state.coordMode !== 'manual') {
          state.coordMode = 'manual';
          state.coordVisible = true;
          toast('좌표보기. C1~C6를 끌어서 옮기세요.');
        } else {
          state.coordVisible = !state.coordVisible;
          toast(state.coordVisible ? '좌표·격자를 다시 보여 줍니다.' : '좌표·격자만 숨겼습니다. 생성에는 그대로 넣습니다.');
        }
        renderDots();
        renderPanel();
        break;
      case 'fit':
        fitView();
        break;
      case 'peek':
        state.peek = !state.peek;
        renderPeek();
        break;
      case 'auto':
        state.coordMode = 'ai';
        state.coordVisible = true;
        renderDots();
        renderPanel();
        toast('AI 좌표. 생성할 때 NAI API에 AI choice를 넣습니다.');
        break;
      case 'history':
        toggleHistory();
        break;
      case 'settings': {
        state.leftFold = false;
        syncLeftFold();
        state.active = 'main';
        state.fold.gset = false;
        renderAll();
        window.requestAnimationFrame(() => {
          const secEl = $('[data-sec=gset]');
          if (!secEl) return;
          secEl.classList.remove('fold');
          secEl.scrollIntoView({ block: 'center' });
        });
        break;
      }
      case 'autoPerson':
        state.main.autoPerson = !state.main.autoPerson;
        renderPanel();
        renderPeek();
        break;
      case 'quotaRefresh':
        void refreshQuota();
        break;
      case 'seedLock':
        state.gen.seedLock = !state.gen.seedLock;
        void saveSettings({ card: { studio_seed_lock: state.gen.seedLock } }).catch(() => {});
        renderPanel();
        break;
      case 'presetPos':
        state.main.presetPane = 'pos';
        renderPanel();
        break;
      case 'presetNeg':
        state.main.presetPane = 'neg';
        renderPanel();
        break;
      case 'styleSave':
        void saveStylePreset();
        break;
      case 'styleDel':
        void deleteStylePreset();
        break;
      case 'llmRun':
        void runLlm();
        break;
      case 'llmSave':
        void saveLlmPreset();
        break;
      case 'llmDel':
        void deleteLlmPreset();
        break;
      case 'llmExport':
        exportLlmPresets();
        break;
      case 'llmImport':
        importLlmPresets();
        break;
      case 'charSave':
        void saveChar();
        break;
      case 'charDel':
        void deleteChar();
        break;
      case 'costumeSave':
        void saveCostume();
        break;
      case 'costumeDel':
        void deleteCostume();
        break;
      case 'costumeDefault':
        void costumeDefault();
        break;
      default:
        break;
    }
  }

  function onEdit(e: Event): void {
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
    const num = (v: string, d: number) => (v === '' ? d : Number.isFinite(Number(v)) ? Number(v) : d);

    if (el.dataset.m) {
      const k = el.dataset.m;
      if (k === 'personSolo' && el instanceof HTMLInputElement) state.main.personSolo = el.checked;
      else if (k === 'presetName') state.main.presetName = el.value;
      else if (k === 'presetPrompt') state.main.presetPrompt = el.value;
      else if (k === 'post') state.main.post = el.value;
      else if (k === 'neg') state.main.neg = el.value;
      else if (k === 'personMode') {
        const v = el.value;
        state.main.personMode = v === 'off' || v === 'gender' || v === 'girls' || v === 'people' ? v : '';
      } else if (k === 'personWeight') state.main.personWeight = el.value;
      renderPeek();
      return;
    }
    if (el.dataset.l) {
      const k = el.dataset.l;
      if (k === 'presetName') state.llm.presetName = el.value;
      else if (k === 'cmd') state.llm.cmd = el.value;
      else if (k === 'cmdPost') state.llm.cmdPost = el.value;
      return;
    }
    if (el.dataset.g) {
      const k = el.dataset.g;
      if (k === 'w' || k === 'h') {
        state.gen[k] = num(el.value, 832) || 832;
        drawStage();
      } else if (k === 'steps') state.gen.steps = el.value;
      else if (k === 'seed') state.gen.seed = num(el.value, 0);
      else if (k === 'cfg' || k === 'rescale') state.gen[k] = num(el.value, 0);
      else if (k === 'sampler') state.gen.sampler = el.value;
      else if (k === 'scheduler') state.gen.scheduler = el.value;
      renderPeek();
      return;
    }
    if (el.dataset.c) {
      const tabId = el.dataset.tab || '';
      const c = liveChar(tabId);
      if (!c) return;
      const k = el.dataset.c;
      if ((k === 'lock' || k === 'auto') && el instanceof HTMLInputElement) {
        if (k === 'lock') c.lock = el.checked;
        else c.auto = el.checked;
        renderDots();
        renderPanel();
        renderPeek();
        return;
      }
      if (k === 'charName' || k === 'costumeName' || k === 'costumeTags' || k === 'costumeNote') {
        c[k] = el.value;
        renderPeek();
        return;
      }
      if (k === 'x' || k === 'y') {
        c[k] = Math.min(1, Math.max(0, Number(el.value) || 0));
        renderDots();
        renderPeek();
        return;
      }
      if (k === 'tags') c.tags = el.value;
      else if (k === 'post') c.post = el.value;
      else if (k === 'uc') c.uc = el.value;
      renderPeek();
    }
  }

  function bindPanel(): void {
    on(root, 'click', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const fold = t.closest('[data-foldhit]');
      if (fold instanceof HTMLElement && !t.closest('[data-foldhit] select, [data-foldhit] button')) {
        const id = fold.dataset.foldhit || '';
        state.fold[id] = !state.fold[id];
        fold.parentElement?.classList.toggle('fold', !!state.fold[id]);
        void persistCard({ studio_folds: { ...state.fold } }).catch(() => {});
        return;
      }
      const a = t.closest('[data-act]');
      if (a instanceof HTMLElement && a.dataset.act) {
        act(a.dataset.act);
        return;
      }
      const del = t.closest('[data-del]');
      if (del instanceof HTMLElement) {
        e.stopPropagation();
        const id = del.dataset.del || '';
        state.tabs = state.tabs.filter((tab) => tab.id !== id);
        delete state.chars[id];
        if (state.active === id) state.active = 'main';
        if (state.selChar === id) state.selChar = state.tabs.find((tab) => tab.kind === 'char')?.id || '';
        relabel();
        renderAll();
        return;
      }
      const tab = t.closest('[data-tab]');
      if (tab instanceof HTMLElement && tab.classList.contains('tab')) {
        state.active = tab.dataset.tab || 'main';
        const found = state.tabs.find((x) => x.id === state.active);
        if (found?.kind === 'char') state.selChar = found.id;
        renderAll();
        return;
      }
      const model = t.closest('[data-model]');
      if (model instanceof HTMLElement) {
        state.gen.model = model.dataset.model || '';
        renderPanel();
        return;
      }
      const size = t.closest('[data-size]');
      if (size instanceof HTMLElement && size.dataset.size) {
        const [w, h] = size.dataset.size.split('x').map(Number);
        state.gen.w = w || 832;
        state.gen.h = h || 1216;
        drawStage();
        renderPanel();
        return;
      }
      const dot = t.closest('[data-dot]');
      if (dot instanceof HTMLElement) {
        if (dragging) return;
        state.selChar = dot.dataset.dot || '';
        state.active = dot.dataset.dot || state.active;
        renderAll();
        return;
      }
      const h = t.closest('[data-h]');
      if (h instanceof HTMLElement) {
        const i = Number(h.dataset.h);
        if (!Number.isFinite(i) || !state.history[i]) return;
        state.historySel = i;
        void showImage(state.history[i]!.url).then(() => renderAll());
      }
    });

    on(root, 'input', onEdit);
    on(root, 'change', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const opt = t.closest('[data-opt]');
      if (opt instanceof HTMLSelectElement) {
        onOptPick(opt.dataset.opt || '', opt.value, opt.dataset.tab || '');
        return;
      }
      onEdit(e);
    });
  }

  function bindViewport(): void {
    on(viewport, 'dragenter', (e) => {
      e.preventDefault();
      viewport.classList.add('dropok');
    });
    on(viewport, 'dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      viewport.classList.add('dropok');
    });
    on(viewport, 'dragleave', (e) => {
      if (e.target === viewport) viewport.classList.remove('dropok');
    });
    on(viewport, 'drop', (e) => {
      e.preventDefault();
      viewport.classList.remove('dropok');
      const file = e.dataTransfer?.files?.[0];
      if (file) void ingestDroppedFile(file);
    });

    on(viewport, 'wheel', (e) => {
      e.preventDefault();
      const r = viewport.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const next = Math.min(8, Math.max(0.1, view.scale * (e.deltaY < 0 ? 1.15 : 0.87)));
      view.x = mx - (mx - view.x) * (next / view.scale);
      view.y = my - (my - view.y) * (next / view.scale);
      view.scale = next;
      applyView();
    }, { passive: false });

    on(root, 'selectstart', (e) => {
      if (dragging || (e.target instanceof Element && e.target.closest('.dot, #dots'))) e.preventDefault();
    });
    on(root, 'dragstart', (e) => {
      if (e.target instanceof Element && e.target.closest('.dot, #dots')) e.preventDefault();
    });

    on(dotsEl, 'pointerdown', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const dot = t.closest('[data-dot]');
      if (!(dot instanceof HTMLElement)) return;
      e.preventDefault();
      e.stopPropagation();
      document.getSelection()?.removeAllRanges();
      if (canDragCoords()) {
        dragDot(dot, e);
        return;
      }
      state.selChar = dot.dataset.dot || '';
      renderDots();
    });

    on(viewport, 'pointerdown', (e) => {
      if (e.target instanceof Element && e.target.closest('[data-dot]')) return;
      if (dragging) return;
      viewport.setPointerCapture(e.pointerId);
      viewport.classList.add('grabbing');
      const sx = e.clientX - view.x;
      const sy = e.clientY - view.y;
      const move = (ev: PointerEvent) => {
        view.x = ev.clientX - sx;
        view.y = ev.clientY - sy;
        applyView();
      };
      const up = () => {
        viewport.classList.remove('grabbing');
        viewport.removeEventListener('pointermove', move);
        viewport.removeEventListener('pointerup', up);
      };
      viewport.addEventListener('pointermove', move);
      viewport.addEventListener('pointerup', up);
    });

    on(viewport, 'dblclick', () => fitView());

    let seen = '';
    const ro = new ResizeObserver(() => {
      const r = viewport.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const key = `${Math.round(r.width)}x${Math.round(r.height)}`;
      if (key === seen) return;
      seen = key;
      fitView();
    });
    ro.observe(viewport);
    cleanups.push(() => ro.disconnect());
  }

  function bindId(id: string, type: string, fn: EventListener): void {
    const el = $(`#${id}`);
    if (!el) return;
    el.addEventListener(type, fn);
    cleanups.push(() => el.removeEventListener(type, fn));
  }

  function bindChrome(): void {
    bindId('close', 'click', () => closeStudio());
    bindId('leftFold', 'click', () => toggleLeft());
    bindId('hL', 'click', () => toggleLeft());
    bindId('hR', 'click', () => toggleHistory());
    bindId('hClose', 'click', () => toggleHistory());
    bindId('tabAdd', 'click', () => addCharTab((($('#charPick') as HTMLSelectElement | null)?.value) || ''));
    const charPick = $('#charPick') as HTMLSelectElement | null;
    if (charPick) {
      const fn = () => {
        if (!charPick.value) return;
        addCharTab(charPick.value);
        charPick.value = '';
      };
      charPick.addEventListener('change', fn);
      cleanups.push(() => charPick.removeEventListener('change', fn));
    }
    const gen = $('#gen');
    if (gen) {
      const fn = () => { void generate(); };
      gen.addEventListener('click', fn);
      cleanups.push(() => gen.removeEventListener('click', fn));
    }
    const save = $('#save');
    if (save) {
      const fn = () => { void commitAndClose(); };
      save.addEventListener('click', fn);
      cleanups.push(() => save.removeEventListener('click', fn));
    }
    const cancel = $('#cancel');
    if (cancel) {
      cancel.addEventListener('click', closeStudio);
      cleanups.push(() => cancel.removeEventListener('click', closeStudio));
    }
    const loop = $('#loop');
    if (loop) {
      loop.addEventListener('click', toggleLoop);
      cleanups.push(() => loop.removeEventListener('click', toggleLoop));
    }
    const loopDesk = $('#loopDesk');
    if (loopDesk) {
      loopDesk.addEventListener('click', toggleLoop);
      cleanups.push(() => loopDesk.removeEventListener('click', toggleLoop));
    }
    const zip = $('#zip');
    if (zip) {
      zip.addEventListener('click', downloadHistory);
      cleanups.push(() => zip.removeEventListener('click', downloadHistory));
    }
  }

  bindPanel();
  bindViewport();
  bindChrome();
  syncLeftFold();
  syncRightFold();
  drawStage();

  void (async () => {
    if (!cardId) {
      toast('카드가 없습니다.');
      const sub = $('#sub');
      if (sub) sub.textContent = '';
      renderAll();
      return;
    }
    const [naiRes, settingsRes, rosterRes, imageUrl] = await Promise.all([
      loadNaiPrompt(cardId).catch((err: unknown) => ({
        ok: false,
        error: { message: String((err as Error)?.message || err) },
      })),
      loadSettings().catch(() => ({})),
      loadRoster(sessionId, characterId).catch(() => ({ characters: [], global: [] })),
      resolveCardUrl(cardId, fallbackUrl),
    ]);

    cardSettings = { ...asRecord(asRecord(settingsRes).card) };
    const rawPresets = Array.isArray(cardSettings.presets) ? cardSettings.presets : [];
    stylePresets = rawPresets.filter((p): p is StyleRow => !!p && typeof p === 'object');
    const rawCmds = Array.isArray(cardSettings.command_presets) ? cardSettings.command_presets : [];
    commandPresets = rawCmds
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .map((p) => ({
        id: cleanText(p.id, 120),
        name: cleanText(p.name, 200),
        cmd: cleanText(p.cmd || p.instruction, 4000),
        cmd_post: cleanText(p.cmd_post || p.cmdPost, 2000),
      }))
      .filter((p) => p.id || p.name || p.cmd);
    state.gen.seedLock = cardSettings.studio_seed_lock === true
      || cardSettings.studio_seed_lock === 'true'
      || cardSettings.studio_seed_lock === 1
      || cardSettings.studio_seed_lock === '1'
      || cardSettings.studio_seed_lock === 'on';
    const folds = cardSettings.studio_folds;
    if (folds && typeof folds === 'object' && !Array.isArray(folds)) {
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(folds as Record<string, unknown>)) {
        const id = cleanText(key, 80);
        if (!id) continue;
        next[id] = value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
      }
      state.fold = next;
    }
    const live = liveUiScope();
    if (!state.characterId && live.characterId) state.characterId = live.characterId;
    if (!state.sessionId && live.sessionId && !live.unified) {
      state.sessionId = live.sessionId;
    }
    let liveFetched: Record<string, unknown> | null = null;
    if (live.sessionId && live.sessionId !== sessionId) {
      liveFetched = await loadRoster(live.sessionId, live.characterId || characterId)
        .catch(() => null);
    }
    await refreshRoster(mergeStudioRosterPayloads(rosterRes, liveFetched));

    const nai = asRecord(naiRes);
    if (nai.ok === false || nai.error) {
      state.metaError = errMsg(nai, '이미지 메타를 읽지 못했습니다.');
      toast(state.metaError);
    } else {
      hydrateFromNai({
        state,
        nai,
        settings: settingsRes,
        rosterPayload,
        card: rec,
      });
      relabel();
    }

    state.imageUrl = imageUrl;
    if (imageUrl) await showImage(imageUrl);
    else drawStage();
    renderAll();
    void refreshQuota();
  })();

  return closed;
}
