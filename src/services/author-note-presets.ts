import { AUTHOR_NOTE_PRESETS_KEY } from '../core/constants';
import type { ApiResult } from '../core/types';
import { promptText } from '../config/prompts';
import { authorNotePresetExamples, normalizeAuthorNotePresets, type AuthorNotePreset } from '../domain/tagging/author-note-presets';
import { psGet, psSet } from '../storage/device-store';
import { getPrompt } from './settings';

const same = (a: string, b: string) => a.replace(/\r\n/g, '\n').trim() === b.replace(/\r\n/g, '\n').trim();

/** The shipped note, so picking it always gives back what the note was before any preset. */
function examples(): AuthorNotePreset[] {
  const shipped = promptText('author_note');
  return [...(shipped.trim() ? [{ id: 'example-default', name: '기존 노트 (기본값)', text: shipped, builtin: true }] : []), ...authorNotePresetExamples()];
}

/**
 * First run after the update: a note the user wrote themselves becomes a preset
 * before any pick can replace it. Runs once — the row exists afterwards, even empty.
 */
async function savedRows(): Promise<AuthorNotePreset[]> {
  const stored = await psGet(AUTHOR_NOTE_PRESETS_KEY);
  if (stored != null) return normalizeAuthorNotePresets(stored);
  const note = await getPrompt('author_note');
  const own = note.trim() && !examples().some(row => same(row.text, note));
  const items = own ? normalizeAuthorNotePresets([{ id: `kept-${Date.now().toString(36)}`, name: '내 기존 노트', text: note }]) : [];
  await psSet(AUTHOR_NOTE_PRESETS_KEY, { items });
  return items;
}

/** Saved presets first, then the shipped ones (read-only, never stored). */
export async function listAuthorNotePresets(): Promise<ApiResult> {
  return { ok: true, items: [...await savedRows(), ...examples()] };
}

/** Replaces the saved list; examples sent back by the UI are dropped, not stored. */
export async function saveAuthorNotePresets(items: unknown): Promise<ApiResult> {
  const next = normalizeAuthorNotePresets(items);
  await psSet(AUTHOR_NOTE_PRESETS_KEY, { items: next });
  return { ok: true, items: [...next, ...examples()] };
}
