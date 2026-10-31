import { risuHost } from '../core/host';
import { psGet, psSet } from './device-store';

/**
 * Where the reader left each chat in 옴니 뷰어, kept on this device (Risu's local plugin
 * store) rather than in the save file. It changes with every line read, and Risu answers
 * each save-file write by rewriting its whole plugin index a second later (on a phone
 * served by a PC, uploading it too): a hitch after every pause in reading. Marks an
 * older version kept in the save file are read once, as where to start.
 */
const MARKS_KEY = 'omniviewer.marks';
let device: Promise<SafeLocalPluginStorage | null> | undefined;
const local = (): Promise<SafeLocalPluginStorage | null> =>
  device ??= Promise.resolve(risuHost()?.getLocalPluginStorage?.()).then(api => api ?? null, () => null);

export async function loadViewerMarks(): Promise<unknown> {
  const api = await local();
  const kept = api ? await api.getItem<unknown>(MARKS_KEY).catch(() => null) : null;
  if (kept && typeof kept === 'object') return kept;
  return psGet(MARKS_KEY).catch(() => null);
}

/** A Risu with no local store keeps them where they always were. */
export async function saveViewerMarks(marks: unknown): Promise<void> {
  const api = await local();
  if (api) await api.setItem(MARKS_KEY, marks);
  else await psSet(MARKS_KEY, marks);
}
