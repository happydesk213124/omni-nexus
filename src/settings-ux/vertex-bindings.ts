import { defaultEndpointForProvider, llmModelPlaceholder, shouldAutoReplaceEndpoint } from '../providers/llm/providers';

interface VertexCredentials { service_account_configured?: boolean }
export interface VertexSettingsActions {
  config: () => { llm?: VertexCredentials; llm_roles?: Record<string, VertexCredentials> };
  save: (patch: unknown) => Promise<void>;
}

const statusObservers = new Map<string, MutationObserver>();
const ROLES = [['nx-llm', 'main'], ['nx-llm-autotag', 'autotag'], ['nx-llm-asset', 'asset_char'], ['nx-llm-comic', 'comic']] as const;

/** The preview owns labels/layout, so provider-dependent credential states live here. */
export function bindVertexCredentials(actions: VertexSettingsActions): void {
  for (const [prefix, role] of ROLES) {
    const input = document.getElementById(prefix + '-service-account') as HTMLTextAreaElement | null;
    if (!input || input.dataset.uxVertex) continue;
    input.dataset.uxVertex = '1';
    statusObservers.get(prefix)?.disconnect();
    statusObservers.delete(prefix);
    const vertex = (document.getElementById(prefix + '-provider') as HTMLSelectElement | null)?.value === 'vertex';
    const checkbox = document.getElementById(prefix + '-clear-sa') as HTMLInputElement | null;
    const oldRow = checkbox?.closest('label');
    if (oldRow) oldRow.hidden = true;
    if (checkbox) checkbox.checked = false;
    const row = input.closest('label');
    if (row) row.hidden = !vertex;
    const region = document.getElementById(prefix + '-vertex-region') as HTMLInputElement | null;
    const regionRow = region?.closest('label');
    if (regionRow) regionRow.hidden = !vertex;
    if (!vertex) continue;

    const endpoint = document.getElementById(prefix + '-endpoint') as HTMLInputElement | null;
    const paintEndpoint = () => {
      if (!endpoint) return;
      const host = defaultEndpointForProvider('vertex', { region: region?.value || 'us-central1' });
      endpoint.placeholder = host;
      if (shouldAutoReplaceEndpoint(endpoint.value)) endpoint.value = host;
    };
    paintEndpoint();
    region?.addEventListener('input', paintEndpoint);
    region?.addEventListener('change', paintEndpoint);
    const model = document.getElementById(prefix + '-model') as HTMLInputElement | null;
    if (model) model.placeholder = llmModelPlaceholder('vertex');
    const token = document.getElementById(prefix + '-key') as HTMLInputElement | null;
    const tokenLabel = token?.closest('label')?.querySelector('span');
    if (tokenLabel) tokenLabel.textContent = 'Access token (선택)';
    if (token) token.placeholder = 'Service Account JSON을 넣었다면 비워두세요';
    input.placeholder = 'Service Account JSON 전체를 붙여넣으세요. 비워두면 기존 값 유지';

    const configured = () => {
      const cfg = actions.config();
      return Boolean((role === 'main' ? cfg.llm : cfg.llm_roles?.[role])?.service_account_configured);
    };
    const status = document.createElement('span');
    status.id = prefix + '-sa-status';
    status.className = 'key-status';
    status.setAttribute('role', 'status');
    const paintStatus = () => { status.textContent = configured() ? '등록됨' : '미등록'; };
    paintStatus();
    input.before(status);
    const button = document.createElement('button');
    button.id = prefix + '-remove-sa';
    button.type = 'button';
    button.className = 'btn-ghost';
    button.textContent = 'SA 제거';
    button.disabled = input.disabled;
    oldRow?.after(button);
    let deleting = false;
    let pending = false;
    button.addEventListener('click', async () => {
      if (deleting) return;
      deleting = true;
      pending = false;
      const draft = input.value;
      input.value = '';
      input.disabled = true;
      button.disabled = true;
      status.textContent = '삭제 중';
      try {
        // save() drains pending autosaves first; the deletion must be the final write.
        await actions.save(role === 'main'
          ? { llm: { clearServiceAccount: true } }
          : { llm_roles: { [role]: { clearServiceAccount: true } } });
        if (checkbox) checkbox.checked = false;
        paintStatus();
      } catch {
        input.value = draft;
        status.textContent = '삭제 실패';
      } finally {
        deleting = false;
        input.disabled = false;
        button.disabled = false;
      }
    });
    input.addEventListener('input', () => { pending = true; status.textContent = '저장 중'; });
    const flash = document.getElementById('nx-save-flash');
    if (flash) {
      const observer = new MutationObserver(() => {
        if (!status.isConnected) { observer.disconnect(); return; }
        if (deleting) return;
        const message = flash.textContent || '';
        if (message.includes('실패')) { if (pending) status.textContent = '저장 실패'; }
        else if (message.includes('저장')) { pending = false; paintStatus(); }
      });
      observer.observe(flash, { subtree: true, childList: true, characterData: true });
      statusObservers.set(prefix, observer);
    }
  }
}
