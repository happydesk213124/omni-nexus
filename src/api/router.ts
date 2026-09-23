/**
 * The HTTP-shaped API the frozen UI bundle calls.
 *
 * 1.x expressed this as one ~280-line if/else chain, which made the two things
 * that actually matter here invisible:
 *
 *  1. **Order is semantics.** Matching is prefix-based, so `/v1/gallery/explore`
 *     must be tested before the `/v1/gallery` prefix or explore requests get
 *     served as a plain gallery list. The route table below is evaluated
 *     top-to-bottom and its order is load-bearing — reordering entries changes
 *     behaviour even though no individual entry changed.
 *  2. **Two routes are public.** `/v1/health` and `/v1/debug` are answered before
 *     the auth check so a user with a misconfigured token can still see why.
 *
 * Adding a route means adding one entry. Every route reads its inputs from the
 * `RouteContext` and returns a `RouteResult`; nothing else in this file needs to
 * change.
 */

import { errorBody, isFetchError, makeFetchError } from '../core/errors';
import { clearDebug, debugSnapshot } from '../core/debug';
import { base64ToBytes, u8ToArrayBuffer } from '../core/util/bytes';
import { cleanText } from '../core/util/text';
import { GLOBAL_SCOPE, normalizeCharRefScope } from '../core/constants';
import { getConfig, getPresetVibePreviewUrl } from '../services/context';
import * as cards from '../services/cards';
import * as characters from '../services/characters';
import * as diagnostics from '../services/diagnostics';
import * as gallery from '../services/gallery';
import * as generation from '../services/generation';
import * as jobs from '../services/jobs';
import * as naiAssets from '../services/nai-assets';
import * as presetLook from '../services/preset-look';
import * as chatChrome from '../services/chat-chrome';
import * as lorefilter from '../services/lorefilter';
import * as charImport from '../services/char-import';
import * as settings from '../services/settings';
import * as storageMigrate from '../services/storage-migrate';
import * as sessionAuthorNote from '../services/session-author-note';
import * as charCommandPresets from '../services/char-command-presets';
import * as charCommand from '../services/char-command';
import * as characterPreview from '../services/character-preview';
import * as characterExample from '../services/character-example';
import * as castIds from '../services/cast-ids';
import { authorized, parseQuery, q, qAll, type Headers, type Query } from './http';

export interface RouteResult {
  status: number;
  data: unknown;
  contentType?: string;
  /** True when `data` is raw bytes rather than a JSON value. */
  raw?: boolean;
}

export interface RouteContext {
  method: string;
  pathname: string;
  query: Query;
  body: Record<string, unknown>;
  /** The variable part of the path, for prefix and wrapped matches. */
  param: string;
}

type Matcher = (pathname: string) => string | null;

/** Matches any of the given paths exactly. */
const exact =
  (...paths: string[]): Matcher =>
  (pathname) =>
    paths.includes(pathname) ? '' : null;

/** Matches a path prefix; the remainder becomes `ctx.param`. */
const under =
  (prefix: string): Matcher =>
  (pathname) =>
    pathname.startsWith(prefix) ? pathname.slice(prefix.length) : null;

/** Matches `<prefix><param><suffix>`, e.g. `/v1/cards/:id/tags`. */
const wrapped =
  (prefix: string, suffix: string): Matcher =>
  (pathname) =>
    pathname.startsWith(prefix) && pathname.endsWith(suffix)
      ? pathname.slice(prefix.length, pathname.length - suffix.length)
      : null;

interface Route {
  match: Matcher;
  handler: (ctx: RouteContext) => Promise<RouteResult> | RouteResult;
}

const ok = (data: unknown): RouteResult => ({ status: 200, data });
const png = (data: ArrayBuffer): RouteResult => ({ status: 200, data, contentType: 'image/png', raw: true });
const notFound = (message: string): never => {
  throw makeFetchError(404, { ok: false, ...errorBody(message, 'not_found') }, message);
};

function firstBodyText(rec: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const raw = rec[key];
    const v = Array.isArray(raw) ? raw[0] : raw;
    const s = cleanText(v, 200);
    if (s) return s;
  }
  return '';
}

function refScopeFrom(body: Record<string, unknown> | Query, sessionFallback = ''): string {
  const rec = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const sessionId = firstBodyText(rec, 'session_id', 'sessionId') || cleanText(sessionFallback, 200);
  const scope = normalizeCharRefScope(firstBodyText(rec, 'scope', 'char_scope'), sessionId);
  if (scope) return scope;
  return sessionId;
}

function uploadBase64(body: Record<string, unknown>): string {
  let raw = body.image_b64 || body.data || '';
  if (typeof raw === 'string' && raw.startsWith('data:')) raw = raw.split(',', 2)[1] ?? '';
  return String(raw || '');
}

// ── GET ────────────────────────────────────────────────────────────────────

// `/v1/debug` is absent from both tables on purpose: `routeFetch` answers it
// before the auth check and returns unconditionally, so an entry here could
// never be reached.
const GET_ROUTES: readonly Route[] = [
  { match: exact('/v1/settings/export'), handler: async () => ok({ ok: true, json: await settings.exportSettingsJson() }) },
  { match: exact('/v1/settings'), handler: () => ok({ ok: true, settings: settings.publicSettings() }) },
  {
    match: exact('/v1/storage/migrate/status'),
    handler: async () => ok(await storageMigrate.storageMigrateInfo()),
  },
  { match: exact('/v1/prompts'), handler: async () => ok({ ok: true, prompts: await settings.listPrompts() }) },
  {
    match: exact('/v1/prompts/export'),
    handler: async () => ok({ ok: true, ...(await settings.exportPromptsPack()) }),
  },
  {
    match: under('/v1/prompts/'),
    handler: async ({ param }) => ok({ ok: true, key: param, text: await settings.getPrompt(param) }),
  },
  { match: under('/v1/jobs/'), handler: async ({ param }) => ok(await jobs.getJob(param)) },
  {
    match: under('/v1/gallery/explore'),
    handler: async ({ query }) => ok(await gallery.galleryExplore(Number(q(query, 'limit', '0')))),
  },
  { match: exact('/v1/gallery/favorites'), handler: async () => ok(await gallery.getExplorerFavorites()) },
  {
    match: under('/v1/gallery'),
    handler: async ({ query }) =>
      ok(
        await gallery.gallery(
          q(query, 'session_id'),
          Number(q(query, 'limit', '40')),
          [...qAll(query, 'hashes'), ...qAll(query, 'content_hash')],
        ),
      ),
  },
  {
    match: exact('/v1/nai/reference.png'),
    handler: async () => png((await naiAssets.getReferenceImageBytes()) ?? notFound('no reference')),
  },
  {
    match: exact('/v1/nai/vibe.png'),
    handler: async () => png((await naiAssets.getVibeImageBytes()) ?? notFound('no vibe')),
  },
  {
    match: exact('/v1/nai/reference'),
    handler: async () => {
      const configured = await naiAssets.hasReferenceImage();
      return ok({
        ok: true,
        configured,
        image_reference: getConfig().nai?.image_reference || 'none',
        preview_url: configured ? '/v1/nai/reference.png' : '',
      });
    },
  },
  {
    match: exact('/v1/nai/vibe'),
    handler: async () => {
      const configured = await naiAssets.hasVibeTransfer();
      return ok({
        ok: true,
        configured,
        vibe_transfer: getConfig().nai?.vibe_transfer || 'none',
        preview_url: configured ? '/v1/nai/vibe.png' : '',
      });
    },
  },
  { match: exact('/v1/nai/quota'), handler: async () => ok(await diagnostics.listNaiQuota()) },
  {
    match: exact('/v1/characters/import-picker'),
    handler: async ({ query }) =>
      ok(await charImport.listImportPicker(q(query, 'kind') || '', q(query, 'character_id') || '')),
  },
  {
    match: exact('/v1/characters/lorefilter'),
    handler: async ({ query }) => {
      const cid = cleanText(q(query, 'character_id') || q(query, 'id'), 200);
      return ok(await lorefilter.getLorefilterPayload({ character_id: cid }));
    },
  },
  {
    match: exact('/v1/session-author-note'),
    handler: async ({ query }) => ok(await sessionAuthorNote.getSessionAuthorNote(q(query, 'session_id') || q(query, 'sessionId'))),
  },
  {
    match: exact('/v1/character-command-presets'),
    handler: async () => ok(await charCommandPresets.listCommandPresets()),
  },
  {
    match: exact('/v1/session-author-note-presets'),
    handler: async () => ok(await sessionAuthorNote.listSessionAuthorNotePresets()),
  },
  {
    match: exact('/v1/characters/example-shot'),
    handler: async ({ query }) => {
      const cid = cleanText(q(query, 'character_id') || q(query, 'id'), 200);
      if (!cid) throw new Error('character_id required');
      const scope = refScopeFrom(query);
      if (!scope) throw new Error('scope required');
      return ok(await characterExample.getCharacterExample(scope, cid));
    },
  },
  {
    match: exact('/v1/characters/ref'),
    handler: async ({ query }) => {
      const cid = cleanText(q(query, 'character_id') || q(query, 'id'), 200);
      if (!cid) throw new Error('character_id required');
      const scope = refScopeFrom(query);
      if (!scope) throw new Error('scope required');
      const configured = await naiAssets.hasCharRefImage(scope, cid);
      return ok({
        ok: true,
        character_id: cid,
        scope,
        configured,
        preview_url: configured ? await naiAssets.ensureCharRefPreviewUrl(scope, cid) : '',
      });
    },
  },
  {
    match: under('/v1/characters'),
    handler: async ({ query }) =>
      ok(await characters.getCharactersPayload(q(query, 'session_id'), q(query, 'character_id'))),
  },
  {
    match: under('/v1/appearance/'),
    handler: async ({ param }) => ok(await characters.getCharactersPayload(param)),
  },
  {
    match: wrapped('/v1/cards/', '/nai-prompt'),
    handler: async ({ param }) => ok(await cards.readCardNaiPrompts(param)),
  },
  {
    match: under('/v1/images/'),
    handler: async ({ param }) => {
      let cardId = param.replace(/^\/+|\/+$/g, '');
      if (cardId.endsWith('.json')) {
        const loc = await generation.locateBakedImage(cardId.slice(0, -'.json'.length));
        if (!Object.keys(loc).length) notFound('location missing');
        return ok(loc);
      }
      if (cardId.endsWith('.png')) cardId = cardId.slice(0, -'.png'.length);
      return png((await gallery.getImageBytes(cardId)) ?? notFound('image missing'));
    },
  },
  {
    // Card id → character asset name (legacy gallery module fallback).
    // The rendered img URL is Risu's file path and carries no cast segment.
    match: exact('/v1/shots/cast'),
    handler: async ({ query }) => ok(await castIds.shotCastIds(q(query, 'card_id'))),
  },
  {
    // Asset file name (data-inray-asset) → image URL + resolved cast
    // names. One round trip for the ⛶ handler: the name on the div is the
    // only key that survives a reload, because Risu owns the files.
    match: exact('/v1/shots/asset'),
    handler: async ({ query }) => ok(await castIds.shotAssetByName(q(query, 'name'), q(query, 'cast') !== '0', q(query, 'display') === 'blob' ? 'blob' : 'data')),
  },
];

// ── POST / PUT / PATCH ─────────────────────────────────────────────────────

const WRITE_ROUTES: readonly Route[] = [
  { match: exact('/v1/settings/reset'), handler: async () => ok(await settings.resetSettings()) },
  {
    match: exact('/v1/settings/import'),
    handler: async ({ body }) => ok(await settings.importSettingsJson(String(body.json || body.text || ''))),
  },
  {
    match: exact('/v1/settings', '/v1/settings/update'),
    handler: async ({ body }) => ok(await settings.updateSettings(body)),
  },
  {
    match: exact('/v1/prompts/import'),
    handler: async ({ body }) =>
      ok(await settings.importPromptsPack(body?.json != null ? body.json : body?.prompts != null ? body : body)),
  },
  {
    match: exact('/v1/prompts/reset-defaults'),
    handler: async ({ body }) =>
      ok(
        await settings.resetPromptsToDefaults({
          keep_author_note: body?.keep_author_note !== false && body?.keepAuthorNote !== false,
        }),
      ),
  },
  {
    match: wrapped('/v1/prompts/', '/reset'),
    handler: async ({ param }) => ok(await settings.resetPrompt(param)),
  },
  {
    match: under('/v1/prompts/'),
    handler: async ({ param, body }) => ok(await settings.setPrompt(param, String(body.text || ''))),
  },
  {
    match: exact('/v1/jobs/create', '/v1/jobs'),
    handler: async ({ body }) => ({ status: 202, data: await jobs.createJob(body) }),
  },
  {
    match: exact('/v1/jobs/commit-output'),
    handler: async ({ body }) => ok(await jobs.commitStreamOutput(body)),
  },
  {
    match: exact('/v1/jobs/retarget-hash'),
    handler: async ({ body }) =>
      ok(
        await jobs.retargetJobSaveHash({
          host_message_id: String(body.host_message_id || body.hostMessageId || ''),
          session_id: String(body.session_id || body.sessionId || ''),
          character_id: String(body.character_id || body.characterId || ''),
          chat_id: String(body.chat_id || body.chatId || ''),
          message_index: body.message_index ?? body.messageIndex ?? body.chatIndex,
          role: String(body.role || body.message_role || ''),
          to_hash: String(body.to_hash || body.content_hash || body.hash || ''),
          assistant_preview: String(body.assistant_preview || body.assistant_text || body.text || ''),
        }),
      ),
  },
  {
    match: exact('/v1/jobs/busy-message'),
    handler: async ({ body }) =>
      ok(
        await jobs.busyJobForMessage({
          session_id: String(body.session_id || body.sessionId || ''),
          character_id: String(body.character_id || body.characterId || ''),
          chat_id: String(body.chat_id || body.chatId || ''),
          message_index: body.message_index ?? body.messageIndex ?? body.chatIndex,
          role: String(body.role || body.message_role || ''),
        }),
      ),
  },
  {
    match: exact('/v1/jobs/stop'),
    handler: async ({ body }) =>
      ok(
        await jobs.requestJobStop({
          session_id: String(body.session_id || body.sessionId || ''),
        }),
      ),
  },
  {
    match: exact('/v1/gallery/unlink', '/v1/cards/unlink'),
    handler: async ({ body }) =>
      ok(
        await gallery.unlinkCardsForMessage(
          String(body.session_id || ''),
          String(body.content_hash || ''),
          body.message_index,
          body.host_message_id || body.hostMessageId,
        ),
      ),
  },
  {
    match: exact('/v1/gallery/rebind-hash', '/v1/cards/rebind-hash'),
    handler: async ({ body }) =>
      ok(
        await gallery.rebindCardsHash({
          session_id: String(body.session_id || body.sessionId || ''),
          card_ids: (body.card_ids || body.ids || []) as unknown[],
          to_hash: String(body.to_hash || body.content_hash || ''),
          assistant_preview: String(body.assistant_preview || body.assistant_text || ''),
        }),
      ),
  },
  {
    match: exact('/v1/gallery/delete', '/v1/cards/delete'),
    handler: async ({ body }) => {
      const folderKey = cleanText(body.folder_key || '', 400);
      const cardId = cleanText(body.card_id || body.id || '', 80);
      const cardIds = Array.isArray(body.card_ids) ? body.card_ids : null;
      if (folderKey) return ok(await gallery.deleteFolder(folderKey));
      if (cardIds?.length) return ok(await gallery.deleteCards(cardIds));
      if (cardId) return ok(await gallery.deleteCard(cardId));
      const message = 'card_id or folder_key required';
      throw makeFetchError(400, { ok: false, ...errorBody(message, 'bad_request') }, message);
    },
  },
  { match: exact('/v1/gallery/export'), handler: async ({ body }) => ok(await gallery.exportGalleryZip(body)) },
  { match: exact('/v1/gallery/import'), handler: async ({ body }) => ok(await gallery.importGalleryZip(body)) },
  {
    match: exact('/v1/gallery/favorites'),
    handler: async ({ body }) => {
      if (Array.isArray(body.ids)) return ok(await gallery.setExplorerFavorites(body.ids));
      return ok(await gallery.getExplorerFavorites());
    },
  },
  {
    match: exact('/v1/cards/nai-from-image'),
    handler: async ({ body }) => ok(await cards.readImageNaiPrompts(body)),
  },
  {
    // Filename-cast lookup: fullscreen overlay reads cast ids from the webp
    // name and resolves them to roster names here. Unknown ids resolve to ''.
    match: exact('/v1/shots/resolve-cast'),
    handler: async ({ body }) =>
      ok(await (body.details === true ? castIds.resolveCastCharacters : castIds.resolveCastNames)(Array.isArray(body.ids) ? body.ids : [])),
  },
  {
    match: wrapped('/v1/cards/', '/tags'),
    handler: async ({ param, body }) => ok(await cards.updateCardTags(param, body)),
  },
  {
    match: wrapped('/v1/cards/', '/studio-generate'),
    handler: async ({ param, body }) => ok(await cards.studioGenerate(param, body)),
  },
  {
    match: wrapped('/v1/cards/', '/studio-commit'),
    handler: async ({ param, body }) => ok(await cards.studioCommit(param, body)),
  },
  {
    match: wrapped('/v1/cards/', '/reroll'),
    handler: async ({ param, body }) => ok(await cards.rerollCard(param, String(body.mode || 'nai'), body.overrides)),
  },
  {
    match: wrapped('/v1/cards/', '/command-rewrite'),
    handler: async ({ param, body }) => ok(await cards.commandRewriteCard(param, body)),
  },
  {
    match: exact('/v1/messages/reroll', '/v1/gallery/reroll-message'),
    handler: async ({ body }) =>
      ok(
        await cards.rerollMessageCards({
          session_id: String(body.session_id || body.sessionId || ''),
          content_hash: String(body.content_hash || body.contentHash || ''),
          message_index: Number(body.message_index ?? body.messageIndex ?? -1),
        }),
      ),
  },
  {
    match: exact('/v1/session-author-note'),
    handler: async ({ body }) =>
      ok(await sessionAuthorNote.setSessionAuthorNote(body.session_id || body.sessionId, body)),
  },
  {
    match: exact('/v1/session-author-note-presets'),
    handler: async ({ body }) => ok(await sessionAuthorNote.saveSessionAuthorNotePresets(body.items ?? body)),
  },
  {
    match: exact('/v1/character-command-presets'),
    handler: async ({ body }) => ok(await charCommandPresets.saveCommandPresets(body.items ?? body)),
  },
  {
    match: exact('/v1/characters/preview-shot'),
    handler: async ({ body }) => ok(await characterPreview.generateCharacterPreview(body)),
  },
  {
    match: exact('/v1/characters/example-shot'),
    handler: async ({ body }) => {
      const cid = cleanText(body.character_id || body.characterId || body.id || '', 200);
      const scope = refScopeFrom(body);
      if (body.clear) {
        if (!cid) throw new Error('character_id required');
        if (!scope) throw new Error('scope required');
        return ok(await characterExample.clearCharacterExample(scope, cid));
      }
      const rawB64 = uploadBase64(body);
      if (body.generate || !cleanText(rawB64)) {
        return ok(await characterExample.generateCharacterExample(body));
      }
      if (!cid) throw new Error('character_id required');
      if (!scope) throw new Error('scope required');
      return ok(await characterExample.setCharacterExample(scope, cid, u8ToArrayBuffer(base64ToBytes(rawB64))));
    },
  },
  {
    match: exact('/v1/characters/example-shot/clear'),
    handler: async ({ body }) => {
      const cid = cleanText(body?.character_id || body?.characterId || body?.id || '', 200);
      if (!cid) throw new Error('character_id required');
      const scope = refScopeFrom(body);
      if (!scope) throw new Error('scope required');
      return ok(await characterExample.clearCharacterExample(scope, cid));
    },
  },
  {
    match: wrapped('/v1/characters/', '/command-rewrite'),
    handler: async ({ param, body }) => ok(await charCommand.commandRewriteCharacter(param.replace(/^\//, ''), body)),
  },
  {
    match: exact('/v1/characters/analyze-asset'),
    handler: async ({ body }) => {
      const rawB64 = uploadBase64(body).replace(/\s+/g, '');
      if (!rawB64) throw new Error('image_b64 required');
      return ok(
        await charImport.analyzeAssetLook(base64ToBytes(rawB64), {
          name: body.name,
          aliases: body.aliases,
          assetName: body.asset_name || body.assetName,
          sessionId: body.session_id || body.sessionId,
          characterId: body.character_id || body.characterId,
        }),
      );
    },
  },
  {
    match: exact('/v1/characters/import-fill'),
    handler: async ({ body }) => ok(await charImport.runImportFill(body)),
  },
  {
    match: exact('/v1/characters/lorefilter'),
    handler: async ({ body }) => {
      if (body?.rescan === true || body?.action === 'rescan') {
        return ok(
          await lorefilter.rescanLorefilter({
            character_id: cleanText(body?.character_id || '', 200),
            lorebook: Array.isArray(body?.lorebook) ? body.lorebook : null,
          }),
        );
      }
      return ok(
        await lorefilter.setLorefilterSelected({
          character_id: cleanText(body?.character_id || '', 200),
          selected: body?.selected,
        }),
      );
    },
  },
  {
    match: exact('/v1/characters/global-toggles', '/v1/characters/global_toggles'),
    handler: async ({ body }) =>
      ok(
        await characters.setDisabledGlobals(
          String(body.character_id || ''),
          (body.disabled_globals || body.disabled || []) as unknown[],
        ),
      ),
  },
  {
    match: exact('/v1/characters/triggered'),
    handler: async ({ body }) => ok(await characters.matchTriggeredCharactersPayload(body)),
  },
  {
    match: exact('/v1/characters/unify', '/v1/characters/merge'),
    handler: async ({ body }) =>
      ok(
        await characters.unifyCharacterSessions(
          String(body.target_session_id || body.session_id || ''),
          (body.source_session_ids || body.session_ids || []) as unknown[],
          body.include_target !== false,
        ),
      ),
  },
  {
    match: exact('/v1/characters/ref', '/v1/characters/ref/upload'),
    handler: async ({ body }) => {
      const cid = cleanText(body.character_id || body.characterId || body.id || '', 200);
      if (!cid) throw new Error('character_id required');
      const scope = refScopeFrom(body);
      if (!scope) throw new Error('scope required');
      if (body.clear) return ok(await naiAssets.clearCharRefImage(scope, cid));
      if (body.copy_from) {
        const from = cleanText(body.copy_from, 200);
        const fromScope = refScopeFrom({
          scope: body.copy_from_scope || body.from_scope || body.scope,
          session_id: body.session_id,
        });
        const copied = from ? await naiAssets.copyCharRefImage(fromScope || scope, from, scope, cid) : false;
        return ok({
          ok: true,
          character_id: cid,
          scope,
          configured: copied,
          preview_url: copied ? await naiAssets.ensureCharRefPreviewUrl(scope, cid) : '',
        });
      }
      const rawB64 = uploadBase64(body);
      if (!cleanText(rawB64)) throw new Error('image_b64 required');
      return ok(
        await naiAssets.setCharRefImage(scope, cid, u8ToArrayBuffer(base64ToBytes(rawB64)), {
          overwrite: body.overwrite !== false,
          quality: Number(body.quality) > 0 && Number(body.quality) <= 1 ? Number(body.quality) : undefined,
        }),
      );
    },
  },
  {
    match: exact('/v1/characters/ref/clear'),
    handler: async ({ body }) => {
      const cid = cleanText(body?.character_id || body?.characterId || body?.id || '', 200);
      if (!cid) throw new Error('character_id required');
      const scope = refScopeFrom(body);
      if (!scope) throw new Error('scope required');
      return ok(await naiAssets.clearCharRefImage(scope, cid));
    },
  },
  {
    match: exact('/v1/characters/ref/hydrate'),
    handler: async ({ body, query }) =>
      ok(
        await naiAssets.hydrateCharRefs({
          sessionId: cleanText(body.session_id || q(query, 'session_id'), 200),
          characterId: cleanText(body.character_id || body.characterId || q(query, 'character_id'), 200),
          scope: cleanText(body.scope || q(query, 'scope'), 200),
        }),
      ),
  },
  {
    match: exact('/v1/characters/ref/reset'),
    handler: async () => ok(await naiAssets.resetAllCharacterRefs()),
  },
  {
    match: exact('/v1/chat/restore-chrome'),
    handler: async () => ok(await chatChrome.remountChatCardChrome()),
  },
  {
    match: exact('/v1/storage/migrate/cancel'),
    handler: () => ok(storageMigrate.cancelStorageMigration()),
  },
  {
    match: exact('/v1/storage/migrate'),
    handler: async () => ok(await storageMigrate.startStorageMigration()),
  },
  { match: exact('/v1/characters', '/v1/characters/update'), handler: ({ body }) => updateCharacters(body) },
  {
    match: under('/v1/appearance/'),
    handler: async ({ param, body }) => {
      if (body.characters != null || body.global != null) {
        if (body.characters != null) {
          await characters.replaceCharacters(param, (body.characters || []) as unknown[], { prune: true });
        }
        if (body.global != null) {
          await characters.replaceCharacters(GLOBAL_SCOPE, (body.global || []) as unknown[], { prune: true });
        }
        return ok(await characters.getCharactersPayload(param));
      }
      return ok(await characters.setAppearance(param, body.appearance || {}));
    },
  },
  {
    match: exact('/v1/models/test'),
    handler: async ({ body }) => ok(await diagnostics.testLlm(body.llm && typeof body.llm === 'object' ? body.llm : null)),
  },
  {
    match: exact('/v1/nai/test'),
    handler: async ({ body }) => ok(await diagnostics.testNai(
      body.nai && typeof body.nai === 'object' ? body.nai : null,
    )),
  },
  {
    match: exact('/v1/nai/probe', '/v1/debug/probe-nai'),
    handler: async () => ok(await diagnostics.probeNaiGenerate()),
  },
  {
    match: exact('/v1/debug/clear'),
    handler: () => {
      clearDebug();
      return ok({ ok: true, cleared: true });
    },
  },
  {
    match: exact('/v1/debug/asset-tags'),
    handler: async ({ body }) => ok(await diagnostics.probeAssetNaiTags(body)),
  },
  {
    match: exact('/v1/nai/reference', '/v1/nai/reference/upload'),
    handler: async ({ body }) => {
      if (body.clear) return ok(await naiAssets.clearReferenceImage());
      const rawB64 = uploadBase64(body);
      if (!cleanText(rawB64)) throw new Error('image_b64 required');
      return ok(await naiAssets.setReferenceImage(u8ToArrayBuffer(base64ToBytes(rawB64))));
    },
  },
  { match: exact('/v1/nai/reference/clear'), handler: async () => ok(await naiAssets.clearReferenceImage()) },
  {
    match: exact('/v1/nai/vibe', '/v1/nai/vibe/upload'),
    handler: async ({ body }) => {
      const presetId = cleanText(body.preset_id || body.presetId || '', 120);
      if (body.clear) {
        if (presetId) return ok(await naiAssets.clearPresetVibeTransfer(presetId));
        return ok(await naiAssets.clearVibeTransfer());
      }
      if (presetId && body.copy_from) {
        const from = cleanText(body.copy_from, 120);
        const copied = from ? await naiAssets.copyPresetVibeTransfer(from, presetId) : false;
        return ok({
          ok: true,
          preset_id: presetId,
          configured: copied,
          preview_url: copied ? getPresetVibePreviewUrl(presetId) : '',
        });
      }
      const rawB64 = uploadBase64(body);
      if (!cleanText(rawB64)) throw new Error('image_b64 required');
      const opts = {
        model: body.model,
        information_extracted: body.information_extracted ?? body.vibe_transfer_information_extracted,
        strength: body.strength ?? body.vibe_transfer_strength,
      };
      if (presetId) {
        return ok(await naiAssets.setPresetVibeTransfer(presetId, u8ToArrayBuffer(base64ToBytes(rawB64)), opts));
      }
      return ok(await naiAssets.setVibeTransfer(u8ToArrayBuffer(base64ToBytes(rawB64)), opts));
    },
  },
  {
    match: exact('/v1/nai/vibe/clear'),
    handler: async ({ body }) => {
      const presetId = cleanText(body?.preset_id || body?.presetId || '', 120);
      if (presetId) return ok(await naiAssets.clearPresetVibeTransfer(presetId));
      return ok(await naiAssets.clearVibeTransfer());
    },
  },
  {
    match: exact('/v1/autotag', '/v1/autotag/evaluate'),
    handler: async ({ body }) => {
      const rawB64 = uploadBase64(body).replace(/\s+/g, '');
      if (!rawB64) throw new Error('image_b64 required');
      const bytes = base64ToBytes(rawB64);
      return ok(await diagnostics.evaluateAutotag(u8ToArrayBuffer(bytes), Number(body.threshold ?? 0.2)));
    },
  },
  {
    match: exact('/v1/presets/look/clear'),
    handler: async ({ body }) => ok(await presetLook.clearPresetLook(String(body.preset_id || body.presetId || ''))),
  },
  {
    match: exact('/v1/presets/look/generate'),
    handler: async ({ body }) => ok(await presetLook.generatePresetLook(body)),
  },
  {
    match: exact('/v1/presets/look'),
    handler: async ({ body }) => {
      const presetId = cleanText(body.preset_id || body.presetId || '', 120);
      if (body.clear) return ok(await presetLook.clearPresetLook(presetId));
      const rawB64 = uploadBase64(body);
      if (!cleanText(rawB64)) throw new Error('image_b64 required');
      return ok(await presetLook.setPresetLook(presetId, u8ToArrayBuffer(base64ToBytes(rawB64))));
    },
  },
  {
    match: exact('/v1/presets/from-image'),
    handler: async ({ body }) => {
      const rawB64 = uploadBase64(body).replace(/\s+/g, '');
      if (!rawB64) throw new Error('image_b64 required');
      const bytes = base64ToBytes(rawB64);
      const rawFilter = body.filter_tags;
      const filterTags = rawFilter !== false && rawFilter !== 'false' && rawFilter !== 0 && rawFilter !== '0';
      return ok(await diagnostics.evaluatePresetFromImage(u8ToArrayBuffer(bytes), { filterTags }));
    },
  },
];

/**
 * The characters write route is the one endpoint that performs several
 * operations per request, because the unified editor saves a whole view at once
 * and the order of those writes matters.
 */
async function updateCharacters(body: Record<string, unknown>): Promise<RouteResult> {
  const sessionId = cleanText(body.session_id || '', 200);
  const characterId = cleanText(body.character_id || '', 200);
  if ('characters' in body && !sessionId) {
    const message = 'session_id required for character list save';
    throw makeFetchError(400, { ok: false, ...errorBody(message, 'bad_request') }, message);
  }
  if ('characters' in body && sessionId) {
    await characters.replaceCharacters(sessionId, (body.characters || []) as unknown[], {
      prune: true,
      rootSessionIds: [],
    });
  }
  // The visible roster is bot-owned; legacy empty global mirrors are ignored.
  if (Array.isArray(body.global)) await characters.replaceCharacters(GLOBAL_SCOPE, body.global, {prune:true});
  if ('character' in body) {
    const scope = cleanText(body.scope || sessionId || GLOBAL_SCOPE, 200);
    const charPayload = (body.character || {}) as Record<string, unknown>;
    // 2.0 is bot-owned: there is no visible shared-global roster
    // (parity asserts `global: []` with the row folded into the session
    // list), so a single-character upsert addressed at __global__ is stored
    // on the live session. See tools/parity/compare.mjs omniRosterExpected.
    await characters.upsertCharacter(scope === GLOBAL_SCOPE ? sessionId : scope, charPayload);
    // Viewer save: pin costume onto this card for subsequent rerolls.
    const stampCardId = cleanText(body.stamp_card_id || charPayload.stamp_card_id || '', 80);
    if (stampCardId && ('costume' in charPayload || 'active_costume' in charPayload)) {
      const costume =
        'costume' in charPayload ? charPayload.costume : charPayload.active_costume;
      const charIndex =
        body.stamp_char_index != null
          ? Number(body.stamp_char_index)
          : charPayload.stamp_char_index != null
            ? Number(charPayload.stamp_char_index)
            : null;
      await cards.stampCardCostume(
        stampCardId,
        cleanText(charPayload.name, 200),
        costume,
        Number.isFinite(charIndex as number) ? (charIndex as number) : null,
      );
    }
  }
  return ok(await characters.getCharactersPayload(sessionId, characterId));
}

// ── dispatch ───────────────────────────────────────────────────────────────

async function dispatch(routes: readonly Route[], ctx: Omit<RouteContext, 'param'>): Promise<RouteResult> {
  for (const route of routes) {
    const param = route.match(ctx.pathname);
    if (param === null) continue;
    return route.handler({ ...ctx, param });
  }
  return notFound(ctx.pathname);
}

export interface RouteOptions {
  method?: string;
  body?: unknown;
  headers?: Headers;
}

export async function routeFetch(path: string, options: RouteOptions = {}): Promise<RouteResult> {
  const { pathname, query } = parseQuery(path);
  const method = String(options.method || 'GET').toUpperCase();
  let body: Record<string, unknown>;
  if (typeof options.body === 'string') {
    try {
      body = JSON.parse(options.body) as Record<string, unknown>;
    } catch {
      body = {};
    }
  } else body = (options.body as Record<string, unknown>) ?? {};

  // Answered before auth so a bad token is still diagnosable.
  if (['/v1/health', '/healthz', '/readyz'].includes(pathname)) {
    return ok({ ok: true, health: settings.health() });
  }
  if (pathname === '/v1/debug' || pathname === '/v1/debug/log') {
    if (method === 'DELETE' || (method === 'POST' && body.clear)) {
      clearDebug();
      return ok({ ok: true, cleared: true });
    }
    return ok(debugSnapshot());
  }

  if (!authorized(getConfig(), options.headers || {})) {
    const message = 'invalid token';
    throw makeFetchError(401, { ok: false, ...errorBody(message, 'unauthorized') }, message);
  }

  const ctx = { method, pathname, query, body };
  if (method === 'GET') return dispatch(GET_ROUTES, ctx);

  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    // Writes report failures as 500 with the message intact; reads let the
    // error propagate so a missing image stays a 404 rather than becoming a 500.
    try {
      return await dispatch(WRITE_ROUTES, ctx);
    } catch (exc) {
      if (isFetchError(exc)) throw exc;
      const message = String((exc as Error)?.message || exc);
      throw makeFetchError(500, { ok: false, ...errorBody(message, 'internal') }, message);
    }
  }

  throw makeFetchError(405, { ok: false, ...errorBody(method, 'method_not_allowed') }, method);
}
