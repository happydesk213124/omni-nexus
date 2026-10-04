import type { CharacterRecord } from '../core/types';
import { CHARACTER_CREATE_TEXT_LIMIT } from '../domain/character/create';

interface Target { session_id: string; character_id: string }
interface Result { ok?: boolean; added?: number; names?: string[]; characters?: CharacterRecord[]; message?: string; error?: { message?: string } }
interface Actions {
  characterTarget: () => Target;
  request: (path: string, body: Record<string, unknown>, timeout?: number) => Promise<Result>;
}
interface CharacterBridge {
  __OMNI_FLUSH_CHARACTERS__?: () => Promise<void>;
  __OMNI_REPLACE_CHARACTER_CACHE__?: (target: string, rows: CharacterRecord[]) => void;
  __OMNI_REFRESH_CHARACTER_SCOPE__?: (target: string) => Promise<void>;
}

const example = '주호 검은머리 짧은 언더컷 25살 검은 눈\n\n민지 파란머리 파란눈을 가진 여성 긴생머리 회색 후드 청바지';

export const CHARACTER_CREATE_HELP = `이름과 원하는 외형을 편하게 적어 주세요. 성별·나이, 머리 색과 스타일, 눈 색, 상의·하의·소지품을 구체적으로 쓰면 좋습니다.

입력하지 않은 외형·나이·복장 정보는 참고자료를 먼저 확인하고, 자료가 없으면 LLM이 어울리게 채웁니다. 직접 적은 설정은 그대로 반영합니다.

여러 명은 줄바꿈이나 빈 줄로 구분해 주세요. 한 번에 모두 추가하며, 이름과 한국어·영어 별칭도 자동으로 작성합니다.

예시
${example}

참고할 로어북의 트리거 단어도 함께 적을 수 있습니다. 현재 캐릭터 목록을 참고하므로 이미 있는 사람은 중복 추가하지 않습니다.`;

const secondary = 'border:1px solid var(--border,rgba(148,151,169,.3));background:var(--surface-2,#161d2b);color:var(--text,#f4f7fb);border-radius:12px;padding:10px 14px;cursor:pointer;font:inherit;font-size:12px';

export function bindCharacterCreate(): void {
  const button = document.getElementById('nx-char-create-llm');
  if (!button || button.dataset.nxBound) return;
  button.dataset.nxBound = '1';
  button.addEventListener('click', () => {
    const actions = Reflect.get(globalThis, '__OMNI_SETTINGS_ACTIONS__') as Actions | undefined;
    if (!actions?.characterTarget || !actions.request || document.getElementById('nx-char-create-modal')) return;
    const target = { ...actions.characterTarget() };
    const kind = document.getElementById('nx-char-scope-bar')?.dataset.uxSelectedScope === 'global' ? 'global' : 'session';
    const scope = kind === 'global' ? '__global__' : target.session_id;
    openCharacterCreate(actions, target, scope);
  });
}

function openCharacterCreate(actions: Actions, target: Target, scope: string): void {
  const bridge = globalThis as typeof globalThis & CharacterBridge;
  const previousFocus = document.activeElement as HTMLElement | null;
  const veil = document.createElement('div');
  veil.id = 'nx-char-create-modal';
  veil.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(16,17,20,.45);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box';
  // The popup lives outside the settings shell, where its theme variables stop inheriting.
  const theme = getComputedStyle(document.getElementById('nx-shell') || document.documentElement);
  for (const key of ['--surface', '--surface-2', '--text', '--muted', '--border', '--accent-soft', '--font']) {
    const value = theme.getPropertyValue(key).trim();
    if (value) veil.style.setProperty(key, value);
  }
  veil.style.colorScheme = theme.colorScheme;
  veil.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="nx-char-create-title" style="width:min(600px,100%);max-height:90vh;overflow:auto;box-sizing:border-box;background:var(--surface,#101622);color:var(--text,#f4f7fb);border:1px solid var(--border,rgba(148,151,169,.3));border-radius:16px;padding:20px;font:14px/1.5 var(--font,IBM Plex Sans,Helvetica Neue,Arial,Noto Sans KR,sans-serif);box-shadow:0 12px 40px rgba(0,0,0,.35)">
    <header style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h3 id="nx-char-create-title" style="margin:0;flex:1;font-size:18px">LLM한테 시키기</h3>
      <button type="button" data-create-help aria-label="작성 도움말" aria-expanded="false" aria-controls="nx-char-create-help" style="${secondary};width:40px;height:40px;padding:0;font-weight:700">?</button>
      <button type="button" data-create-close style="${secondary}">닫기</button></header>
    <p style="margin:12px 0;color:var(--muted,#9497a9)">${scope === '__global__' ? '전역 캐릭터' : '현재 선택한 캐릭터 목록'}에 추가합니다.</p>
    <div id="nx-char-create-help" hidden style="white-space:pre-wrap;padding:14px;margin:0 0 14px;background:var(--accent-soft,rgba(133,91,251,.16));border-radius:12px"></div>
    <label for="nx-char-create-description" style="display:block;margin:0 0 6px;font-weight:600">추가할 캐릭터 설명</label>
    <p id="nx-char-create-hint" style="margin:0 0 10px;color:var(--muted,#9497a9);font-size:12px">입력하지 않은 외형·나이·복장 정보는 LLM이 알아서 채웁니다.</p>
    <textarea id="nx-char-create-description" aria-describedby="nx-char-create-hint" rows="8" maxlength="${CHARACTER_CREATE_TEXT_LIMIT}" style="display:block;width:100%;box-sizing:border-box;min-height:180px;max-height:50vh;resize:vertical;padding:12px;border:1px solid var(--border,rgba(148,151,169,.3));border-radius:12px;background:var(--surface-2,#161d2b);color:inherit;font:inherit"></textarea>
    <p data-create-status role="status" aria-live="polite" style="white-space:pre-wrap;overflow-wrap:anywhere;min-height:21px;margin:12px 0;color:var(--muted,#9497a9)"></p>
    <footer style="display:flex;justify-content:flex-end;gap:8px"><button type="button" data-create-run style="${secondary};border-color:#7132f5;background:#7132f5;color:#fff">LLM 호출</button></footer>
  </div>`;
  const input = veil.querySelector<HTMLTextAreaElement>('textarea')!;
  input.placeholder = example;
  const submit = veil.querySelector<HTMLButtonElement>('[data-create-run]')!;
  const close = veil.querySelector<HTMLButtonElement>('[data-create-close]')!;
  const help = veil.querySelector<HTMLButtonElement>('[data-create-help]')!;
  const helpBody = veil.querySelector<HTMLElement>('#nx-char-create-help')!;
  const status = veil.querySelector<HTMLElement>('[data-create-status]')!;
  helpBody.textContent = CHARACTER_CREATE_HELP;
  let busy = false;
  const dismiss = () => { if (!busy) { veil.remove(); if (previousFocus?.isConnected) previousFocus.focus(); } };
  help.addEventListener('click', () => { helpBody.hidden = !helpBody.hidden; help.setAttribute('aria-expanded', String(!helpBody.hidden)); });
  close.addEventListener('click', dismiss);
  veil.addEventListener('click', event => { if (event.target === veil) dismiss(); });
  veil.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if (event.key === 'Tab') {
      const fields = [...veil.querySelectorAll<HTMLElement>('button:not(:disabled),textarea')];
      const first = fields[0], last = fields.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  submit.addEventListener('click', () => {
    const instruction = input.value.trim();
    if (busy) return;
    if (!instruction) { status.textContent = '추가할 캐릭터의 이름과 외형을 적어 주세요.'; input.focus(); return; }
    if (!scope) { status.textContent = '캐릭터를 추가할 대상을 선택해 주세요.'; return; }
    busy = true; submit.disabled = close.disabled = true; input.readOnly = true;
    submit.textContent = '작성 중…'; status.textContent = '캐릭터 작성 중…'; status.style.color = 'var(--muted,#9497a9)';
    void (async () => {
      try {
        await bridge.__OMNI_FLUSH_CHARACTERS__?.();
        const result = await actions.request('/v1/characters/create-from-description', { ...target, scope, instruction }, 300_000);
        if (result.ok !== true) throw new Error(result.error?.message || '캐릭터를 추가하지 못했습니다.');
        bridge.__OMNI_REPLACE_CHARACTER_CACHE__?.(scope, result.characters || []);
        status.textContent = [result.message || `${result.added || 0}명 추가됨`, ...(result.names || [])].join('\n');
        status.style.color = '#68d9a0';
        await bridge.__OMNI_REFRESH_CHARACTER_SCOPE__?.(scope);
      } catch (error) {
        status.textContent = String((error as Error).message || error); status.style.color = '#e8a2a2';
      } finally {
        busy = false; submit.disabled = close.disabled = false; input.readOnly = false; submit.textContent = 'LLM 호출';
      }
    })();
  });
  document.body.append(veil);
  input.focus();
}
