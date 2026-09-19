import { paintReferenceProgress } from './reference-progress';
import { getConfig, setConfig } from '../services/context';
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
    const query = search.value.trim().toLocaleLowerCase();
    for (const tile of tiles) {
      const preset = getConfig().card?.presets?.find(p => String(p.id) === tile.dataset.presetSelect);
      const haystack = [tile.textContent, preset?.positive, preset?.negative, preset?.model_family, preset?.model_family === 'v5' ? 'nai5' : 'nai4 nai4.5'].join(' ').toLocaleLowerCase();
      tile.hidden = !haystack.includes(query);
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
  for (const tile of tiles) tile.addEventListener('click', event => {
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
  bg?.addEventListener('click', () => open(false));
  document.getElementById('nx-preset-vibe-preview')?.addEventListener('click', () => document.getElementById('nx-preset-vibe-pick')?.click());
}
