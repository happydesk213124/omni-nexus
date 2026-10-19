import { AUTHOR_NOTE_PRESETS_KEY } from '../core/constants';
import type { ApiResult } from '../core/types';
import { promptText } from '../config/prompts';
import { AUTHOR_NOTE_PRESET_TEXT_LIMIT, authorNotePresetExamples, normalizeAuthorNotePresets, type AuthorNotePreset } from '../domain/tagging/author-note-presets';
import { psGet, psSet } from '../storage/device-store';
import { getPrompt } from './settings';

const same = (a: string, b: string) => a.replace(/\r\n/g, '\n').trim() === b.replace(/\r\n/g, '\n').trim();
const clipText = (value: unknown) => String(value ?? '').replace(/\r\n/g, '\n').slice(0, AUTHOR_NOTE_PRESET_TEXT_LIMIT);
const clipId = (value: unknown) => String(value ?? '').trim().slice(0, 80);
/** The 직접 입력 entry of the picker: the user's own note, which no pick ever overwrites. */
export const CUSTOM_NOTE_ID = 'custom';

/** The shipped note, so picking it always gives back what the note was before any preset. */
function examples(): AuthorNotePreset[] {
  const shipped = promptText('author_note');
  return [...(shipped.trim() ? [{ id: 'example-default', name: '기존 노트 (기본값)', text: shipped, builtin: true }] : []), ...authorNotePresetExamples()];
}

type Stored = { items: AuthorNotePreset[]; custom: string; selected: string };

/**
 * Saved presets, the 직접 입력 text and which entry is picked. A save from before
 * 직접 입력 existed (or none at all) is upgraded once: the note written by hand,
 * else the 「내 기존 노트」 kept on the first run, becomes 직접 입력, so going back
 * to one's own writing is always one pick away.
 */
async function load(): Promise<Stored> {
  const raw = await psGet(AUTHOR_NOTE_PRESETS_KEY);
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const items = normalizeAuthorNotePresets(raw);
  if (rec && typeof rec.custom === 'string') return { items, custom: clipText(rec.custom), selected: clipId(rec.selected) || CUSTOM_NOTE_ID };
  const note = await getPrompt('author_note');
  const all = [...items, ...examples()];
  const own = note.trim() && !all.some(row => same(row.text, note)) ? note : '';
  const kept = items.find(row => row.id.startsWith('kept-'));
  const match = all.find(row => same(row.text, note));
  const stored = { items, custom: clipText(own || kept?.text || ''), selected: own || !match ? CUSTOM_NOTE_ID : match.id };
  await psSet(AUTHOR_NOTE_PRESETS_KEY, stored);
  return stored;
}

const shape = (stored: Stored): ApiResult => ({ ok: true, items: [...stored.items, ...examples()], custom: stored.custom, selected: stored.selected });

/** Saved presets first, then the shipped ones (read-only, never stored), with 직접 입력 and the pick. */
export async function listAuthorNotePresets(): Promise<ApiResult> {
  return shape(await load());
}

/**
 * Updates what the body names: `items` (examples sent back are dropped, not stored),
 * `custom` (직접 입력) and `selected`. A bare array is a list of presets.
 */
export async function saveAuthorNotePresets(body: unknown): Promise<ApiResult> {
  const current = await load();
  const rec = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const items = Array.isArray(body) ? body : rec.items;
  const next: Stored = {
    items: items !== undefined ? normalizeAuthorNotePresets(items) : current.items,
    custom: typeof rec.custom === 'string' ? clipText(rec.custom) : current.custom,
    selected: typeof rec.selected === 'string' ? clipId(rec.selected) || CUSTOM_NOTE_ID : current.selected,
  };
  await psSet(AUTHOR_NOTE_PRESETS_KEY, next);
  return shape(next);
}

/** What a settings file carries: the saved presets, 직접 입력 and the pick (examples ship with the plugin). */
export async function exportAuthorNotePresets(): Promise<Stored> {
  const stored = await load();
  return { items: stored.items, custom: stored.custom, selected: stored.selected };
}

/** A file from a version with 직접 입력: restored as it was. */
export async function restoreAuthorNotePresets(raw: unknown): Promise<void> {
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  await saveAuthorNotePresets({ items: Array.isArray(rec.items) ? rec.items : [], custom: typeof rec.custom === 'string' ? rec.custom : '', selected: typeof rec.selected === 'string' ? rec.selected : CUSTOM_NOTE_ID });
}

/**
 * A file from before 직접 입력 only carries the note itself. That note is the
 * user's own writing, so it becomes 직접 입력 and is picked; one that is exactly
 * a preset's or example's text picks that entry and leaves 직접 입력 alone.
 */
export async function adoptImportedAuthorNote(): Promise<void> {
  const note = await getPrompt('author_note');
  const stored = await load();
  const match = note.trim() ? [...stored.items, ...examples()].find(row => same(row.text, note)) : undefined;
  await saveAuthorNotePresets(match ? { selected: match.id } : { custom: note, selected: CUSTOM_NOTE_ID });
}
