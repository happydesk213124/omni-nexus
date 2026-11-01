import type { TtsSegment } from '../../core/tts-types';
import { costumeKey } from '../character/costume';

/**
 * `하린_melony_form`: a cue that names the costume by its name instead of its number (a model does, now and then).
 * It is split at the underscore where the part before is someone known and the rest one of their costume names,
 * compared as costume names are (no case, spaces, underscores or dashes). A whole name that is someone (Dark_Knight)
 * is never split, and neither is one whose rest names none of their costumes.
 *
 * `costumesOf`: for a name, the costume names of the one it is, by their numbers ([] with none known); undefined
 * for no one.
 */
export type CostumesOf = (name: string) => readonly string[] | undefined;

export function costumeCue(speaker: string, costumesOf: CostumesOf): { speaker: string; costume: number } | null {
  if (!speaker.includes('_') || costumesOf(speaker)) return null;
  for (let at = speaker.indexOf('_'); at > 0; at = speaker.indexOf('_', at + 1)) {
    const name = speaker.slice(0, at).trim(), want = costumeKey(speaker.slice(at + 1)), names = name && want ? costumesOf(name) : undefined;
    const costume = names ? names.findIndex(costume => costumeKey(costume) === want) : -1;
    if (costume >= 0) return { speaker: name, costume };
  }
  return null;
}

/** The lines whose cue named a costume by its name: their speaker, and that costume's number (0, the default, as none). */
export function namedCostumes(segments: TtsSegment[], costumesOf: CostumesOf): TtsSegment[] {
  return segments.map(segment => {
    const cue = segment.speaker && segment.costume === undefined ? costumeCue(segment.speaker, costumesOf) : null;
    return cue ? { ...segment, speaker: cue.speaker, ...(cue.costume ? { costume: cue.costume } : {}) } : segment;
  });
}
