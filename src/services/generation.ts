import { insertCharacterPlaceholders } from '../domain/prompt/character-placeholders';
/**
 * One shot → one image, plus the record of where that image belongs.
 *
 * Two responsibilities live together here because they share the same input:
 * turning a tagged shot into a NovelAI/ComfyUI request, and writing the
 * "location" sidecar that lets a card be re-attached to its message after the
 * chat is edited, renamed or re-linked.
 *
 * The location shape is frozen. Its fields are read by the gallery, the
 * explorer and the re-bind path, and older rows may be missing any of them, so
 * every read falls back through `location → card meta → default` in that order.
 */

import { QUALITY_TAGS, UC_PRESETS } from '../config/defaults';
import { normalizeFocusCharacterMode, normalizeFocusPromptMode, normalizeFocusWeight, normalizeNaturalBaseMode } from '../config/schema';
import { API_URL, IMAGE_KEY, charRefScopeForCharacter } from '../core/constants';
import { dbg } from '../core/debug';
import type { JobRequest, NaiSettings, ShotCharacter, StylePreset, TaggedShot } from '../core/types';
import {
  ASSISTANT_PREVIEW_LIMIT,
  cleanText,
  extractPreset,
  joinTags,
  toInt,
  toOptionalFloat,
} from '../core/util/text';
import type { CharacterInput } from '../domain/character/identity';
import {
  applyFocusOutOfFrame,
  focusIndexesToMeta,
  manualFocusIndexesByGender,
  parseFocusIndexes,
} from '../domain/character/focus';
import { dedupeShotCharacters, resolveCharacter } from '../domain/character/roster';
import {
  characterMaxLimit,
  composeCharacterCaptionTags,
  emphasizePersonTags,
  normalizePersonTagMode,
  personCountTagsForShot,
  stripPersonCountTags,
  appendNoHumansWhenNoCast,
} from '../domain/character/tags';
import { resolveStoredContentHash } from '../domain/gallery/unlink-match';
import { canvasDimsForShot } from '../domain/nai-meta/aspect.ts';
import { composeComicSlotCaption } from '../domain/comic/caption';
import { resolveComicUseCoords } from '../domain/comic/coords';
import { normalizeShotKind } from '../domain/comic/kind';
import { resolveComicNaiParams } from '../domain/comic/params';
import { stripComicKomaFromUc, stripComicPageStyleTags, stripComicStyleWords } from '../domain/comic/tags';
import { takeComicGenerationSlots, type ComicPage } from '../domain/comic/page';
import { shouldUseNaiCoords, readNaiCoord, type CoordPair } from '../domain/nai/coords';
import {
  captionWithSpeech,
  speechCaptionTagsForShot,
  stripSpokenBubbleSuppression,
} from '../domain/nai/speech';
import { tokensForFamily } from '../domain/nai/keys';
import { naiSamplerForFamily, naiStepsForFamily } from '../domain/nai/samplers';
import {
  cardFlagOn,
  characterReferenceCandidates,
  effectiveCharacterReferenceMode,
  pickPresetForFamily,
  resolveShotRoute,
  shouldPrepareSharedVibe,
  type ShotNaiRoute,
} from '../domain/nai/routing';
import { resolveGenerationSeed } from '../domain/prompt/command-rewrite';
import { naiToComfyEmphasis } from '../domain/prompt/nai-to-comfy';
import { resolveGenerationCfgParams } from '../domain/style-preset-overrides';
import { prepareDirectorReferenceWebp } from '../core/util/image';
import { generateViaComfy, imageBackendKind } from '../providers/comfy/client';
import { generateT2i } from '../providers/nai/client';
import {
  isNaiV5,
  modelToNaia,
  resolveModel,
  supportsDirectorReference,
  supportsVibeTransfer,
  type CharacterReference,
  type T2iRequest,
  type VibeReference,
} from '../providers/nai/payload';
import { imageLocation, putImageLocation } from '../storage/stores';
import { findAssetMessage } from '../storage/asset-message';
import { getConfig } from './context';
import { ensureCharRefVibeEncoded, ensurePresetVibeEncoded, ensureVibeEncoded, getCharRefImageBytes, getReferenceImageBytes, seedCharRefsFromLooks } from './nai-assets';
import { getPrompt } from './settings';

/** NAI width/height: accept any positive size up to 5000 (no 832/1216 portrait ceiling). */
function clampNaiDim(value: unknown, fallback: number): number {
  const n = Number(value);
  const base = Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
  return Math.max(1, Math.min(5000, base));
}

/**
 * One NovelAI character caption. Deliberately anonymous — the provider payload
 * identifies characters by position, and the display name is carried separately
 * in `GenerationMeta.characters`.
 */
export interface NaiCaption {
  prompt: string;
  uc: string;
  center_x: number;
  center_y: number;
}

/** A caption plus the bookkeeping the card row and the reroll path need. */
export interface GenerationCharacter extends NaiCaption {
  name: string;
  /** Roster id when resolved — used for per-character NAI reference images. */
  id?: string;
  /** Roster scope (`__global__` or chat session id). Required to load a ref. */
  scope?: string;
  /** The tagger's original entry, replayed verbatim when the card is rerolled. */
  raw: ShotCharacter;
}

/** The non-payload half of a plan: what the card row records about the shot. */
export interface GenerationMeta {
  setup: string;
  person: string;
  characters: GenerationCharacter[];
  paragraph: number | undefined;
  /** Tagger shot `focus` (indexes / charN); kept so reroll re-applies out of frame. */
  focus?: unknown;
  /** Kept so a later reroll can reuse NAI5-first V4/V5 routing. */
  complexity?: string;
}

export interface GenerationPlan {
  main: string;
  neg: string;
  captions: NaiCaption[];
  meta: GenerationMeta;
  route: ShotNaiRoute;
  use_coords: boolean;
  cfg?: {
    cfg_scale?: number;
    cfg_rescale?: number;
    steps?: number;
    sampler?: string;
    scheduler?: string;
  };
}

/**
 * The payload half of a plan. `rerollCard`'s prompt-override path builds one of
 * these without ever producing a `GenerationMeta`, so `generateImage` asks for
 * no more than it uses.
 */
export type ImageRequest = Pick<GenerationPlan, 'main' | 'neg' | 'captions'> & {
  /** Optional per-shot canvas override (auto_aspect). */
  width?: number;
  height?: number;
  /**
   * Optional fixed seed (shot-tag 시드고정). When missing/0, falls back to
   * `nai.seed`, then a random seed — same as a normal generation.
   */
  seed?: number;
  /**
   * Shot cast with roster ids. V4.5 attaches every stored character ref;
   * explicit `vibe` selects vibe encoding, otherwise stored images use Precise Reference.
   */
  characters?: Array<{ id?: string; name?: string; scope?: string }>;
  token?: string;
  model?: string;
  preset?: StylePreset | null;
  use_coords?: boolean;
  cfg?: GenerationPlan['cfg'];
  replay?: T2iRequest;
};

export interface GeneratedImage {
  bytes: ArrayBuffer;
  seed: number;
  recipe?: T2iRequest;
}

export interface ShotArgs {
  shot: TaggedShot;
  roster: CharacterInput[];
  /** Chat this shot belongs to — used when a roster row has no scope. */
  sessionId?: string;
  /** Pins the scene tags so a reroll re-renders only the cast. */
  lockedSetup?: string;
  /** Forced route (quota fallback to V4). */
  route?: ShotNaiRoute;
}

/** Bind a ref to this roster row only — never fall back session ↔ global. */
function charRefScopeForStored(stored: CharacterInput | null, sessionId: string): string | undefined {
  if (!stored) return undefined;
  return charRefScopeForCharacter(stored.scope, '', sessionId) || undefined;
}

export interface LocationArgs {
  imageId: string;
  sessionId: string;
  request: JobRequest;
  shotIndex: number;
  paragraph: unknown;
  yPercent: number | null;
  line?: number | null;
  contentHash?: string;
  /** When set (e.g. inherited after mid-job hash rebind), overrides request.assistant_text. */
  assistantPreview?: string;
}

/** Written alongside every image; a type alias so it stays an open record. */
export type ImageLocation = {
  version: number;
  image_id: string;
  session_id: string;
  unified_session_id: string;
  character_id: string;
  character_name: string;
  chat_id: string;
  chat_name: string;
  char_index: number;
  chat_index: number;
  message_index: number;
  message_role: string;
  shot_index: number;
  paragraph: number;
  y_percent: number | null;
  line: number | null;
  content_hash: string;
  host_message_id?: string;
  /** Roster cast ids for the shot filename `.c` segment. Memory-only. */
  cast_ids?: string[];
};

/** The location fields a card response carries, resolved against its stored meta. */
export type CardLocationFields = {
  character_id: string;
  chat_id: string;
  character_name: string;
  chat_name: string;
  char_index: number;
  chat_index: number;
  message_index: number;
  message_role: string;
  shot_index: number;
  paragraph: number;
  y_percent: number | null;
  line: number | null;
  content_hash: string;
  host_message_id?: string;
  assistant_preview: string;
  unified_session_id: string;
  location_file: string;
  storage: string;
  storage_key: string;
};

/** Builds the prompt, negative prompt and per-character captions for one shot. */
export async function buildGenerationForShot(args: ShotArgs): Promise<GenerationPlan> {
  const { shot, roster } = args;
  const card = getConfig().card;
  const nai = getConfig().nai;
  const charMax = characterMaxLimit(card);
  const chars = dedupeShotCharacters(shot.characters || [], roster, charMax).slice(0, charMax);
  const n = Math.max(1, chars.length);
  const personMode = normalizePersonTagMode(card.person_tag_mode, card.auto_person_tags);
  // Only source of person-count tags: cast count (or solo), optionally wrapped N::…::
  const person = emphasizePersonTags(
    personCountTagsForShot(chars, roster, personMode, null, card.person_tag_solo),
    card.person_tag_weight,
  );
  const [filePos, fileNeg] = extractPreset(await getPrompt('preset_1'));
  const route = args.route || resolveShotRoute(card, nai, shot);
  const active = route.preset as (StylePreset & Record<string, unknown>) | null;
  let stylePos: string;
  let styleNeg: string;
  if (active) {
    stylePos = cleanText(active.positive || active.pos || '');
    styleNeg = cleanText(active.negative || active.neg || '');
  } else {
    stylePos = joinTags(cleanText(card.custom_pos), filePos);
    styleNeg = joinTags(cleanText(card.custom_neg), fileNeg);
  }
  const speechCaps = route.useSpeech ? speechCaptionTagsForShot(shot, chars) : [];
  const hasSpeech = speechCaps.some(Boolean);
  if (hasSpeech) stylePos = stripSpokenBubbleSuppression(stylePos);
  let situation: unknown = shot.situation || shot.scene;
  const lockedSetup = cleanText(args.lockedSetup || '');
  let setup: string;
  if (lockedSetup) {
    setup = lockedSetup;
  } else {
    setup = joinTags(shot.camera, situation, shot.place, shot.action);
    if (card.mode === 'asset') {
      setup = joinTags(setup, 'white background', 'simple background', 'cowboy shot', 'looking at viewer', 'portrait');
    }
  }
  const naturalMode = normalizeNaturalBaseMode(card.natural_base);
  const naturalCap = route.useV5Natural
    ? 600
    : naturalMode === 'supplement' ? 600 : naturalMode === 'detailed' ? 480 : 400;
  // V5 shots always take `natural` (positions). V4 follows the left-hand mode.
  const natural = route.useV5Natural
    ? cleanText(shot.natural || shot.natural_base || shot.nl || '', naturalCap)
    : naturalMode === 'off'
      ? ''
      : cleanText(shot.natural || shot.natural_base || shot.nl || '', naturalCap);
  let fixedPos = cleanText(shot.curation_fixed_positive, 800);
  let fixedNeg = '';
  // Cut foreign person-count tags from body, then prepend our ONE wrapped block.
  // joinTags must not split N::1girl, 1boy:: (see splitTagTokens).
  const location = cleanText(shot.location, 800);
  let body = joinTags(stylePos, location, natural, setup, fixedPos);
  if (personMode !== 'off') {
    body = stripPersonCountTags(body);
    setup = stripPersonCountTags(setup);
  }
  // Card-level fixed prompts always wrap style/scene (after person tags, before quality).
  const lead = cleanText(card.fixed_prompt_prefix, 8000);
  const trail = cleanText(card.fixed_prompt_suffix, 8000);
  body = joinTags(lead, body, trail);
  let main = person ? (body ? `${person}, ${body}` : person) : body;
  const naiaModel = modelToNaia(route.model || nai.model || 'nai-diffusion-4-5-full');
  if (nai.apply_quality_tags !== false) main += QUALITY_TAGS[naiaModel] || '';
  main = appendNoHumansWhenNoCast(main, chars.length, card.no_humans_when_no_char);
  // Frozen UI has no UC preset control; leftover human_focus appended a long UC block on every gen.
  const ucPreset = 'none';
  const neg = joinTags(styleNeg, fixedNeg, (UC_PRESETS[naiaModel] || {})[ucPreset] || '');

  const captions: NaiCaption[] = [];
  const charMeta: GenerationCharacter[] = [];
  for (let idx = 0; idx < chars.length; idx++) {
    const char = chars[idx];
    const name = cleanText(char.name, 200);
    const stored = name ? resolveCharacter(name, roster) : null;
    const prompt = joinTags(composeCharacterCaptionTags(stored, char));
    const uc = cleanText(char.negative);
    const taggedX = readNaiCoord(char.center_x);
    const taggedY = readNaiCoord(char.center_y);
    // Payload still wants a center even when use_coords is off; do not feed
    // these invented values into the use_coords decision.
    const cx = taggedX ?? (n === 1 ? 0.5 : Math.round((0.1 + (0.8 * idx) / Math.max(1, n - 1)) * 10) / 10);
    const cy = taggedY ?? 0.5;
    captions.push({ prompt: prompt || 'girl', uc, center_x: cx, center_y: cy });
    charMeta.push({
      name: stored?.name || name,
      id: cleanText(stored?.id || '', 80) || undefined,
      scope: charRefScopeForStored(stored, args.sessionId || ''),
      prompt,
      uc,
      center_x: cx,
      center_y: cy,
      raw: char,
    });
  }
  const focusMode = normalizeFocusCharacterMode(card.focus_character);
  const focusPrompt = normalizeFocusPromptMode(card.focus_prompt);
  let appliedFocus: unknown = shot.focus;
  if (focusMode !== 'off') {
    let focusIdxs: number[] = [];
    if (focusPrompt === 'manual' && (focusMode === 'female' || focusMode === 'male')) {
      focusIdxs = manualFocusIndexesByGender(chars, roster, focusMode);
      appliedFocus = focusIdxs.length ? focusIndexesToMeta(focusIdxs) : '';
    } else if (focusPrompt !== 'manual') {
      focusIdxs = parseFocusIndexes(shot.focus, chars.length);
    }
    if (focusIdxs.length) {
      const focused = applyFocusOutOfFrame(captions, focusIdxs, normalizeFocusWeight(card.focus_weight));
      for (let i = 0; i < captions.length; i++) {
        captions[i] = focused[i]!;
        charMeta[i] = { ...charMeta[i]!, prompt: focused[i]!.prompt };
      }
    }
  }
  // Last thing in the caption, after out-of-frame so the bubble stays at the end.
  // `charMeta` deliberately keeps the speech-free caption: it is what the tag
  // editor shows, and a reroll re-derives the line from `raw.speech` instead.
  if (hasSpeech) {
    for (let i = 0; i < captions.length; i++) {
      const tag = speechCaps[i];
      if (!tag) continue;
      captions[i] = { ...captions[i]!, prompt: captionWithSpeech(captions[i]!.prompt, tag) };
    }
  }
  const taggedPairs = chars.map((char) => {
    const x = readNaiCoord(char.center_x);
    const y = readNaiCoord(char.center_y);
    return x != null && y != null ? { x, y } : null;
  });
  const use_coords = shouldUseNaiCoords(cardFlagOn(card.nai_use_coords, true), taggedPairs);
  return {
    ...insertCharacterPlaceholders(main, neg, captions),
    meta: {
      setup,
      person,
      characters: charMeta,
      paragraph: shot.paragraph,
      focus: appliedFocus,
      ...(cleanText(shot.complexity, 20) ? { complexity: cleanText(shot.complexity, 20) } : {}),
    },
    route,
    use_coords,
  };
}

/** Comic page → V5 plan. Costume is resolved per slot; layout is row/position text. */
export async function buildComicGenerationForShot(args: ShotArgs): Promise<GenerationPlan> {
  const { shot, roster } = args;
  const card = getConfig().card;
  const nai = getConfig().nai;
  const page = (shot.comic_page || {}) as Partial<ComicPage>;
  const slots = takeComicGenerationSlots(Array.isArray(shot.characters) ? shot.characters : []);
  const n = Math.max(1, slots.length);
  // Comic never carries person-count tags: one image holds several panels, so a
  // global count is wrong by construction (the same person in two cuts flattens
  // to two entries). Person-count mode (incl. solo) applies to illustration only.
  const person = '';
  const [filePos, fileNeg] = extractPreset(await getPrompt('preset_1'));
  const route = args.route || resolveShotRoute(card, nai, { ...shot, kind: 'comic' });
  const active = route.preset as (StylePreset & Record<string, unknown>) | null;
  let stylePos: string;
  let styleNeg: string;
  if (active) {
    stylePos = cleanText(active.positive || active.pos || '');
    styleNeg = cleanText(active.negative || active.neg || '');
  } else {
    stylePos = joinTags(cleanText(card.custom_pos), filePos);
    styleNeg = joinTags(cleanText(card.custom_neg), fileNeg);
  }
  stylePos = stripSpokenBubbleSuppression(stylePos);
  styleNeg = stripComicKomaFromUc(styleNeg);
  const koma = Math.max(1, Math.min(6, Math.floor(Number(page.koma) || slots.length || 1)));
  const layout = stripComicStyleWords(page.layout || '');
  const comicLead = stripComicPageStyleTags(card.comic_prompt_prefix);
  const comicTrail = stripComicPageStyleTags(card.comic_prompt_suffix);
  const lead = cleanText(card.fixed_prompt_prefix, 8000);
  const trail = cleanText(card.fixed_prompt_suffix, 8000);
  // Author note is comic-LLM instruction only (callComicLlm). NAI main uses prefix/suffix.
  const location = cleanText(page.location || shot.location, 800);
  let body = joinTags(
    stylePos,
    location,
    `${koma}::${koma}koma::`,
    layout,
  );
  // Cut bases come from the LLM, which is told never to write counts — strip
  // them anyway so a disobedient base cannot sneak a global count in.
  body = stripPersonCountTags(body);
  body = joinTags(lead, comicLead, body, comicTrail, trail);
  body = stripComicPageStyleTags(body);
  let main = person ? (body ? `${person}, ${body}` : person) : body;
  const naiaModel = modelToNaia(route.model || nai.model || 'nai-diffusion-5-full');
  if (nai.apply_quality_tags !== false) main += QUALITY_TAGS[naiaModel] || '';
  main = appendNoHumansWhenNoCast(main, slots.length, card.no_humans_when_no_char);
  const neg = styleNeg;

  const captions: NaiCaption[] = [];
  const charMeta: GenerationCharacter[] = [];
  const taggedPairs: Array<CoordPair | null> = [];
  for (let idx = 0; idx < slots.length; idx++) {
    const char = slots[idx]!;
    const name = cleanText(char.name, 200);
    const stored = name ? resolveCharacter(name, roster) : null;
    const prompt = joinTags(composeComicSlotCaption(stored, char)) || 'girl';
    const uc = cleanText(char.negative);
    const taggedX = readNaiCoord(char.center_x);
    const taggedY = readNaiCoord(char.center_y);
    taggedPairs.push(taggedX != null && taggedY != null ? { x: taggedX, y: taggedY } : null);
    const cx = taggedX ?? (n === 1 ? 0.5 : Math.round((0.1 + (0.8 * idx) / Math.max(1, n - 1)) * 10) / 10);
    const cy = taggedY ?? 0.5;
    captions.push({ prompt, uc, center_x: cx, center_y: cy });
    charMeta.push({
      name: stored?.name || name,
      id: cleanText(stored?.id || '', 80) || undefined,
      scope: charRefScopeForStored(stored, args.sessionId || ''),
      prompt,
      uc,
      center_x: cx,
      center_y: cy,
      raw: char,
    });
  }
  const use_coords = resolveComicUseCoords(card.comic_coords, page.coords, taggedPairs);
  const cfg = resolveComicNaiParams(card, nai, route.preset);
  return {
    ...insertCharacterPlaceholders(main, neg, captions),
    meta: {
      setup: layout,
      person,
      characters: charMeta,
      paragraph: shot.paragraph,
      complexity: 'dynamic',
    },
    route,
    use_coords,
    cfg,
  };
}

export function isComicShot(shot: TaggedShot | null | undefined): boolean {
  return normalizeShotKind(shot?.kind) === 'comic';
}

/** Runs one generation on the configured backend and returns the bytes and seed. */
export async function generateImage(
  plan: ImageRequest,
  shotAspect?: unknown,
  opts?: { useShotAspect?: boolean },
): Promise<GeneratedImage> {
  const nai: NaiSettings = getConfig().nai;
  const dims = plan.width && plan.height
    ? { width: clampNaiDim(plan.width, 832), height: clampNaiDim(plan.height, 1216), aspect: 'settings' as const }
    : canvasDimsForShot(
      shotAspect,
      nai,
      Boolean(getConfig().card?.auto_aspect),
      Boolean(opts?.useShotAspect),
    );
  // Both providers type their cast as `ShotCharacter`, which requires a `name`;
  // captions carry none and only the four caption fields are ever read.
  const characters = plan.captions as unknown as ShotCharacter[];
  const resolvedSeed = resolveGenerationSeed(plan.seed, nai.seed);
  const routeModelEarly = cleanText(plan.model) || nai.model || 'nai-diffusion-4-5-full';
  const routeFamily = isNaiV5(routeModelEarly) ? 'v5' : 'v4';
  if (imageBackendKind(nai) === 'comfy') {
    const naiSized = {
      ...nai,
      width: dims.width,
      height: dims.height,
      seed: resolvedSeed,
      steps: plan.cfg?.steps ?? naiStepsForFamily(nai, routeFamily),
      sampler: plan.cfg?.sampler ?? naiSamplerForFamily(nai, routeFamily),
      cfg_scale: plan.cfg?.cfg_scale ?? nai.cfg_scale,
      cfg_rescale: plan.cfg?.cfg_rescale ?? nai.cfg_rescale,
      noise_schedule: plan.cfg?.scheduler ?? nai.noise_schedule,
    };
    const wantsRef = /\[\[\s*ref\s*\]\]/i.test(String(nai.comfy_workflow_json || ''));
    const refBytes = wantsRef ? await getReferenceImageBytes() : null;
    const [comfyBytes, comfySeed] = await generateViaComfy(
      naiSized,
      plan.main,
      plan.neg,
      characters,
      refBytes,
    );
    return { bytes: comfyBytes, seed: comfySeed, recipe:{prompt:plan.main,negative_prompt:plan.neg,
      width:dims.width,height:dims.height,seed:comfySeed,steps:naiSized.steps,
      cfg_scale:Number(naiSized.cfg_scale),cfg_rescale:Number(naiSized.cfg_rescale || 0),
      sampler:naiSized.sampler,scheduler:String(naiSized.noise_schedule || 'native'),model:routeModelEarly,
      var_plus:false,use_coords:Boolean(plan.use_coords),characters} };
  }
  const routePreset = plan.preset ?? null;
  const routeModel = routeModelEarly;
  const token = cleanText(plan.token)
    || tokensForFamily(nai, routeFamily)[0]
    || cleanText(nai.api_key);
  if (!token) throw new Error('NAI api_key가 설정되지 않았습니다.');
  const characterRefs: CharacterReference[] = [];
  const refMode = cleanText(nai.image_reference || 'none').toLowerCase();
  if (!['', 'none', 'off', 'false', '0'].includes(refMode)) {
    const refBytes = await getReferenceImageBytes();
    if (refBytes) {
      let refType = cleanText(nai.image_reference_type || 'character&style') || 'character&style';
      if (!['character', 'style', 'character&style'].includes(refType)) refType = 'character&style';
      let strength = Number(nai.image_reference_strength ?? 0.6);
      let fidelity = Number(nai.image_reference_fidelity ?? 1.0);
      if (Number.isNaN(strength)) strength = 0.6;
      if (Number.isNaN(fidelity)) fidelity = 1.0;
      try {
        characterRefs.push({
          image: await prepareDirectorReferenceWebp(refBytes, 0.5),
          type: refType,
          strength: Math.max(0, Math.min(1, strength)),
          fidelity: Math.max(0, Math.min(1, fidelity)),
        });
      } catch (err) {
        dbg('nai.ref.prepare_fail', { message: String((err as Error)?.message || err) }, 'warn');
      }
    }
  }
  // Active style preset may override CFG; preset vibe image replaces NAI vibe when set.
  const card = getConfig().card;
  const charRefMode = effectiveCharacterReferenceMode(routeModel, card.char_ref_mode);
  if (charRefMode !== 'off') {
    await seedCharRefsFromLooks(Array.isArray(plan.characters) ? plan.characters : []).catch((err) => {
      dbg('char_ref.seed.gen.fail', { message: String((err as Error)?.message || err) }, 'warn');
    });
  }
  const activePreset = (routePreset || pickPresetForFamily(card, routeFamily)) as StylePreset | null;
  const presetId = cleanText(activePreset?.id || card.active_preset_id, 120);
  const cfgParams = resolveGenerationCfgParams(
    {
      ...nai,
      steps: naiStepsForFamily(nai, routeFamily),
      sampler: naiSamplerForFamily(nai, routeFamily),
    },
    activePreset,
  );
  if (plan.cfg) {
    if (plan.cfg.cfg_scale != null) cfgParams.cfg_scale = plan.cfg.cfg_scale;
    if (plan.cfg.cfg_rescale != null) cfgParams.cfg_rescale = plan.cfg.cfg_rescale;
    if (plan.cfg.steps != null) cfgParams.steps = plan.cfg.steps;
    if (plan.cfg.sampler) cfgParams.sampler = plan.cfg.sampler;
    if (plan.cfg.scheduler) cfgParams.scheduler = plan.cfg.scheduler;
  }

  const vibes: VibeReference[] = [];
  let charRefStrength = Number(card.char_ref_strength ?? 0.6);
  let charRefFidelity = Number(card.char_ref_fidelity ?? 1);
  if (Number.isNaN(charRefStrength)) charRefStrength = 0.6;
  if (Number.isNaN(charRefFidelity)) charRefFidelity = 1;
  charRefStrength = Math.max(0.01, Math.min(1, charRefStrength));
  charRefFidelity = Math.max(0.01, Math.min(1, charRefFidelity));
  const cast = charRefMode === 'off'
    ? []
    : characterReferenceCandidates(Array.isArray(plan.characters) ? plan.characters : []);
  if (charRefMode === 'image') {
    for (const { id: cid, scope } of cast) {
      const bytes = await getCharRefImageBytes(scope, cid);
      if (!bytes) continue;
      let refType = cleanText(card.char_ref_image_type || 'character&style') || 'character&style';
      if (!['character', 'style', 'character&style'].includes(refType)) refType = 'character&style';
      try {
        characterRefs.push({
          image: await prepareDirectorReferenceWebp(bytes, 0.5),
          type: refType,
          strength: charRefStrength,
          fidelity: charRefFidelity,
        });
      } catch (err) {
        dbg(
          'nai.char_ref.prepare_fail',
          { message: String((err as Error)?.message || err), character_id: cid, scope },
          'warn',
        );
      }
    }
  }

  // Precise Reference and Vibe Transfer cannot be combined. Decide only after
  // collecting actual refs so an empty image-mode cast keeps shared vibes.
  // Encode only on models that accept vibe (V4 / V3) — V5 must not call encode-vibe.
  const naiModel = modelToNaia(routeModel);
  const encodeModel = resolveModel(naiModel);
  if (shouldPrepareSharedVibe(characterRefs.length) && supportsVibeTransfer(naiModel)) {
    try {
      let vibeRow = presetId ? await ensurePresetVibeEncoded(presetId, encodeModel) : null;
      if (!vibeRow) {
        const vibeMode = cleanText(nai.vibe_transfer || 'none').toLowerCase();
        if (!['', 'none', 'off', 'false', '0'].includes(vibeMode)) {
          vibeRow = await ensureVibeEncoded(encodeModel);
        }
      }
      if (vibeRow?.encoded) {
        let strength = Number(nai.vibe_transfer_strength ?? 0.6);
        let ie = Number(nai.vibe_transfer_information_extracted ?? vibeRow.information_extracted ?? 1.0);
        if (Number.isNaN(strength)) strength = 0.6;
        if (Number.isNaN(ie)) ie = 1.0;
        vibes.push({
          encoded: vibeRow.encoded,
          strength: Math.max(0, Math.min(1, strength)),
          information_extracted: Math.max(0, Math.min(1, ie)),
        });
      }
    } catch (err) {
      dbg('nai.vibe.encode_fail', {
        message: String((err as Error)?.message || err),
        encode_model: encodeModel,
        generate_model: resolveModel(routeModel),
      }, 'warn');
    }
  }

  if (charRefMode === 'vibe' && shouldPrepareSharedVibe(characterRefs.length) && supportsVibeTransfer(naiModel)) {
    for (const { id: cid, scope } of cast) {
      try {
        const row = await ensureCharRefVibeEncoded(scope, cid, charRefFidelity, encodeModel);
        if (!row?.encoded) continue;
        vibes.push({
          encoded: row.encoded,
          strength: charRefStrength,
          information_extracted: charRefFidelity,
        });
      } catch (err) {
        dbg('nai.vibe.char_ref_encode_fail', {
          message: String((err as Error)?.message || err),
          character_id: cid,
          encode_model: encodeModel,
        }, 'warn');
      }
    }
  }

  // Official NAI: Precise Reference and Vibe Transfer cannot be combined.
  // Prefer director refs when both would be present (global/preset vibe + image mode).
  if (characterRefs.length && vibes.length) {
    dbg('nai.ref.drop_vibes', {
      message: `Precise Reference ${characterRefs.length}개 — 동시 vibe ${vibes.length}개 제외`,
      focus: true,
    });
    vibes.length = 0;
  }

  if (characterRefs.length && !supportsDirectorReference(naiModel)) {
    dbg('nai.ref.drop_director', {
      message: `이 모델은 Precise Reference를 아직 안 받음 · ${characterRefs.length}개 제외`,
      focus: true,
    });
    characterRefs.length = 0;
  }
  if (vibes.length && !supportsVibeTransfer(naiModel)) {
    dbg('nai.ref.drop_vibes', {
      message: `이 모델은 Vibe Transfer를 아직 안 받음 · ${vibes.length}개 제외`,
      focus: true,
    });
    vibes.length = 0;
  }

  const req: T2iRequest = {
    prompt: plan.main,
    negative_prompt: plan.neg,
    width: dims.width,
    height: dims.height,
    seed: resolvedSeed,
    steps: cfgParams.steps,
    cfg_scale: cfgParams.cfg_scale,
    cfg_rescale: cfgParams.cfg_rescale,
    sampler: cfgParams.sampler,
    scheduler: cfgParams.scheduler,
    model: naiModel,
    use_coords: Boolean(plan.use_coords),
    var_plus: Boolean(nai.variety_plus),
    characters,
    ...plan.replay,
    character_refs: characterRefs,
    vibes,
  };
  // SDXL식 강조: NAI 전송 직전에만 N::/{}/[] → () 가중치로 변환.
  // plan.main/neg와 저장 카드는 domain 형태 그대로 둔다.
  if (nai.sdxl_emphasis === true) {
    req.prompt = naiToComfyEmphasis(req.prompt);
    req.negative_prompt = naiToComfyEmphasis(req.negative_prompt);
    req.characters = (req.characters || []).map((c) => ({
      ...c,
      prompt: naiToComfyEmphasis((c as { prompt?: unknown }).prompt),
      uc: naiToComfyEmphasis((c as { uc?: unknown }).uc || ''),
    }));
  }
  dbg('nai.generate.dims', {
    message: `${req.width}x${req.height} · ${resolveModel(routeModel)}`,
    model: resolveModel(routeModel),
    family: routeFamily,
    char_ref: charRefMode,
    encode_model: encodeModel,
    vibe_count: vibes.length,
    aspect: dims.aspect,
    auto_aspect: Boolean(getConfig().card?.auto_aspect) || Boolean(opts?.useShotAspect),
    steps: req.steps,
    focus: true,
  });
  if (!req.seed) req.seed = Math.floor(Math.random() * 4294967295) || 1;
  const apiUrl = cleanText(nai.request_url) || API_URL;
  // `generateT2i` serialises NovelAI generations internally.
  const result = await generateT2i(token, req, apiUrl, { timeoutMs: 90000 });
  const {character_refs: _refs, vibes: _vibes, ...recipe} = req;
  return { bytes: result.raw_bytes, seed: req.seed || 0, recipe };
}

/** Replay image prompts/settings, with only the seed and current reference inputs changed. */
export async function generateFromNaiReplay(req: T2iRequest, cast: Array<{id?:string;scope?:string;name?:string}> = []): Promise<GeneratedImage> {
  if (!cleanText(req.model)) throw new Error('이미지 메타에 모델이 없습니다.');
  return generateImage({
    main:req.prompt, neg:req.negative_prompt,
    captions:(req.characters || []).map(c=>({prompt:c.prompt || '',uc:c.uc || '',center_x:Number(c.center_x ?? 0.5),center_y:Number(c.center_y ?? 0.5)})), characters:cast,
    width:req.width, height:req.height, seed:req.seed, model:req.model, use_coords:req.use_coords,
    cfg:{steps:req.steps,cfg_scale:req.cfg_scale,cfg_rescale:req.cfg_rescale,sampler:req.sampler,scheduler:req.scheduler},
    replay:req,
  });
}

/** The location record for a freshly generated image. */
export function buildImageLocation({
  imageId,
  sessionId,
  request,
  shotIndex,
  paragraph,
  yPercent,
  line = null,
  contentHash = '',
}: LocationArgs): ImageLocation {
  const lineN = Math.floor(Number(line));
  return {
    version: 1,
    image_id: cleanText(imageId, 80),
    session_id: cleanText(sessionId, 200),
    unified_session_id: cleanText(request.unified_session_id || '', 200),
    character_id: cleanText(request.character_id || '', 200),
    character_name: cleanText(request.character_name || '', 200),
    chat_id: cleanText(request.chat_id || '', 200),
    chat_name: cleanText(request.chat_name || '', 200),
    char_index: toInt(request.char_index, -1),
    chat_index: toInt(request.chat_index, -1),
    message_index: toInt(request.message_index, -1),
    message_role: cleanText(request.message_role || request.role || '', 40).toLowerCase(),
    shot_index: toInt(shotIndex, 0),
    paragraph: toInt(paragraph, 0),
    y_percent: yPercent,
    line: Number.isFinite(lineN) && lineN >= 1 ? lineN : null,
    content_hash: cleanText(contentHash || request.content_hash || '', 128),
    ...(() => {
      const host = cleanText(
        request.host_message_id || request.hostMessageId || '',
        160,
      );
      return host ? { host_message_id: host } : {};
    })(),
  };
}

export async function readImageLocation(imageId: string): Promise<Record<string, unknown>> {
  // Metadata-only: this runs once per row when a gallery is listed, so it must not
  // pull the pixels in with it. See `imageLocation` in storage/stores.
  return imageLocation(imageId);
}

export async function locateBakedImage(imageId: string): Promise<Record<string, unknown>> {
  const location = await imageLocation(imageId);
  return await findAssetMessage(imageId, location) || {...location, message_index:-1, content_hash:''};
}

export async function writeImageLocation(imageId: string, location: unknown): Promise<void> {
  const loc = (location || {}) as Record<string, unknown>;
  await putImageLocation(cleanText(imageId, 80), {
    ...loc,
    version: Number(loc.version || 1),
    image_id: cleanText(imageId, 80),
  });
}

/** Location fields for a card response, filling gaps from the card's own meta. */
export async function locationFieldsForCard(imageId: string, meta: unknown = {}): Promise<CardLocationFields> {
  return locationFieldsFrom(imageId, meta, await readImageLocation(imageId));
}

/**
 * The same mapping with the sidecar already in hand.
 *
 * Listings need the raw sidecar as well as these fields, and reading it twice per
 * row is a lookup per card for nothing.
 */
export function locationFieldsFrom(
  imageId: string,
  meta: unknown,
  loc: Record<string, unknown>,
): CardLocationFields {
  const base = (typeof meta === 'object' && meta ? meta : {}) as Record<string, unknown>;
  let yPercent: unknown = loc.y_percent;
  if (yPercent == null) yPercent = base.y_percent ?? base.anchor_percent ?? base.read_percent;
  const hasLoc = Object.keys(loc).length > 0;
  const storageKey = IMAGE_KEY(cleanText(imageId, 80));
  return {
    character_id: cleanText(loc.character_id || base.character_id || '', 200),
    chat_id: cleanText(loc.chat_id || base.chat_id || '', 200),
    character_name: cleanText(loc.character_name || base.character_name || '', 200),
    chat_name: cleanText(loc.chat_name || base.chat_name || '', 200),
    char_index: toInt(loc.char_index ?? base.char_index, -1),
    chat_index: toInt(loc.chat_index ?? base.chat_index, -1),
    message_index: toInt('message_index' in loc ? loc.message_index : base.message_index, -1),
    message_role: cleanText(loc.message_role || base.message_role || '', 40).toLowerCase(),
    shot_index: toInt(loc.shot_index, -1),
    paragraph: toInt('paragraph' in loc ? loc.paragraph : base.paragraph, 0),
    y_percent: toOptionalFloat(yPercent),
    line: (() => {
      const n = Math.floor(Number(loc.line ?? base.line));
      return Number.isFinite(n) && n >= 1 ? n : null;
    })(),
    content_hash: resolveStoredContentHash(loc, base),
    ...(() => {
      const host = cleanText(loc.host_message_id || base.host_message_id || '', 160);
      return host ? { host_message_id: host } : {};
    })(),
    assistant_preview: cleanText(loc.assistant_preview || base.assistant_preview || '', ASSISTANT_PREVIEW_LIMIT),
    unified_session_id: cleanText(loc.unified_session_id || base.unified_session_id || '', 200),
    // UI-compat field: was a sidecar .json path; now an IndexedDB key ref.
    location_file: hasLoc ? `idb:${storageKey}` : '',
    storage: 'indexeddb',
    storage_key: storageKey,
  };
}

/** Merges a card's stored meta with its location into the meta the card row keeps. */
export function cardMetaFromLocation(meta: unknown, location: unknown, pngBytes = 0): Record<string, unknown> {
  const base = (typeof meta === 'object' && meta ? { ...meta } : {}) as Record<string, unknown>;
  const loc = (location || {}) as Record<string, unknown>;
  return {
    ...base,
    character_id: cleanText(loc.character_id || base.character_id || '', 200),
    chat_id: cleanText(loc.chat_id || base.chat_id || '', 200),
    character_name: cleanText(loc.character_name || base.character_name || '', 200),
    chat_name: cleanText(loc.chat_name || base.chat_name || '', 200),
    char_index: toInt(loc.char_index ?? base.char_index, -1),
    chat_index: toInt(loc.chat_index ?? base.chat_index, -1),
    message_index: toInt(loc.message_index ?? base.message_index, -1),
    message_role: cleanText(loc.message_role || base.message_role || '', 40).toLowerCase(),
    content_hash: cleanText(loc.content_hash || base.content_hash || '', 128),
    ...(() => {
      const host = cleanText(loc.host_message_id || base.host_message_id || '', 160);
      return host ? { host_message_id: host } : {};
    })(),
    assistant_preview: cleanText(loc.assistant_preview || base.assistant_preview || '', ASSISTANT_PREVIEW_LIMIT),
    unified_session_id: cleanText(loc.unified_session_id || base.unified_session_id || '', 200),
    y_percent: toOptionalFloat(loc.y_percent ?? base.y_percent),
    line: (() => {
      const n = Math.floor(Number(loc.line ?? base.line));
      return Number.isFinite(n) && n >= 1 ? n : null;
    })(),
    storage: 'indexeddb',
    // Empty when the location carries no image_id — 1.x emitted the bare prefix
    // here too, and the explorer treats it as "no blob key" rather than a miss.
    storage_key: IMAGE_KEY(cleanText(loc.image_id || '', 80)),
    png_bytes: Number(pngBytes) || 0,
  };
}
