/**
 * The comic prompt as the main tagger gets it (만화 페이지 메인 태거와 함께). The same prompt also drives the separate
 * comic call, which needs every line; beside the main tagger's rules some of it is said twice, on every request. A line
 * is dropped or shortened only when it is still the shipped default word for word: a line the user rewrote is theirs
 * and goes as written. tests/comic-main-pack.test.mjs fails when prompts/comic.txt stops carrying these lines.
 */
const norm = (line: string) => line.trim().replace(/\s+/g, ' ');

/** Shipped line → what the main tagger gets instead ('' drops it). */
export const COMIC_MAIN_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  // The page lands in the shot's comic_page (the comic kind rules say so), never as a JSON of its own.
  ['Return raw JSON with pages, without markdown/commentary. Lay out each supplied comic shot as one page; follow supplied ordering. Copy its locked aspect (portrait/square/landscape).',
    'Lay out each comic shot as one page; copy its locked aspect (portrait/square/landscape).'],
  // The location rule (only on a change, one indoor/outdoor tag) is the shot's.
  ['Each page has shot_index, aspect, coords, cuts; optional location only on a change from prev_location, ending in exactly one indoor/outdoor tag.',
    'Each page has shot_index, aspect, coords, cuts; optional location as for a shot.'],
  // The shot characters' contact and wear_state rules, word for word in meaning.
  ['- Contact verbs: doer source, receiver target with the SAME active verb, never passive voice. Shared acts use mutual on both entries. At most one of these keys per entry; omit without contact; keep contact out of action.',
    '- source/target/mutual: as for shot characters.'],
  ['- wear_state = clothed/torn/topless/bottomless/nude/completely; only on change from previous state or earlier entries for that person.',
    '- wear_state: as for shot characters, earlier cuts counted.'],
  // The comic kind rules carry the same list for the separate tagger; written into the reply it means nothing.
  ['Ignore <img>, observation/insight/foreshadow blocks, <RP-Guide>, <AOS>, HTML comments and Upcoming lines.', ''],
];

const REPLACE = new Map(COMIC_MAIN_REPLACEMENTS.map(([from, to]) => [norm(from), to]));

export function comicPackForMainTagger(text: string): string {
  return text.split(/\r?\n/).flatMap(line => {
    const to = REPLACE.get(norm(line));
    return to === undefined ? [line] : to ? [to] : [];
  }).join('\n');
}
