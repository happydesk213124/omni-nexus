import { upsertCharacter } from '../services/characters';
import type { CharacterRecord, CommandPreset } from '../core/types';
import { cleanText } from '../core/util/text';
import { formatCommandDeltaLog } from '../domain/character/command-edit';
import { commandRewriteCharacter } from '../services/char-command';
import { applyCharacterToForm, characterIdFromForm, readCharacterFromForm, type FormPrefix } from './form';
import { closeImagePeek, openImagePeek } from './peek';
import { GEN_SPIN_CSS, optionBarHtml } from './ui-bits';

type NativeFetch = (path: string, init?: Record<string, unknown>, timeout?: number) => Promise<Record<string, unknown>>;

export interface OpenCharacterCommandOpts {
  formRoot: Element;
  prefix?: FormPrefix;
  sessionId?: string;
  seed?: Partial<CharacterRecord>;
}

let activeClose: ((keep?: boolean) => void) | null = null;

export function closeCharacterCommandEdit(): void {
  if (activeClose) activeClose();
}

function nativeFetch(): NativeFetch {
  const n = (globalThis as { __INLAY_NATIVE__?: { fetch?: NativeFetch } }).__INLAY_NATIVE__;
  if (!n?.fetch) throw new Error('Inlay Nexus backend unavailable');
  return n.fetch.bind(n);
}

function toast(root: HTMLElement, text: string, ok = true): void {
  const el = root.querySelector('[data-cc-toast]') as HTMLElement | null;
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? '#86efac' : '#fecaca';
}

function btn(label: string, extra = ''): string {
  return `<button type="button" ${extra} style="cursor:pointer;border:0;background:rgba(255,255,255,.08);color:#e8eef8;padding:6px 10px;border-radius:8px;font:650 12px Segoe UI,sans-serif">${label}</button>`;
}

function asPresets(raw: unknown): CommandPreset[] {
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as { items?: unknown } : null;
  const arr = Array.isArray(raw) ? raw : Array.isArray(rec?.items) ? rec!.items : [];
  return arr.filter((row): row is CommandPreset => !!row && typeof row === 'object' && !!(row as CommandPreset).id);
}

export function openCharacterCommandEdit(opts: OpenCharacterCommandOpts): void {
  const formRoot = opts.formRoot;
  const prefix: FormPrefix = opts.prefix || (formRoot.querySelector('[data-ce-appearance]') ? 'ce' : 'char');
  closeCharacterCommandEdit();
  closeImagePeek();

  const veil = document.createElement('div');
  veil.setAttribute('data-cc-root', '1');
  veil.style.cssText = 'position:fixed;inset:0;z-index:160000;background:rgba(4,8,16,.45);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box';
  veil.innerHTML = `
    <div data-cc-card style="width:min(560px,100%);max-height:min(92vh,820px);background:linear-gradient(165deg,#1a1f2e,#0c1018);border:1px solid rgba(151,139,255,.4);border-radius:16px;box-shadow:0 28px 80px rgba(0,0,0,.55);display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0">
        <div style="font-weight:700;font-size:14px;flex:1">명령수정</div>
        <button type="button" data-cc-x style="cursor:pointer;border:0;background:rgba(255,255,255,.08);color:#e2e8f0;padding:6px 10px;border-radius:8px">✕</button>
      </div>
      <div style="padding:12px 14px;display:grid;gap:10px;overflow:auto;flex:1;min-height:0">
        <label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px;font-weight:650">수정 로그
          <pre data-cc-log style="margin:0;min-height:88px;max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-word;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#070b12;color:#c8d4e6;padding:8px 10px;font:12px/1.45 ui-monospace,Consolas,monospace">LLM 호출 후 추가(+)/삭제(−)가 여기 표시됩니다.</pre>
        </label>
        ${optionBarHtml({ name: 'cc-preset-name', select: 'cc-preset', save: 'cc-preset-save', del: 'cc-preset-del', namePlaceholder: '명령 프리셋 이름' })}
        <label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px;font-weight:650">명령어
          <textarea data-cc-cmd rows="5" placeholder="예: 옷만 교복으로 바꾸고 구도는 그대로." style="width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:8px 10px;font:13px/1.45 Segoe UI,sans-serif;resize:vertical;min-height:110px"></textarea>
        </label>
        <label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px;font-weight:650">후행 명령어
          <textarea data-cc-trail rows="3" placeholder="추가로 지킬 것." style="width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:8px 10px;font:13px/1.45 Segoe UI,sans-serif;resize:vertical;min-height:72px"></textarea>
        </label>
        <div data-cc-busy style="display:none;align-items:center;gap:8px;color:#c4b5fd;font:650 12px Segoe UI,sans-serif">
          <span data-cc-spin style="width:14px;height:14px;border:2px solid rgba(196,181,253,.3);border-top-color:#c4b5fd;border-radius:50%;display:inline-block;animation:nx-cc-spin .7s linear infinite"></span>
          수정중…
        </div>
        <div data-cc-toast style="min-height:16px;font-size:12px"></div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 14px;border-top:1px solid rgba(255,255,255,.08)">
        ${btn('LLM 호출', 'data-cc-llm style="cursor:pointer;border:0;background:rgba(124,108,255,.28);color:#e8eef8;padding:8px 14px;border-radius:10px;font:700 13px Segoe UI,sans-serif"')}
        ${btn('저장', 'data-cc-save style="cursor:pointer;border:0;background:rgba(34,197,94,.28);color:#e8eef8;padding:8px 16px;border-radius:10px;font:700 13px Segoe UI,sans-serif"')}
        ${btn('취소', 'data-cc-cancel')}
      </div>
    </div>
    <style>@keyframes nx-cc-spin{to{transform:rotate(360deg)}}${GEN_SPIN_CSS}</style>
  `;

  const presetSel = veil.querySelector('[data-cc-preset]') as HTMLSelectElement;
  const nameEl = veil.querySelector('[data-cc-preset-name]') as HTMLInputElement;
  const trailEl = veil.querySelector('[data-cc-trail]') as HTMLTextAreaElement;
  const cmdEl = veil.querySelector('[data-cc-cmd]') as HTMLTextAreaElement;
  const logEl = veil.querySelector('[data-cc-log]') as HTMLElement;
  const busyEl = veil.querySelector('[data-cc-busy]') as HTMLElement;

  let presets: CommandPreset[] = [];
  let abort: AbortController | null = null;
  let lastResult: Partial<CharacterRecord> | null = null;
  let closed = false;
  const snapshot = JSON.parse(JSON.stringify(readCharacterFromForm(formRoot, prefix, opts.seed || {}))) as Partial<CharacterRecord>;

  const ownerScope=formRoot.getAttribute('data-char-ref-scope') || opts.sessionId || '';
  const ownerId=characterIdFromForm(formRoot,snapshot);
  const close = (keep?: boolean) => {
    if (closed) return;
    closed = true;
    abort?.abort();
    abort = null;
    const target=formRoot.isConnected ? formRoot : [...document.querySelectorAll<HTMLElement>('.char-card[data-char-id]')]
      .find(card=>card.dataset.charId===ownerId && card.dataset.charRefScope===ownerScope);
    if(target){
      applyCharacterToForm(target, prefix, keep && lastResult ? lastResult : snapshot);
      if (keep) target.dispatchEvent(new Event('input', {bubbles:true}));
    } else if(keep && lastResult && ownerScope && ownerId) {
      const result={...snapshot,...lastResult,id:ownerId};
      const bridge=globalThis as typeof globalThis & {
        __OMNI_PATCH_CHARACTER__?:(scope:string,id:string,patch:Partial<CharacterRecord>)=>void;
        __OMNI_FLUSH_CHARACTERS__?:()=>Promise<void>;
      };
      bridge.__OMNI_PATCH_CHARACTER__?.(ownerScope,ownerId,result);
      void (async()=>{await bridge.__OMNI_FLUSH_CHARACTERS__?.();await upsertCharacter(ownerScope,result);})()
        .catch(error=>window.alert('명령수정 저장 실패: '+String(error)));
    }
    veil.remove();
    if (activeClose === close) activeClose = null;
    closeImagePeek();
  };
  activeClose = close;

  const paintPresets = () => {
    const cur = presetSel.value;
    presetSel.innerHTML = `<option value="">(직접 입력)</option>`
      + presets.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
    if (cur && presets.some((p) => p.id === cur)) presetSel.value = cur;
  };

  const applyPreset = (id: string) => {
    const hit = presets.find((p) => p.id === id);
    if (!hit) return;
    nameEl.value = hit.name;
    cmdEl.value = hit.cmd || '';
    trailEl.value = hit.cmd_post || '';
  };

  const loadPresets = async () => {
    try {
      const res = await nativeFetch()('/v1/character-command-presets', { method: 'GET' });
      presets = asPresets(res?.items ?? res);
      paintPresets();
    } catch {
      presets = [];
      paintPresets();
    }
  };

  const currentInstruction = (): string => {
    const cmd = cleanText(cmdEl.value, 4000);
    const trail = cleanText(trailEl.value, 2000);
    return [cmd, trail].filter(Boolean).join('\n');
  };

  const setBusy = (on: boolean) => {
    busyEl.style.display = on ? 'flex' : 'none';
  };

  const runRewrite = async () => {
    abort?.abort();
    const request = new AbortController();
    abort = request;
    setBusy(true);
    toast(veil, '');
    try {
      const character = lastResult || snapshot;
      const id = characterIdFromForm(formRoot, character);
      const res = await commandRewriteCharacter(id, {
        instruction: currentInstruction(),
        character,
        signal: request.signal,
      }) as Record<string, unknown>;
      if(closed || request!==abort || request.signal.aborted)return;
      if (!res?.ok) {
        const err = res.error && typeof res.error === 'object' ? res.error as { message?: string } : null;
        toast(veil, String(err?.message || '실패'), false);
        return;
      }
      if (closed || request!==abort || request.signal.aborted) return;
      lastResult = res.character as CharacterRecord;
      // Preview lives in this dialog until Save; cancelled requests never enter autosave.
      const log = formatCommandDeltaLog(res.deltas);
      logEl.textContent = log || '변경된 태그 없음';
      toast(veil, '태그 수정됨 · 저장하면 유지됩니다');
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      toast(veil, String((err as Error)?.message || err), false);
    } finally {
      if(request===abort)setBusy(false);
    }
  };

  veil.addEventListener('click', (ev) => {
    if (ev.target === veil) close(false);
  });
  veil.querySelector('[data-cc-x]')?.addEventListener('click', () => close(false));
  veil.querySelector('[data-cc-cancel]')?.addEventListener('click', () => close(false));
  veil.querySelector('[data-cc-llm]')?.addEventListener('click', () => void runRewrite());
  veil.querySelector('[data-cc-save]')?.addEventListener('click', () => {
    if (!lastResult) {
      toast(veil, '먼저 LLM 호출로 태그를 수정하세요', false);
      return;
    }
    close(true);
  });
  cmdEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      void runRewrite();
    }
  });

  presetSel.addEventListener('change', () => {
    if (presetSel.value) applyPreset(presetSel.value);
  });
  veil.querySelector('[data-cc-preset-save]')?.addEventListener('click', async () => {
    const name = cleanText(nameEl.value, 80);
    if (!name) {
      toast(veil, '프리셋 이름을 입력하세요', false);
      return;
    }
    const id = presets.find((p) => p.id === presetSel.value)?.id || `p_${Date.now().toString(36)}`;
    const next = presets.filter((p) => p.id !== id);
    next.push({
      id,
      name,
      cmd: cleanText(cmdEl.value, 4000),
      cmd_post: cleanText(trailEl.value, 2000),
    });
    try {
      const res = await nativeFetch()('/v1/character-command-presets', { method: 'PUT', body: { items: next } });
      presets = asPresets(res?.items ?? next);
      paintPresets();
      presetSel.value = id;
      toast(veil, '프리셋 저장됨');
    } catch (err) {
      toast(veil, String((err as Error)?.message || err), false);
    }
  });
  veil.querySelector('[data-cc-preset-del]')?.addEventListener('click', async () => {
    const id = presetSel.value;
    if (!id) return;
    const next = presets.filter((p) => p.id !== id);
    try {
      const res = await nativeFetch()('/v1/character-command-presets', { method: 'PUT', body: { items: next } });
      presets = asPresets(res?.items ?? next);
      paintPresets();
      nameEl.value = '';
      cmdEl.value = '';
      trailEl.value = '';
      toast(veil, '프리셋 삭제됨');
    } catch (err) {
      toast(veil, String((err as Error)?.message || err), false);
    }
  });

  document.body.appendChild(veil);
  void loadPresets();
}

export { openImagePeek, closeImagePeek };
export { bindCharacterHeaderRef, paintHeaderRefSlot } from './header-ref';
export { bindCharacterExampleShot, paintExampleSlot } from './example-shot';
export { readCharacterFromForm } from './form';
export { setGenSpin } from './ui-bits';
