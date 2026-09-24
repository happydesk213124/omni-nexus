import { getConfig } from '../services/context';

type Actions = { save: (patch: unknown) => Promise<void> };

export function bindCharacterOptions(): void {
  const section = document.getElementById('nx-asset-tag-controls');
  if (!section || section.dataset.nxBound === '1') return;
  section.dataset.nxBound = '1';
  const heading = document.createElement('h3'); heading.textContent = '에셋 태깅';
  const group = document.createElement('div'); group.className = 'stack';
  const config = getConfig().card;
  const enabled = makeToggle('nx-asset-tags-enabled', '에셋 태깅', config.asset_nai_tags !== 'off');
  const inline = makeToggle('nx-asset-tags-inline', '에셋태깅 메인태깅에 포함', config.asset_nai_tags === 'inline');
  const separate = makeToggle('nx-image-analysis-separate', '이미지는 분기해서 하기', config.image_analysis_separate === true);
  const status = document.createElement('small'); status.setAttribute('role', 'status');
  group.append(enabled.row, inline.row, separate.row, status);
  section.append(heading, group);
  const paint = () => { inline.input.disabled = !enabled.input.checked; };
  const save = async (patch: unknown) => {
    const actions = Reflect.get(globalThis, '__OMNI_SETTINGS_ACTIONS__') as Actions | undefined;
    if (!actions) { status.textContent = '설정 저장 연결 없음'; return; }
    try { await actions.save(patch); status.textContent = '저장됨'; }
    catch (error) { status.textContent = `저장 실패: ${String(error)}`; }
  };
  const assetChange = () => {
    const mode = !enabled.input.checked ? 'off' : inline.input.checked ? 'inline' : 'prepass';
    paint(); void save({ card: { asset_nai_tags: mode } });
  };
  enabled.input.onchange = assetChange; inline.input.onchange = assetChange; paint();
  separate.input.onchange = () => void save({ card: { image_analysis_separate: separate.input.checked } });
}

function makeToggle(id: string, text: string, checked: boolean) {
  const row = document.createElement('label'); row.className = 'row';
  const title = document.createElement('span'); title.className = 'row-text'; title.textContent = text;
  const sw = document.createElement('span'); sw.className = 'sw';
  const input = document.createElement('input'); input.type = 'checkbox'; input.id = id; input.checked = checked;
  sw.append(input); row.append(title, sw);
  return { row, input };
}
