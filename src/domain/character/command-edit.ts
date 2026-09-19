/**
 * Apply LLM 명령수정 add/remove JSON onto a roster character (form only).
 */

import type { CharacterCostume, CharacterRecord } from '../../core/types.ts';
import { cleanText } from '../../core/util/text.ts';
import { applyTagDelta, type TagDelta } from '../prompt/command-rewrite.ts';
import { COSTUME_FIELDS, ensureCostumes, normalizeCostume, resolveCostumeIndex } from './costume.ts';
import { normalizeGender } from './identity.ts';

function isDelta(value: unknown): value is TagDelta {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && ('add' in value || 'remove' in value);
}

function applyMaybeDelta(current: unknown, delta: unknown, max: number): string {
  if (isDelta(delta)) return applyTagDelta(current, delta);
  if (delta == null) return cleanText(current, max);
  if (typeof delta === 'string' && (delta.trim()==='' || delta.trim()==='[base]')) return delta.trim();
  return applyTagDelta(current, { add: delta });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const LOOK_SLOTS = ['hair_color', 'hair_style', 'eye_color', 'height'] as const;

function copyCostume(row: CharacterCostume): CharacterCostume {
  return { ...row, bottoms: row.bottoms || '' };
}

function applyCostumeDeltas(row: CharacterCostume, patch: Record<string, unknown>, fallback: Partial<CharacterCostume> = {}): CharacterCostume {
  const next = copyCostume(row);
  if ('note' in patch && typeof patch.note === 'string') next.note = cleanText(patch.note, 200);
  for (const key of COSTUME_FIELDS) if (key in patch) {
    const current=next[key]==='[base]'?fallback[key]:next[key];
    next[key]=(key==='age' || key==='penis_size') && !isDelta(patch[key]) ? cleanText(patch[key],400) : applyMaybeDelta(current, patch[key], 4000);
  }
  return next;
}

export function applyCharacterCommandDeltas(
  rec: Partial<CharacterRecord> | null | undefined,
  parsed: unknown,
): CharacterRecord {
  const base = { ...(rec || {}) } as CharacterRecord;
  const delta = asRecord(parsed) || {};
  if ('name' in delta) base.name = cleanText(delta.name, 200);
  if ('id' in delta) base.id = cleanText(delta.id, 80);
  if ('original' in delta) {
    // Prompt says replace-if-present, but models often emit {add,remove} like other tag slots.
    base.original = isDelta(delta.original)
      ? applyTagDelta(base.original, delta.original)
      : cleanText(delta.original, 400);
  }
  if ('gender' in delta) base.gender = normalizeGender(delta.gender);
  if (isDelta(delta.appearance) || delta.appearance != null && delta.appearance !== '') {
    base.appearance = applyMaybeDelta(base.appearance, delta.appearance, 4000);
  }
  for (const slot of LOOK_SLOTS) {
    if (slot in delta) (base as Record<string, unknown>)[slot] = applyMaybeDelta(base[slot], delta[slot], 400);
  }
  if ('age' in delta && delta.age != null && delta.age !== '') {
    const n = Number(delta.age);
    if (Number.isFinite(n)) base.age = Math.round(n);
  }
  if ('penis_size' in delta && typeof delta.penis_size === 'string') {
    base.penis_size = cleanText(delta.penis_size, 40);
  }

  const ensured = ensureCostumes(base);
  let costumes = ensured.costumes.map(copyCostume);
  let active = ensured.active_costume;
  costumes[active] = applyCostumeDeltas(costumes[active]!, delta, costumes[0]);

  const existingPatches = Array.isArray(delta.costumes) ? delta.costumes : [];
  for (const raw of existingPatches) {
    const row = asRecord(raw);
    if (!row) continue;
    const idx = resolveCostumeIndex(costumes, row.name ?? row.index);
    if (idx < 0) continue;
    costumes[idx] = applyCostumeDeltas(costumes[idx]!, row, costumes[0]);
  }

  const created = Array.isArray(delta.new_costumes) ? delta.new_costumes : [];
  for (const raw of created) {
    const row = asRecord(raw);
    if (!row) continue;
    const name = cleanText(row.name, 80);
    if (!name) continue;
    const existing = resolveCostumeIndex(costumes, name);
    if (existing >= 0) { costumes[existing] = applyCostumeDeltas(costumes[existing]!, row, costumes[0]); continue; }
    let seed: CharacterCostume = { name, note: cleanText(row.note, 200), attire: '', bottoms: '', accessories: '' };
    const baseName = cleanText(row.base_costume, 80);
    if (baseName) {
      const bi = resolveCostumeIndex(costumes, baseName);
      if (bi >= 0) {
        seed = { ...copyCostume(costumes[bi]!), name, note: seed.note || costumes[bi]!.note };
      }
    }
    const normalized = normalizeCostume({ ...seed, name }, costumes.length);
    if (!normalized) continue;
    costumes.push(applyCostumeDeltas(normalized, row, costumes[0]));
  }

  const removed = collectCostumeNames(delta.remove_costumes);
  if (removed.length) {
    const drop = new Set(removed.map((n) => n.toLowerCase()));
    const next = costumes.filter((c) => !drop.has(c.name.toLowerCase()));
    if (next.length) costumes = next;
  }

  if (delta.active_costume != null) {
    const idx = resolveCostumeIndex(costumes, delta.active_costume);
    if (idx >= 0) active = idx;
  }
  ({ costumes, active_costume: active } = ensureCostumes({costumes, active_costume: active}));
  const wear = costumes[active] || costumes[0];
  return {
    ...base,
    costumes,
    active_costume: active,
    attire: wear?.attire || '',
    bottoms: wear?.bottoms || '',
    accessories: wear?.accessories || '',
  };
}

function collectCostumeNames(value: unknown): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (raw: unknown) => {
    if (raw == null || raw === '') return;
    if (Array.isArray(raw)) {
      for (const item of raw) add(item);
      return;
    }
    let name = '';
    if (typeof raw === 'string' || typeof raw === 'number') name = cleanText(raw, 80);
    else {
      const rec = asRecord(raw);
      if (rec) name = cleanText(rec.name ?? rec.index, 80);
    }
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };
  add(value);
  return names;
}

function listTokens(value: unknown): string[] {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.map((v) => cleanText(v, 200)).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((v) => cleanText(v, 200)).filter(Boolean);
  return [cleanText(value, 200)].filter(Boolean);
}

function formatDeltaLines(label: string, delta: unknown): string[] {
  if (isDelta(delta)) {
    const add = listTokens(delta.add);
    const remove = listTokens(delta.remove);
    const lines: string[] = [];
    for (const t of add) lines.push(`${label}  + ${t}`);
    for (const t of remove) lines.push(`${label}  − ${t}`);
    return lines;
  }
  if (delta == null || delta === '') return [];
  return listTokens(delta).map((t) => `${label}  + ${t}`);
}

/** Human log of add/remove from 명령수정 JSON. Empty when nothing changed. */
export function formatCommandDeltaLog(parsed: unknown): string {
  const delta = asRecord(parsed);
  if (!delta) return '';
  const lines: string[] = [];
  if ('name' in delta) lines.push(`이름  → ${cleanText(delta.name, 200)}`);
  if ('id' in delta) lines.push(`id  → ${cleanText(delta.id, 80)}`);
  if ('original' in delta) {
    if (isDelta(delta.original)) lines.push(...formatDeltaLines('original', delta.original));
    else lines.push(`original  → ${cleanText(delta.original, 400)}`);
  }
  if ('gender' in delta) lines.push(`성별  → ${normalizeGender(delta.gender)}`);
  lines.push(...formatDeltaLines('외형', delta.appearance));
  lines.push(...formatDeltaLines('머리색', delta.hair_color));
  lines.push(...formatDeltaLines('머리', delta.hair_style));
  lines.push(...formatDeltaLines('눈', delta.eye_color));
  lines.push(...formatDeltaLines('키', delta.height));
  if (delta.age != null && delta.age !== '') lines.push(`나이  → ${cleanText(delta.age, 20)}`);
  if (typeof delta.penis_size === 'string' && delta.penis_size) {
    lines.push(`penis  → ${cleanText(delta.penis_size, 40)}`);
  }
  const costumes = Array.isArray(delta.costumes) ? delta.costumes : [];
  for (const raw of costumes) {
    const row = asRecord(raw);
    if (!row) continue;
    const name = cleanText(row.name ?? row.index, 80) || '코스튬';
    lines.push(...formatDeltaLines(`코스튬 ${name} · 상의`, row.attire));
    lines.push(...formatDeltaLines(`코스튬 ${name} · 하의`, row.bottoms));
    lines.push(...formatDeltaLines(`코스튬 ${name} · 악세`, row.accessories));
    if (typeof row.note === 'string' && row.note) lines.push(`코스튬 ${name} · 메모  → ${cleanText(row.note, 200)}`);
  }
  const created = Array.isArray(delta.new_costumes) ? delta.new_costumes : [];
  for (const raw of created) {
    const row = asRecord(raw);
    if (!row) continue;
    const name = cleanText(row.name, 80) || '새 코스튬';
    const base = cleanText(row.base_costume, 80);
    lines.push(`새 코스튬  ${name}${base ? `  (from ${base})` : ''}`);
    lines.push(...formatDeltaLines(`  ${name} · 상의`, row.attire));
    lines.push(...formatDeltaLines(`  ${name} · 하의`, row.bottoms));
    lines.push(...formatDeltaLines(`  ${name} · 악세`, row.accessories));
  }
  for (const name of collectCostumeNames(delta.remove_costumes)) {
    lines.push(`코스튬 삭제  ${name}`);
  }
  if (delta.active_costume != null && delta.active_costume !== '') {
    lines.push(`활성 코스튬  → ${cleanText(delta.active_costume, 80)}`);
  }
  return lines.join('\n');
}

/** Payload the LLM is allowed to see — no ref bytes. */
export function characterCommandSnapshot(rec: Partial<CharacterRecord> | null | undefined): Record<string, unknown> {
  const ensured = ensureCostumes(rec);
  return {
    id: cleanText(rec?.id, 80),
    name: cleanText(rec?.name, 200),
    original: cleanText(rec?.original, 400),
    appearance: cleanText(rec?.appearance, 4000),
    gender: cleanText(rec?.gender, 20),
    hair_color: cleanText(rec?.hair_color, 120),
    hair_style: cleanText(rec?.hair_style, 400),
    eye_color: cleanText(rec?.eye_color, 120),
    height: cleanText(rec?.height, 80),
    age: rec?.age ?? '',
    penis_size: cleanText(rec?.penis_size, 40),
    attire: cleanText(rec?.attire, 4000),
    bottoms: cleanText(rec?.bottoms, 4000),
    accessories: cleanText(rec?.accessories, 4000),
    attire_locked: rec?.attire_locked !== false,
    bottoms_locked: rec?.bottoms_locked !== false,
    accessories_locked: rec?.accessories_locked !== false,
    active_costume: ensured.active_costume,
    costumes: ensured.costumes,
  };
}
