/**
 * Session place tags: omit on a shot to keep the last location (like wear_state).
 */
import { cleanText } from '../../core/util/text.ts';

export const LOCATION_TAG_LIMIT = 800;

export function cleanLocationTags(raw: unknown): string {
  return cleanText(raw, LOCATION_TAG_LIMIT).replace(/,\s*$/, '');
}

export function formatPrevLocationLine(raw: unknown): string {
  const loc = cleanLocationTags(raw);
  return `prev_location: ${loc || '(none)'}`;
}

type ShotLike = { location?: unknown };

/** Bake omitted shot.location from the running session/previous shot value. */
export function applyLocationContinuityToShots<T extends ShotLike>(
  shots: T[],
  previous: unknown,
): string {
  let running = cleanLocationTags(previous);
  for (const shot of shots || []) {
    if (!shot || typeof shot !== 'object') continue;
    const next = cleanLocationTags(shot.location) || running;
    if (next) shot.location = next;
    else delete shot.location;
    running = next;
  }
  return running;
}
