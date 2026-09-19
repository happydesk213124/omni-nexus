/**
 * Character-lore whitelist (lorefilter): pick lore entries by stable id, then
 * still run normal message-trigger matching inside that set.
 */
import type { LoreEntry } from '../../core/types.ts';
import { cleanText, normalizeAlias } from '../../core/util/text.ts';
import { isCharacterImageExtraLore } from './extra.ts';
import { loreEntryKeys } from './assemble.ts';

export interface LoreCatalogItem {
  id: string;
  title: string;
  keys: string[];
  /** Entry body for peek UI (readonly). */
  content: string;
}

/** Stable id for one lore entry (title preferred, else key set). */
export function loreEntryId(entry: LoreEntry | null | undefined): string {
  if (!entry || typeof entry !== 'object') return '';
  const title = cleanText(entry.comment || entry.name || '', 200);
  if (title) return `t:${normalizeAlias(title)}`;
  const keys = loreEntryKeys(entry);
  if (!keys.length) return '';
  return `k:${normalizeAlias(keys.join('|')).slice(0, 160)}`;
}

/** Short label for UI / LLM title scan. */
export function loreEntryTitle(entry: LoreEntry | null | undefined): string {
  if (!entry || typeof entry !== 'object') return '';
  const title = cleanText(entry.comment || entry.name || '', 200);
  if (title) return title;
  const keys = loreEntryKeys(entry);
  return keys.slice(0, 3).join(', ');
}

/** Catalog rows from a lorebook (folders + lb-xnai.lb.extra skipped). */
export function buildLoreCatalog(entries: LoreEntry[] | null | undefined): LoreCatalogItem[] {
  const out: LoreCatalogItem[] = [];
  const seen = new Set<string>();
  for (const entry of entries || []) {
    if (!entry || typeof entry !== 'object') continue;
    if (isCharacterImageExtraLore(entry)) continue;
    const mode = cleanText(entry.mode || '', 40).toLowerCase();
    const keyRaw = cleanText(entry.key || '', 2000);
    if (mode === 'folder' || keyRaw.startsWith('\uf000folder:')) continue;
    const id = loreEntryId(entry);
    const title = loreEntryTitle(entry);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title,
      keys: loreEntryKeys(entry),
      content: cleanText(entry.content || entry.data || '', 12000),
    });
  }
  return out;
}

/** Normalize stored selected ids (drop empties, dedupe). */
export function normalizeLorefilterSelected(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[,，\n\r]+/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const id = cleanText(item, 240);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Keep lb-xnai extras always; keep others only when id ∈ selected.
 * Empty selected or zero matches among others → return entries unchanged (fail-open).
 */
export function filterLoreEntriesBySelected(
  entries: LoreEntry[] | null | undefined,
  selectedRaw: unknown,
): LoreEntry[] {
  const list = Array.isArray(entries) ? entries : [];
  const selected = new Set(normalizeLorefilterSelected(selectedRaw));
  if (!selected.size) return list.slice();

  const extras: LoreEntry[] = [];
  const others: LoreEntry[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    if (isCharacterImageExtraLore(entry)) extras.push(entry);
    else others.push(entry);
  }

  const kept = others.filter((entry) => {
    const id = loreEntryId(entry);
    return id && selected.has(id);
  });
  if (!kept.length) return list.slice();
  return [...extras, ...kept];
}

/**
 * Map LLM-returned display names onto catalog ids (title / alias / compact includes).
 */
export function matchCatalogIdsFromNames(
  catalog: LoreCatalogItem[],
  names: readonly unknown[],
): string[] {
  const wanted = names
    .map((n) => normalizeAlias(cleanText(n, 200)))
    .filter((n) => n.length >= 2);
  if (!wanted.length || !catalog.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of catalog) {
    const title = normalizeAlias(item.title);
    const keyBlob = normalizeAlias(item.keys.join(' '));
    const hit = wanted.some(
      (w) => title === w || title.includes(w) || w.includes(title) || keyBlob.includes(w),
    );
    if (!hit || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item.id);
  }
  return out;
}

/** Parse LLM JSON array of strings (tolerant of markdown fences). */
export function parseLorefilterNameArray(raw: unknown): string[] {
  const text = String(raw || '').trim();
  if (!text) return [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence?.[1] || text).trim();
  const arrMatch = body.match(/\[[\s\S]*\]/);
  if (!arrMatch) return [];
  try {
    const parsed = JSON.parse(arrMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((n) => cleanText(n, 200)).filter(Boolean);
  } catch {
    return [];
  }
}
