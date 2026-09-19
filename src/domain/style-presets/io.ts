/**
 * Style-preset import/export for card.json and Risu lorebook_export JSON.
 *
 * Risu "로어북 내보내기" is `{ type: "risu", ver: 1, data: { "0": entry, … } }`.
 * Only entries whose content has `[Positive]` become presets; folders / prompt packs skip.
 */
import type { StylePreset } from '../../core/types.ts';
import { cleanText } from '../../core/util/text.ts';
import { optionalNaiSampler } from '../nai/samplers.ts';

export interface ParsedStylePreset {
  id: string;
  name: string;
  positive: string;
  negative: string;
  cfg_scale?: number | null;
  cfg_rescale?: number | null;
  sampler?: string | null;
}

/** Split `[Positive]…[Negative]…` like the frozen UI `ht()`. */
export function splitPositiveNegative(content: unknown): { positive: string; negative: string } | null {
  const text = String(content || '').replace(/\r\n/g, '\n');
  if (!/\[Positive\]/i.test(text)) return null;
  const posMatch = text.match(/\[Positive\]\s*([\s\S]*?)(?=\s*\[Negative\]|$)/i);
  const negMatch = text.match(/\[Negative\]\s*([\s\S]*?)\s*$/i);
  const positive = cleanText(posMatch?.[1] ?? '', 8000);
  const negative = cleanText(negMatch?.[1] ?? '', 8000);
  if (!positive && !negative) return null;
  return { positive, negative };
}

function presetId(name: string, index: number): string {
  const base =
    String(name || 'preset')
      .toLowerCase()
      .replace(/[^a-z0-9\uac00-\ud7a3]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'preset';
  const rand = Math.random().toString(36).slice(2, 7);
  return `${base}_${index}_${rand}`;
}

function pushUnique(out: ParsedStylePreset[], row: ParsedStylePreset | null): void {
  if (!row) return;
  const key = `${row.name}::${row.positive.slice(0, 80)}`;
  if (out.some((p) => `${p.name}::${p.positive.slice(0, 80)}` === key)) return;
  out.push(row);
}

function fromPresetObject(raw: unknown, index: number): ParsedStylePreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const name = cleanText(rec.name ?? rec.comment ?? rec.title ?? `프리셋 ${index + 1}`, 200);
  let positive = cleanText(rec.positive ?? rec.pos ?? '', 8000);
  let negative = cleanText(rec.negative ?? rec.neg ?? '', 8000);
  if (!positive && !negative && typeof rec.content === 'string') {
    const split = splitPositiveNegative(rec.content);
    if (!split) return null;
    positive = split.positive;
    negative = split.negative;
  }
  if (!positive && !negative) return null;
  const cfg =
    rec.cfg_scale == null || rec.cfg_scale === ''
      ? null
      : Number(rec.cfg_scale);
  const rescale =
    rec.cfg_rescale == null || rec.cfg_rescale === ''
      ? null
      : Number(rec.cfg_rescale);
  return {
    id: cleanText(rec.id, 200) || presetId(name, index),
    name: name || `프리셋 ${index + 1}`,
    positive,
    negative,
    cfg_scale: cfg != null && Number.isFinite(cfg) ? cfg : null,
    cfg_rescale: rescale != null && Number.isFinite(rescale) ? rescale : null,
    sampler: optionalNaiSampler(rec.sampler),
  };
}

function isFolderEntry(entry: Record<string, unknown>): boolean {
  const mode = cleanText(entry.mode, 40).toLowerCase();
  const key = cleanText(entry.key ?? entry.keys ?? '', 2000);
  return mode === 'folder' || key.startsWith('\uf000folder:');
}

function fromLoreEntry(entry: unknown, index: number): ParsedStylePreset | null {
  if (!entry || typeof entry !== 'object') return null;
  const rec = entry as Record<string, unknown>;
  if (isFolderEntry(rec)) return null;
  const content = String(rec.content ?? rec.data ?? '');
  const split = splitPositiveNegative(content);
  if (!split) return null;
  const name = cleanText(rec.comment ?? rec.name ?? `프리셋 ${index + 1}`, 200);
  return {
    id: presetId(name, index),
    name: name || `프리셋 ${index + 1}`,
    positive: split.positive,
    negative: split.negative,
    cfg_scale: null,
    cfg_rescale: null,
  };
}

/** Collect lore entries from card.json or lorebook_export `data`. */
function collectLoreEntries(root: Record<string, unknown>): unknown[] {
  const book =
    (root.data as Record<string, unknown> | undefined)?.character_book
    ?? root.character_book
    ?? (root.data as Record<string, unknown> | undefined)?.characterBook;
  if (book && typeof book === 'object') {
    const entries = (book as Record<string, unknown>).entries;
    if (Array.isArray(entries)) return entries;
  }

  const type = cleanText(root.type, 40).toLowerCase();
  const data = root.data;
  if ((type === 'risu' || type === 'lorebook' || type === '') && data && typeof data === 'object' && !Array.isArray(data)) {
    // lorebook_export: numeric-string keys; also accept plain array under data
    const values = Object.keys(data as object)
      .sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)))
      .map((k) => (data as Record<string, unknown>)[k]);
    if (values.length) return values;
  }
  if (Array.isArray(data)) return data;
  if (Array.isArray(root.lorebook)) return root.lorebook;
  if (Array.isArray(root.entries)) return root.entries;
  return [];
}

/**
 * Parse pasted/file JSON (or raw `[Positive]` text) into style presets.
 * Supports: `{presets:[…]}`, card.json character_book, Risu lorebook_export.
 */
export function parseStylePresetsFromJson(input: unknown): ParsedStylePreset[] {
  const out: ParsedStylePreset[] = [];

  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) return [];
    if (!text.startsWith('{') && !text.startsWith('[') && /\[Positive\]/i.test(text)) {
      const split = splitPositiveNegative(text);
      if (!split) return [];
      return [
        {
          id: presetId('가져온 프리셋', 0),
          name: '가져온 프리셋',
          positive: split.positive,
          negative: split.negative,
        },
      ];
    }
    try {
      return parseStylePresetsFromJson(JSON.parse(text));
    } catch {
      return [];
    }
  }

  if (Array.isArray(input)) {
    input.forEach((row, i) => pushUnique(out, fromPresetObject(row, i) || fromLoreEntry(row, i)));
    return out;
  }

  if (!input || typeof input !== 'object') return [];
  const root = input as Record<string, unknown>;

  if (Array.isArray(root.presets)) {
    root.presets.forEach((row, i) => pushUnique(out, fromPresetObject(row, i)));
    if (out.length) return out;
  }

  const lore = collectLoreEntries(root);
  lore.forEach((entry, i) => pushUnique(out, fromLoreEntry(entry, i)));
  return out;
}

/** Risu lorebook_export envelope for style presets (importable back into Risu / Inlay). */
export function toLorebookExport(
  presets: readonly StylePreset[] | readonly ParsedStylePreset[],
): { type: 'risu'; ver: number; data: Record<string, Record<string, unknown>> } {
  const data: Record<string, Record<string, unknown>> = {};
  let i = 0;
  for (const raw of presets || []) {
    if (!raw || typeof raw !== 'object') continue;
    const name = cleanText(raw.name, 200);
    const positive = cleanText(raw.positive, 8000);
    const negative = cleanText(raw.negative, 8000);
    if (!name && !positive && !negative) continue;
    const content = `[Positive]\n${positive}\n\n[Negative]\n${negative}`.trim();
    data[String(i)] = {
      key: '',
      comment: name || `프리셋 ${i + 1}`,
      content,
      mode: 'normal',
      insertorder: 100 + i,
      alwaysActive: false,
      secondkey: '',
      selective: false,
      useRegex: false,
      bookVersion: 2,
    };
    i += 1;
  }
  return { type: 'risu', ver: 1, data };
}

/** Legacy Inlay `{ presets, active_preset_id }` export. */
export function toPresetsJson(
  presets: readonly StylePreset[] | readonly ParsedStylePreset[],
  activePresetId = '',
): { presets: ParsedStylePreset[]; active_preset_id: string } {
  const list: ParsedStylePreset[] = [];
  for (const raw of presets || []) {
    const row = fromPresetObject(raw, list.length);
    if (row) list.push(row);
  }
  return {
    presets: list,
    active_preset_id: cleanText(activePresetId, 200) || list[0]?.id || '',
  };
}
