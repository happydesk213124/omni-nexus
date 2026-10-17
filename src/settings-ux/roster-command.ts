import type { CharacterRecord } from '../core/types';
import { ROSTER_COMMAND_LIMIT } from '../domain/character/roster-command';

/**
 * 「LLM한테 시키기」: one instruction over the character list (or the picked ones).
 * The model's plan is shown first (who is edited, deleted, added) and nothing is
 * saved until 적용 is pressed.
 */
interface Target { session_id: string; character_id: string }
interface PlanEdit { id: string; name: string; log: string; character: Record<string, unknown> }
interface Plan { edits: PlanEdit[]; deletes: Array<{ id: string; name: string }>; adds: Array<{ name: string; description: string }> }
interface Reply { ok?: boolean; plan?: Plan; empty?: boolean; targets?: number; edited?: number; deleted?: number; added?: number; characters?: CharacterRecord[]; error?: { message?: string } }
export interface RosterCommandActions {
  characterTarget: () => Target;
  request: (path: string, body: Record<string, unknown>, timeout?: number) => Promise<Reply>;
}
interface CharacterBridge {
  __OMNI_FLUSH_CHARACTERS__?: () => Promise<void>;
  __OMNI_REPLACE_CHARACTER_CACHE__?: (target: string, rows: CharacterRecord[]) => void;
  __OMNI_REFRESH_CHARACTER_SCOPE__?: (target: string) => Promise<void>;
}

export const ROSTER_COMMAND_HELP = `무엇을 할지 편하게 적어 주세요. 고른 캐릭터가 있으면 그 사람들만, 없으면 지금 목록 전체가 대상입니다.

예시
하린 교복 코스튬 지워 줘
민아는 삭제
지수 추가: 파란 단발, 20살, 흰 셔츠에 청바지
모두 머리 스타일을 더 자세하게

수정은 명령수정과 같은 방식으로 태그를 더하고 뺍니다. 삭제는 대상 안에서만 합니다. 추가하는 사람은 「LLM한테 시키기」로 만들 때처럼 외모를 채웁니다.
먼저 「미리보기」로 바뀌는 내용을 확인하고, 「적용」을 눌러야 저장됩니다.`;

const secondary = 'border:1px solid var(--border,rgba(148,151,169,.3));background:var(--surface-2,#161d2b);color:var(--text,#f4f7fb);border-radius:12px;padding:10px 14px;cursor:pointer;font:inherit;font-size:12px';
const primary = secondary + ';border-color:#7132f5;background:#7132f5;color:#fff';
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export function planListHtml(plan: Plan): string {
  const section = (title: string, rows: string[]) => rows.length
    ? `<div style="margin:10px 0 4px;font-weight:700">${title} · ${rows.length}</div><ul style="margin:0;padding-left:18px;line-height:1.55">${rows.join('')}</ul>` : '';
  return [
    section('수정', plan.edits.map(edit => `<li><b>${esc(edit.name)}</b><div style="white-space:pre-wrap;color:var(--muted,#9497a9);font-size:12px">${esc(edit.log || '(바뀌는 태그 없음)')}</div></li>`)),
    section('삭제', plan.deletes.map(row => `<li><b>${esc(row.name)}</b></li>`)),
    section('추가', plan.adds.map(add => `<li><b>${esc(add.name)}</b>${add.description ? ` <span style="color:var(--muted,#9497a9)">${esc(add.description)}</span>` : ''}</li>`)),
  ].join('') || '<div style="color:var(--muted,#9497a9)">바뀌는 내용이 없습니다.</div>';
}

/** `ids`: the picked characters; empty means the whole list in `scope`. */
export function openRosterCommand(actions: RosterCommandActions, scope: string, ids: string[], names: string[]): void {
  if (document.getElementById('nx-roster-command-modal')) return;
  const bridge = globalThis as typeof globalThis & CharacterBridge;
  const target = { ...actions.characterTarget() };
  const previousFocus = document.activeElement as HTMLElement | null;
  const veil = document.createElement('div');
  veil.id = 'nx-roster-command-modal';
  veil.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(16,17,20,.45);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box';
  const theme = getComputedStyle(document.getElementById('nx-shell') || document.documentElement);
  for (const key of ['--surface', '--surface-2', '--text', '--muted', '--border', '--accent-soft', '--font']) {
    const value = theme.getPropertyValue(key).trim();
    if (value) veil.style.setProperty(key, value);
  }
  const who = ids.length ? `고른 ${ids.length}명: ${names.slice(0, 6).join(', ')}${names.length > 6 ? ' …' : ''}` : `${scope === '__global__' ? '전역 캐릭터' : '지금 캐릭터 목록'} 전체`;
  veil.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="nx-roster-command-title" style="width:min(640px,100%);max-height:90vh;overflow:auto;box-sizing:border-box;background:var(--surface,#101622);color:var(--text,#f4f7fb);border:1px solid var(--border,rgba(148,151,169,.3));border-radius:16px;padding:20px;font:14px/1.5 var(--font,IBM Plex Sans,Helvetica Neue,Arial,Noto Sans KR,sans-serif)">
    <header style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h3 id="nx-roster-command-title" style="margin:0;flex:1;font-size:18px">LLM한테 시키기</h3>
      <button type="button" data-rc-help aria-label="도움말" aria-expanded="false" style="${secondary};width:40px;height:40px;padding:0;font-weight:700">?</button>
      <button type="button" data-rc-close style="${secondary}">닫기</button></header>
    <p style="margin:12px 0;color:var(--muted,#9497a9)">대상: ${esc(who)}</p>
    <div data-rc-help-body hidden style="white-space:pre-wrap;padding:14px;margin:0 0 14px;background:var(--accent-soft,rgba(133,91,251,.16));border-radius:12px"></div>
    <textarea data-rc-text rows="6" maxlength="${ROSTER_COMMAND_LIMIT}" aria-label="명령" placeholder="예: 하린 교복 코스튬 지워 줘 / 민아는 삭제 / 지수 추가: 파란 단발, 20살" style="display:block;width:100%;box-sizing:border-box;min-height:140px;max-height:40vh;resize:vertical;padding:12px;border:1px solid var(--border,rgba(148,151,169,.3));border-radius:12px;background:var(--surface-2,#161d2b);color:inherit;font:inherit"></textarea>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin:10px 0 0;font-size:13px">
      <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" data-rc-xnai> lb-xnai 참조</label>
      <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" data-rc-lore> 로어북 참조</label>
    </div>
    <div data-rc-plan role="status" aria-live="polite" style="margin:12px 0;min-height:21px;overflow-wrap:anywhere"></div>
    <footer style="display:flex;justify-content:flex-end;gap:8px"><button type="button" data-rc-preview style="${secondary}">미리보기</button><button type="button" data-rc-apply disabled style="${primary}">적용</button></footer>
  </div>`;
  const $ = <T extends HTMLElement>(selector: string) => veil.querySelector<T>(selector)!;
  const input = $<HTMLTextAreaElement>('[data-rc-text]'), planBox = $<HTMLElement>('[data-rc-plan]');
  const preview = $<HTMLButtonElement>('[data-rc-preview]'), apply = $<HTMLButtonElement>('[data-rc-apply]'), close = $<HTMLButtonElement>('[data-rc-close]');
  $<HTMLElement>('[data-rc-help-body]').textContent = ROSTER_COMMAND_HELP;
  let busy = false, plan: Plan | null = null;
  const dismiss = () => { if (!busy) { veil.remove(); if (previousFocus?.isConnected) previousFocus.focus(); } };
  const lock = (on: boolean) => { busy = on; preview.disabled = close.disabled = on; input.readOnly = on; apply.disabled = on || !plan; };
  const say = (text: string, color = 'var(--muted,#9497a9)') => { planBox.textContent = text; planBox.style.color = color; };
  $<HTMLButtonElement>('[data-rc-help]').addEventListener('click', event => {
    const body = $<HTMLElement>('[data-rc-help-body]'); body.hidden = !body.hidden;
    (event.currentTarget as HTMLElement).setAttribute('aria-expanded', String(!body.hidden));
  });
  close.addEventListener('click', dismiss);
  veil.addEventListener('click', event => { if (event.target === veil) dismiss(); });
  veil.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if (event.key === 'Tab') {
      const fields = [...veil.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,input')];
      const first = fields[0], last = fields.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  // A changed instruction is a new plan: the shown one no longer applies.
  input.addEventListener('input', () => { if (plan) { plan = null; apply.disabled = true; say('명령이 바뀌었습니다. 다시 미리보기 해 주세요.'); } });
  preview.addEventListener('click', () => {
    const instruction = input.value.trim();
    if (busy) return;
    if (!instruction) { say('할 일을 적어 주세요.'); input.focus(); return; }
    plan = null; lock(true); preview.textContent = '확인 중…'; say('LLM에게 묻는 중…');
    void (async () => {
      try {
        await bridge.__OMNI_FLUSH_CHARACTERS__?.();
        const reply = await actions.request('/v1/characters/command-plan', { ...target, scope, ids, instruction,
          xnai: $<HTMLInputElement>('[data-rc-xnai]').checked, lore: $<HTMLInputElement>('[data-rc-lore]').checked }, 300_000);
        if (reply.ok !== true || !reply.plan) throw new Error(reply.error?.message || '계획을 받지 못했습니다.');
        plan = reply.empty ? null : reply.plan;
        planBox.innerHTML = planListHtml(reply.plan); planBox.style.color = '';
      } catch (error) { say(String((error as Error).message || error), '#e8a2a2'); }
      finally { lock(false); preview.textContent = '미리보기'; }
    })();
  });
  apply.addEventListener('click', () => {
    if (busy || !plan) return;
    lock(true); apply.textContent = '적용 중…';
    void (async () => {
      try {
        await bridge.__OMNI_FLUSH_CHARACTERS__?.();
        const reply = await actions.request('/v1/characters/command-apply', { ...target, scope, plan }, 300_000);
        if (reply.ok !== true) throw new Error(reply.error?.message || '적용하지 못했습니다.');
        bridge.__OMNI_REPLACE_CHARACTER_CACHE__?.(scope, reply.characters || []);
        plan = null;
        say(`적용했습니다 · 수정 ${reply.edited || 0} · 삭제 ${reply.deleted || 0} · 추가 ${reply.added || 0}`, '#68d9a0');
        await bridge.__OMNI_REFRESH_CHARACTER_SCOPE__?.(scope);
      } catch (error) { say(String((error as Error).message || error), '#e8a2a2'); }
      finally { lock(false); apply.textContent = '적용'; }
    })();
  });
  document.body.append(veil);
  input.focus();
}
