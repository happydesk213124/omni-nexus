import { getConfig } from '../services/context';

type Actions = { save: (patch: unknown) => Promise<void> };

export function bindCharacterOptions(): void {
  const anchor = document.getElementById('nx-asset-nai-tags') as HTMLSelectElement | null;
  if (!anchor || document.getElementById('nx-image-analysis-separate')) return;
  const container = anchor.closest('label,.row') || anchor;
  // Keep the legacy selector as the single source used by the vendor saver.
  container.setAttribute('hidden', '');
  const group = document.createElement('div');
  group.className = 'stack';
  const config = getConfig().card;
  const enabled = makeToggle('nx-asset-tags-enabled', '에셋 태깅', anchor.value !== 'off');
  const inline = makeToggle('nx-asset-tags-inline', '에셋태깅 메인태깅에 포함', anchor.value === 'inline');
  const separate = makeToggle('nx-image-analysis-separate', '이미지는 분기해서 하기', config.image_analysis_separate === true);
  const help = document.createElement('small');
  help.textContent = '이미지 분석은 오토태그 모델로 보냅니다. 생성 중 이미지 분석이 필요하면 호출이 추가됩니다.';
  const status = document.createElement('small'); status.setAttribute('role', 'status');
  group.append(enabled.row, inline.row, separate.row, help, status);
  container.after(group);
  const paint = () => { inline.input.disabled = !enabled.input.checked; };
  const change = () => {
    anchor.value = !enabled.input.checked ? 'off' : inline.input.checked ? 'inline' : 'prepass';
    anchor.dispatchEvent(new Event('change', { bubbles: true })); paint();
  };
  enabled.input.onchange = change; inline.input.onchange = change; paint();
  separate.input.onchange = () => {
    const actions = Reflect.get(globalThis, '__OMNI_SETTINGS_ACTIONS__') as Actions | undefined;
    if (!actions) { status.textContent = '설정 저장 연결 없음'; return; }
    void actions.save({ card: { image_analysis_separate: separate.input.checked } })
      .then(() => { status.textContent = '저장됨'; })
      .catch(error => { status.textContent = `저장 실패: ${String(error)}`; });
  };
}

function makeToggle(id: string, text: string, checked: boolean) {
  const row = document.createElement('label'); row.className = 'row';
  const title = document.createElement('span'); title.className = 'row-text'; title.textContent = text;
  const sw = document.createElement('span'); sw.className = 'sw';
  const input = document.createElement('input'); input.type = 'checkbox'; input.id = id; input.checked = checked;
  sw.append(input); row.append(title, sw);
  return { row, input };
}
