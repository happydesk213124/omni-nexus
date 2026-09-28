import { NOTE_KEYS, type SettingsPreset } from '../domain/settings-preset';

interface Result { ok?: boolean; items?: SettingsPreset[]; appliedId?: string; preset?: SettingsPreset; json?: string; name?: string }
interface Actions {
  request: (path: string, body?: Record<string, unknown>) => Promise<Result>;
  flush: () => Promise<void>;
  reload: () => Promise<void>;
}
let selectedId = '';
const NOTE_LABELS = ['일반 작가의 노트', '에셋 태거 작가의 노트', '공통 작가의 노트', '만화 작가의 노트'];

export function bindSettingsPresets(): void {
  const root = document.getElementById('nx-settings-presets');
  const actions = Reflect.get(globalThis, '__OMNI_SETTINGS_ACTIONS__') as Actions | undefined;
  if (!root || root.dataset.bound || !actions?.request) return;
  root.dataset.bound = '1';
  const select = root.querySelector<HTMLSelectElement>('#nx-sp-select')!;
  const status = root.querySelector<HTMLElement>('#nx-sp-status')!;
  const description = root.querySelector<HTMLElement>('#nx-sp-description')!;
  let rows: SettingsPreset[] = [], busy = false, appliedName = '';
  const current = () => rows.find(row => row.id === select.value);
  const report = (message: string) => { if (root.isConnected) status.textContent = message; };
  const paint = () => {
    description.textContent = current()?.description || '';
    description.hidden = !description.textContent;
    for (const id of ['apply', 'save', 'edit', 'duplicate', 'delete', 'export']) root.querySelector<HTMLButtonElement>('#nx-sp-' + id)!.disabled = busy || !current();
  };
  const refresh = async (preferred = selectedId) => {
    const result = await actions.request('/v1/settings-presets');
    if (!root.isConnected) return;
    rows = result.items || [];
    appliedName = rows.find(row => row.id === result.appliedId)?.name || '';
    select.replaceChildren();
    if (!rows.length) { const empty = document.createElement('option'); empty.value = ''; empty.textContent = '저장된 프리셋 없음'; select.append(empty); }
    for (const [label, builtin] of [['내 프리셋', false], ['예제', true]] as const) {
      const group = document.createElement('optgroup'); group.label = label;
      for (const row of rows.filter(item => !!item.builtin === builtin)) {
        const option = document.createElement('option'); option.value = row.id; option.textContent = row.name;
        group.append(option);
      }
      if (group.childElementCount) select.append(group);
    }
    select.value = rows.find(row => row.id === preferred)?.id || rows.find(row => row.id === result.appliedId)?.id || rows[0]?.id || '';
    selectedId = select.value; paint();
  };
  const run = async (message: string, work: () => Promise<void>) => {
    if (busy) return;
    busy = true; report(message);
    root.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('button,select,input').forEach(node => node.disabled = true);
    try { await work(); } catch (error) { report(String((error as Error).message || error)); }
    finally { busy = false; root.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('button,select,input').forEach(node => node.disabled = false); paint(); }
  };
  const on = (id: string, fn: () => void) => root.querySelector<HTMLButtonElement>('#nx-sp-' + id)!.addEventListener('click', fn);
  select.addEventListener('change', () => { selectedId = select.value; paint(); report(''); });
  on('apply', () => {
    const preset = current(); if (!preset) return;
    void run('설정 적용 중…', async () => {
      const shell = document.getElementById('nx-shell'); if (shell) shell.inert = true;
      try {
        await actions.flush();
        await actions.request('/v1/settings-presets/apply', { id: preset.id });
        await actions.reload();
        const live = document.getElementById('nx-sp-status'); if (live) live.textContent = `‘${preset.name}’ 적용됨`;
      } finally { if (shell) shell.inert = false; }
    });
  });

  const edit = (preset?: SettingsPreset, duplicate = false) => {
    const dialog = document.createElement('dialog'); dialog.className = 'nx-sp-dialog';
    dialog.setAttribute('aria-label', duplicate ? '설정 프리셋 복제' : preset ? '설정 프리셋 수정' : '설정 프리셋 만들기');
    dialog.innerHTML = `<form><h3>${duplicate ? '프리셋 복제' : preset ? '프리셋 편집' : '새 프리셋'}</h3>${preset ? '' : '<p class="nx-sp-dialog-hint">현재 설정을 새 프리셋으로 저장합니다.</p>'}<label>이름<input type="text" name="name" placeholder="예: 일상 대화용" maxlength="80" required></label><label><span>설명 <small class="nx-sp-optional">선택 사항</small></span><input type="text" name="description" maxlength="400"></label>${preset ? '<details><summary>작가의 노트 편집</summary></details>' : ''}<p role="status"></p><footer><button type="button" data-cancel>취소</button><button type="button" data-save>${duplicate ? '복제 저장' : preset ? '변경 저장' : '프리셋 저장'}</button></footer></form>`;
    const form = dialog.querySelector('form')!;
    const name = form.elements.namedItem('name') as HTMLInputElement;
    const desc = form.elements.namedItem('description') as HTMLInputElement;
    name.value = duplicate ? (preset!.name.slice(0, 76) + ' 복사본') : preset?.name || ''; desc.value = preset?.description || '';
    const keys = [...NOTE_KEYS, 'comic_author_note'];
    if (preset) keys.forEach((key, index) => {
      const label = document.createElement('label'); label.textContent = NOTE_LABELS[index]!;
      const field = document.createElement('textarea'); field.name = key;
      field.value = key === 'comic_author_note' ? String(preset.settings.card.comic_author_note || '') : preset.prompts[key as typeof NOTE_KEYS[number]];
      label.append(field); form.querySelector('details')!.append(label);
    });
    form.querySelector('[data-cancel]')!.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    // Risu V3 omits allow-forms, so native submission never reaches a submit listener.
    const save = () => {
      if (!name.value.trim()) { name.setCustomValidity('프리셋 이름을 입력하세요.'); }
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      const button = form.querySelector<HTMLButtonElement>('[data-save]')!;
      if (button.disabled) return;
      button.disabled = true;
      form.querySelector('[role=status]')!.textContent = '저장 중…';
      void (async () => {
        try {
          await actions.flush();
          const result = await actions.request('/v1/settings-presets/save', {
            id: duplicate ? undefined : preset?.id, copy_from: duplicate ? preset?.id : undefined, name: name.value.trim(), description: data.get('description'), capture: !preset,
            ...(preset ? { prompts: Object.fromEntries(NOTE_KEYS.map(key => [key, data.get(key)])), comic_author_note: data.get('comic_author_note') } : {}),
          });
          selectedId = result.preset!.id; dialog.close(); await refresh(selectedId); report(`‘${result.preset!.name}’ 저장됨`);
        } catch (error) { form.querySelector('[role=status]')!.textContent = String((error as Error).message || error); }
        finally { button.disabled = false; }
      })();
    };
    form.querySelector('[data-save]')!.addEventListener('click', save);
    form.addEventListener('submit', event => { event.preventDefault(); save(); });
    form.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing && event.target instanceof HTMLInputElement) { event.preventDefault(); save(); }
    });
    name.addEventListener('input', () => name.setCustomValidity(''));
    document.body.append(dialog); dialog.showModal(); name.focus();
  };
  on('new', () => edit());
  on('duplicate', () => { const preset = current(); if (preset) edit(preset, true); });
  on('edit', () => { const preset = current(); if (preset) edit(preset); });
  on('save', () => {
    const preset = current(); if (!preset) return;
    const dialog = document.createElement('dialog'); dialog.className = 'nx-sp-dialog';
    dialog.setAttribute('aria-label', '설정 프리셋 덮어쓰기');
    const text = document.createElement('p'); text.textContent = `‘${preset.name}’을 현재 설정으로 덮어쓰겠습니까?`;
    const footer = document.createElement('footer');
    for (const [label, value] of [['아니오', 'no'], ['예', 'yes']] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.value = value;
      if (value === 'yes') button.dataset.save = '';
      button.addEventListener('click', () => dialog.close(value)); footer.append(button);
    }
    dialog.append(text, footer);
    dialog.addEventListener('close', () => {
      dialog.remove(); if (dialog.returnValue !== 'yes') return;
      void run('프리셋 저장 중…', async () => {
        await actions.flush();
        await actions.request('/v1/settings-presets/save', { id: preset.id, name: preset.name, description: preset.description, capture: true });
        await refresh(preset.id); report(`‘${preset.name}’을 현재 설정으로 저장했습니다.`);
      });
    });
    document.body.append(dialog); dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('button[value=no]')!.focus();
  });
  on('delete', () => {
    const preset = current(); if (!preset) return;
    const dialog = document.createElement('dialog'); dialog.className = 'nx-sp-dialog'; dialog.setAttribute('aria-label', '설정 프리셋 삭제');
    const form = document.createElement('form');
    const text = document.createElement('p'); text.textContent = `‘${preset.name}’ 프리셋을 삭제할까요? 현재 적용된 설정은 유지됩니다.`;
    const footer = document.createElement('footer');
    for (const [label, value] of [['취소', 'cancel'], ['삭제', 'delete']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label!; button.value = value!;
      button.addEventListener('click', () => dialog.close(value!)); footer.append(button);
    }
    form.append(text, footer); dialog.append(form); document.body.append(dialog); dialog.showModal();
    dialog.addEventListener('close', () => {
      dialog.remove(); if (dialog.returnValue !== 'delete') return;
      void run('삭제 중…', async () => { await actions.request('/v1/settings-presets/delete', { id: preset.id }); await refresh(); report('프리셋 삭제됨'); });
    });
  });
  const file = root.querySelector<HTMLInputElement>('#nx-sp-file')!;
  on('import', () => file.click());
  file.addEventListener('change', () => {
    const picked = file.files?.[0]; file.value = ''; if (!picked) return;
    void run('JSON 불러오는 중…', async () => {
      if (picked.size > 2_000_000) throw new Error('JSON은 2MB 이하만 불러올 수 있습니다.');
      const result = await actions.request('/v1/settings-presets/import', { json: await picked.text(), name: picked.name.replace(/\.json$/i, '') });
      selectedId = result.preset!.id; await refresh(selectedId); report('불러오기 완료 · 적용 버튼을 누르면 현재 설정에 반영됩니다.');
    });
  });
  on('export', () => {
    const preset = current(); if (!preset) return;
    void run('JSON 준비 중…', async () => {
      const result = await actions.request('/v1/settings-presets/export?id=' + encodeURIComponent(preset.id));
      const url = URL.createObjectURL(new Blob([result.json!], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = preset.name.replace(/[<>:"/\\|?*]/g, '_') + '.json';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); report('프리셋 JSON 내보내기 완료');
    });
  });
  void run('프리셋 불러오는 중…', async () => { await refresh(); report(appliedName ? `마지막 적용: ${appliedName}` : ''); });
}
