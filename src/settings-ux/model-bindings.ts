import { bindVertexCredentials } from './vertex-bindings';

type Credentials = { api_key_configured?: boolean; service_account_configured?: boolean; api_keys_v4_configured?: boolean; api_keys_v5_configured?: boolean; backend?: string };
let referenceOpen = false;
type Actions = {config: () => { nai?: Credentials; llm?: Credentials; llm_roles?: Record<string, Credentials> }; save: (patch: unknown) => Promise<void>};
export function bindModels(): void {
  const fold = document.getElementById('nx-nai-ref-fold');
  const foldButton = document.getElementById('nx-nai-ref-fold-btn');
  if (fold && foldButton && !foldButton.dataset.boundFold) {
    foldButton.dataset.boundFold = '1';
    fold.classList.toggle('open', referenceOpen);
    foldButton.setAttribute('aria-expanded', String(referenceOpen));
    foldButton.addEventListener('click', () => {
      const open = foldButton.getAttribute('aria-expanded') !== 'true';
      referenceOpen = open;
      foldButton.setAttribute('aria-expanded', String(open));
      fold.classList.toggle('open', open);
      const body = document.getElementById('nx-nai-ref-fold-body');
      if (body) body.hidden = !open;
    });
    const vibe = document.getElementById('nx-nai-vibe-on') as HTMLInputElement | null;
    const paint = () => { fold.dataset.vibe = vibe?.checked ? 'on' : 'off'; };
    vibe?.addEventListener('change', paint); paint();
  }
  const tabs = document.getElementById('nx-llm-role-tabs');
  const paintRole = () => {
    // The vendor persists the draft and restores its active role on every repaint.
    const role = tabs?.querySelector<HTMLElement>('[data-llm-role].active')?.dataset.llmRole || 'main';
    document.querySelectorAll<HTMLElement>('[data-ux-llm-role]').forEach(panel => {
      panel.hidden = panel.dataset.uxLlmRole !== role;
    });
    tabs?.querySelectorAll<HTMLElement>('[data-llm-role]').forEach(button => {
      const on = button.dataset.llmRole === role;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    });
  };
  paintRole();
  const actions = Reflect.get(globalThis, '__OMNI_SETTINGS_ACTIONS__') as Actions | undefined;
  if (!actions) return;
  const cfg = actions.config();
  const backend = cfg.nai?.backend === 'comfy' ? 'comfy' : 'nai';
  document.querySelectorAll<HTMLElement>('[data-nx-backend-pane]').forEach(el => el.hidden = el.dataset.nxBackendPane !== backend);
  const familyBar = document.querySelector('[data-nai-family]')?.parentElement;
  if (familyBar) {
    // NAI-only fields occupy the segment before the Comfy fields in the preview.
    let el: Element | null = familyBar;
    while (el && !el.hasAttribute('data-nx-backend-pane')) {
      (el as HTMLElement).hidden = backend !== 'nai'; el = el.nextElementSibling;
    }
  }
  document.querySelectorAll<HTMLElement>('[data-backend]').forEach(el => el.classList.toggle('on',el.dataset.backend === backend));
  for (const family of ['v4','v5'] as const) {
    const input = document.getElementById('nx-nai-keys-' + family) as HTMLTextAreaElement | null;
    const checkbox = document.getElementById('nx-nai-keys-' + family + '-clear') as HTMLInputElement | null;
    if (!input || !checkbox || checkbox.dataset.uxDelete) continue;
    checkbox.dataset.uxDelete = '1';
    const oldRow = checkbox.closest('label'); if (oldRow) oldRow.hidden = true;
    const status = document.createElement('span'); status.className = 'key-status'; status.setAttribute('role','status');
    const configured = family === 'v4' ? cfg.nai?.api_keys_v4_configured : cfg.nai?.api_keys_v5_configured;
    status.textContent = configured ? '등록됨' : '미등록';
    input.before(status);
    const button = document.createElement('button'); button.type='button'; button.className='btn-ghost'; button.textContent='이 탭 키 모두 지우기';
    oldRow?.after(button);
    button.addEventListener('click',async () => {
      button.disabled=true; status.textContent='저장 중';
      try {
        await actions.save({nai:{['api_keys_' + family]:[], [family === 'v4' ? 'clearApiKeysV4' : 'clearApiKeysV5']:true}});
        input.value=''; checkbox.checked=false; status.textContent='미등록';
      } catch { status.textContent='저장 실패'; }
      finally { button.disabled=false; }
    });
    input.addEventListener('input',()=> { status.textContent='저장 중'; });
    const flash = document.getElementById('nx-save-flash');
    if (flash) new MutationObserver(() => {
      const text=flash.textContent || '';
      const nai=actions.config().nai;
      status.textContent=text.includes('실패') ? '저장 실패' : (family==='v4' ? nai?.api_keys_v4_configured : nai?.api_keys_v5_configured) ? '등록됨' : '미등록';
    }).observe(flash,{subtree:true,childList:true,characterData:true});
  }
  for (const [prefix, credential] of [['nx-llm',cfg.llm],['nx-llm-autotag',cfg.llm_roles?.autotag],['nx-llm-asset',cfg.llm_roles?.asset_char],['nx-llm-comic',cfg.llm_roles?.comic]] as const) {
    const field = document.getElementById(prefix+'-key');
    if (field) { const status=document.createElement('span'); status.className='key-status'; status.textContent=credential?.api_key_configured?'등록됨':'미등록'; field.before(status); }
  }
  bindVertexCredentials(actions);
}
