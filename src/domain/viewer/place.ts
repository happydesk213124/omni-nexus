import { compactHash } from '../tts/segment';
import { inlineCastBlock, inlineCastPlace, inlineShotBlocks, inlineShotTagged } from '../prompt/inline-shots';
import { PLACE_MARKER_SOURCE } from '../prompt/inline-shot-pattern';

export { PLACE_MARKER_SOURCE };

/**
 * A reply's places. The writer marks a scene's place like a BGM cue, on a line of
 * its own: `[[place:cafe, indoors, window, daytime]]`. 옴니 뷰어 changes the stage
 * there; the chat never shows it (⚛️ omni place hides it) and TTS never reads it.
 */
/** One background per place: its tags, lowercased, without repeats, in order. */
export const placeKey = (place: string): string => [...new Set(String(place || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 16).join(', ');
/** The same place: the same tags, in any order. */
export function samePlace(a: string, b: string): boolean {
  const x = new Set(placeKey(a).split(', ').filter(Boolean)), y = new Set(placeKey(b).split(', ').filter(Boolean));
  return x.size > 0 && x.size === y.size && [...x].every(tag => y.has(tag));
}

/** The place marks in a text, in order, with where each one stands. */
export function placeMarkers(text: string): Array<{ at: number; place: string }> {
  return [...String(text || '').matchAll(new RegExp(PLACE_MARKER_SOURCE, 'gi'))]
    .map(hit => ({ at: hit.index ?? 0, place: placeKey(hit[1]!) })).filter(mark => mark.place);
}
/** The place at an offset of the text: the last mark before it; '' when none comes before. */
export function placeAt(marks: ReadonlyArray<{ at: number; place: string }>, offset: number): string {
  let place = '';
  for (const mark of marks) { if (mark.at > offset) break; place = mark.place; }
  return place;
}

/**
 * A background's asset name on the bot: \`omni_bg_\` and its tags, so it never mixes with
 * the bot's own assets and is found again by name. A very long place: its hash.
 */
export function backgroundName(place: string, ext: string): string {
  const k = placeKey(place);
  return `omni_bg_${k.length <= 180 ? k : compactHash(k).slice(0, 12)}.${ext.replace(/[^a-z0-9]/gi, '') || 'webp'}`;
}
/** A name that holds a place's hash (a very long place, or the first backgrounds), not its tags. */
export const hashedPlace = (named: string): boolean => named.length <= 12 && /^[0-9a-f]{1,8}-[0-9a-f]*$/i.test(named);
/** The place an asset name holds: \`omni_bg_<tags>\` (or the older \`bg_<tags>\`); '' for any other asset. */
export function backgroundPlace(name: string): string {
  const hit = /^(?:omni_)?bg_(.+)$/i.exec(String(name || '').replace(/\.[a-z0-9]{2,5}$/i, ''));
  return hit ? hit[1]!.trim() : '';
}

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

/** ⚛️ omni place: the writer's instruction, and the chat rule that hides the marks. */
export const PLACE_MODULE = { id: 'omni-place', name: '⚛️ omni place', description: '장면 장소 [[place:…]]. 채팅에는 보이지 않고, 옴니 뷰어가 배경으로 씁니다.' } as const;
export const PLACE_PROMPT = `@@depth 0
<OmniPlace>
Scene place: at the start of every reply, and whenever the scene moves to another place, write that place as Danbooru-style English tags on a line of its own, just before the first narration or dialogue line there, e.g.
[[place:cafe, indoors, window, daytime]]
Use two to six plain tags: the kind of place first, then indoors or outdoors, a notable feature or two, the time of day. Write it again only when the place changes (at most three per reply). Never put it inside a narration or dialogue line, quotes or code. Never explain it.
</OmniPlace>`;
export function placeModule(): RisuModule {
  const book = { key: '', secondkey: '', comment: 'omni-place-cues', content: PLACE_PROMPT, mode: 'normal', insertorder: 996, alwaysActive: true, selective: false, useRegex: false, bookVersion: 2 };
  // The mark and its line go from the chat (the message keeps it: the viewer and the next reply read it).
  const hide = { comment: 'omni-place-marker', type: 'editdisplay', ableFlag: true, flag: 'gi<order -10110,no_end_nl>', in: `${PLACE_MARKER_SOURCE}[ \\t]*\\n?`, out: '' };
  return { id: PLACE_MODULE.id, namespace: PLACE_MODULE.id, name: PLACE_MODULE.name, description: PLACE_MODULE.description, hideIcon: false, lowLevelAccess: false, backgroundEmbedding: '', trigger: [], lorebook: [book], regex: [hide], assets: [] } as unknown as RisuModule;
}
