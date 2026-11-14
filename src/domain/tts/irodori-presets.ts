import type { TtsVoice } from '../../core/tts-types';

/** An Irodori preset row as saved or imported: anything else in the list is dropped, never a reason to refuse the whole list. */
export function irodoriPresetRows(raw: unknown): TtsVoice[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value: unknown) => {
    const row = value && typeof value === 'object' ? value as Partial<TtsVoice> : null;
    if (!row || typeof row.key !== 'string' || !row.key || typeof row.name !== 'string' || typeof row.fishId !== 'string') return [];
    const gender: TtsVoice['gender'] = row.gender === 'female' || row.gender === 'male' ? row.gender : 'unknown';
    const tags = Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 40) : [];
    return [{ key: row.key, name: row.name.slice(0, 200), fishId: row.fishId.slice(0, 200), tags, gender, folder: '', ...(typeof row.caption === 'string' && row.caption ? { caption: row.caption.slice(0, 2000) } : {}) }];
  }).slice(0, 2000);
}
/**
 * The presets a file holds that this device does not: an export ({ irodoriVoices: [...] }) or a bare list. One
 * already here, by its key or by the server voice it names, is left as it is: the reader's own name and tags win.
 * Keys are kept, so a character that came along with the save still finds its preset. The recordings are not in the
 * file: they stay on the server (its voices folder), and a preset whose voice is not there reads as a 404.
 */
export function newIrodoriPresets(current: readonly TtsVoice[], file: unknown): TtsVoice[] {
  const rows = irodoriPresetRows(Array.isArray(file) ? file : file && typeof file === 'object' ? (file as { irodoriVoices?: unknown }).irodoriVoices : null);
  const keys = new Set(current.map(voice => voice.key)), ids = new Set(current.map(voice => voice.fishId)), fresh: TtsVoice[] = [];
  for (const row of rows) {
    if (!row.fishId.trim() || keys.has(row.key) || ids.has(row.fishId)) continue;
    keys.add(row.key); ids.add(row.fishId); fresh.push(row);
  }
  return fresh;
}
