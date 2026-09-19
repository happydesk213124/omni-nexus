import type { CharacterCostume, CharacterRecord } from '../core/types';
import { cleanText } from '../core/util/text';
import { COSTUME_FIELDS, ensureCostumes } from '../domain/character/costume';

export type FormPrefix = 'ce' | 'char';

function q(root: ParentNode, prefix: FormPrefix, name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  return root.querySelector(`[data-${prefix}-${name}]`);
}

function val(el: { value?: string } | null): string {
  return el && 'value' in el ? String(el.value || '') : '';
}

function setVal(el: { value?: string } | null, value: unknown): void {
  if (el && 'value' in el) el.value = value == null ? '' : String(value);
}

function readCostumes(root: ParentNode, prefix: FormPrefix, rec: Partial<CharacterRecord>): CharacterCostume[] {
  const sel = q(root, prefix, 'costume') as HTMLSelectElement | null;
  if (sel) {
    const fromOpts: CharacterCostume[] = [];
    for (const opt of Array.from(sel.options)) {
      if (opt.value === '__add__') continue;
      fromOpts.push({
        name: opt.getAttribute('data-name') || opt.textContent || `costume${fromOpts.length}`,
        note: opt.getAttribute('data-note') || '',
        attire: opt.getAttribute('data-attire') || '',
        accessories: opt.getAttribute('data-accessories') || '',
        ...Object.fromEntries(COSTUME_FIELDS.map(key => [key, opt.getAttribute('data-' + key) ?? (fromOpts.length ? '[base]' : val(q(root, prefix, key.replaceAll('_','-'))))])),
      });
    }
    if (fromOpts.length) return fromOpts;
  }
  return ensureCostumes(rec).costumes;
}

export function readCharacterFromForm(root: ParentNode, prefix: FormPrefix, seed: Partial<CharacterRecord> = {}): Partial<CharacterRecord> {
  const rec: Partial<CharacterRecord> = { ...seed };
  rec.name = val(q(root, prefix, 'name')) || rec.name || '';
  rec.original = val(q(root, prefix, 'original'));
  rec.appearance = val(q(root, prefix, 'appearance'));
  rec.attire = val(q(root, prefix, 'attire'));
  rec.accessories = val(q(root, prefix, 'accessories'));
  rec.bottoms = val(q(root, prefix, 'bottoms'));
  rec.gender = val(q(root, prefix, 'gender'));
  rec.hair_color = val(q(root, prefix, 'hair-color'));
  rec.hair_style = val(q(root, prefix, 'hair-style'));
  rec.eye_color = val(q(root, prefix, 'eye-color'));
  rec.height = val(q(root, prefix, 'height'));
  rec.age = val(q(root, prefix, 'age'));
  rec.penis_size = val(q(root, prefix, 'penis-size'));
  rec.costumes = readCostumes(root, prefix, rec);
  const sel = q(root, prefix, 'costume') as HTMLSelectElement | null;
  const idx = sel && sel.value !== '__add__' ? Number(sel.value) : Number(rec.active_costume || 0);
  rec.active_costume = Number.isFinite(idx) ? idx : 0;
  rec.attire = val(q(root, prefix, 'attire')) || rec.attire;
  rec.accessories = val(q(root, prefix, 'accessories')) || rec.accessories;
  const nameEl = q(root, prefix, 'costume-name');
  const noteEl = q(root, prefix, 'costume-note');
  if (rec.costumes?.[rec.active_costume || 0]) {
    if (nameEl) rec.costumes[rec.active_costume || 0]!.name = val(nameEl) || rec.costumes[rec.active_costume || 0]!.name;
    if (noteEl) rec.costumes[rec.active_costume || 0]!.note = val(noteEl);
    rec.costumes[rec.active_costume || 0]!.attire = rec.attire || '';
    for (const key of COSTUME_FIELDS) rec.costumes[rec.active_costume || 0]![key] = val(q(root,prefix,key.replaceAll('_','-')));
  }
  return rec;
}

export function applyCharacterToForm(root: ParentNode, prefix: FormPrefix, rec: Partial<CharacterRecord>): void {
  const { costumes, active_costume } = ensureCostumes(rec);
  const wear = costumes[active_costume] || costumes[0];
  setVal(q(root, prefix, 'name'), rec.name || '');
  setVal(q(root, prefix, 'original'), rec.original || '');

  for (const key of COSTUME_FIELDS) setVal(q(root,prefix,key.replaceAll('_','-')), wear?.[key] ?? rec[key] ?? '');

  setVal(q(root, prefix, 'gender'), rec.gender || '');
  setVal(q(root, prefix, 'costume-name'), wear?.name || '');
  setVal(q(root, prefix, 'costume-note'), wear?.note || '');
  const sel = q(root, prefix, 'costume') as HTMLSelectElement | null;
  if (sel) {
    const addOpt = sel.querySelector('option[value="__add__"]');
    sel.innerHTML = '';
    if (addOpt) sel.appendChild(addOpt);
    else {
      const o = document.createElement('option');
      o.value = '__add__';
      o.textContent = '＋ 코스튬 추가';
      sel.appendChild(o);
    }
    costumes.forEach((c, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.setAttribute('data-name', c.name);
      o.setAttribute('data-note', c.note || '');
      o.setAttribute('data-attire', c.attire);
      for (const key of COSTUME_FIELDS) o.setAttribute('data-' + key, c[key] ?? (i ? '[base]' : String(rec[key] ?? '')));
      o.textContent = `${c.name}[${i}]${c.note ? ` · ${c.note}` : ''}`;
      if (i === active_costume) o.selected = true;
      sel.appendChild(o);
    });
    sel.value = String(active_costume);
    sel.dispatchEvent(new Event('omni-costumes-replaced'));
  }
  if (root instanceof HTMLElement) root.dispatchEvent(new Event('omni-character-refresh'));
}

export function characterIdFromForm(root: Element, seed: Partial<CharacterRecord> = {}): string {
  return cleanText(
    root.getAttribute('data-char-id')
      || root.getAttribute('data-ce-id')
      || seed.id
      || '',
    80,
  );
}
