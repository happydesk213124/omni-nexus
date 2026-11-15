import { convertComfyWorkflowForOmni } from '../services/comfy-convert';

type Actions = { save: (patch: { nai: { backend: 'comfy'; comfy_workflow_json: string } }) => Promise<unknown> };

/** 모델 설정 › Omni용으로 변환, beside JSON 파일 불러오기: the pasted workflow is converted in place and saved. */
export function bindComfyConvert(): void {
  const button = document.getElementById('nx-comfy-convert') as HTMLButtonElement | null;
  const undo = document.getElementById('nx-comfy-convert-undo') as HTMLButtonElement | null;
  const area = document.getElementById('nx-comfy-workflow') as HTMLTextAreaElement | null;
  const result = document.getElementById('nx-comfy-convert-result');
  if (!button || !undo || !area || !result || button.dataset.comfyConvertBound) return;
  button.dataset.comfyConvertBound = '1';
  const label = button.textContent || 'Omni용으로 변환';
  let before = '';
  const store = async (text: string) => {
    area.value = text;
    const actions = Reflect.get(globalThis, '__OMNI_SETTINGS_ACTIONS__') as Actions | undefined;
    await actions?.save({ nai: { backend: 'comfy', comfy_workflow_json: text } });
  };
  const show = (lines: string[]) => { result.hidden = false; result.replaceChildren(...lines.map(line => { const row = document.createElement('div'); row.textContent = line; return row; })); };
  button.addEventListener('click', () => void (async () => {
    button.disabled = true; button.textContent = '⏳ 변환 중…'; button.setAttribute('aria-busy', 'true');
    try {
      const original = area.value, converted = await convertComfyWorkflowForOmni(original);
      if (!converted.changes.length) { show(['바꿀 곳이 없습니다. 이미 Omni용 워크플로입니다.']); return; }
      await store(converted.text);
      before = original; undo.hidden = false;
      show([`변환해서 저장했습니다${converted.asked ? ' · 애매한 자리는 LLM에게 물었습니다' : ''}.`, ...converted.changes]);
    } catch (error) {
      show([`변환 실패: ${String((error as Error)?.message || error)}`]);
    } finally { button.disabled = false; button.textContent = label; button.removeAttribute('aria-busy'); }
  })());
  undo.addEventListener('click', () => void (async () => {
    if (!before) return;
    try { await store(before); before = ''; undo.hidden = true; show(['원래 JSON으로 되돌렸습니다.']); } catch (error) { show([`되돌리기 실패: ${String((error as Error)?.message || error)}`]); }
  })());
}
