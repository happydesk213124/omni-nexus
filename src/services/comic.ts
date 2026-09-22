/**
 * Second LLM: comic pages for shots the first tagger marked kind=comic.
 */
import type { CharacterRecord, TaggedShot } from '../core/types.ts';
import { cleanText } from '../core/util/text.ts';
import { parseJsonLoose } from '../core/util/object.ts';
import { resolveLlmRole } from '../domain/llm/roles.ts';
import { resolveCharacter } from '../domain/character/roster.ts';
import {
  formatComicCostumeCatalog,
  formatComicNowWearingBlock,
  resolveComicSlotCostume,
} from '../domain/comic/costume.ts';
import { comicProseBlockForLlm } from '../domain/comic/llm-prose.ts';
import { normalizeComicLlmBatch } from '../domain/comic/params.ts';
import { assignComicPagesToShots, attachInlineComicPages, parseComicPages, type ComicPage } from '../domain/comic/page.ts';
import { resolveShotAspect } from '../domain/nai-meta/aspect.ts';
import { callLlm } from './llm-call.ts';
import { getConfig } from './context.ts';
import { authorNoteSystemContent } from '../domain/tagging/session-note.ts';
import { getSessionAuthorNote, rosterWithSessionOutfits, sessionAuthorNoteLlmContent } from './session-author-note.ts';
import { getPrompt } from './settings.ts';
import { comicNaturalInstruction } from '../domain/comic/natural.ts';

function rosterBlock(
  names: string[],
  roster: CharacterRecord[],
  shotChars: Array<{ name?: unknown; costume?: unknown; wear_state?: unknown }> = [],
): string {
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = cleanText(raw, 200);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const rec = resolveCharacter(name, roster);
    const shot = shotChars.find((c) => cleanText(c?.name, 200).toLowerCase() === name.toLowerCase());
    const looks = cleanText(rec?.appearance || rec?.original || '', 800);
    const catalog = formatComicCostumeCatalog(rec || {});
    const wear = resolveComicSlotCostume(rec || {}, shot?.costume);
    const now = formatComicNowWearingBlock({
      costumeName: wear.name,
      wearState: shot?.wear_state ?? rec?.wear_state,
      accessories: wear.accessories,
    });
    blocks.push(
      `## ${name}\nlooks: ${looks || '(none)'}\n${now}\ncostumes (reference only):\n${catalog || '(none)'}`,
    );
  }
  return blocks.join('\n\n');
}

async function callComicLlm(user: string, extraNote: string, sessionId: unknown, signal?: AbortSignal): Promise<ComicPage[]> {
  const sys = (await getPrompt('comic')).trim();
  const globalNote = authorNoteSystemContent("Global Author's Note", await getPrompt('global_author_note'));
  const note = cleanText(extraNote, 8000);
  const sessMsg = await sessionAuthorNoteLlmContent(sessionId);
  const messages = [
    { role: 'system' as const, content: `${sys}\n\n${comicNaturalInstruction(getConfig().card.comic_natural_supplement === true)}` },
    ...(globalNote ? [{ role: 'system' as const, content: globalNote }] : []),
    ...(note
      ? [{
        role: 'system' as const,
        content: `# Priority: Comic author's note\n${note}\nIf this conflicts with earlier rules, follow this note (except never emit comic/manga/hatching/thick outlines).`,
      }]
      : []),
    ...(sessMsg ? [{ role: 'system' as const, content: sessMsg }] : []),
    { role: 'user' as const, content: user },
  ];
  const raw = await callLlm(resolveLlmRole(getConfig(), 'comic'), messages, { signal });
  return parseComicPages(parseJsonLoose(raw));
}

export async function fillComicPagesForShots(args: {
  shots: TaggedShot[];
  roster: CharacterRecord[];
  assistantText: unknown;
  sessionId?: unknown;
  chatSessionId?: unknown;
  signal?: AbortSignal;
}): Promise<Set<number>> {
  const { shots, assistantText } = args;
  let roster=args.roster;
  const sessionId = args.chatSessionId ?? args.sessionId;
  const card = getConfig().card || {};
  const note = cleanText(card.comic_author_note, 8000);
  const batch = normalizeComicLlmBatch(card.comic_llm_batch);
  const already = batch === 'with_main' ? attachInlineComicPages(shots) : new Set<number>();
  const comicIdx: number[] = [];
  for (let i = 0; i < shots.length; i += 1) {
    if (String(shots[i]?.kind || '').toLowerCase() !== 'comic') continue;
    if (already.has(i)) continue;
    comicIdx.push(i);
  }
  if (!comicIdx.length) return already;
  if (sessionId) roster=rosterWithSessionOutfits(roster,await getSessionAuthorNote(sessionId));

  const packOne = (i: number): string => {
    const shot = shots[i]!;
    const names = (shot.characters || []).map((c) => cleanText(c.name, 200)).filter(Boolean);
    const prose = comicProseBlockForLlm(assistantText, shot.line, shot.comic_line_end);
    return [
      `shot_index: ${i}`,
      `line: ${shot.line ?? ''}–${shot.comic_line_end ?? shot.line ?? ''}`,
      `aspect: ${resolveShotAspect(shot.aspect)} (locked by the first tagger — copy this, do not change it)`,
      `cast: ${names.join(', ') || '(none)'}`,
      `prev_location: ${cleanText(shot.location, 800) || '(none)'}`,
      rosterBlock(names, roster, shot.characters || []),
      `## prose\n${prose || '(empty)'}`,
    ].join('\n');
  };

  let pages: ComicPage[] = [];
  if (batch === 'per_shot') {
    for (const i of comicIdx) {
      try {
        const got = await callComicLlm(packOne(i), note, sessionId, args.signal);
        if (got[0]) got[0]!.shot_index = i;
        pages.push(...got);
      } catch (error) {
        if (args.signal?.aborted) throw error;
        /* this comic shot stays unassigned → skipped */
      }
    }
  } else {
    const body = comicIdx.map((i) => packOne(i)).join('\n\n----\n\n');
    pages = await callComicLlm(
      `Produce one page per comic shot below, in order.\n\n${body}`,
      note,
      sessionId,
      args.signal,
    );
  }
  const assigned = assignComicPagesToShots(shots, pages);
  for (const i of already) assigned.add(i);
  return assigned;
}
