import { AUTHOR_NOTE_PRESETS_KEY } from '../core/constants';
import type { ApiResult } from '../core/types';
import { authorNotePresetExamples, normalizeAuthorNotePresets } from '../domain/tagging/author-note-presets';
import { psGet, psSet } from '../storage/device-store';

/** Saved presets first, then the shipped examples (read-only, never stored). */
export async function listAuthorNotePresets(): Promise<ApiResult> {
  const items = normalizeAuthorNotePresets(await psGet(AUTHOR_NOTE_PRESETS_KEY));
  return { ok: true, items: [...items, ...authorNotePresetExamples()] };
}

/** Replaces the saved list; examples sent back by the UI are dropped, not stored. */
export async function saveAuthorNotePresets(items: unknown): Promise<ApiResult> {
  const next = normalizeAuthorNotePresets(items);
  await psSet(AUTHOR_NOTE_PRESETS_KEY, { items: next });
  return { ok: true, items: [...next, ...authorNotePresetExamples()] };
}
