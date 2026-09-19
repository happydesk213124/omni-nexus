import { COSTUME_FIELDS, COSTUME_LOOK_FIELDS } from '../domain/character/costume';

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
/** Options carry the draft so a repaint/save cannot drop a non-active appearance. */
export function bindCostumeEditor(root: HTMLElement): void {
  const select = root.querySelector<HTMLSelectElement>('[data-char-costume]');
  if (!select || select.dataset.fullCostume) return;
  select.dataset.fullCostume = '1';
  const field = (key: string) => root.querySelector<Field>(`[data-char-${key.replaceAll('_', '-')}]`);
  const options = () => [...select.options].filter(o => o.value !== '__add__');
  for (const key of ['age', 'penis_size']) {
    const el = field(key);
    if (el instanceof HTMLInputElement) el.type = 'text';
    if (el instanceof HTMLSelectElement && ![...el.options].some(o => o.value === '[base]')) el.add(new Option('[base]', '[base]'));
  }
  options().forEach((option, i) => {
    for (const key of COSTUME_LOOK_FIELDS) if (!option.hasAttribute('data-' + key)) {
      option.setAttribute('data-' + key, i ? '[base]' : field(key)?.value || '');
    }
  });
  let active = select.selectedOptions[0];
  select.addEventListener('omni-costumes-replaced', () => { active = select.selectedOptions[0]; });
  const commit = () => {
    if (!active || active.value === '__add__') return;
    for (const key of COSTUME_FIELDS) {
      const value = field(key)?.value.trim() || '';
      active.setAttribute('data-' + key, active === options()[0] && value === '[base]' ? '' : value);
    }
    active.setAttribute('data-name', field('costume-name')?.value || 'default');
    active.setAttribute('data-note', field('costume-note')?.value || '');
  };
  const load = () => {
    if (!active) return;
    for (const key of COSTUME_FIELDS) { const el = field(key); if (el) el.value = active.getAttribute('data-' + key) || ''; }
    const name = field('costume-name'), note = field('costume-note');
    if (name) name.value = active.getAttribute('data-name') || '';
    if (note) note.value = active.getAttribute('data-note') || '';
  };
  const reindex = () => options().forEach((o, i) => { o.value = String(i); o.textContent = `${o.getAttribute('data-name')}[${i}]`; });
  for (const key of [...COSTUME_FIELDS, 'costume-name', 'costume-note']) field(key)?.addEventListener('input', commit);
  select.addEventListener('change', event => {
    event.stopImmediatePropagation(); commit();
    if (select.value === '__add__') {
      const option = new Option('', String(options().length));
      for (const key of COSTUME_FIELDS) option.setAttribute('data-' + key, '[base]');
      option.setAttribute('data-name', 'costume' + options().length);
      select.add(option); active = option; reindex(); select.value = option.value;
    } else active = select.selectedOptions[0];
    load(); root.dispatchEvent(new Event('input', { bubbles: true }));
  }, true);
  for (const action of ['default', 'delete']) root.querySelector(`[data-char-costume-${action}]`)?.addEventListener('click', event => {
    event.preventDefault(); event.stopImmediatePropagation(); commit();
    if (!active) return;
    if (action === 'delete') {
      if (options().length <= 1) return;
      active.remove(); active = options()[0];
    } else {
      const base = options()[0];
      for (const key of COSTUME_FIELDS) if (active.getAttribute('data-' + key) === '[base]') active.setAttribute('data-' + key, base.getAttribute('data-' + key) || '');
      if (active !== base && base.getAttribute('data-name') === 'default') base.setAttribute('data-name', 'previous');
      select.insertBefore(active, base); active.setAttribute('data-name', 'default');
    }
    reindex(); select.value = active.value; load(); root.dispatchEvent(new Event('input', { bubbles: true }));
  }, true);
  load();
}
