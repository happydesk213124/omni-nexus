import { messageAssetIds, findAssetMessage } from '../storage/asset-message';
/**
 * Edits to a single already-generated card.
 *
 * Two things here are easy to get wrong.
 *
 * **A reroll replays the saved image's NAI metadata** (sampler, size, base,
 * model) with a new seed. Character captions stay on the file (and any stored
 * prompt). The live roster is a fallback only when that prompt is empty.
 * Comic pages never resolve slot names against the roster. Tag-popup
 * overrides replace base (and char prompts when the form sent them). The
 * settings tab is not applied.
 *
 * **A reroll allocates a new card id** and deletes the old row, so callers must
 * follow `replaced` rather than assume the id survived. The image location
 * (message index, content hash, y position) is carried across unchanged — that
 * is what keeps the new image anchored to the same message.
 *
 * `rerollMessageCards` holds `messageBusyKeys` for the whole batch instead of
 * taking a job epoch: it is a single-shot operation with no shots to supersede,
 * and it only needs to stop a concurrent generation from targeting the same
 * message while it works.
 */

import type { ApiResult, CardRow } from '../core/types';
import { QUALITY_TAGS } from '../config/defaults';
import {
  ASSISTANT_PREVIEW_LIMIT,
  cleanText,
  splitTagTokens,
  stripCbs,
  toInt,
  toOptionalFloat,
  unifiedSessionIdForCharacter,
  uuid,
} from '../core/util/text';
import { characterMaxLimit, stripPersonCountTags } from '../domain/character/tags';
import { collectStylePositives } from '../domain/prompt/reroll-setup';
import { modelToNaia } from '../providers/nai/payload';
import { slimCardCharacters } from '../domain/gallery/slim-cast';
import { stripStoredCardMeta } from '../domain/gallery/strip-stored-meta';
import { resolveRerollCharacters } from '../domain/gallery/reroll-captions';
import { aspectFromCanvas, extractNaiMetadata, readGenerationImageData } from '../domain/nai-meta';
import {
  applyNaiSceneOverrides,
  isComicNaiScene,
  randomNaiSeed,
  requireNaiReplayScene,
  sceneFromNaiMetadata,
  t2iRequestFromScene,
  type NaiScene,
} from '../domain/nai-meta/replay';
import {
  commandRewriteHasDeltas,
  mergeCommandRewriteCharacters,
  mergeCommandRewriteDeltas,
  mergeCommandRewriteMain,
} from '../domain/prompt/command-rewrite';
import { dbg } from '../core/debug';
import { parseJsonLoose } from '../core/util/object';
import { attachImageUrls, publishImage, resolveImageUrl } from '../storage/image-urls';
import { idbGet, idbPut } from '../storage/stores';
import { callLlm } from './llm-call';
import type { LlmMessage } from '../providers/llm/transform';
import { rosterForSession } from './characters';
import { getConfig, messageBusyKeys, clearMessageRerollStop, isMessageRerollStopRequested } from './context';
import {
  cardMetaFromLocation,
  generateFromNaiReplay,
  locationFieldsForCard,
  readImageLocation,
} from './generation';
import { persistChatImagesOn, rewriteBakedCardInChatMessage } from './chat-bake';
import { deleteCard, getImageBytes } from './gallery';
import { busyReplyForRequest, jobKey } from './job-locks';
import { createJob } from './jobs';
import { getPrompt } from './settings';
import { bytesToDataUrlAsync, base64ToAb } from '../core/util/bytes';
import { shotCastIds } from './cast-ids';

function parseJsonOr(raw: unknown, fallback: unknown): unknown {
  try {
    return JSON.parse(raw as string);
  } catch {
    return fallback;
  }
}

async function loadCardImageScene(cardId: string): Promise<NaiScene> {
  const bytes = await getImageBytes(cardId);
  if (!bytes?.byteLength) throw new Error('이미지를 읽지 못했습니다.');
  const naiMeta = await extractNaiMetadata(bytes);
  if (!naiMeta) throw new Error('이미지에서 NovelAI 메타데이터를 읽지 못했습니다.');
  const scene = requireNaiReplayScene(naiMeta);
  if (!cleanText(scene.main) && !scene.characters.length) {
    throw new Error('메타데이터에 프롬프트가 없습니다.');
  }
  return scene;
}

/** Image NAI tags for the shot-tag popup (one card — pixels are OK). */
export async function readCardNaiPrompts(cardId: string): Promise<ApiResult> {
  const id = cleanText(cardId, 80);
  const row = await idbGet('cards', id);
  if (!row) return { ok: false, error: { code: 'not_found', message: 'card not found' } };
  try {
    const bytes = await getImageBytes(id);
    if (!bytes) throw new Error('이미지를 읽지 못했습니다.');
    const scene = requireNaiReplayScene(await extractNaiMetadata(bytes));
    const embedded = readGenerationImageData(bytes);
    const slim = embedded?.characters?.length
      ? embedded.characters.map(c=>({scope:c.scope,id:c.id,name:c.name}))
      : slimCardCharacters(parseJsonOr(row.characters_json || '[]', []));
    const characters = scene.characters.map((c, i) => ({
      ...(slim[i] || {}),
      prompt: c.prompt,
      uc: c.uc,
      center_x: c.center_x,
      center_y: c.center_y,
    }));
    return {
      ...naiPromptFromScene(scene),
      characters,
    };
  } catch (err) {
    return {
      ok: false,
      error: { code: 'no_meta', message: String((err as Error)?.message || err) },
    };
  }
}

export interface RerollOptions {
  /** Set by `rerollMessageCards`, which already holds the message lock. */
  skipBusyCheck?: boolean;
}

export interface RerollMessageArgs {
  /** Straight from the request body, so every field may be any JSON value. */
  session_id?: unknown;
  content_hash?: unknown;
  message_index?: unknown;
}

/**
 * Applies hand-edited tags to a card without regenerating the image.
 */
export async function updateCardTags(cardId: string, body: Record<string, unknown> = {}): Promise<ApiResult> {
  const id = cleanText(cardId, 80);
  const row = await idbGet('cards', id);
  if (!row) return { ok: false, error: { code: 'not_found', message: 'card not found' } };

  const parsedOld = parseJsonOr(row.characters_json || '[]', []);
  const oldChars: unknown[] = Array.isArray(parsedOld) ? parsedOld : [];

  let main = row.main_prompt;
  if ('main_prompt' in body) main = cleanText(body.main_prompt, 8000);
  let neg = row.negative_prompt;
  if ('negative_prompt' in body) neg = cleanText(body.negative_prompt, 8000);

  let chars: unknown[] = oldChars;
  if ('characters' in body) {
    const rawChars = body.characters || [];
    if (!Array.isArray(rawChars)) {
      return { ok: false, error: { code: 'bad_request', message: 'characters must be a list' } };
    }
    chars = [];
    const limit = characterMaxLimit(getConfig().card || {});
    for (let idx = 0; idx < rawChars.slice(0, limit).length; idx++) {
      const entry: unknown = rawChars[idx];
      if (typeof entry !== 'object') continue;
      // `typeof null === 'object'`, so a null element survives the guard and the
      // reads below throw. Preserved from 1.x — the UI never sends one.
      const ch = entry as Record<string, unknown>;
      const prev = (idx < oldChars.length && typeof oldChars[idx] === 'object'
        ? oldChars[idx]
        : {}) as Record<string, unknown>;
      const name = cleanText(ch.name != null ? ch.name : prev.name, 200);
      const prompt = cleanText(ch.prompt != null ? ch.prompt : prev.prompt, 4000);
      if (!name && !prompt) continue;
      const out: Record<string, unknown> = { ...prev, name: name || `char${idx + 1}`, prompt: prompt || 'girl' };
      if ('uc' in ch) out.uc = cleanText(ch.uc, 2000);
      for (const key of ['center_x', 'center_y']) {
        if (key in ch) {
          try {
            out[key] = Number(ch[key]);
          } catch {
            /* Number() only throws on symbols/bigints; 1.x swallowed it */
          }
        }
      }
      chars.push(out);
    }
  }

  // Stored rows keep no cast: the response below still echoes the live values.
  row.main_prompt = '';
  row.negative_prompt = '';
  row.characters_json = '[]';
  try {
    let meta = parseJsonOr(row.meta_json || '{}', {});
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {};
    const metaRec = meta as Record<string, unknown>;
    delete metaRec.characters;
    delete metaRec.setup;
    row.meta_json = JSON.stringify(stripStoredCardMeta(metaRec));
  } catch {
    /* the mirror is best-effort; the card columns are already correct */
  }
  await idbPut('cards', row);

  const loc = await locationFieldsForCard(id, {});
  const card = {
    id,
    main_prompt: main,
    negative_prompt: neg,
    characters: chars,
    paragraph: row.paragraph,
    shot_index: row.shot_index,
    y_percent: loc.y_percent,
    message_index: loc.message_index,
    content_hash: loc.content_hash,
    image_url: resolveImageUrl(id),
  };
  await attachImageUrls(card);
  return { ok: true, card };
}

function applyScenePromptOverrides(scene: NaiScene, ov: Record<string, unknown> | null): void {
  applyNaiSceneOverrides(scene, ov);
}

function naiPromptFromScene(scene: NaiScene): Record<string, unknown> {
  return {
    ok: true,
    main_prompt: scene.main,
    negative_prompt: scene.negative,
    characters: scene.characters.map((c) => ({
      prompt: c.prompt,
      uc: c.uc,
      center_x: c.center_x,
      center_y: c.center_y,
    })),
    model: scene.model,
    width: scene.width,
    height: scene.height,
    steps: scene.steps,
    cfg_scale: scene.cfg_scale,
    cfg_rescale: scene.cfg_rescale,
    sampler: scene.sampler,
    scheduler: scene.scheduler,
    ...(scene.seed ? { seed: scene.seed } : {}),
  };
}

/** Dropped-file NAI tags for the shot studio. Does not touch the stored card. */
export async function readImageNaiPrompts(body: Record<string, unknown> = {}): Promise<ApiResult> {
  const bytes = decodeStudioImage(body);
  if (!bytes?.byteLength) {
    return { ok: false, error: { code: 'bad_request', message: 'image required' } };
  }
  try {
    const naiMeta = await extractNaiMetadata(bytes);
    if (!naiMeta) throw new Error('이미지에서 NovelAI 메타데이터를 읽지 못했습니다.');
    const scene = sceneFromNaiMetadata(naiMeta);
    if (!cleanText(scene.main) && !scene.characters.length) {
      throw new Error('메타데이터에 프롬프트가 없습니다.');
    }
    return naiPromptFromScene(scene);
  } catch (err) {
    return {
      ok: false,
      error: { code: 'no_meta', message: String((err as Error)?.message || err) },
    };
  }
}

function decodeStudioImage(body: Record<string, unknown>): ArrayBuffer | null {
  const dataUrl = cleanText(body.image_data_url || body.image_url, 20_000_000);
  const matched = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/s);
  if (matched?.[1]) return base64ToAb(matched[1]);
  const b64 = cleanText(body.image_b64, 20_000_000);
  return b64 ? base64ToAb(b64) : null;
}

/** NAI replay into bytes only — does not replace the card. */
export async function studioGenerate(cardId: string, body: Record<string, unknown> = {}): Promise<ApiResult> {
  const id = cleanText(cardId, 80);
  const row = await idbGet('cards', id);
  if (!row) return { ok: false, error: { code: 'not_found', message: 'card not found' } };
  let scene: NaiScene;
  try {
    scene = await loadCardImageScene(id);
  } catch (err) {
    return { ok: false, error: { code: 'no_meta', message: String((err as Error)?.message || err) } };
  }
  applyScenePromptOverrides(scene, body);
  if (!Array.isArray(body.characters)) {
    scene.characters = resolveRerollCharacters({
      comic: true,
      sceneChars: scene.characters,
      stored: [],
      fromMeta: [],
      roster: [],
      limit: characterMaxLimit(getConfig().card || {}),
    });
  }
  if (!cleanText(scene.model)) {
    return { ok: false, error: { code: 'no_model', message: '이미지 메타에 모델이 없습니다.' } };
  }
  const ovSeed = 'seed' in body ? Number(body.seed) : NaN;
  const seedOverride = Number.isFinite(ovSeed) && ovSeed > 0 ? Math.floor(ovSeed) : undefined;
  const { bytes, seed } = await generateFromNaiReplay(
    t2iRequestFromScene(scene, seedOverride || randomNaiSeed()),
  );
  return {
    ok: true,
    image_data_url: await bytesToDataUrlAsync(bytes, 'image/png'),
    seed,
  };
}

/**
 * Commit the studio canvas the way a reroll lands: the bytes are published
 * under a NEW card id at the same place (location and cast inherited from the
 * old row), tags are written onto the new row, the old row is dropped, and
 * callers must follow `replaced`. The image location (message index, content
 * hash, y position) is carried across unchanged — that is what keeps the new
 * image anchored to the same message. Tags-only commits (no canvas bytes)
 * keep the old same-id path.
 */
export async function studioCommit(cardId: string, body: Record<string, unknown> = {}): Promise<ApiResult> {
  const id = cleanText(cardId, 80);
  const row = await idbGet('cards', id);
  if (!row) return { ok: false, error: { code: 'not_found', message: 'card not found' } };
  const bytes = decodeStudioImage(body);
  if (!bytes?.byteLength) return updateCardTags(id, body);
  const meta = parseJsonOr(row.meta_json || '{}', {}) as Record<string, unknown>;
  const prevLocMeta = (meta.location || {}) as Record<string, unknown>;
  const sessionId = row.session_id;
  const characterId = cleanText(prevLocMeta.character_id || meta.character_id || '', 200);
  let unifiedSessionId = cleanText(meta.unified_session_id || prevLocMeta.unified_session_id || '', 200);
  if (!unifiedSessionId && characterId) unifiedSessionId = unifiedSessionIdForCharacter(characterId);
  const newId = uuid();
  const now = Date.now() / 1000;
  const storedLoc = await readImageLocation(row.id);
  const prevLoc = await findAssetMessage(row.id, storedLoc) || { ...storedLoc, message_index: -1 };
  // The source asset file name already carries the cast, so no roster minting
  // is needed. Castless source → filename stays without .c.
  let inheritCast: string[] = [];
  try {
    const prev = await shotCastIds(row.id);
    if (prev && Array.isArray(prev.ids)) inheritCast = prev.ids.filter(Boolean).map(String);
  } catch { /* keep castless */ }
  const location = {
    version: 1,
    image_id: newId,
    ...(inheritCast.length ? { cast_ids: inheritCast } : {}),
    session_id: sessionId,
    unified_session_id: unifiedSessionId,
    character_id: cleanText(prevLoc.character_id || '', 200),
    character_name: cleanText(prevLoc.character_name || meta.character_name || '', 200),
    chat_id: cleanText(prevLoc.chat_id || '', 200),
    chat_name: cleanText(prevLoc.chat_name || meta.chat_name || '', 200),
    char_index: toInt(prevLoc.char_index, -1),
    chat_index: toInt(prevLoc.chat_index, -1),
    message_index: toInt(prevLoc.message_index, -1),
    shot_index: toInt(prevLoc.shot_index, toInt(row.shot_index, 0)),
    paragraph: toInt(prevLoc.paragraph, toInt(row.paragraph, 0)),
    y_percent: toOptionalFloat(prevLoc.y_percent),
    content_hash: cleanText(prevLoc.content_hash || '', 128),
    assistant_preview: cleanText(prevLoc.assistant_preview || meta.assistant_preview || '', ASSISTANT_PREVIEW_LIMIT),
  };
  await publishImage(newId, bytes, location);
  const slimCast = slimCardCharacters(parseJsonOr(row.characters_json || '[]', []));
  const genMetaExtra: Record<string, unknown> = {
    kind: cleanText(meta.kind, 20) || 'illustration',
    characters: slimCast,
  };
  const genMeta = cardMetaFromLocation({ ...meta, ...genMetaExtra }, location, bytes.byteLength);
  for (const key of ['y_percent', 'anchor_percent', 'read_percent']) delete genMeta[key];
  genMeta.y_percent = location.y_percent;
  const seedRaw = Number((body as Record<string, unknown>).seed);
  const canvasW = Math.max(64, Math.round(Number((body as Record<string, unknown>).width) || Number((meta as Record<string, unknown>).width) || 832));
  const canvasH = Math.max(64, Math.round(Number((body as Record<string, unknown>).height) || Number((meta as Record<string, unknown>).height) || 1216));
  genMeta.aspect = aspectFromCanvas(canvasW, canvasH);
  genMeta.width = canvasW;
  genMeta.height = canvasH;
  await idbPut('cards', {
    id: newId,
    job_id: row.job_id,
    session_id: sessionId,
    shot_index: row.shot_index,
    paragraph: row.paragraph,
    main_prompt: row.main_prompt,
    negative_prompt: row.negative_prompt,
    characters_json: row.characters_json,
    seed: Number.isFinite(seedRaw) ? Math.floor(seedRaw) : toInt(row.seed, 0),
    meta_json: JSON.stringify(genMeta),
    created_at: now,
  });
  const tagged = await updateCardTags(newId, body);
  if ((tagged as { ok?: unknown }).ok !== true) return tagged;
  if (persistChatImagesOn()) {
      await rewriteBakedCardInChatMessage({
        charIndex: toInt(location.char_index, -1),
        chatIndex: toInt(location.chat_index, -1),
        messageIndex: toInt(location.message_index, -1),
        prevCardId: id,
        nextCardId: newId,
        characterId: location.character_id,
        chatId: location.chat_id,
      });
  }
  try { await deleteCard(id); } catch { /* A committed replacement can retain an orphan gallery row. */ }
  return { ok: true, replaced: id, card: (tagged as { card: unknown }).card };
}

/**
 * Pin a costume pick onto a card's cast so later rerolls keep that wardrobe
 * without changing roster costumes[0].
 */
export async function stampCardCostume(
  cardId: string,
  characterName: string,
  costume: unknown,
  charIndex: number | null = null,
): Promise<ApiResult> {
  const id = cleanText(cardId, 80);
  const name = cleanText(characterName, 200);
  if (!id || !name) {
    return { ok: false, error: { code: 'bad_request', message: 'card_id and character name required' } };
  }
  const row = await idbGet('cards', id);
  if (!row) return { ok: false, error: { code: 'not_found', message: 'card not found' } };

  const parsed = parseJsonOr(row.characters_json || '[]', []);
  const chars: Record<string, unknown>[] = Array.isArray(parsed)
    ? parsed.map((c) => (c && typeof c === 'object' ? { ...(c as Record<string, unknown>) } : c)).filter(Boolean) as Record<string, unknown>[]
    : [];

  let hit = false;
  const wantIdx = charIndex != null && Number.isFinite(Number(charIndex)) ? Number(charIndex) : -1;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const chName = cleanText(ch.name, 200);
    if (wantIdx >= 0 ? i !== wantIdx : chName !== name) continue;
    ch.costume = costume;
    if (ch.raw && typeof ch.raw === 'object') {
      ch.raw = { ...(ch.raw as Record<string, unknown>), costume, name: chName || name };
    } else {
      ch.raw = { ...(typeof ch.raw === 'object' && ch.raw ? ch.raw as Record<string, unknown> : {}), name: chName || name, costume };
    }
    hit = true;
    if (wantIdx >= 0) break;
  }
  if (!hit) {
    return { ok: false, error: { code: 'not_found', message: 'character not on card' } };
  }

  row.characters_json = JSON.stringify(chars);
  try {
    let meta = parseJsonOr(row.meta_json || '{}', {});
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {};
    const metaRec = meta as Record<string, unknown>;
    const metaChars = Array.isArray(metaRec.characters)
      ? (metaRec.characters as unknown[]).map((c) => (c && typeof c === 'object' ? { ...(c as object) } : c))
      : chars;
    for (let i = 0; i < metaChars.length; i++) {
      const ch = metaChars[i];
      if (!ch || typeof ch !== 'object') continue;
      const rec = ch as Record<string, unknown>;
      const chName = cleanText(rec.name, 200);
      if (wantIdx >= 0 ? i !== wantIdx : chName !== name) continue;
      rec.costume = costume;
      if (rec.raw && typeof rec.raw === 'object') {
        rec.raw = { ...(rec.raw as Record<string, unknown>), costume, name: chName || name };
      }
    }
    metaRec.characters = metaChars;
    row.meta_json = JSON.stringify(metaRec);
  } catch {
    /* best-effort meta mirror */
  }
  await idbPut('cards', row);
  return { ok: true, card_id: id, costume };
}

/**
 * Regenerates one card's image, replacing it with a new card at the same place.
 *
 * `mode: "full"` re-runs the entire originating job (tagging included) rather
 * than just the image.
 */
export async function rerollCard(
  cardId: string,
  mode = 'nai',
  overrides: unknown = null,
  opts: RerollOptions = {},
): Promise<ApiResult> {
  const row = await idbGet('cards', cardId);
  if (!row) return { ok: false, error: { code: 'not_found', message: 'card not found' } };
  const sessionId = row.session_id;
  const meta = parseJsonOr(row.meta_json || '{}', {}) as Record<string, unknown>;
  const prevLocMeta = (meta.location || {}) as Record<string, unknown>;

  if (!opts.skipBusyCheck) {
    try {
      const loc0 = await locationFieldsForCard(cardId, meta);
      const busy = await busyReplyForRequest(
        {
          session_id: sessionId,
          content_hash: cleanText(loc0.content_hash || meta.content_hash || '', 128),
          message_index: toInt(loc0.message_index, -1),
        },
        sessionId,
      );
      if (busy) return busy;
    } catch {
      /* an unreadable location must not block a reroll */
    }
  }

  const characterId = cleanText(prevLocMeta.character_id || meta.character_id || '', 200);
  let unifiedSessionId = cleanText(meta.unified_session_id || prevLocMeta.unified_session_id || '', 200);
  if (!unifiedSessionId && characterId) unifiedSessionId = unifiedSessionIdForCharacter(characterId);
  let sourceSessionIds: string[] = [];
  try {
    const job = await idbGet('jobs', row.job_id);
    if (job?.request_json) {
      const req = JSON.parse(job.request_json) as Record<string, unknown>;
      if (Array.isArray(req.source_session_ids)) {
        sourceSessionIds = req.source_session_ids.map((s) => cleanText(s, 200)).filter(Boolean);
      }
    }
  } catch {
    /* no readable job request means no cross-session sources */
  }
  const roster = await rosterForSession(sessionId, unifiedSessionId, characterId, sourceSessionIds);

  if (mode === 'full') {
    const job = await idbGet('jobs', row.job_id);
    if (!job) return { ok: false, error: { code: 'no_job', message: 'original job missing' } };
    const request = JSON.parse(job.request_json as string) as Record<string, unknown>;
    request.force = true;
    return createJob(request);
  }

  let scene: NaiScene;
  let embeddedCast: Array<{scope:string;id:string;name:string}> = [];
  try {
    const oldBytes = await getImageBytes(cardId);
    if (!oldBytes) throw new Error('이미지를 읽지 못했습니다.');
    const stored = readGenerationImageData(oldBytes);
    embeddedCast = stored?.characters || [];
    scene = requireNaiReplayScene(stored?.recipe ?? await extractNaiMetadata(oldBytes));
  } catch (err) {
    return { ok: false, error: { code: 'no_meta', message: String((err as Error)?.message || err) } };
  }

  const ov = overrides as Record<string, unknown> | null;
  if (ov && 'main_prompt' in ov) {
    const ovMain = cleanText(ov.main_prompt || '', 8000);
    if (ovMain) scene.main = ovMain;
  }
  if (ov && 'negative_prompt' in ov && cleanText(ov.negative_prompt || '', 8000)) {
    scene.negative = cleanText(ov.negative_prompt || '', 8000);
  }

  const ovChars = ov && Array.isArray(ov.characters) ? ov.characters : null;
  const ovHasCharPrompts = Boolean(
    ovChars?.some((ch) => ch && typeof ch === 'object' && cleanText((ch as Record<string, unknown>).prompt)),
  );
  const comic = cleanText(meta.kind, 20) === 'comic' || isComicNaiScene(scene);
  const stored = parseJsonOr(row.characters_json || '[]', []);
  const fromMeta = slimCardCharacters(meta.characters);
  scene.characters = resolveRerollCharacters({
    // Preserve the image's exact captions; roster changes supply reference files only.
    comic: true,
    sceneChars: scene.characters,
    stored,
    fromMeta,
    roster,
    overrideChars: ovChars,
    overrideHasPrompts: ovHasCharPrompts,
    limit: characterMaxLimit(getConfig().card || {}),
  });

  if (!cleanText(scene.model)) {
    return { ok: false, error: { code: 'no_model', message: '이미지 메타에 모델이 없습니다.' } };
  }

  const ovSeed = ov && 'seed' in ov ? Number(ov.seed) : NaN;
  const seedOverride = Number.isFinite(ovSeed) && ovSeed > 0 ? Math.floor(ovSeed) : undefined;
  const replayCast = embeddedCast.length ? embeddedCast : slimCardCharacters(parseJsonOr(row.characters_json || '[]', []))
    .map(c=>({scope:String(c.scope || ''),id:String(c.id || ''),name:String(c.name || '')}));
  const replayRequest = t2iRequestFromScene(scene, seedOverride || randomNaiSeed());
  const { bytes, seed, recipe } = await generateFromNaiReplay(
    replayRequest,
    replayCast,
  );
  const slimCast = slimCardCharacters(parseJsonOr(row.characters_json || '[]', []));
  const charList = slimCast;
  const main = scene.main;
  const neg = scene.negative;
  const genMetaExtra: Record<string, unknown> = {
    kind: comic ? 'comic' : cleanText(meta.kind, 20) || 'illustration',
    characters: slimCast,
  };
  const newId = uuid();
  const now = Date.now() / 1000;
  const storedLoc = await readImageLocation(row.id);
  const prevLoc = await findAssetMessage(row.id, storedLoc) || {...storedLoc,message_index:-1};
  // Reroll inherits the previous .c: the source asset file name already
  // carries the cast, so no roster minting is needed. Castless source →
  // filename stays without .c (chips empty by construction).
  let inheritCast: string[] = [];
  try {
    const prev = await shotCastIds(row.id);
    if (prev && Array.isArray(prev.ids)) inheritCast = prev.ids.filter(Boolean).map(String);
  } catch { /* keep castless */ }
  const location = {
    version: 1,
    image_id: newId,
    ...(inheritCast.length ? { cast_ids: inheritCast } : {}),
    session_id: sessionId,
    unified_session_id: unifiedSessionId,
    character_id: cleanText(prevLoc.character_id || '', 200),
    character_name: cleanText(prevLoc.character_name || meta.character_name || '', 200),
    chat_id: cleanText(prevLoc.chat_id || '', 200),
    chat_name: cleanText(prevLoc.chat_name || meta.chat_name || '', 200),
    char_index: toInt(prevLoc.char_index, -1),
    chat_index: toInt(prevLoc.chat_index, -1),
    message_index: toInt(prevLoc.message_index, -1),
    shot_index: toInt(prevLoc.shot_index, toInt(row.shot_index, 0)),
    paragraph: toInt(prevLoc.paragraph, toInt(row.paragraph, 0)),
    y_percent: toOptionalFloat(prevLoc.y_percent),
    content_hash: cleanText(prevLoc.content_hash || '', 128),
    assistant_preview: cleanText(prevLoc.assistant_preview || meta.assistant_preview || '', ASSISTANT_PREVIEW_LIMIT),
  };
  await publishImage(newId, bytes, location, {recipe:recipe || replayRequest,characters:replayCast,generatedAt:Date.now()});

  const genMeta = cardMetaFromLocation({ ...meta, ...genMetaExtra }, location, bytes.byteLength);
  // The old card's y position lives under three historical key names; drop all
  // of them so the location's value is the only one left.
  for (const key of ['y_percent', 'anchor_percent', 'read_percent']) delete genMeta[key];
  genMeta.y_percent = location.y_percent;
  const canvasW = Math.max(64, Math.round(Number(scene.width) || 832));
  const canvasH = Math.max(64, Math.round(Number(scene.height) || 1216));
  genMeta.aspect = aspectFromCanvas(canvasW, canvasH);
  genMeta.width = canvasW;
  genMeta.height = canvasH;

  await idbPut('cards', {
    id: newId,
    job_id: row.job_id,
    session_id: sessionId,
    shot_index: row.shot_index,
    paragraph: row.paragraph,
    main_prompt: '',
    negative_prompt: '',
    characters_json: JSON.stringify(slimCast),
    seed,
    meta_json: JSON.stringify(genMeta),
    created_at: now,
  });
  if (persistChatImagesOn()) {
      await rewriteBakedCardInChatMessage({
        charIndex: toInt(location.char_index, -1),
        chatIndex: toInt(location.chat_index, -1),
        messageIndex: toInt(location.message_index, -1),
        prevCardId: cardId,
        nextCardId: newId,
        characterId: location.character_id,
        chatId: location.chat_id,
      });
  }
  try { await deleteCard(cardId); } catch { /* A committed replacement can retain an orphan gallery row. */ }

  const card = {
    id: newId,
    image_url: resolveImageUrl(newId),
    main_prompt: main,
    negative_prompt: neg,
    characters: charList,
    seed,
    paragraph: location.paragraph,
    y_percent: location.y_percent,
    message_index: location.message_index,
    shot_index: location.shot_index,
    content_hash: location.content_hash,
    character_id: location.character_id,
    chat_id: location.chat_id,
    character_name: location.character_name,
    chat_name: location.chat_name,
    assistant_preview: location.assistant_preview,
    aspect: genMeta.aspect,
    width: canvasW,
    height: canvasH,
    storage: 'indexeddb',
    png_bytes: bytes.byteLength,
  };
  await attachImageUrls(card);
  return { ok: true, replaced: cardId, card };
}

export type CommandRewriteBody = {
  instruction?: unknown;
  preset_id?: unknown;
  look_locked?: unknown;
  main_prompt?: unknown;
  negative_prompt?: unknown;
  characters?: unknown;
};

/**
 * LLM rewrite for shot-tag form fields. Does not generate an image — the UI
 * fills textareas and the user chooses 저장 / 저장·리롤.
 */
export async function commandRewriteCard(cardId: string, body: CommandRewriteBody = {}): Promise<ApiResult> {
  const row = await idbGet('cards', cardId);
  if (!row) return { ok: false, error: { code: 'not_found', message: 'card not found' } };

  let currentMain = 'main_prompt' in body
    ? cleanText(body.main_prompt, 8000)
    : cleanText(row.main_prompt, 8000);
  let currentNeg = 'negative_prompt' in body
    ? cleanText(body.negative_prompt, 8000)
    : cleanText(row.negative_prompt, 8000);
  let currentChars: Array<Record<string, unknown>> = [];
  if (Array.isArray(body.characters)) {
    currentChars = body.characters.filter((c) => c && typeof c === 'object') as Array<Record<string, unknown>>;
  } else {
    const parsed = parseJsonOr(row.characters_json || '[]', []);
    currentChars = Array.isArray(parsed)
      ? (parsed.filter((c) => c && typeof c === 'object') as Array<Record<string, unknown>>)
      : [];
  }
  currentChars = currentChars.slice(0, characterMaxLimit(getConfig().card || {}));
  if (!('main_prompt' in body) || !('negative_prompt' in body) || !Array.isArray(body.characters)) {
    try {
      const scene = await loadCardImageScene(cardId);
      if (!('main_prompt' in body) && !currentMain) currentMain = scene.main;
      if (!('negative_prompt' in body) && !currentNeg) currentNeg = scene.negative;
      if (!Array.isArray(body.characters) && currentChars.every((c) => !cleanText(c.prompt))) {
        currentChars = scene.characters.map((c, i) => ({
          ...(currentChars[i] || {}),
          prompt: c.prompt,
          uc: c.uc,
        }));
      }
    } catch {
      /* form sent fields, or the image has no NovelAI metadata */
    }
  }

  const lookLockedRaw = Array.isArray(body.look_locked) ? body.look_locked : [];
  const lookLocked = currentChars.map((_, i) => lookLockedRaw[i] === true);

  const cardCfg = (getConfig().card || {}) as Record<string, unknown>;
  const presets: unknown[] = Array.isArray(cardCfg.presets) ? (cardCfg.presets as unknown[]) : [];
  const wantPreset = cleanText(body.preset_id, 120);
  const activeId = cleanText(cardCfg.active_preset_id, 120);
  let stylePositive = '';
  let chosenPreset: Record<string, unknown> | null = null;
  if (presets.length) {
    const id = wantPreset || activeId;
    if (id) {
      chosenPreset =
        (presets.find(
          (p) => typeof p === 'object' && p && cleanText((p as Record<string, unknown>).id, 120) === id,
        ) as Record<string, unknown> | undefined) || null;
    }
    if (!chosenPreset && typeof presets[0] === 'object') chosenPreset = presets[0] as Record<string, unknown>;
    if (chosenPreset) {
      stylePositive = cleanText(chosenPreset.positive || chosenPreset.pos || '', 8000);
    }
  }

  const instruction = cleanText(body.instruction, 4000);
  const payload = {
    instruction: instruction || '(empty — creatively randomize unlocked fields)',
    main_prompt: currentMain,
    negative_prompt: currentNeg,
    characters: currentChars.map((ch, i) => ({
      index: i,
      name: cleanText(ch.name, 200),
      prompt: cleanText(ch.prompt, 4000),
      look_locked: lookLocked[i],
      look_tags: lookLocked[i] ? cleanText(ch.prompt, 4000) : '',
      uc: cleanText(ch.uc, 2000),
    })),
  };

  const system = stripCbs(await getPrompt('command_reroll'));
  const messages: LlmMessage[] = [
    { role: 'system', content: system || 'Rewrite prompts. Return JSON only.' },
    { role: 'user', content: JSON.stringify(payload) },
  ];
  let raw = '';
  try {
    raw = await callLlm(getConfig().llm, messages);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'llm_failed',
        message: `명령 수정 LLM 실패: ${String((err as Error)?.message || err).slice(0, 240)}`,
      },
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonLoose(raw) as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'parse_failed',
        message: String((err as Error)?.message || err).slice(0, 240),
      },
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: { code: 'parse_failed', message: 'LLM returned non-object JSON' } };
  }

  const naiaModel = modelToNaia(getConfig().nai?.model || 'nai-diffusion-4-5-full');
  const qualitySuffixes = Object.values(QUALITY_TAGS).filter(Boolean);
  if (QUALITY_TAGS[naiaModel]) qualitySuffixes.unshift(QUALITY_TAGS[naiaModel]);
  const stylePositives = collectStylePositives(cardCfg);
  const meta = parseJsonOr(row.meta_json || '{}', {}) as Record<string, unknown>;
  const person = cleanText(meta.person || '', 400);
  const presetId = cleanText((chosenPreset?.id as string) || wantPreset || activeId, 120);

  if (commandRewriteHasDeltas(parsed)) {
    const sceneKeys = new Set(splitTagTokens(stripPersonCountTags(currentMain)).map((t) => t.toLowerCase()));
    const personFromMain = splitTagTokens(currentMain).filter((t) => !sceneKeys.has(t.toLowerCase()));
    const merged = mergeCommandRewriteDeltas({
      currentMain,
      currentNeg,
      currentChars,
      lookLocked,
      parsed,
      protectMain: [...stylePositives, ...qualitySuffixes, person, ...personFromMain],
    });
    return { ok: true, ...merged, preset_id: presetId };
  }

  const main_prompt = mergeCommandRewriteMain({
    currentMain,
    setup: parsed.setup,
    mainPrompt: parsed.main_prompt,
    stylePositive,
    person,
    stylePositives,
    qualitySuffixes,
  });
  const negFromLlm = cleanText(parsed.negative_prompt, 8000);
  const negative_prompt = negFromLlm || currentNeg;
  const characters = mergeCommandRewriteCharacters(currentChars, parsed.characters, lookLocked);

  return {
    ok: true,
    main_prompt,
    negative_prompt,
    characters,
    preset_id: presetId,
  };
}

/**
 * Rerolls every card attached to one message, in reading order.
 *
 * Stops at the first card that reports busy, since that means something else
 * has taken the message and the remaining rerolls would race it.
 */
export async function rerollMessageCards({
  session_id = '',
  content_hash = '',
  message_index = -1,
}: RerollMessageArgs = {}): Promise<ApiResult> {
  const sessionId = cleanText(session_id, 200);
  const contentHash = cleanText(content_hash, 128);
  const msgIndex = toInt(message_index, -1);
  if (!sessionId && !contentHash && msgIndex < 0) {
    return { ok: false, error: { code: 'bad_request', message: 'session_id or content_hash required' } };
  }

  const targets: Array<{row:CardRow}> = [];
  for (const id of await messageAssetIds(sessionId, msgIndex)) {
    const row = await idbGet('cards', id);
    if (row) targets.push({row});
  }
  if (!targets.length) return { ok: false, error: { code: 'not_found', message: 'no cards for message' } };

  const sid = sessionId || cleanText(targets[0]?.row?.session_id || '', 200);
  const keyReq = { session_id: sid, content_hash: contentHash, message_index: msgIndex };
  const busy = await busyReplyForRequest(keyReq, sid);
  if (busy) return busy;

  const key = jobKey(keyReq, sid);
  clearMessageRerollStop();
  messageBusyKeys.add(key);
  const cards: unknown[] = [];
  const replaced: unknown[] = [];
  const failed: Array<{ id: string; error: unknown }> = [];
  let stopped = false;
  try {
    for (const item of targets) {
      if (isMessageRerollStopRequested()) {
        stopped = true;
        dbg('cards.reroll_message.stop', { done: cards.length, total: targets.length, focus: true });
        break;
      }
      const row = item.row;
      try {
        const result = (await rerollCard(row.id, 'nai', null, { skipBusyCheck: true })) as Record<string, unknown>;
        if (result?.busy) {
          failed.push({ id: row.id, error: (result.error as Record<string, unknown>)?.message || 'busy' });
          break;
        }
        if (result?.ok && result.card) {
          cards.push(result.card);
          if (result.replaced) replaced.push(result.replaced);
        } else {
          failed.push({
            id: row.id,
            error: cleanText((result?.error as Record<string, unknown>)?.message || 'reroll failed', 400),
          });
        }
      } catch (error) {
        failed.push({ id: row.id, error: cleanText((error as Error)?.message || error, 400) });
      }
    }
    return { ok: cards.length > 0 || stopped, count: cards.length, replaced, cards, failed, stopped };
  } finally {
    messageBusyKeys.delete(key);
  }
}
