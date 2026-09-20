import { bindModels } from './model-bindings';
/**
 * Preview HTML is the settings window. Vendor values/handlers bind by #nx-* id.
 */

import { bindCharacterSheet, openCharacterEditor } from './character-bindings';
import { installSearchClear } from './search-clear';
import { bindPresetSheet } from './preset-bindings';
import { fillRisuTiles } from './risu-bindings';
import { replaceMain } from './character-render';
import { speakText } from '../services/tts';
import { settingsUxCss } from './styles';
import { previewChrome, tabHtml, previewHelp } from './tab-html';

let explorerOpen = false;
let explorerCharacter = '';
let risuPickOpen = false;
let debugPanel = 'quota';
const STYLE_ID = 'nx-settings-ux-css';
const TAB_LABELS: Record<string, string> = {
  dashboard: '대시보드',
  gen_options: '생성 옵션',
  comic_gen: '만화 생성',
  style_presets: '스타일 프리셋',
  card: '스타일 프리셋',
  characters: '캐릭터',
  models: '모델 설정',
  explorer: '이미지 탐색',
  curation: 'TTS',
  prompts: '프롬프트',
  changelog: '업데이트 내역',
  debug: '디버그',
};

function ensureCss(): void {
  document.documentElement.dataset.theme = 'dark';
  // The frozen stylesheet is only for its legacy settings markup.
  document.querySelectorAll('body > style').forEach(style => {
    if (style.id !== STYLE_ID && style.textContent?.includes('.toggle-row') && style.textContent.includes('.wrap')) style.remove();
  });
  const existing = document.getElementById(STYLE_ID);
  if (existing) { document.body.appendChild(existing); return; }
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = settingsUxCss;
  document.body.appendChild(el);
}

function activeTab(): string {
  return document.querySelector('#nx-tabs [data-nx-tab].active')?.getAttribute('data-nx-tab')
    || document.querySelector('#nx-tabs [data-nx-tab][aria-current="page"]')?.getAttribute('data-nx-tab')
    || '';
}

function markLive(text = '저장됨'): void {
  const live = document.querySelector('#nx-shell .nx-live') as HTMLElement | null;
  if (!live) return;
  live.textContent = text;
  if (text.includes('실패')) return;
  window.setTimeout(() => {
    if (live.isConnected) live.textContent = '바로 저장됨';
  }, 900);
}

function bindLiveFlash(): void {
  const flash = document.getElementById('nx-save-flash');
  if (!flash || flash.dataset.nxUxLive === '1') return;
  flash.dataset.nxUxLive = '1';
  new MutationObserver(() => {
    syncModelWarning();
    const text = (flash.textContent || '').trim();
    if (text) markLive(text.includes('실패') ? text : '저장됨');
  }).observe(flash, { childList: true, characterData: true, subtree: true });
}

function syncModelWarning(): void {
  const actions = Reflect.get(globalThis, '__OMNI_SETTINGS_ACTIONS__') as {config?: () => {nai?: Record<string, unknown>}} | undefined;
  const nai = actions?.config?.().nai || {};
  const ready = Boolean(nai.api_keys_v4_configured || nai.api_keys_v5_configured || nai.api_key_configured || String(nai.comfy_workflow_json || '').trim());
  const dot = document.querySelector<HTMLElement>('#nx-tabs [data-nx-tab="models"] .alarm');
  if (dot) { dot.hidden = ready; dot.style.display = ready ? 'none' : ''; dot.title = 'NAI 키 또는 ComfyUI workflow를 설정하세요'; }
}

function fillTtsVoices(select: HTMLSelectElement, current: string): void {
  const voices = globalThis.speechSynthesis?.getVoices?.() || [];
  const keep = select.value || current;
  select.innerHTML = '<option value="">기본</option>';
  for (const v of voices) {
    const opt = document.createElement('option');
    opt.value = v.voiceURI || v.name;
    opt.textContent = `${v.name}${v.lang ? ` (${v.lang})` : ''}`;
    if (opt.value === keep) opt.selected = true;
    select.appendChild(opt);
  }
}

function mountTts(): void {
  const sel = document.querySelector('#nx-tts-voice') as HTMLSelectElement | null;
  if (sel && !sel.dataset.nxUxVoices) {
    sel.dataset.nxUxVoices = '1';
    fillTtsVoices(sel, sel.value);
    globalThis.speechSynthesis?.addEventListener?.('voiceschanged', () => fillTtsVoices(sel, sel.value));
  }
  const test = document.querySelector('#nx-tts-test') as HTMLButtonElement | null;
  if (test && !test.dataset.nxUxTest) {
    test.dataset.nxUxTest = '1';
    test.addEventListener('click', (ev) => {
      ev.preventDefault();
      speakText('안녕하세요. 옴니 넥서스 읽기 시험입니다.');
    });
  }
}

function bindSheet(openId: string, sheetId: string, bgId: string, closeId: string, openLabel: string, closeLabel: string): void {
  const openBtn = document.getElementById(openId);
  const sheet = document.getElementById(sheetId);
  const bg = document.getElementById(bgId);
  const closeBtn = document.getElementById(closeId);
  if (!openBtn || !sheet || !bg || !closeBtn || openBtn.dataset.nxUxSheet === '1') return;
  openBtn.dataset.nxUxSheet = '1';
  const setOpen = (on: boolean) => {
    sheet.classList.toggle('open', on);
    bg.classList.toggle('on', on);
    sheet.setAttribute('aria-hidden', on ? 'false' : 'true');
    openBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    openBtn.textContent = on ? closeLabel : openLabel;
  };
  openBtn.addEventListener('click', () => setOpen(!sheet.classList.contains('open')));
  closeBtn.addEventListener('click', () => setOpen(false));
  bg.addEventListener('click', () => setOpen(false));
}

function bindRisuPick(): void {
  const railBtn = document.getElementById('nx-char-risu-open');
  const pick = document.getElementById('nx-risu-pick');
  const bg = document.getElementById('nx-risu-pick-bg');
  const close = document.getElementById('nx-risu-pick-close');
  if (!railBtn || !pick || !bg || railBtn.dataset.nxUxRisu === '1') return;
  railBtn.dataset.nxUxRisu = '1';
  const setOpen = (on: boolean) => {
    risuPickOpen = on;
    pick.classList.toggle('open', on);
    bg.classList.toggle('on', on);
    pick.setAttribute('aria-hidden', on ? 'false' : 'true');
    railBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    railBtn.textContent = on ? '›' : '‹';
    if (on) void fillRisuTiles(document.getElementById('nx-risu-pick-tiles'));
  };
  railBtn.addEventListener('click', () => setOpen(!pick.classList.contains('open')));
  close?.addEventListener('click', () => setOpen(false));
  bg.addEventListener('click', () => setOpen(false));
  // P() rebuilds the panel on every scope switch: restore the open rail so
  // selecting another tile does not collapse it.
  if (risuPickOpen) setOpen(true);
}

function bindExplorerPick(): void {
  const railBtn = document.getElementById('nx-ex-open');
  const pick = document.getElementById('nx-ex-pick');
  const bg = document.getElementById('nx-ex-pick-bg');
  if (!railBtn || !pick || !bg || railBtn.dataset.nxUxEx === '1') return;
  railBtn.dataset.nxUxEx = '1';
  const tiles = document.getElementById('nx-ex-pick-tiles');
  const chats = document.getElementById('nx-ex-chats');
  const folders = [...document.querySelectorAll<HTMLButtonElement>('[data-explorer-folder]')];
  const byChar = new Map<string, HTMLButtonElement[]>();
  for (const f of folders) {
    const key = f.getAttribute('data-explorer-folder') || '';
    const group = f.closest('[data-explorer-char]');
    const name = (group?.querySelector('.explorer-char-head span')?.textContent || f.querySelector('strong')?.textContent || key).trim();
    if (key === '__all__') continue;
    const list = byChar.get(name) || [];
    list.push(f);
    byChar.set(name, list);
  }
  const addTile = (label: string, on: boolean, click: () => void) => {
    if (!tiles) return;
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'nx-ex-tile' + (on ? ' on' : '');
    t.textContent = label;
    t.addEventListener('click', () => {
      tiles.querySelectorAll('.nx-ex-tile').forEach((el) => el.classList.toggle('on', el === t));
      click();
    });
    tiles.appendChild(t);
  };
  const fillChats = (btns: HTMLButtonElement[] | null) => {
    if (!chats) return;
    chats.innerHTML = '';
    if (!btns) {
      chats.textContent = '모든 이미지';
      return;
    }
    for (const b of btns) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'chat-pick';
      row.textContent = (b.querySelector('strong')?.textContent || b.textContent || '').trim();
      row.addEventListener('click', () => b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })));
      chats.appendChild(row);
    }
  };
  const allBtn = folders.find((f) => f.getAttribute('data-explorer-folder') === '__all__');
  addTile('모든 이미지 보기', true, () => {
    explorerCharacter = '';
    allBtn?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    fillChats(null);
  });
  for (const [name, btns] of byChar) {
    addTile(name, name === explorerCharacter, () => {
      explorerCharacter = name;
      fillChats(btns);
    });
  }
  fillChats(byChar.get(explorerCharacter) || null);
  document.getElementById('nx-ex-view-all')?.setAttribute('hidden', '');
  document.getElementById('nx-ex-all-hint')?.setAttribute('hidden', '');
  const setOpen = (on: boolean) => {
    explorerOpen = on;
    pick.classList.toggle('open', on);
    bg.classList.toggle('on', on);
    pick.setAttribute('aria-hidden', on ? 'false' : 'true');
    railBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    railBtn.textContent = on ? '›' : '‹';
  };
  railBtn.addEventListener('click', () => setOpen(!pick.classList.contains('open')));
  setOpen(explorerOpen);
  document.getElementById('nx-ex-pick-close')?.addEventListener('click', () => setOpen(false));
  bg.addEventListener('click', () => setOpen(false));
  const handle = document.getElementById('nx-ex-resize');
  const body = pick.querySelector('.ex-pick-body') as HTMLElement | null;
  if (handle && body && tiles) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const box = body.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const y = ev.clientY - box.top;
        const top = Math.max(88, Math.min(box.height - 104, y));
        (tiles as HTMLElement).style.flex = `0 0 ${top}px`;
      };
      const up = () => {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }
}

function bindDebugBar(): void {
  const bar = document.getElementById('nx-debug-bar');
  if (!bar || bar.dataset.nxUxDebug === '1') return;
  bar.dataset.nxUxDebug = '1';
  bar.querySelectorAll<HTMLElement>('[data-debug-panel]').forEach(el => el.classList.toggle('on', el.dataset.debugPanel === debugPanel));
  document.querySelectorAll<HTMLElement>('[data-debug-pane]').forEach(el => { el.hidden = el.dataset.debugPane !== debugPanel; });
  bar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-debug-panel]');
    if (!btn) return;
    const name = btn.getAttribute('data-debug-panel');
    debugPanel = name || 'quota';
    bar.querySelectorAll('[data-debug-panel]').forEach((el) => el.classList.toggle('on', el === btn));
    document.querySelectorAll('[data-debug-pane]').forEach((el) => {
      (el as HTMLElement).hidden = el.getAttribute('data-debug-pane') !== name;
    });
    document.querySelector<HTMLElement>(`[data-nx-debug-panel="${name}"]`)?.click();
  });
}

function bindMenu(): void {
  const menu = document.getElementById('menuBtn');
  if (!menu || menu.dataset.nxUxMenu === '1') return;
  menu.dataset.nxUxMenu = '1';
  menu.addEventListener('click', () => document.documentElement.classList.toggle('nx-nav-open'));
  document.getElementById('nx-tabs')?.addEventListener('click', event => {
    if ((event.target as Element).closest('[data-nx-tab]')) document.documentElement.classList.remove('nx-nav-open');
  });
  document.getElementById('drawerBg')?.addEventListener('click', () => document.documentElement.classList.remove('nx-nav-open'));
}

export function replaceShell(): void {
  const shell = document.getElementById('nx-shell');
  const chrome = previewChrome();
  if (!shell || !chrome || shell.dataset.nxUxApp === '1') return;
  // Keep mounted nodes: serializing would retain bound flags but discard listeners.
  const contents = document.createDocumentFragment();
  const oldMain = document.getElementById('nx-main');
  if (oldMain) contents.append(...oldMain.childNodes);
  const tab = document.querySelector('#nx-tabs [data-nx-tab].active')?.getAttribute('data-nx-tab') || 'dashboard';
  document.documentElement.classList.add('nx-ux-on');
  ensureCss();
  shell.className = 'wrap nx-ux nx-ux-app';
  shell.dataset.nxUxApp = '1';
  // Explorer overlays live outside the replaceable settings shell.
  for (const id of ['nx-explorer-lightbox', 'nx-explorer-ctx', 'nx-explorer-tip']) {
    const overlay = shell.querySelector('#' + id);
    if (overlay) document.body.appendChild(overlay);
  }
  shell.innerHTML = chrome;
  if (!document.getElementById('drawerBg')) {
    const bg = document.createElement('div');
    bg.id = 'drawerBg';
    bg.className = 'drawer-bg';
    shell.prepend(bg);
  }
  const main = document.getElementById('nx-main');
  if (main) {
    main.replaceChildren(contents);
    main.setAttribute('data-nx-ux-tab', tab);
  }
  document.querySelectorAll('#nx-tabs [data-nx-tab]').forEach((btn) => {
    const on = btn.getAttribute('data-nx-tab') === tab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-current', on ? 'page' : 'false');
  });
}

export function afterPaint(): void {
  installSearchClear();
  const shell = document.getElementById('nx-shell');
  if (!shell) return;
  document.documentElement.classList.add('nx-ux-on');
  shell.classList.add('nx-ux');
  ensureCss();
  if (shell.dataset.nxUxApp !== '1') replaceShell();
  bindMenu();
  bindLiveFlash();
  syncModelWarning();
  const tab = activeTab();
  const line = document.getElementById('nx-version-line');
  if (line) line.textContent = TAB_LABELS[tab] || '설정';
  const main = document.getElementById('nx-main');
  if (main) main.setAttribute('data-nx-ux-tab', tab);
  document.querySelectorAll('#nx-tabs [data-nx-tab]').forEach((btn) => {
    const on = btn.getAttribute('data-nx-tab') === tab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-current', on ? 'page' : 'false');
  });
  const help = document.getElementById('nx-help-toggle');
  if (help && !help.dataset.nxUxHelp) {
    help.dataset.nxUxHelp = '1';
    help.addEventListener('click', () => {
      const on = !document.documentElement.classList.contains('help-on');
      document.documentElement.classList.toggle('help-on', on);
      document.body.classList.toggle('help-on', on);
      document.getElementById('nx-head-help')?.classList.remove('is-collapsed');
      help.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  if (tab === 'models') {
    bindModels();
    const family = document.querySelector<HTMLInputElement>('#nx-nai-model')?.value.includes('nai-diffusion-5') ? 'v5' : 'v4';
    document.querySelectorAll<HTMLElement>('[data-nx-nai-pane]').forEach(el => {
      el.style.display = el.dataset.nxNaiPane === family ? '' : 'none';
    });
    document.querySelectorAll<HTMLElement>('[data-nai-family]').forEach(button => {
      button.classList.toggle('on', button.dataset.naiFamily === family);
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-nai-family]').forEach(el => el.classList.toggle('on', el === button));
        // Vendor family selection updates hidden values but does not emit input.
        document.getElementById('nx-nai-model')?.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  }
  if (tab === 'curation') mountTts();
  if (tab === 'style_presets' || tab === 'card') {
    bindPresetSheet();
    bindSheet('nx-preset-edit-btn', 'nx-preset-sheet', 'nx-preset-sheet-bg', 'nx-preset-sheet-close', '▲ 프리셋 수정', '▼ 프리셋 수정');
  }
  if (tab === 'characters') {
    bindCharacterSheet();
    bindSheet('nx-char-edit-btn', 'nx-char-sheet', 'nx-char-sheet-bg', 'nx-char-sheet-close', '▲ 캐릭터 수정', '▼ 캐릭터 수정');
    bindRisuPick();
    // Navigation nodes can outlive the form; refresh only their selection marks.
    if (risuPickOpen) void fillRisuTiles(document.getElementById('nx-risu-pick-tiles'));
  }
  if (tab === 'explorer') bindExplorerPick();
  if (tab === 'debug') bindDebugBar();
}

export function installSettingsUx(): void {
  installSearchClear();
  Reflect.set(globalThis, '__INLAY_SETTINGS_UX__', { afterPaint, tabHtml, replaceShell, replaceMain, openCharacterEditor, previewHelp });
}
