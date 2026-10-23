import { paintReferenceProgress } from './reference-progress';
import { getConfig, setConfig } from '../services/context';
import type { CardSettings, StylePreset } from '../core/types';
import { lookFilterAllows, presetModelBadge, splitLookFilter } from './preset-tiles';

interface Actions {
  config: () => { card?: CardSettings } | undefined;
  request: (path: string, body?: Record<string, unknown>, timeout?: number) => Promise<Record<string, unknown> | undefined>;
  save: (patch: Record<string, unknown>) => Promise<void>;
  flush: () => Promise<void>;
  reload: () => Promise<void>;
}
const settingsActions = (): Actions | undefined => Reflect.get(globalThis, '__OMNI_SETTINGS_ACTIONS__') as Actions | undefined;
const hasLook = (preset: StylePreset | undefined): boolean => !!(preset?.look_hash || preset?.look_configured || preset?.look_preview_url);
/** Preview-only chrome around vendor preset handlers, which own persistence. */
export function bindPresetSheet(): void {
  const search = document.querySelector<HTMLInputElement>('#nx-preset-search');
  if (!search || search.dataset.nxBound) return;
  search.dataset.nxBound = '1';
  const select = document.querySelector<HTMLSelectElement>('#nx-preset-select');
  const current = document.getElementById('nx-preset-current');
  const tiles = [...document.querySelectorAll<HTMLElement>('#nx-preset-chips [data-preset-select]')];
  const update = () => {
    if (current) current.textContent = document.querySelector<HTMLInputElement>('#nx-preset-name')?.value || select?.selectedOptions[0]?.textContent || '프리셋 없음';
    // Repaints rebuild tiles through tabHtml, but a secondary toggle without one still moves the mark.
    const secondId = String(getConfig().card?.secondary_preset_id ?? '');
    for (const tile of tiles) tile.classList.toggle('second', !!secondId && tile.dataset.presetSelect === secondId);
    // Commas list several, as on the 캐릭터 tab: any one matches. "참고컷 없는" filters instead.
    const { look, terms } = splitLookFilter(search.value.toLocaleLowerCase().split(/[,，]/).map(term => term.trim()).filter(Boolean));
    for (const tile of tiles) {
      const preset = getConfig().card?.presets?.find(p => String(p.id) === tile.dataset.presetSelect);
      const haystack = [tile.textContent, preset?.positive, preset?.negative, preset?.model_family, preset?.model_family === 'v5' ? 'nai5' : 'nai4 nai4.5'].join(' ').toLocaleLowerCase();
      tile.hidden = (terms.length > 0 && !terms.some(term => haystack.includes(term))) || !lookFilterAllows(look, hasLook(preset));
    }
    const empty = document.getElementById('nx-preset-empty');
    if (empty) empty.hidden = tiles.some(tile => !tile.hidden);
  };
  search.addEventListener('input', update);
  const nameField = document.querySelector<HTMLInputElement>('#nx-preset-name');
  const rename = () => {
    const name = nameField?.value || '(이름 없음)';
    const tile = tiles.find(tile => tile.dataset.presetSelect === select?.value);
    const label = tile?.querySelector('[data-preset-label]');
    if (label) label.textContent = name;
    if (tile) { tile.title = name; tile.setAttribute('aria-label', name); }
    const option = select?.selectedOptions[0];
    if (option) option.textContent = name;
    update();
  };
  nameField?.addEventListener('input', rename);
  nameField?.addEventListener('change', rename);
  // The model mark follows the editor before the preset is saved.
  document.querySelector<HTMLSelectElement>('#nx-preset-family')?.addEventListener('change', event => {
    const tile = tiles.find(tile => tile.dataset.presetSelect === select?.value);
    tile?.querySelector('[data-preset-model]')?.replaceWith(presetModelBadge((event.target as HTMLSelectElement).value));
  });
  // The vendor handler owns persistence; mirror its toggle from the tile DOM itself
  // (never the live config, which the vendor listener may already have mutated)
  // so the mark moves on click instead of waiting for a settings reopen. Sync the
  // module config too, otherwise the rebind-time update() re-marks from a stale value.
  document.getElementById('nx-preset-second')?.addEventListener('click', () => {
    const tile = tiles.find(t => t.dataset.presetSelect === select?.value);
    if (!tile) return;
    const on = !tile.classList.contains('second');
    const config = getConfig();
    setConfig({ ...config, card: { ...config.card, secondary_preset_id: on ? String(tile.dataset.presetSelect) : '' } });
    for (const t of tiles) t.classList.toggle('second', on && t === tile);
  });
  select?.addEventListener('change', update);
  update();
  paintReferenceProgress();
  const picking = bindPresetSelection(tiles, update);
  for (const tile of tiles) tile.addEventListener('click', event => {
    // Selection mode: a tap picks or unpicks; the preset is neither applied nor opened.
    if (picking.on) { event.stopImmediatePropagation(); picking.toggle(tile); return; }
    if (tile.dataset.presetSelect !== select?.value) return;
    event.stopImmediatePropagation();
    if (!document.getElementById('nx-preset-sheet')?.classList.contains('open')) document.getElementById('nx-preset-edit-btn')?.click();
  }, true);
  const pop = document.getElementById('nx-preset-import-pop');
  const bg = document.getElementById('nx-preset-import-bg');
  const trigger = document.getElementById('nx-preset-import');
  const ok = document.getElementById('nx-preset-import-ok');
  let importing = false;
  const open = (value: boolean) => {
    pop?.classList.toggle('on', value);
    bg?.classList.toggle('on', value);
    if (value) document.getElementById('nx-preset-import-text')?.focus();
  };
  document.getElementById('nx-preset-import-text')?.addEventListener('paste', event => event.stopImmediatePropagation(), true);
  // Capture intercepts only opening the preview dialog. OK invokes the original importer.
  trigger?.addEventListener('click', event => {
    if (importing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open(true);
  }, true);
  ok?.addEventListener('click', () => {
    importing = true;
    try { trigger?.click(); } finally { importing = false; }
    open(false);
  });
  document.getElementById('nx-preset-import-cancel')?.addEventListener('click', () => open(false));
  // JSON 관리: one button for the three; the originals stay (hidden) for the handlers bound to them.
  document.getElementById('nx-preset-json')?.addEventListener('click', () => open(true));
  for (const [id, target] of [['nx-preset-json-export', 'nx-preset-export'], ['nx-preset-json-file', 'nx-preset-file']]) {
    document.getElementById(id)?.addEventListener('click', () => { open(false); document.getElementById(target)?.click(); });
  }
  bg?.addEventListener('click', () => open(false));
  document.getElementById('nx-preset-vibe-preview')?.addEventListener('click', () => document.getElementById('nx-preset-vibe-pick')?.click());
}

/**
 * 선택 모드, as on the 캐릭터 tab: tiles are picked by tapping, then one bar acts
 * on all of them. 참고컷 생성 runs one preset after another (NovelAI draws one
 * image at a time per account); 삭제 removes them in one settings write.
 */
function bindPresetSelection(tiles: HTMLElement[], repaint: () => void): { on: boolean; toggle: (tile: HTMLElement) => void } {
  const state = { on: false, toggle: (_tile: HTMLElement) => {} };
  const toggleButton = document.getElementById('nx-preset-pick');
  const row = toggleButton?.parentElement;
  if (!toggleButton || !row) return state;
  const bar = document.createElement('div');
  bar.id = 'nx-preset-pick-bar'; bar.hidden = true; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', '고른 프리셋');
  bar.innerHTML = '<span data-sel-count></span><button type="button" class="dock-btn" data-sel="all">전체 선택</button>'
    + '<button type="button" class="dock-btn" data-sel="look-gen">참고컷 생성</button><button type="button" class="dock-btn" data-sel="delete">삭제</button>';
  toggleButton.after(bar);
  const picked = new Set<string>();
  let note = '', running = false;
  const chosen = () => tiles.filter(tile => picked.has(tile.dataset.presetSelect || '') && tile.isConnected).map(tile => tile.dataset.presetSelect || '');
  const paint = () => {
    const n = chosen().length;
    bar.querySelector('[data-sel-count]')!.textContent = n + '개 선택' + (note ? ' · ' + note : '');
    for (const button of bar.querySelectorAll<HTMLButtonElement>('[data-sel]')) button.disabled = running || (button.dataset.sel !== 'all' && n === 0);
    toggleButton.classList.toggle('on', state.on);
    toggleButton.setAttribute('aria-pressed', String(state.on));
  };
  const setTile = (tile: HTMLElement, on: boolean) => { tile.classList.toggle('nx-picked', on); tile.setAttribute('aria-checked', String(on)); };
  state.toggle = tile => {
    const id = tile.dataset.presetSelect || '';
    const on = !picked.has(id);
    if (on) picked.add(id); else picked.delete(id);
    setTile(tile, on); paint();
  };
  const setMode = (on: boolean) => {
    state.on = on; bar.hidden = !on;
    row.classList.toggle('nx-selecting', on);
    if (!on) { for (const tile of tiles) setTile(tile, false); picked.clear(); note = ''; }
    paint();
  };
  toggleButton.addEventListener('click', () => setMode(!state.on));
  const run = async (work: (ids: string[], actions: Actions) => Promise<void>) => {
    const ids = chosen(), actions = settingsActions();
    if (!ids.length || running) return;
    if (!actions) { window.alert('설정 연결을 찾을 수 없습니다.'); return; }
    running = true; note = ''; paint();
    try { await work(ids, actions); } catch (error) { window.alert(String((error as Error)?.message || error)); }
    finally { running = false; paint(); }
  };
  bar.addEventListener('click', event => {
    const action = (event.target as Element).closest<HTMLElement>('[data-sel]')?.dataset.sel;
    if (action === 'all') { for (const tile of tiles) if (!tile.hidden) { picked.add(tile.dataset.presetSelect || ''); setTile(tile, true); } paint(); return; }
    if (action === 'look-gen') void run(async (ids, actions) => {
      let done = 0;
      for (const [i, id] of ids.entries()) {
        note = '참고컷 ' + (i + 1) + '/' + ids.length + '…'; paint();
        try {
          // The saved preset's own prompt and settings: the backend reads them when the body leaves them out.
          const res = await actions.request('/v1/presets/look/generate', { preset_id: id }, 180000);
          const preset = actions.config()?.card?.presets?.find(p => String(p.id) === id);
          if (preset) Object.assign(preset, { look_configured: true, look_preview_url: String(res?.preview_url || ''), look_hash: String(res?.look_hash || '') });
          done++;
        } catch { /* the tile shows the error; the next preset goes on */ }
      }
      note = done === ids.length ? '참고컷 ' + done + '개 완료' : '참고컷 ' + done + '/' + ids.length + '개 완료';
      repaint();
    });
    if (action === 'delete') void run(async (ids, actions) => {
      if (!window.confirm('고른 프리셋 ' + ids.length + '개를 삭제할까요?')) return;
      await actions.flush();
      const card = actions.config()?.card;
      if (!card) throw new Error('설정을 읽지 못했습니다.');
      const gone = new Set(ids);
      const all = card.presets || [];
      const presets = all.filter(p => !gone.has(String(p.id)));
      if (!presets.length) throw new Error('프리셋은 하나 이상 남겨야 합니다.');
      // The applied one, if deleted, passes to the nearest one left after it.
      const was = all.findIndex(p => String(p.id) === String(card.active_preset_id));
      const active = gone.has(String(card.active_preset_id))
        ? all.slice(Math.max(0, was)).find(p => !gone.has(String(p.id))) || presets[presets.length - 1]!
        : presets.find(p => String(p.id) === String(card.active_preset_id)) || presets[0]!;
      await actions.save({ card: { ...card, presets, active_preset_id: String(active.id),
        secondary_preset_id: gone.has(String(card.secondary_preset_id || '')) ? '' : card.secondary_preset_id,
        custom_pos: active.positive || '', custom_neg: active.negative || '' } });
      for (const id of ids) void actions.request('/v1/nai/vibe/clear', { preset_id: id }).catch(() => {});
      setMode(false);
      await actions.reload();
    });
  });
  paint();
  return state;
}
