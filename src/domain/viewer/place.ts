import { inlineCastBlock, inlineCastPlace, inlineShotBlocks, inlineShotTagged } from '../prompt/inline-shots';

/**
 * Where a reply opens, from its own blocks as they close in the stream: its cast
 * block's place, else the first picture's location that says one (a shot may leave
 * it out to keep the last). '' while none has closed yet.
 */
export function streamingPlace(text: string): string {
  const cast = inlineCastBlock(text, { live: true });
  const opened = cast ? inlineCastPlace(cast.body) : '';
  if (opened) return opened;
  for (const block of inlineShotBlocks(text, { live: true })) {
    const shot = inlineShotTagged(block.body, 0)?.scenes?.[0]?.shots?.[0] as { location?: unknown } | undefined;
    const location = typeof shot?.location === 'string' ? shot.location.trim() : '';
    if (location) return location.slice(0, 400);
  }
  return '';
}
