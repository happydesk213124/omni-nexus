import type { ApiResult } from '../core/types';
import { splitSettingsDocPrompts } from '../config/schema';
import { shareableJson } from './export';
import { exportSettingsJson, importPromptsPack, importSettingsJson, parsePromptsImport } from './settings';
import { adoptImportedAuthorNote, exportAuthorNotePresets, restoreAuthorNotePresets } from './author-note-presets';

/**
 * The header EXPORT / IMPORT and the prompts tab import, with the main author's
 * note picker riding along. Kept apart from settings.ts, which the presets read
 * the note through.
 */
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export async function exportSettingsFile(): Promise<string> {
  const doc = JSON.parse(await exportSettingsJson()) as Record<string, unknown>;
  doc.author_note_presets = await exportAuthorNotePresets();
  return shareableJson(doc);
}

/** A file with the picker restores it; an older one puts its note into 직접 입력. */
export async function afterAuthorNoteImport(presets: unknown, noteImported: boolean): Promise<void> {
  if (object(presets)) await restoreAuthorNotePresets(presets);
  else if (noteImported) await adoptImportedAuthorNote();
}

export async function importSettingsFile(json: string): Promise<ApiResult> {
  let doc: Record<string, unknown> | null = null;
  try { doc = object(JSON.parse(String(json ?? ''))); } catch { /* importSettingsJson reports it */ }
  const presets = doc?.author_note_presets;
  let text = String(json ?? '');
  // Not a setting: it never reaches the settings import.
  if (doc && 'author_note_presets' in doc) { delete doc.author_note_presets; text = JSON.stringify(doc); }
  const prompts = doc ? splitSettingsDocPrompts(doc).prompts : null;
  const result = await importSettingsJson(text);
  await afterAuthorNoteImport(presets, !!prompts && Object.prototype.hasOwnProperty.call(prompts, 'author_note'));
  return result;
}

export async function importPromptsFile(raw: unknown): Promise<ApiResult> {
  let noteImported = false;
  try { noteImported = Object.prototype.hasOwnProperty.call(parsePromptsImport(raw), 'author_note'); } catch { /* importPromptsPack reports it */ }
  const result = await importPromptsPack(raw);
  if (noteImported) await adoptImportedAuthorNote();
  return result;
}
