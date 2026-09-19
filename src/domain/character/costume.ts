/**
 * Named wardrobe sets on a character (clothes + weapons/props).
 *
 * Missing shot pick inherits the previous shot, then roster `active_costume`.
 * `attire` / `bottoms` / `accessories` on the roster row remain the editing mirror.
 */

import type { CharacterCostume, CharacterRecord } from '../../core/types.ts';
import { cleanText, joinTags, splitTagTokens } from '../../core/util/text.ts';

export type CostumeInput = Partial<CharacterCostume> & Record<string, unknown>;
export const COSTUME_LOOK_FIELDS = ['appearance', 'hair_color', 'hair_style', 'eye_color', 'height', 'age', 'penis_size'] as const;
export const COSTUME_FIELDS = [...COSTUME_LOOK_FIELDS, 'attire', 'bottoms', 'accessories'] as const;
export type CostumeField = typeof COSTUME_FIELDS[number];
export function resolveCostumeFields(costume: CharacterCostume, base: Partial<CharacterRecord> | CharacterCostume): Record<CostumeField, string> {
  return Object.fromEntries(COSTUME_FIELDS.map(key => {
    const value = cleanText(costume[key], 4000);
    const fallback = cleanText(base[key], 4000);
    return [key, expandBaseTokens(value, fallback)];
  })) as Record<CostumeField, string>;
}

/**
 * `[base]` is a token-level inherit marker, not a whole-field one: each
 * `[base]` token expands to the fallback tags, so `[base], happy` over a
 * default `coat` resolves to `coat, happy`. A bare `[base]` still means the
 * whole fallback, and a `[base]` inside the fallback itself is dropped.
 */
export function expandBaseTokens(value: unknown, fallback: unknown): string {
  const tokens = splitTagTokens(value);
  if (!tokens.some((t) => t === '[base]')) return cleanText(value, 4000);
  const base = splitTagTokens(fallback).filter((t) => t !== '[base]');
  const out: string[] = [];
  for (const t of tokens) {
    if (t === '[base]') out.push(...base);
    else out.push(t);
  }
  return joinTags(...out);
}

const costumeKey = (value: unknown): string =>
  cleanText(value, 120).normalize('NFKC').toLocaleLowerCase().replace(/[\s_.·•･-]+/g, '');

/** Sanitize one costume row. Empty name → `default` when index is 0, else `costumeN`. */
export function normalizeCostume(raw: unknown, index = 0): CharacterCostume | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as CostumeInput;
  const attire = cleanText(row.attire ?? row.clothing ?? row.outfit ?? row.tops ?? '', 4000);
  const bottoms = cleanText(row.bottoms ?? row.bottom ?? row.pants ?? '', 4000);
  const accessories = cleanText(row.accessories ?? row.weapon ?? row.weapons ?? '', 4000);
  let name = cleanText(row.name ?? row.id ?? row.label ?? '', 80);
  if (!name) name = index === 0 ? 'default' : `costume${index}`;
  // Collapse spaces for LLM-facing ids; keep alnum-ish + underscore.
  name = name.replace(/\s+/g, '').replace(/[^a-zA-Z0-9_\uac00-\ud7a3-]+/g, '') || (index === 0 ? 'default' : `costume${index}`);
  const note = cleanText(row.note ?? row.description ?? row.desc ?? '', 200);
  const result: CharacterCostume = { name, note, attire, bottoms, accessories };
  for (const key of COSTUME_LOOK_FIELDS) {
    if (row[key] != null) result[key] = cleanText(row[key], 4000);
    else if (index > 0 || name !== 'default') result[key] = '[base]';
  }
  if (index === 0 && name === 'default') for (const key of COSTUME_FIELDS) if (result[key] === '[base]') result[key] = '';
  return result;
}

/**
 * Ensure a non-empty costumes array. Missing → one `default` from wear fields.
 * Clamps `active_costume` into range. Old rows without `bottoms` stay empty there.
 */
export function ensureCostumes(
  rec: Partial<CharacterRecord> | null | undefined,
): { costumes: CharacterCostume[]; active_costume: number } {
  const attire = cleanText(rec?.attire || '', 4000);
  const bottoms = cleanText(rec?.bottoms || '', 4000);
  const accessories = cleanText(rec?.accessories || '', 4000);
  const rawList = Array.isArray(rec?.costumes) ? rec!.costumes! : [];
  const costumes: CharacterCostume[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const c = normalizeCostume(rawList[i], i);
    if (c) costumes.push(c);
  }
  if (!costumes.length) {
    costumes.push({ name: 'default', note: '', attire, bottoms, accessories });
  } else if (!costumes[0]!.name) {
    costumes[0]!.name = 'default';
  }
  for (const key of COSTUME_LOOK_FIELDS) {
    const original = rawList[0] as Partial<CharacterCostume> | undefined;
    if (original?.[key] == null) costumes[0]![key] = cleanText(rec?.[key], 4000);
    else if (costumes[0]![key] === '[base]') costumes[0]![key] = '';
  }
  // Repair ambiguous names without discarding distinct user-authored looks or notes.
  const originalActive = Number(rec?.active_costume) || 0;
  const unique: CharacterCostume[] = [];
  const names = new Set<string>();
  const variants = new Map<string, Array<{row:CharacterCostume;index:number}>>();
  const lookKey=(row:CharacterCostume)=>costumeWearKey({...row,...resolveCostumeFields(row,costumes[0]!)});
  let remapped = 0;
  for (let i = 0; i < costumes.length; i++) {
    const row = costumes[i]!;
    const originalName=costumeKey(row.name);
    const group=variants.get(originalName)||[];
    const same=group.find(c=>lookKey(c.row)===lookKey(row) && (c.row.note||'')===(row.note||''));
    if (same) { if (i === originalActive) remapped = same.index; continue; }
    group.push({row,index:unique.length});variants.set(originalName,group);
    const name = row.name;
    let suffix = 2;
    while (names.has(costumeKey(row.name))) row.name = name + '_' + suffix++;
    names.add(costumeKey(row.name));
    if (i === originalActive) remapped = unique.length;
    unique.push(row);
  }
  costumes.splice(0, costumes.length, ...unique);
  let active = originalActive < 0 || originalActive >= rawList.length ? Number(rec?.active_costume) : remapped;
  if (!Number.isFinite(active)) active = 0;
  active = Math.max(0, Math.min(costumes.length - 1, Math.floor(active)));
  // A new all-[base] draft is intentionally identical until the user edits it.
  // Deduplicate generated imports at merge time, never while reading an editor draft.
  for (const key of COSTUME_FIELDS) if (costumes[0]![key] === '[base]') costumes[0]![key] = '';
  return { costumes, active_costume: active };
}

/** Same attire+accessories token set (order/case ignored). Keep the first (oldest) row. */
export function dedupeIdenticalCostumeTags(
  costumes: CharacterCostume[],
  active: number,
): { costumes: CharacterCostume[]; active_costume: number } {
  if (costumes.length < 2) {
    return { costumes, active_costume: Math.max(0, Math.min(costumes.length - 1, active)) };
  }
  const keyFor = (row: CharacterCostume) => costumeWearKey({ ...row, ...resolveCostumeFields(row, costumes[0]!) });
  const wearKey = keyFor(costumes[active] || costumes[0]!);
  const out: CharacterCostume[] = [];
  const seen = new Set<string>();
  for (const row of costumes) {
    const key = keyFor(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  let next = out.findIndex((row) => keyFor(row) === wearKey);
  if (next < 0) next = 0;
  return { costumes: out, active_costume: next };
}

function costumeWearKey(row: CharacterCostume): string {
  const norm = (value: string) =>
    splitTagTokens(value).map((t) => t.toLowerCase()).sort().join('\0');
  return COSTUME_FIELDS.map(key => norm(row[key] || '')).join('\n');
}

export function matchingCostumeIndex(list: CharacterCostume[], candidate: CharacterCostume): number {
  const base = list[0];
  if (!base) return -1;
  const key = costumeWearKey({ ...candidate, ...resolveCostumeFields(candidate, base) });
  return list.findIndex(row => costumeWearKey({ ...row, ...resolveCostumeFields(row, base) }) === key);
}

/** Generated names can differ even when the resolved appearance already exists. */
export function reuseCreatedCostumePicks(
  shots: Array<{characters?: Array<{name: string; costume?: unknown}>}>,
  pairs: CostumePair[],
  roster: Partial<CharacterRecord>[],
): void {
  for (const shot of shots) for (const char of shot.characters || []) {
    const record = roster.find(row => row.name?.toLowerCase() === char.name.toLowerCase());
    if (!record) continue;
    const list = ensureCostumes(record).costumes;
    if (resolveCostumeIndex(list, char.costume) >= 0) continue;
    const incoming = pairs.find(pair => pair.name.toLowerCase() === char.name.toLowerCase())?.costumes || [];
    const pick = resolveCostumeIndex(incoming, char.costume);
    const candidate = incoming[pick];
    if (!candidate) continue;
    const existing = matchingCostumeIndex(list, candidate);
    if (existing >= 0) char.costume = list[existing]!.name;
  }
}

/** Promote current wear to index 0; previous default shifts to index 1. */
export function promoteCostumeToDefault(
  costumes: CharacterCostume[],
  wear: Partial<Record<CostumeField | 'name' | 'note', unknown>>,
): CharacterCostume[] {
  const next = normalizeCostume(
    {
      ...resolveCostumeFields({ ...wear } as CharacterCostume, costumes[0] || {}),
      name: wear.name || 'default',
      note: wear.note || '',
    },
    0,
  ) || {
    name: 'default',
    note: '',
    attire: cleanText(wear.attire, 4000),
    bottoms: cleanText(wear.bottoms, 4000),
    accessories: cleanText(wear.accessories, 4000),
  };
  next.name = 'default';
  const prev = Array.isArray(costumes) ? costumes.map((c) => ({ ...c })) : [];
  if (prev[0] && costumeWearKey(prev[0]) === costumeWearKey(next) && (prev[0].note || '') === (next.note || '')) return [next, ...prev.slice(1)];
  const shifted = prev.length ? [{ ...prev[0]!, name: prev[0]!.name === 'default' ? 'previous' : prev[0]!.name }, ...prev.slice(1)] : [];
  // Keep distinct previous defaults; the shared normalizer disambiguates names.
  return ensureCostumes({costumes:[next, ...shifted], active_costume:0}).costumes;
}

/**
 * Parse shot.costume: number, "2", "swimsuit", "swimsuit[2]".
 * Returns index into costumes, or -1 if unreadable → caller uses 0.
 */
export function resolveCostumeIndex(
  costumes: CharacterCostume[] | null | undefined,
  pick: unknown,
): number {
  const list = Array.isArray(costumes) && costumes.length ? costumes : null;
  if (!list) return -1;
  if (pick == null || pick === '') return -1;

  if (pick && typeof pick === 'object' && !Array.isArray(pick)) {
    const row = normalizeCostume(pick, 0);
    return row ? resolveCostumeIndex(list, row.name) : -1;
  }

  if (typeof pick === 'number' && Number.isFinite(pick)) {
    const i = Math.floor(pick);
    return i >= 0 && i < list.length ? i : -1;
  }

  const text = cleanText(pick, 120);
  if (!text) return -1;

  const bracket = text.match(/^(.*?)\[(\d+)\]\s*$/);
  if (bracket) {
    const idx = Number(bracket[2]);
    if (Number.isFinite(idx) && idx >= 0 && idx < list.length) return idx;
    const byName = costumeKey(bracket[1]);
    if (byName) {
      const found = list.findIndex((c) => costumeKey(c.name) === byName);
      if (found >= 0) return found;
    }
    return -1;
  }

  if (/^\d+$/.test(text)) {
    const idx = Number(text);
    return idx >= 0 && idx < list.length ? idx : -1;
  }

  const want = costumeKey(text);
  if (!want) return -1;
  return list.findIndex((c) => costumeKey(c.name) === want);
}

/**
 * Wear for a shot. Missing pick → previous pick → roster `active_costume`.
 * Index 0 only when that is the active/previous slot — not a silent default.
 */
export function resolveCostumeWear(
  stored: Partial<CharacterRecord> | null | undefined,
  pick: unknown,
  previousPick: unknown = undefined,
): Record<CostumeField, string> & { index: number; name: string } {
  const { costumes, active_costume } = ensureCostumes(stored || {});
  let index = resolveCostumeIndex(costumes, pick);
  if (index < 0) index = resolveCostumeIndex(costumes, previousPick);
  if (index < 0) index = active_costume;
  if (index < 0 || index >= costumes.length) index = 0;
  const c = costumes[index]!;
  return {
    ...resolveCostumeFields(c, costumes[0]!),
    index,
    name: c.name,
  };
}

type ShotCostumeLike = { characters?: Array<{ name?: unknown; costume?: unknown } | null> | null };

function costumePickReadable(pick: unknown): boolean {
  if (pick == null || pick === '') return false;
  if (typeof pick === 'number') return Number.isFinite(pick);
  if (typeof pick === 'object' && !Array.isArray(pick)) return Boolean(normalizeCostume(pick, 0));
  return Boolean(cleanText(pick, 120));
}

export interface CostumePair {
  name: string;
  costumes: CharacterCostume[];
}

function pushCostumeRows(buckets: Map<string, CostumePair>, charName: unknown, rows: unknown): void {
  const name = cleanText(charName, 200);
  if (!name) return;
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const normalized: CharacterCostume[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const row = normalizeCostume(list[i], i);
    if (row) normalized.push(row);
  }
  if (!normalized.length) return;
  const key = name.toLowerCase();
  const existing = buckets.get(key);
  if (existing) existing.costumes.push(...normalized);
  else buckets.set(key, { name, costumes: normalized });
}

/** Character + wardrobe rows from new_costumes, new_characters, and shot picks. */
export function collectCostumePairs(input: {
  new_costumes?: unknown;
  new_characters?: unknown;
  shots?: readonly { characters?: unknown[] | null }[] | null;
} = {}): CostumePair[] {
  const buckets = new Map<string, CostumePair>();
  for (const raw of Array.isArray(input.new_costumes) ? input.new_costumes : []) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as { name?: unknown; costumes?: unknown };
    pushCostumeRows(buckets, row.name, row.costumes);
  }
  for (const raw of Array.isArray(input.new_characters) ? input.new_characters : []) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Partial<Record<CostumeField, unknown>> & { name?: unknown; costumes?: unknown; costume?: unknown };
    if (Array.isArray(row.costumes) && row.costumes.length) pushCostumeRows(buckets, row.name, row.costumes);
    if (row.costume && typeof row.costume === 'object' && !Array.isArray(row.costume)) {
      pushCostumeRows(buckets, row.name, row.costume);
    } else if (costumePickReadable(row.costume) && COSTUME_FIELDS.some(k => row[k] != null)) {
      pushCostumeRows(buckets, row.name, {
        ...Object.fromEntries(COSTUME_FIELDS.filter(k => row[k] != null).map(k => [k, row[k]])),
        name: row.costume,
        attire: row.attire,
        bottoms: row.bottoms,
        accessories: row.accessories,
      });
    }
  }
  for (const shot of input.shots || []) {
    for (const raw of Array.isArray(shot?.characters) ? shot.characters! : []) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Partial<Record<CostumeField, unknown>> & { name?: unknown; costume?: unknown };
      if (row.costume && typeof row.costume === 'object' && !Array.isArray(row.costume)) {
        pushCostumeRows(buckets, row.name, row.costume);
        continue;
      }
      if (costumePickReadable(row.costume) && COSTUME_FIELDS.some(k => row[k] != null)) {
        pushCostumeRows(buckets, row.name, {
          ...Object.fromEntries(COSTUME_FIELDS.filter(k => row[k] != null).map(k => [k, row[k]])),
        name: row.costume,
          attire: row.attire,
          bottoms: row.bottoms,
          accessories: row.accessories,
        });
      }
    }
  }
  return [...buckets.values()];
}

/** Last created costume name per character (lowercased key). */
export function createdCostumeWearByName(pairs: readonly CostumePair[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of pairs || []) {
    const last = pair.costumes[pair.costumes.length - 1];
    const name = cleanText(pair.name, 200);
    const wear = cleanText(last?.name, 80);
    if (name && wear) out.set(name.toLowerCase(), wear);
  }
  return out;
}

/** Wear newly paired costumes on shots that omitted a pick. Explicit picks win. */
export function applyCreatedCostumesToShots<T extends ShotCostumeLike>(
  shots: T[],
  wearByName: ReadonlyMap<string, string>,
): void {
  if (!wearByName?.size) return;
  for (const shot of shots || []) {
    const chars = Array.isArray(shot.characters) ? shot.characters : [];
    for (const ch of chars) {
      if (!ch || typeof ch !== 'object') continue;
      const name = cleanText(ch.name, 200);
      if (!name) continue;
      const wear = wearByName.get(name.toLowerCase());
      if (!wear) continue;
      if (ch.costume && typeof ch.costume === 'object' && !Array.isArray(ch.costume)) {
        const row = normalizeCostume(ch.costume, 0);
        ch.costume = row?.name || wear;
        continue;
      }
      if (!costumePickReadable(ch.costume)) ch.costume = wear;
    }
  }
}

/**
 * Walk shots like wear_state. Empty / omitted `costume` inherit the running
 * pick, then roster `active_costume`. Bakes that pick onto each char.
 */
export function applyCostumeContinuityToShots<T extends ShotCostumeLike>(
  shots: T[],
  previousForName: (name: string) => unknown,
): Map<string, unknown> {
  const running = new Map<string, unknown>();
  const last = new Map<string, unknown>();
  for (const shot of shots || []) {
    const chars = Array.isArray(shot.characters) ? shot.characters : [];
    for (const ch of chars) {
      if (!ch || typeof ch !== 'object') continue;
      const name = cleanText(ch.name, 200);
      if (!name) continue;
      const key = name.toLowerCase();
      const next = costumePickReadable(ch.costume)
        ? ch.costume
        : (running.has(key) ? running.get(key) : previousForName(name));
      if (costumePickReadable(next)) {
        ch.costume = next as string | number;
        running.set(key, next);
        last.set(key, next);
      }
    }
  }
  return last;
}

/** Compact catalog line for LLM inject: `default[0] casual school uniform; swimsuit[1] bikini`. */
export function formatCostumeCatalog(costumes: CharacterCostume[] | null | undefined): string {
  const { costumes: list } = ensureCostumes({ costumes: costumes || [] });
  return list
    .map((c, i) => {
      const note = cleanText(c.note, 60);
      const clothes = COSTUME_FIELDS.map(k => c[k] && c[k] !== '[base]' ? `${k}:${cleanText(c[k], 80)}` : '').filter(Boolean).join(' / ');
      return [ `${c.name}[${i}]`, note, clothes].filter(Boolean).join(' ');
    })
    .join('; ');
}

/**
 * Merge incoming costume rows into existing. Never overwrites index 0 when
 * `protectDefault` (filled characters). Same-name rows deepen tags if longer.
 */
export function mergeCostumeLists(
  existing: CharacterCostume[] | null | undefined,
  incoming: unknown,
  opts: { protectDefault?: boolean } = {},
): CharacterCostume[] {
  const base = ensureCostumes({ costumes: existing || [] }).costumes;
  const rawIn = Array.isArray(incoming) ? incoming : [];
  if (!rawIn.length) return base;

  const out = base.map((c) => ({ ...c }));
  const indexByName = new Map<string, number>();
  for (let i = 0; i < out.length; i++) {
    const k = costumeKey(out[i]!.name);
    if (k && !indexByName.has(k)) indexByName.set(k, i);
  }

  for (let i = 0; i < rawIn.length; i++) {
    const next = normalizeCostume(rawIn[i], out.length);
    if (!next) continue;
    const k = costumeKey(next.name);
    const hit = k ? indexByName.get(k) : undefined;
    if (hit != null) {
      if (opts.protectDefault && hit === 0) {
        continue;
      }
      for (const key of COSTUME_FIELDS) {
        if (next[key] !== undefined && next[key] !== '[base]') out[hit]![key] = next[key];
      }
      if (next.note && !cleanText(out[hit]!.note)) out[hit]!.note = next.note;
      continue;
    }
    indexByName.set(k || `idx${out.length}`, out.length);
    out.push(next);
  }
  return dedupeIdenticalCostumeTags(out, 0).costumes;
}

/** Sync active slot from attire/accessories textareas; keep other slots. */
export function syncActiveCostumeFromWear(
  costumes: CharacterCostume[],
  active: number,
  wear: { attire?: unknown; bottoms?: unknown; accessories?: unknown },
): CharacterCostume[] {
  const { costumes: list, active_costume } = ensureCostumes({ costumes, active_costume: active });
  const out = list.map((c) => ({ ...c }));
  const i = active_costume;
  out[i] = {
    ...out[i]!,
    attire: cleanText(wear.attire, 4000),
    bottoms: cleanText(wear.bottoms, 4000),
    accessories: cleanText(wear.accessories, 4000),
  };
  return out;
}
