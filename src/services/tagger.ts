/**
 * The tagging request: prose in, a scene/shot plan out.
 *
 * Almost everything below is prompt assembly, and the assembly *is* the
 * behaviour. Block order, the blank lines between blocks and the exact wording
 * were tuned against real model output, so the concatenations are reproduced
 * character-for-character and must not be reflowed or "tidied". Constraints:
 *
 *  - Stable how-to (tagger/format/inject rules/placement) is the leading
 *    system prefix so consecutive tagger calls can reuse an LLM prompt cache.
 *    Per-message lore, roster lines, asset soup, and the labeled chat are
 *    later user turns (`# Reference: …` then the L1| message).
 *  - The lorebook injection wraps the `lb-xnai.lb.extra` pack in explicit
 *    START/END markers. Without them models treat the ordinary matched lore that
 *    follows as image-tag ground truth and copy lore prose into appearance tags.
 *  - The `y_percent` instruction is emitted unconditionally even when the
 *    display toggle is off, because the value is persisted either way; the
 *    toggle only chooses between equal bands and the model's percentages.
 */

import { dbg } from '../core/debug';
import type { CharacterRecord, JobRequest, TaggedShot, TaggerResult } from '../core/types';
import { deepMerge } from '../core/util/object';
import { cleanText, stripCbs } from '../core/util/text';
import { filterTaggerContextMessages, stripBakeTokens } from '../domain/chat-bake';
import { normalizeAssetNaiTagsMode, normalizeFocusCharacterMode, normalizeFocusPromptMode, normalizeNaturalBaseMode, type NaturalBaseMode } from '../config/schema';
import type { FocusCharacterMode, FocusPromptMode } from '../core/types';
import { characterTriggers, dedupeShotCharacters, matchCharactersInText } from '../domain/character/roster';
import { characterHasAppearance, characterMaxLimit, formatWearStateForPrompt } from '../domain/character/tags';
import { normalizeEyeColorSlot, normalizeHairColorSlot } from '../domain/character/looks-fields';
import { ensureCostumes, formatCostumeCatalog } from '../domain/character/costume';
import {
  assembleLorebookForTagger,
  collectTriggeredLoreKeys,
  filledNamesForLoreExtra,
  normalizeLoreExtraMode,
} from '../domain/lore/assemble';
import { isCharacterImageExtraLore } from '../domain/lore/extra';
import type { LlmContentPart, LlmMessage } from '../providers/llm/transform';
import { applyComicKindGuard, comicGenOn } from '../domain/comic/kind';
import { attachInlineComicPages } from '../domain/comic/page';
import { resolveShotAspect } from '../domain/nai-meta/aspect';
import { comicLlmWithMain, normalizeComicGenRatio } from '../domain/comic/params';
import { hostHas, risuHost } from '../core/host';
import { mergeTaggerCharUserFields, pickSelectedPersona } from '../domain/tagging/char-user-info';
import { authorNoteSystemContent } from '../domain/tagging/session-note';
import { chatNoteSessionId, getSessionAuthorNote, rosterWithSessionOutfits, sessionAuthorNoteLlmContent } from './session-author-note';
import { formatPrevLocationLine } from '../domain/tagging/location';
import { normalizeComicAspect } from '../domain/comic/aspect';
import { numberMessageLinesForTagger, repairLazyShotLines } from '../domain/tagging/shot-line';
import { collectAssetNaiTags, setLastAssetWeightMap, type AssetLookPreview } from './asset-tags';
import { loadTaggerRoster, rosterForSession } from './characters';
import { cardFlagOn, taggerShouldUseV5Rules, normalizeV5NaturalLang } from '../domain/nai/routing';
import { getConfig } from './context';
import { getPrompt } from './settings';

/** The job request, as the tagger reads it. */
export type TaggerArgs = JobRequest;

/** Replace UI `personality` with the selected Risu persona; fill CharInfo from desc if empty. */
export async function hydrateTaggerCharUser(request: TaggerArgs): Promise<void> {
  const card = getConfig().card || {};
  const charInfoOn = Boolean(card.char_info);
  const userInfoOn = Boolean(card.user_info);
  let hostChar: { description?: unknown; desc?: unknown } | null = null;
  if (charInfoOn && !cleanText(request.character_description)) {
    if (hostHas('getCharacter')) {
      try {
        const c = await risuHost()!.getCharacter!();
        hostChar = c && typeof c === 'object' ? (c as { description?: unknown; desc?: unknown }) : null;
      } catch {
        hostChar = null;
      }
    }
  }
  let hostPersona: { personaPrompt?: unknown; note?: unknown } | null = null;
  if (userInfoOn && hostHas('getDatabase')) {
    try {
      const db = await risuHost()!.getDatabase!(['personas', 'selectedPersona']);
      hostPersona = pickSelectedPersona(db);
    } catch {
      hostPersona = null;
    }
  }
  const merged = mergeTaggerCharUserFields({
    charInfoOn,
    userInfoOn,
    requestChar: request.character_description,
    requestPersona: request.persona_description,
    hostChar,
    hostPersona,
  });
  request.character_description = merged.character_description;
  request.persona_description = merged.persona_description;
  dbg('tagger.char_user', {
    char_info: charInfoOn,
    user_info: userInfoOn,
    char_len: merged.character_description.length,
    user_len: merged.persona_description.length,
  });
}

/** Optional switches for the main scene tagger call. */
export interface BuildTaggerOptions {
  /**
   * When true, do not inject the NovelAI asset tag soup.
   * Used after a successful character-looks pre-pass already consumed assets
   * and wrote looks to the roster (lb-xnai sections then auto-trim via filledNames).
   */
  skipAssetInject?: boolean;
}

/** Lore + UI trigger keys used for asset name matching. */
export function assetTriggerPoolForRequest(request: TaggerArgs): string[] {
  const assistant = cleanText(stripBakeTokens(request.assistant_text), 20000);
  return [
    ...(Array.isArray(request.lore_trigger_keys) ? request.lore_trigger_keys : []),
    ...collectTriggeredLoreKeys(request.lorebook || [], assistant),
  ].map((k) => cleanText(k, 200)).filter(Boolean);
}

/** Collect asset NAI tags when mode is not off; null if off / empty. */
export async function collectAssetTagsForTagger(
  request: TaggerArgs,
  opts: { withPreviews?: boolean } = {},
) {
  const card = deepMerge(getConfig().card, (request.card as Record<string, unknown>) || {});
  if (normalizeAssetNaiTagsMode(card.asset_nai_tags) === 'off') return null;
  try {
    const sessionId = cleanText(request.session_id, 200);
    const sourceSessionIds = Array.isArray(request.source_session_ids)
      ? request.source_session_ids.map((s) => cleanText(s, 200)).filter(Boolean)
      : [];
    const roster = await rosterForSession(
      sessionId,
      cleanText(request.unified_session_id || '', 200),
      cleanText(request.character_id || '', 200),
      sourceSessionIds,
    );
    return await collectAssetNaiTags(assetTriggerPoolForRequest(request), {
      withPreviews: opts.withPreviews === true,
      roster,
      lorebook: Array.isArray(request.lorebook) ? request.lorebook : null,
      message: cleanText(stripBakeTokens(request.assistant_text), 20000),
    });
  } catch (err) {
    setLastAssetWeightMap(new Map());
    dbg('asset-tags.collect.fail', { message: String((err as Error)?.message || err) }, 'warn');
    return null;
  }
}

function formatAppearanceInjectLine(
  c: Partial<CharacterRecord>,
  opts: { withCostumes?: boolean } = {},
): string {
  const name = cleanText(c.name, 200);
  const appearance = cleanText(c.appearance || '', 200);
  const { costumes, active_costume } = ensureCostumes(c);
  const parts = [
    appearance ? `appearance=${appearance}` : '',
  ];
  const hair = normalizeHairColorSlot(c.hair_color, 80);
  const style = cleanText(c.hair_style, 160);
  const eyes = normalizeEyeColorSlot(c.eye_color, 80);
  const height = cleanText(c.height, 40);
  const age = c.age != null && c.age !== '' ? String(c.age) : '';
  if (hair) parts.push(`hair_color=${hair}`);
  if (style) parts.push(`hair_style=${style}`);
  if (eyes) parts.push(`eye_color=${eyes}`);
  if (height) parts.push(`height=${height}`);
  if (age) parts.push(`age=${age}`);
  const gender = cleanText(c.gender, 20);
  if (gender) parts.push(`gender=${gender}`);
  if (opts.withCostumes) {
    const catalog = formatCostumeCatalog(costumes);
    if (catalog) parts.push(`costumes: ${catalog}`);
    const current = costumes[active_costume]?.name;
    if (current) parts.push(`active_costume=${current}[${active_costume}]`);
  } else {
    const attire = cleanText(c.attire || costumes[active_costume]?.attire || costumes[0]?.attire || '', 160);
    const accessories = cleanText(c.accessories || costumes[active_costume]?.accessories || costumes[0]?.accessories || '', 120);
    if (attire) parts.push(`attire=${attire}`);
    if (accessories) parts.push(`accessories=${accessories}`);
  }
  const wear = formatWearStateForPrompt(c.wear_state);
  parts.push(`wear_state=${wear}`);
  return parts.length ? `${name} ← ${parts.join(' | ')}` : name;
}

function collectLorePayload(
  request: TaggerArgs,
  card: Record<string, unknown>,
  assistant: string,
  rosterEarly: CharacterRecord[],
  opts: { extraOnly?: boolean } = {},
): string {
  if (!card.lorebook) return '';
  const filledNames = filledNamesForLoreExtra(rosterEarly);
  const triggerKeys = Array.isArray(request.lore_trigger_keys) ? request.lore_trigger_keys : null;
  const loreExtraMode = normalizeLoreExtraMode(card.lore_extra);
  const filtered = assembleLorebookForTagger(
    request.lorebook || [],
    assistant,
    filledNames,
    5,
    1200,
    triggerKeys,
    loreExtraMode,
  );
  const extraBlocks: string[] = [];
  const refBlocks: string[] = [];
  for (const entry of filtered) {
    const isExtra = isCharacterImageExtraLore(entry) || entry.always;
    const content = cleanText(entry.content || '', isExtra ? 50000 : 1200);
    if (!content) continue;
    const comment = cleanText(entry.comment || '', 200);
    const block = comment ? `### ${comment}\n${content}` : content;
    if (isExtra) extraBlocks.push(block);
    else if (!opts.extraOnly) refBlocks.push(block);
  }
  const loreParts: string[] = [];
  if (extraBlocks.length) {
    loreParts.push(
      '## lb-xnai.lb.extra — OFFICIAL PACK (START)\n'
      + 'Until END: lb-xnai pack only (custom prompt + Character Image Tags). '
      + '`### Name` headings here are pack sections, not separate lore.\n\n'
      + extraBlocks.join('\n\n')
      + '\n\n## lb-xnai.lb.extra — OFFICIAL PACK (END)\n'
      + '[END OF lb-xnai.lb.extra] Pack finished — text below is not lb-xnai ground truth.',
    );
  }
  if (refBlocks.length) {
    loreParts.push(
      '## Reference Lorebook (trigger-matched only)\n'
      + 'Naming/context only. Not lb-xnai. Do not copy lore prose into tags.\n\n'
      + refBlocks.join('\n\n'),
    );
  }
  dbg('job.lore.extra', {
    trigger_keys: Array.isArray(triggerKeys) ? triggerKeys.length : 0,
    injected: extraBlocks.length,
    reference: refBlocks.length,
    extra_only: opts.extraOnly === true,
    sections: filtered
      .filter((e) => isCharacterImageExtraLore(e) || e.always)
      .map((e) => e.key || '')
      .filter(Boolean)
      .join(' | '),
  });
  return loreParts.join('\n\n');
}

async function pushAuthorNoteTurns(
  messages: LlmMessage[],
  sessionId: unknown,
  lane?: { label: string; text: unknown },
): Promise<void> {
  const globalNote = authorNoteSystemContent("Global Author's Note", await getPrompt('global_author_note'));
  if (globalNote) messages.push({ role: 'system', content: globalNote });
  if (lane) {
    const laneNote = authorNoteSystemContent(lane.label, lane.text);
    if (laneNote) messages.push({ role: 'system', content: laneNote });
  }
  const sessMsg = await sessionAuthorNoteLlmContent(sessionId);
  if (sessMsg) messages.push({ role: 'system', content: sessMsg });
}

function pushReferenceUser(messages: LlmMessage[], title: string, body: string): void {
  const text = cleanText(body, 200000);
  if (!text) return;
  messages.push({ role: 'user', content: `# Reference: ${title}\n${text}` });
}

/** Incomplete roster rows that belong with this looks pre-pass (asset / message match). */
function incompleteTargetsForLooks(
  roster: CharacterRecord[],
  assetNames: string[],
  assistant: string,
): CharacterRecord[] {
  const incomplete = roster.filter((c) => cleanText(c.name, 200) && !characterHasAppearance(c));
  if (!incomplete.length) return [];
  const assetNeedles = assetNames.map((n) => cleanText(n, 200).toLowerCase()).filter(Boolean);
  const byAsset = incomplete.filter((c) => {
    const keys = [c.name, ...characterTriggers(c)].map((t) => cleanText(t, 200).toLowerCase()).filter(Boolean);
    return assetNeedles.some((a) => keys.some((k) => k === a || a.includes(k) || k.includes(a)));
  });
  if (byAsset.length) return byAsset;
  const inMessage = matchCharactersInText(assistant, incomplete);
  if (!inMessage.length) return [];
  const hit = new Set(inMessage.map((c) => cleanText(c.name, 200)).filter(Boolean));
  return incomplete.filter((c) => hit.has(cleanText(c.name, 200)));
}

/**
 * Looks-only pre-pass: asset tags (+ optional images).
 * No chat message, no filled-roster dump, no story lore, no lb-xnai pack.
 * global_author_note, then asset_author_note, then the session note (session wins).
 */
export async function buildCharacterLooksMessages(
  request: TaggerArgs,
  assetBlock: string,
  assetNames: string[] = [],
  previews: AssetLookPreview[] = [],
): Promise<LlmMessage[]> {
  const sessionId = cleanText(request.session_id, 200);
  const looks = stripCbs(await getPrompt('char_looks'));
  const messages: LlmMessage[] = [{ role: 'system', content: looks.trim() }];
  const assetHowTo = stripCbs(await getPrompt('asset_tags_inject')).replace(/\{asset_tags_block\}/g, '').trim();
  if (assetHowTo) {
    messages[0].content = `${messages[0].content}\n\n${assetHowTo}`;
  }
  await pushAuthorNoteTurns(messages, chatNoteSessionId(sessionId, request), {
    label: "Asset Author's Note",
    text: await getPrompt('asset_author_note'),
  });

  const assistant = cleanText(stripBakeTokens(request.assistant_text), 20000);
  const sourceSessionIds = Array.isArray(request.source_session_ids)
    ? request.source_session_ids.map((s) => cleanText(s, 200)).filter(Boolean)
    : [];
  const rosterEarly: CharacterRecord[] = await rosterForSession(
    sessionId,
    cleanText(request.unified_session_id || '', 200),
    cleanText(request.character_id || '', 200),
    sourceSessionIds,
  );

  pushReferenceUser(messages, 'NovelAI asset tags', assetBlock);

  const incomplete = incompleteTargetsForLooks(rosterEarly, assetNames, assistant);
  if (incomplete.length) {
    const lines = incomplete.map((char) => {
      const aliases = characterTriggers(char).slice(0, 8).join(', ');
      return `- ${char.name}${aliases ? ` (aliases: ${aliases})` : ''}`;
    });
    pushReferenceUser(
      messages,
      'Incomplete names',
      '## Incomplete (empty appearance) — fill these in `new_characters`\n'
        + 'Use these exact name spellings. Skip anyone already filled on the roster.\n'
        + lines.join('\n'),
    );
  }
  dbg('job.char_looks.targets', {
    assets: assetNames,
    incomplete: incomplete.map((c) => c.name),
  });

  const usablePreviews = (Array.isArray(previews) ? previews : [])
    .filter((p) => p?.dataUrl && /^data:image\//i.test(p.dataUrl))
    .slice(0, 5);

  const userText =
    'Fill `new_characters` for incomplete / asset-matched people from the NovelAI asset block'
    + (incomplete.length ? ' and the Incomplete list' : '')
    + '. COPY tags verbatim into appearance / attire / accessories. JSON only.';

  if (usablePreviews.length) {
    const parts: LlmContentPart[] = [{ type: 'text', text: userText }];
    for (const p of usablePreviews) {
      parts.push({
        type: 'text',
        text: [`Image asset_name: ${cleanText(p.name, 200)}`, 'role: selected_asset'].join('\n'),
      });
      parts.push({ type: 'image_url', image_url: { url: p.dataUrl } });
    }
    messages.push({ role: 'user', content: parts });
    dbg('job.char_looks.previews', { count: usablePreviews.length, names: usablePreviews.map((p) => p.name) });
  } else {
    messages.push({ role: 'user', content: userText });
  }
  dbg('asset-tags.inject', { reason: 'char_looks_prepass', assets: assetNames });
  return messages;
}

function appearancePayload(
  card: Record<string, unknown>,
  assistant: string,
  sessionId: string,
  rosterEarly: CharacterRecord[],
): string {
  if (card.char_appearance === false) return '';
  const roster = rosterEarly;
  const filled = roster.filter((c) => characterHasAppearance(c));
  const incomplete = roster.filter((c) => cleanText(c.name, 200) && !characterHasAppearance(c));
  const matched = matchCharactersInText(assistant, roster);
  if (!filled.length && !incomplete.length && !matched.length) return '';
  const matchedFilled = matched.filter((c) => characterHasAppearance(c));
  const matchedIncomplete = matched.filter((c) => !characterHasAppearance(c));
  const withCostumes = card.costume === true
    || card.costume === 'true'
    || card.costume === 1
    || card.costume === '1'
    || card.costume === 'on';
  const detectedBlock = matchedFilled.length
    ? matchedFilled.map((c) => formatAppearanceInjectLine(c, { withCostumes })).filter(Boolean).join('\n')
    : '(none)';
  const incompleteBlock = matchedIncomplete.length
    ? matchedIncomplete
      .map((char) => `- ${char.name} (aliases: ${characterTriggers(char).slice(0, 8).join(', ')}) → empty appearance; full looks required in new_characters`)
      .join('\n')
    : '(none)';
  dbg('job.roster.split', {
    filled: filled.map((c) => c.name),
    incomplete: incomplete.map((c) => c.name),
    matched: matched.map((c) => c.name),
    matched_with_looks: matchedFilled.map((c) => c.name),
    session_id: sessionId,
  });
  return [
    '## Characters in this message',
    detectedBlock,
    '',
    '## Incomplete in this message (empty appearance)',
    incompleteBlock,
  ].join('\n');
}

function costumeHowTo(): string {
  return [
    '## Costumes (enabled)',
    'Catalog lines are display only: default[0] means name "default", index 0. Never copy "default[0]" into a name field.',
    'Wear an EXISTING catalog outfit: characters[].costume MUST be a string — the bare name ("default"), the index (0), or "default[0]". Not an object. Same clothes as a catalog row = existing. Do not register again.',
    'Register ONLY a truly new outfit that is not in the catalog. New name = short id with no digits glued on (maid, swimsuit). Never default0 / maid1 / name[index].',
    'new_costumes: [{ "name": "<exact char name>", "costumes": [{ "name", "note", "attire", "accessories" }] }]. Then wear with the string name.',
    'Omit / empty costume only when this shot keeps the same set as the previous shot.',
    'attire = detailed clothes (colors, top/bottom/skirt/dress…). accessories = weapons/held props for that set.',
  ].join('\n');
}

/** Builds the full system/user message list for one tagging call. */
export async function buildTaggerMessages(
  request: TaggerArgs,
  opts: BuildTaggerOptions = {},
): Promise<LlmMessage[]> {
  await hydrateTaggerCharUser(request);
  const card = deepMerge(getConfig().card, (request.card as Record<string, unknown>) || {});
  const sessionId = cleanText(request.session_id, 200);
  const tagger = stripCbs(await getPrompt('tagger'));
  const fmt = stripCbs(await getPrompt('format'));
  const loreHow = stripCbs(await getPrompt('lore_inject')).trim();
  const appearanceHow = stripCbs(await getPrompt('appearance_inject')).trim();
  const withCostumes = card.costume === true;
  const assetMode = normalizeAssetNaiTagsMode(card.asset_nai_tags);
  const includeAssetHow = !opts.skipAssetInject && assetMode !== 'off';
  const assetHow = includeAssetHow
    ? stripCbs(await getPrompt('asset_tags_inject')).replace(/\{asset_tags_block\}/g, '').trim()
    : '';

  const naturalMode = normalizeNaturalBaseMode(card.natural_base);
  const charMax = characterMaxLimit(card);
  const imageMin = Math.max(1, Number(card.image_min ?? 1) || 1);
  const imageMax = Math.max(imageMin, Number(card.image_max ?? 3) || 3);
  const placement = [
    // Always ask for y_percent so values are saved. Toggle only affects display (equal bands vs LLM %).
    'Every shot MUST include `y_percent` (0–100): reading position top→bottom. Spread across the full range in order (shot0 < shot1 < …); ~even gaps. E.g. 2→~25/~75; 3→~20/~50/~80; 4→~15/~40/~65/~90. Forbidden: all under 40, duplicates, or gaps under ~15 unless 1 shot.',
    'LINE: message lines are labeled `L1|…`, `L2|…`. Set each shot `line` to that L number (illustration sits immediately before that line). Pick the L# whose text matches the shot moment. `paragraph` = shot order (0,1,2…). `line` is NOT shot order. INVALID: emitting line=1,2,3… just because you have 1st/2nd/3rd shots.',
    imageMin === imageMax
      ? `SHOT COUNT: produce exactly ${imageMax} shot(s) in scenes[].shots (across all scenes).`
      : `SHOT COUNT: produce between ${imageMin} and ${imageMax} shots in scenes[].shots (across all scenes). Prefer the count that fits the message; never fewer than ${imageMin} or more than ${imageMax}.`,
    naturalBaseSystemMessage(naturalMode),
    `CHARACTER CAP: at most ${charMax} characters per shot (char1..char${charMax}). If more are visible, keep the ${charMax} most important; fold extras into situation/place.`,
    focusCharacterSystemMessage(
      normalizeFocusCharacterMode(card.focus_character),
      charMax,
      normalizeFocusPromptMode(card.focus_prompt),
    ),
    'ASPECT (required on every shot, including comic): set `aspect` to exactly one of `portrait` (832×1216 vertical), `square` (1024×1024), or `landscape` (1216×832 horizontal). Pick from the scene framing — tall full-body / standing → portrait; equal crop / face close-up square → square; wide group / side-by-side / scenic → landscape. Comic shots use this same canvas; the comic layout pass must copy it. Omit or unknown → portrait.',
  ].filter(Boolean).join('\n');

  const withMain = comicGenOn(card) && comicLlmWithMain(card.comic_llm_batch);
  const comicPack = withMain ? stripCbs(await getPrompt('comic')).trim() : '';
  const messages: LlmMessage[] = [{
    role: 'system',
    content: [
      `${tagger}\n\n${fmt}`.trim(),
      loreHow,
      appearanceHow,
      withCostumes ? costumeHowTo() : '',
      taggerShouldUseV5Rules(card, getConfig().nai)
        ? v5NaturalHowTo(normalizeV5NaturalLang(card.v5_natural_lang))
        : '',
      cardFlagOn(card.nai_use_coords, true) ? naiCoordsHowTo() : '',
      cardFlagOn(card.nai5_speech, false) ? naiSpeechHowTo() : '',
      comicGenOn(card) ? comicKindHowTo(card.comic_gen_ratio, card.comic_aspect, withMain) : '',
      comicPack,
      assetHow,
      placement,
      formatPrevLocationLine(
        sessionId
          ? await getSessionAuthorNote(sessionId, request).then((r) => (r as { location?: unknown }).location).catch(() => '')
          : '',
      ),
    ].filter(Boolean).join('\n\n'),
  }];

  await pushAuthorNoteTurns(messages, chatNoteSessionId(sessionId, request), {
    label: "Author's Note",
    text: await getPrompt('author_note'),
  });

  if (withMain) {
    const comicNote = cleanText(card.comic_author_note, 8000);
    if (comicNote) {
      messages.push({
        role: 'system',
        content: `# Priority: Comic author's note\n${comicNote}\nIf this conflicts with earlier rules, follow this note (except never emit comic/manga/hatching/thick outlines). Put the page on comic_page, not on the shot root.`,
      });
    }
  }

  if (card.char_info && cleanText(request.character_description)) {
    messages.push({
      role: 'system',
      content: `${await getPrompt('char_inject')}\n## {{char}} Info\n${cleanText(request.character_description, 12000)}`,
    });
  }
  if (card.user_info && cleanText(request.persona_description)) {
    messages.push({
      role: 'system',
      content: `${await getPrompt('char_inject')}\n## {{user}} Info\n${cleanText(request.persona_description, 8000)}`,
    });
  }

  const assistant = cleanText(stripBakeTokens(request.assistant_text), 20000);
  const sourceSessionIds = Array.isArray(request.source_session_ids)
    ? request.source_session_ids.map((s) => cleanText(s, 200)).filter(Boolean)
    : [];
  const unifiedSessionId = cleanText(request.unified_session_id || '', 200);
  const characterId = cleanText(request.character_id || '', 200);
  let rosterEarly: CharacterRecord[] = card.lorebook || card.char_appearance !== false || assetMode !== 'off'
    ? await loadTaggerRoster({
      sessionId,
      unifiedSessionId,
      characterId,
      sourceSessionIds,
    })
    : [];

  const outfitSessionId = chatNoteSessionId(sessionId, request);
  if (outfitSessionId) rosterEarly = rosterWithSessionOutfits(rosterEarly, await getSessionAuthorNote(outfitSessionId));
  pushReferenceUser(messages, 'Lorebook', collectLorePayload(request, card, assistant, rosterEarly));
  pushReferenceUser(messages, 'Characters in this message', appearancePayload(card, assistant, sessionId, rosterEarly));

  if (!opts.skipAssetInject && assetMode !== 'off') {
    const triggerPool = assetTriggerPoolForRequest(request);
    try {
      const collected = await collectAssetNaiTags(triggerPool, {
        withPreviews: false,
        roster: rosterEarly,
        lorebook: Array.isArray(request.lorebook) ? request.lorebook : null,
        message: assistant,
      });
      if (collected?.block) {
        pushReferenceUser(messages, 'NovelAI asset tags', collected.block);
        dbg('asset-tags.inject', {
          reason: `asset_nai_tags_${assetMode}`,
          assets: collected.packed.groups.flatMap((g) => g.assets.map((a) => a.name)),
        });
      } else {
        setLastAssetWeightMap(new Map());
        dbg('asset-tags.inject.skip', { reason: assetMode, cause: 'collect_empty', triggers: triggerPool.length });
      }
    } catch (err) {
      setLastAssetWeightMap(new Map());
      dbg('asset-tags.inject.fail', { reason: assetMode, message: String((err as Error)?.message || err) }, 'warn');
    }
  } else if (opts.skipAssetInject) {
    dbg('asset-tags.inject.skip', { reason: 'prepass_done' });
  } else if (assetMode === 'off') {
    dbg('asset-tags.inject.skip', { reason: 'off' });
  }

  const chunks: string[] = [];
  const includeMax = Number(card.include_max || 0);
  if (includeMax > 0) {
    // Current message excluded by construction (stripped equality inside);
    // no later dedupe pass. Ships below L-numbered instead.
    for (const { role, body } of filterTaggerContextMessages(request.recent_messages, assistant)) {
      chunks.push(`[${role}]\n${body}`);
    }
  }
  if (assistant) chunks.push(numberMessageLinesForTagger(assistant));
  const userContent = chunks.length ? chunks.join('\n\n') : numberMessageLinesForTagger(assistant);
  if (!userContent) throw new Error('태깅할 메시지 텍스트가 없습니다.');
  messages.push({ role: 'user', content: userContent });
  return messages;
}

/** Flattens the tagger's `scenes[].shots[]` reply into a flat shot list. */
export function flattenShots(tagged: unknown, messageText?: unknown): TaggedShot[] {
  const charMax = characterMaxLimit(getConfig().card);
  const result = tagged as TaggerResult;
  const shots: TaggedShot[] = [];
  for (const scene of result.scenes || []) {
    const place = cleanText(scene.place);
    for (const shot of scene.shots || []) {
      // Roster is not available yet, so this dedupe is name-only;
      // buildGenerationForShot runs it again once the roster is merged.
      const item: TaggedShot = {
        ...shot,
        place,
        aspect: resolveShotAspect(shot.aspect),
        characters: dedupeShotCharacters(shot.characters || [], [], charMax).slice(0, charMax),
      };
      shots.push(item);
    }
  }
  // Models often emit line=1,2,3 as shot order; remap from y_percent when that pattern appears.
  const repaired = repairLazyShotLines(shots, messageText ?? '');
  applyComicKindGuard(repaired, comicGenOn(getConfig().card));
  if (comicLlmWithMain(getConfig().card?.comic_llm_batch)) attachInlineComicPages(repaired);
  return repaired;
}

function comicKindHowTo(ratioPct: unknown, comicAspect?: unknown, withMain = false): string {
  const share = normalizeComicGenRatio(ratioPct);
  const aspectMode = normalizeComicAspect(comicAspect);
  const aspectLock =
    aspectMode === 'landscape'
      ? 'Every comic shot MUST set `aspect` to exactly `landscape` (1216×832). Illustration shots still pick aspect from the scene.'
      : aspectMode === 'portrait'
        ? 'Every comic shot MUST set `aspect` to exactly `portrait` (832×1216). Illustration shots still pick aspect from the scene.'
        : aspectMode === 'square'
          ? 'Every comic shot MUST set `aspect` to exactly `square` (1024×1024). Illustration shots still pick aspect from the scene.'
          : '';
  return [
    'KIND: every shot MUST set `kind` to `illustration` or `comic`.',
    'Use `comic` only when the moment needs two or more sequential panels (dialogue + continuous action). A single still scene is `illustration`.',
    share === 0
      ? 'Comic ratio is 0%. Every shot MUST be `illustration`. Do not emit `kind: comic`.'
      : `About ${share}% of the shots in this message may be comic (at most that share). Extra comic-worthy beats become illustration.`,
    'For a comic shot: `line` is the start (image sits immediately above that line, same as illustration). Also set `comic_line_end` to the last prose line this page covers. The next illustration must pick a line after `comic_line_end`.',
    'Do not infer a comic range from neighboring shot `line` values.',
    'Ignore `<img>`, `┣ observation/insight/foreshadow ┫`, `<RP-Guide>`, `<AOS>`, HTML comments, and Upcoming lines — they are not scenes.',
    withMain
      ? [
        'Comic shots still list `characters[].name` for who appears (this list follows CHARACTER CAP).',
        'When kind is comic, also emit `comic_page` on THAT shot. Do not put koma/layout/slots on the shot root.',
        '`comic_page` is the same object as the comic layout JSON: `location` (place tags then indoor or outdoor last; omit if unchanged vs prev_location), `coords` (`position` or `ai_choice`), and `cuts` (1–6; max 6 character entries total across cuts).',
        'Each cut: `cut_kind` (`normal` people in a place, base = place+camera+light with no weight; `background` scenery only, base = `2::no humans::, place`, characters MUST be []; `closeup` zoom, base = `2::close-up::, woman|man, part, state` in English; `cross_section` inside view, base = `2::cross-section::, inside` in English; `upperbody` waist-up, base = `2::upperbody::, place/camera`, upper body only, never lower body), `base` (comma tags, no periods), `characters` (cut appearances — the same person in two cuts is two entries; entries ignore CHARACTER CAP).',
        'Each character entry: name, action (pose/expression; bare kind tag for closeup/cross_section/upperbody cuts, never `N:: ::`; never clothes), source/target/mutual (body-contact verbs: doer→source, receiver→target with the SAME verb on both, shared→mutual on both, never passive), costume (omit for closeup/cross_section), wear_state (`clothed`|`torn`|`topless`|`bottomless`|`nude`|`completely`, omit when unchanged — same rule as shot characters; omit for closeup/cross_section), bubble (`speech`|`thought`|`narration`), text, center_x, center_y.',
        '`nude` = half-undressed/draped, or clothed but nipples/genitals exposed. `completely` = fully undressed, nothing worn.',
      ].join(' ')
      : 'Comic shots still list `characters[].name` for who appears. Do not write panel layout here.',
    aspectLock,
  ].filter(Boolean).join(' ');
}

function focusCharacterSystemMessage(
  mode: FocusCharacterMode,
  charMax: number,
  promptMode: FocusPromptMode = 'default',
): string {
  if (mode === 'off' || promptMode === 'manual') return '';
  const prefer =
    mode === 'female'
      ? ' When choosing focus, prefer female characters when it fits.'
      : mode === 'male'
        ? ' When choosing focus, prefer male characters when it fits.'
        : '';
  const values = `Values: 1..${charMax} or charN, single or several — e.g. 1, [1,2], "char1,char3".`;
  if (promptMode === 'always') {
    return [
      `FOCUS (required): every shot MUST set \`focus\` to at least one cast index so the image emphasizes them (others get out of frame).`,
      values,
      'Do not leave focus empty.',
      prefer.trim(),
    ].filter(Boolean).join(' ');
  }
  if (promptMode === 'strong') {
    return [
      `FOCUS: usually set shot \`focus\` to one or more cast indexes when a shot has a clear subject (others get out of frame).`,
      values,
      'Leave focus empty only when everyone should stay fully framed.',
      prefer.trim(),
    ].filter(Boolean).join(' ');
  }
  return [
    `FOCUS (optional): you may set shot \`focus\` to one or more cast indexes so the image emphasizes them (others get out of frame).`,
    values,
    `Use it when a shot benefits from focus; if it's unclear whether focus helps, leave focus empty.`,
    prefer.trim(),
  ].filter(Boolean).join(' ');
}

function v5NaturalHowTo(lang: 'en' | 'ja'): string {
  const langLine = lang === 'ja'
    ? 'Write V5 `natural` and characters[].action (gaze/pose/hands/face) in Japanese natural language.'
    : 'Write V5 `natural` and characters[].action (gaze/pose/hands/face) in English natural language.';
  return [
    '## V5 natural (per shot)',
    'Set shot `complexity`: `simple` (still / one pose / V4) or `dynamic` (motion / contact / V5). Omit complexity → treat as V5.',
    'For V5-bound shots (complexity empty or dynamic):',
    '- Main `natural` = POSITIONS ONLY. No acts, no gaze, no hands. Who stands where (left/right/front/behind, lying, standing, above).',
    '- Put gaze, pose, hands, face, and acts in characters[].action as one comma-separated string. Do not emit gaze/pose/left_hand keys.',
    '- Body contact lives outside action (solo verbs only there): the doer entry holds characters[].source, the receiver entry holds characters[].target — never both keys in one entry — with the SAME active verb in both. Shared acts go in characters[].mutual on both entries. Never passive voice (`being X` is wrong). No contact: omit all three.',
    '- Never use Korean display names or romanized names in tags. Identify others as one fused chunk: hair color + girl/boy + original tag with NO comma between them.',
    '- Wrong: `looking at makima, red hair` / `facing him` / `on his hips`.',
    "- Right: `looking at red hair girl's makima` / `facing black hair boy's monkey d. luffy` / `sitting on black hair boy's monkey d. luffy's hips`.",
    '- Never him/her/his for other people. OC with no original: `brown hair girl` or `black hair 150cm boy`.',
    langLine,
    'For V4-bound shots (complexity=simple): follow the Natural base mode message; English Danbooru-adjacent phrases.',
  ].join('\n');
}

function naiCoordsHowTo(): string {
  return [
    '## NAI centers (2+ characters only)',
    'When a shot has 2 or more characters, set characters[].center_x and center_y (0–1). Solo shot: omit or 0.5, 0.5.',
    'x = left 0 → right 1. y = top 0 → bottom 1. Stay in 0.12–0.88 (avoid edges).',
    'Do not put everyone at (0.5, 0.5). Standing group: spread left–right.',
    'Story-fit: lying y≈0.72, standing y≈0.5, face/above y≈0.22, left side x≈0.2, right side x≈0.8.',
    'Contact sits next to the other person: on belly ≈ same x, y a bit higher; on face ≈ same x, y higher still.',
    'Centers MUST match main `natural` positions (do not write left and set x=0.8).',
  ].join('\n');
}

function naiSpeechHowTo(): string {
  return [
    '## Speech (V5 shots)',
    'If someone speaks in this shot, set that character `speech` to the exact line and optional `speech_lang` (`korean`/`english`/`japanese`).',
    'Generation appends `speechbubble, korean text:안돼!!` to the end of that character\'s own caption, so each speaker carries their own line.',
  ].join('\n');
}

function naturalBaseSystemMessage(mode: NaturalBaseMode): string {
  if (mode === 'off') {
    return 'Natural base mode OFF. Omit the `natural` field (or leave it empty). Do not invent natural-language base phrases.';
  }
  if (mode === 'detailed') {
    return [
      'Natural base mode DETAILED. Every shot MUST include `natural`: a compact English phrase for NovelAI base caption only (NOT Danbooru comma tags, NOT characters[].action).',
      'Include framing/vantage when useful (side view, close-up, viewed through, reflected in…), then for each visible person in left-to-right (or front-to-back) order: hair color + age band + gender, facial expression, clothing, and pose/action as separate details.',
      'Multi-person: NEVER use character names — use position (left girl, right boy) or hair. Add shared action and lighting/atmosphere briefly.',
      'Telegraphic and objective. Example: `side view upper body, left red hair adult woman tense smile in coat pulling right blue hair teen boy startled arms pinned, warm cafe light`. Keep ~12–28 words, English only.',
    ].join(' ');
  }
  if (mode === 'supplement') {
    return [
      'Natural base mode SUPPLEMENT. Every shot MUST include `natural`: telegraphic English sentences describing what tags cannot express (composition, framing, actions, atmosphere, lighting) for NovelAI base caption only (NOT Danbooru comma tags, NOT characters[].action).',
      'Keep tags and natural language clearly separated. Multi-person: NEVER use names — identify by position (left girl, bottom boy) or appearance. For each person include facial expression and clothing as distinct details; also hair and pose unless already obvious.',
      'Unusual framing welcome (viewed through, reflected in shards of a broken mirror, behind…). Concise, minimal, objective — no subjective interpretation.',
      'Example: `Side view, upper body. Left: adult woman with red hair, tense smile, coat, pulling. Right: teen boy with blue hair, startled face, arms pinned. Warm cafe lighting.` Prefer ~2–5 short sentences, English only.',
    ].join(' ');
  }
  // short (default)
  return [
    'Natural base mode SHORT. Every shot MUST include `natural`: a short English natural-language phrase for NovelAI base caption only (NOT Danbooru comma tags, NOT characters[].action).',
    'Include hair color + age band + gender for each visible person, plus the shared action. Example: `red hair adult woman forced hug blue hair boy`. Keep ~6–20 words, English only.',
  ].join(' ');
}
