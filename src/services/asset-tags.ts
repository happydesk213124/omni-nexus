/**
 * Collect NovelAI tags from Risu character additionalAssets and active module assets.
 */
import { dbg } from '../core/debug';
import { hostHas, risuHost } from '../core/host';
import type { ApiResult, LoreEntry } from '../core/types';
import { cleanText } from '../core/util/text.ts';
import { normalizeAssetNaiTagsMode } from '../config/schema.ts';
import type { CharacterInput } from '../domain/character/identity.ts';
import { collectTriggeredLoreKeys, explainTriggeredLoreEntries } from '../domain/lore/assemble';
import {
  formatAssetTagsInjectBlock,
  mergeWeightMaps,
  packAssetTagGroups,
  packedAssetNames,
  inspectNaiImageBytes,
  type PackedAssetTags,
} from '../domain/nai-meta/index.ts';
import {
  ASSETS_PER_TRIGGER,
  assetBasenameCompact,
  assetMatchTriggers,
  compactAssetKey,
  filterAssetTriggersForUnfilledLooks,
  loreKeysByCompactTrigger,
  orderTriggersForAssetPick,
  originalTagFromPlains,
  rankPoolForTrigger,
  scoreAssetName,
} from '../domain/nai-meta/match.ts';
import { characterHasAppearance } from '../domain/character/tags.ts';
import {
  assetsFromEnabledModules,
  collectEnabledModuleIds,
  mergeNamedAssets,
  parseRisuAssetRows,
  personaEmbeddedModule,
  type RisuNamedAsset,
} from '../domain/nai-meta/risu-asset-list.ts';
import { asU8, bytesToBase64Async } from '../core/util/bytes.ts';
import { prepareAutotagImage } from '../core/util/image.ts';
import { getConfig } from './context';
import { applyLorefilter, ensureLorefilter } from './lorefilter';

function foldNameHas(name: unknown, trigger: string): boolean {
  const n = assetBasenameCompact(name);
  const t = compactAssetKey(trigger, 200);
  return Boolean(n && t && n.includes(t));
}

/** Hard cap across all triggers (ASSETS_PER_TRIGGER × several cast members). */
const MAX_ASSETS_HARD = 32;
/** Cap how many name-matched candidates we try to read before giving up. */
const MAX_READ_ATTEMPTS = 48;
/** One vision preview per matched character/trigger (hard cap for multimodal). */
const MAX_LOOK_PREVIEWS = 5;

export interface AssetLookPreview {
  name: string;
  /** Prepared data URL (resized like 오토태그 display path) for the looks LLM. */
  dataUrl: string;
}

export interface AssetTagCollectResult {
  block: string;
  packed: PackedAssetTags;
  weightMap: Map<string, string>;
  /** Representative asset images for vision (≤1 per character, ≤MAX_LOOK_PREVIEWS). */
  previews: AssetLookPreview[];
  /** Vision only: first few name-matched files (≤MAX_LOOK_PREVIEWS). */
  previewTargets: Array<{ name: string; key: string }>;
  /** Top name-ranked file per trigger — meta not required. */
  refTargets: Array<{ name: string; key: string }>;
  /** Compact name/trigger → NAI identity tag for roster `original`. */
  originalHints: Record<string, string>;
}

interface AssetPoolInfo {
  assets: RisuNamedAsset[];
  characterCount: number;
  moduleCount: number;
  personaCount: number;
  enabledModuleIds: string[];
}

/** Last successful collect — used to restore emphasis when merging new_characters. */
let lastWeightMap: Map<string, string> = new Map();

/** Cache: asset storage key → filtered plains + weight entries. */
const tagCache = new Map<string, { plains: string[]; weights: Array<[string, string]> }>();

export function getLastAssetWeightMap(): Map<string, string> {
  return lastWeightMap;
}

export function setLastAssetWeightMap(map: Map<string, string>): void {
  lastWeightMap = map;
}

export function clearAssetTagCache(): void {
  tagCache.clear();
  lastWeightMap = new Map();
}

async function readAssetBytes(path: string): Promise<Uint8Array | null> {
  const host = risuHost();
  if (!host || typeof host.readImage !== 'function') return null;
  try {
    const data = await host.readImage(path);
    if (!data) return null;
    if (data instanceof ArrayBuffer) return asU8(data);
    if (data instanceof Uint8Array) return data;
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      return asU8(await data.arrayBuffer());
    }
    if (typeof data === 'string') {
      const m = data.match(/^data:[^;]+;base64,(.+)$/i);
      if (m) {
        const bin = atob(m[1]!);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i);
        return u8;
      }
      // bare base64
      try {
        const bin = atob(data.replace(/\s+/g, ''));
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i);
        return u8;
      } catch {
        return null;
      }
    }
    if (data && typeof data === 'object') {
      const rec = data as Record<string, unknown>;
      if (rec.data instanceof ArrayBuffer) return asU8(rec.data);
      if (typeof rec.data === 'string') return readAssetBytes(rec.data);
    }
  } catch (err) {
    dbg('asset-tags.read.fail', { path, message: String((err as Error)?.message || err) }, 'warn');
  }
  return null;
}

async function tryCurrentChat(): Promise<unknown | null> {
  const host = risuHost();
  if (
    !host ||
    typeof host.getCurrentCharacterIndex !== 'function' ||
    typeof host.getCurrentChatIndex !== 'function' ||
    typeof host.getChatFromIndex !== 'function'
  ) {
    return null;
  }
  try {
    const charIdx = await host.getCurrentCharacterIndex();
    const chatIdx = await host.getCurrentChatIndex();
    return await host.getChatFromIndex(charIdx, chatIdx);
  } catch (err) {
    dbg('asset-tags.chat.fail', { message: String((err as Error)?.message || err) }, 'warn');
    return null;
  }
}

/** Fallback when getChatFromIndex is missing — Risu stores modules on character.chats[chatPage]. */
function chatModulesFromCharacter(character: unknown): unknown {
  const c = character && typeof character === 'object' ? (character as Record<string, unknown>) : null;
  if (!c) return null;
  const chats = Array.isArray(c.chats) ? c.chats : null;
  if (!chats?.length) return null;
  const page = typeof c.chatPage === 'number' ? c.chatPage : 0;
  const chat = chats[Math.max(0, Math.min(chats.length - 1, page))];
  return chat && typeof chat === 'object' ? chat : null;
}

async function listSearchableAssets(character: unknown): Promise<AssetPoolInfo> {
  const charRec = character && typeof character === 'object' ? (character as Record<string, unknown>) : null;
  const charAssets = parseRisuAssetRows(charRec?.additionalAssets ?? charRec?.additional_assets);

  let moduleAssets: RisuNamedAsset[] = [];
  let embeddedAssets: RisuNamedAsset[] = [];
  let enabledModuleIds: string[] = [];

  if (hostHas('getDatabase')) {
    try {
      const db = await risuHost()!.getDatabase!([
        'modules',
        'enabledModules',
        'moduleIntergration',
        'personas',
        'selectedPersona',
      ]);
      if (db) {
        const chat = (await tryCurrentChat()) || chatModulesFromCharacter(character);
        const chatRec = chat && typeof chat === 'object' ? (chat as Record<string, unknown>) : null;
        const embedded = personaEmbeddedModule(db);
        const embeddedRec =
          embedded && typeof embedded === 'object' ? (embedded as Record<string, unknown>) : null;
        enabledModuleIds = collectEnabledModuleIds({
          enabledModules: db.enabledModules,
          characterModules: charRec?.modules,
          chatModules: chatRec?.modules,
          moduleIntergration: db.moduleIntergration,
          personaEmbeddedModuleId: embeddedRec?.id,
        });
        const dbModules = Array.isArray(db.modules) ? db.modules : [];
        moduleAssets = assetsFromEnabledModules(dbModules, enabledModuleIds, embedded ? [embedded] : []);
        if (embeddedRec) embeddedAssets = parseRisuAssetRows(embeddedRec.assets);

        // Probe-friendly: how many assets each enabled id actually has on the module row.
        const idSet = new Set(enabledModuleIds);
        const perMod: Array<{ id: string; name: string; assets: number }> = [];
          for (const raw of dbModules) {
          if (!raw || typeof raw !== 'object') continue;
          const m = raw as unknown as Record<string, unknown>;
          const id = cleanText(m.id, 200);
          const ns = cleanText(m.namespace, 200);
          if (!(id && idSet.has(id)) && !(ns && idSet.has(ns))) continue;
          perMod.push({
            id: id || ns,
            name: cleanText(m.name, 200),
            assets: parseRisuAssetRows(m.assets).length,
          });
        }
        dbg('asset-tags.modules', {
          enabled: enabledModuleIds.length,
          module_assets: moduleAssets.length,
          per_module: perMod.slice(0, 12),
        });
      }
    } catch (err) {
      dbg('asset-tags.modules.fail', { message: String((err as Error)?.message || err) }, 'warn');
    }
  }

  return {
    assets: mergeNamedAssets(charAssets, moduleAssets, embeddedAssets),
    characterCount: charAssets.length,
    moduleCount: moduleAssets.length,
    personaCount: embeddedAssets.length,
    enabledModuleIds,
  };
}

type ScoredAsset = RisuNamedAsset & { score: number; hits: string[] };

async function scoreAndReadAssets(
  assets: readonly RisuNamedAsset[],
  triggers: readonly string[],
): Promise<{
  scored: ScoredAsset[];
  packedRows: Array<{ name: string; plains: string[]; weightMap: Map<string, string>; trigger: string }>;
  previewTargets: Array<{ name: string; key: string }>;
  refTargets: Array<{ name: string; key: string }>;
  attempts: number;
  attemptLog: Array<Record<string, unknown>>;
}> {
  const scored = assets
    .map((a) => {
      const s = scoreAssetName(a.name, triggers);
      return s ? { ...a, score: s.score, hits: s.hits } : null;
    })
    .filter(Boolean) as ScoredAsset[];

  const packedRows: Array<{ name: string; plains: string[]; weightMap: Map<string, string>; trigger: string }> = [];
  const refTargets: Array<{ name: string; key: string }> = [];
  const seenRef = new Set<string>();
  for (const tr of orderTriggersForAssetPick(triggers)) {
    const top = rankPoolForTrigger(scored, tr).find((a) => !seenRef.has(a.key));
    if (!top) continue;
    seenRef.add(top.key);
    refTargets.push({ name: tr, key: top.key });
  }
  const previewTargets = refTargets.slice(0, MAX_LOOK_PREVIEWS);
  const attemptLog: Array<Record<string, unknown>> = [];
  const claimed = new Set<string>();
  let attempts = 0;

  const tryRead = async (asset: ScoredAsset, trigger: string): Promise<boolean> => {
    if (claimed.has(asset.key)) return false;
    if (packedRows.length >= MAX_ASSETS_HARD) return false;
    if (attempts >= MAX_READ_ATTEMPTS) return false;
    attempts += 1;

    let plains: string[];
    let weightMap: Map<string, string>;
    let fromCache = false;

    const cached = tagCache.get(asset.key);
    if (cached) {
      plains = cached.plains;
      weightMap = new Map(cached.weights);
      fromCache = true;
    } else {
      const bytes = await readAssetBytes(asset.key);
      if (!bytes?.length) {
        attemptLog.push({ name: asset.name, key: asset.key, ok: false, reason: 'read_empty' });
        return false;
      }
      const inspected = await inspectNaiImageBytes(bytes);
      if (!inspected.tags?.plains.length) {
        dbg('asset-tags.no_meta', { name: asset.name, reason: inspected.reason });
        attemptLog.push({
          name: asset.name,
          key: asset.key,
          ok: false,
          reason: inspected.reason || 'no_nai_meta',
          bytes: bytes.length,
          kind: inspected.kind,
          color_type: inspected.colorType,
          png_decode: inspected.pngDecode,
          text_keys: inspected.textKeys,
          stealth_head: inspected.stealthHead,
          prompt_len: inspected.promptLen,
          prompt_sample: inspected.promptSample,
        });
        return false;
      }
      plains = inspected.tags.plains;
      weightMap = inspected.tags.weightMap;
      tagCache.set(asset.key, {
        plains,
        weights: [...weightMap.entries()],
      });
    }

    claimed.add(asset.key);
    packedRows.push({ name: asset.name, plains, weightMap, trigger });
    attemptLog.push({
      name: asset.name,
      key: asset.key,
      ok: true,
      from_cache: fromCache,
      plains: plains.length,
      hits: asset.hits,
      trigger,
      score: asset.score,
    });
    return true;
  };

  // Top names only — do not walk the rest of an emotion dump after those miss.
  for (const tr of orderTriggersForAssetPick(triggers)) {
    if (packedRows.length >= MAX_ASSETS_HARD) break;
    const pool = rankPoolForTrigger(scored, tr).slice(0, ASSETS_PER_TRIGGER);
    let got = 0;
    for (const asset of pool) {
      if (got >= ASSETS_PER_TRIGGER) break;
      if (await tryRead(asset, tr)) got += 1;
    }
  }

  return { scored, packedRows, previewTargets, refTargets, attempts, attemptLog };
}

async function buildLookPreviews(
  targets: Array<{ name: string; key: string }>,
): Promise<AssetLookPreview[]> {
  const out: AssetLookPreview[] = [];
  for (const t of targets) {
    try {
      const bytes = await readAssetBytes(t.key);
      if (!bytes?.length) continue;
      const prepared = await prepareAutotagImage(bytes);
      const b64 = await bytesToBase64Async(prepared.bytes);
      out.push({
        name: t.name,
        dataUrl: `data:${prepared.mime || 'image/png'};base64,${b64}`,
      });
    } catch (err) {
      dbg('asset-tags.preview.fail', {
        name: t.name,
        message: String((err as Error)?.message || err),
      }, 'warn');
    }
  }
  return out;
}

/**
 * Match lore triggers to character + active-module assets, read NAI metadata, pack common+unique.
 * Returns null when nothing usable was found.
 * Pass `roster` so triggers for already-filled looks are skipped.
 * Pass `lorebook` + `message` so each trigger group lists original lore_keys (incl. sibling keys on the same entry).
 */
export async function collectAssetNaiTags(
  triggerKeys: readonly unknown[],
  opts: {
    withPreviews?: boolean;
    roster?: CharacterInput[] | null;
    lorebook?: LoreEntry[] | null;
    message?: string;
  } = {},
): Promise<AssetTagCollectResult | null> {
  const preferFilledLooks = !!getConfig()?.card?.unified_chat_priority;
  const triggers = filterAssetTriggersForUnfilledLooks(triggerKeys, opts.roster, { preferFilledLooks });
  if (!triggers.length) {
    dbg('asset-tags.skip', {
      reason: opts.roster?.length ? 'no_unfilled_triggers' : 'no_long_triggers',
    });
    return null;
  }
  if (!hostHas('getCharacter') || !hostHas('readImage')) {
    dbg('asset-tags.skip', { reason: 'host_api_missing' });
    return null;
  }

  let character: unknown;
  try {
    character = await risuHost()!.getCharacter!();
  } catch (err) {
    dbg('asset-tags.getCharacter.fail', { message: String((err as Error)?.message || err) }, 'warn');
    return null;
  }

  const pool = await listSearchableAssets(character);
  if (!pool.assets.length) {
    dbg('asset-tags.skip', { reason: 'no_assets' });
    return null;
  }

  const relatedGroups = opts.lorebook?.length && opts.message
    ? explainTriggeredLoreEntries(opts.lorebook, opts.message).map((e) => e.keys)
    : [];
  const loreKeysMap = loreKeysByCompactTrigger(triggerKeys, triggers, relatedGroups);
  const { scored, packedRows, previewTargets, refTargets, attempts } = await scoreAndReadAssets(pool.assets, triggers);

  if (!packedRows.length) {
    dbg('asset-tags.skip', { reason: 'no_meta_hits', matched: scored.length, attempts });
    return null;
  }

  const packed = packAssetTagGroups(packedRows, loreKeysMap);
  const weightMap = mergeWeightMaps(packed.weightMap);
  lastWeightMap = weightMap;
  const block = formatAssetTagsInjectBlock(packed);
  const previews = opts.withPreviews === true ? await buildLookPreviews(previewTargets) : [];
  const assetNames = packedAssetNames(packed);
  dbg('asset-tags.done', {
    assets: assetNames,
    groups: packed.groups.map((g) => ({
      trigger: g.trigger,
      lore_keys: g.lore_keys,
      common: g.common.length,
      assets: g.assets.map((a) => a.name),
    })),
    pool: pool.assets.length,
    unique: packed.groups.reduce((n, g) => n + g.assets.reduce((m, a) => m + a.unique.length, 0), 0),
    previews: previews.map((p) => p.name),
  });
  const originalHints: Record<string, string> = {};
  const addHint = (key: string, tag: string) => {
    const ck = compactAssetKey(key, 200);
    if (!ck || !tag) return;
    const prev = originalHints[ck];
    if (!prev || tag.length > prev.length) originalHints[ck] = tag;
  };
  for (const row of packedRows) {
    const tag = originalTagFromPlains(row.plains, row.trigger);
    if (!tag) continue;
    addHint(row.trigger, tag);
    for (const lk of loreKeysMap.get(row.trigger) || []) addHint(lk, tag);
  }
  return { block, packed, weightMap, previews, previewTargets, refTargets, originalHints };
}

export interface BestLookAsset {
  trigger: string;
  name: string;
  key: string;
  bytes: Uint8Array;
}

/** Read bytes for already-ranked ref targets (meta or not). */
export async function loadLookAssetsFromTargets(
  targets: ReadonlyArray<{ name: string; key: string }>,
): Promise<BestLookAsset[]> {
  const out: BestLookAsset[] = [];
  const seen = new Set<string>();
  for (const t of targets || []) {
    const key = cleanText(t.key, 400);
    const trigger = cleanText(t.name, 200);
    if (!key || !trigger || seen.has(key)) continue;
    const bytes = await readAssetBytes(key);
    if (!bytes?.length) continue;
    seen.add(key);
    out.push({ trigger, name: trigger, key, bytes });
  }
  return out;
}

/** Highest-ranked matching file per trigger, even when it has no NAI meta. */
export async function collectBestLookAssets(
  triggerKeys: readonly unknown[],
  opts: { roster?: CharacterInput[] | null } = {},
): Promise<BestLookAsset[]> {
  const preferFilledLooks = !!getConfig()?.card?.unified_chat_priority;
  const triggers = filterAssetTriggersForUnfilledLooks(triggerKeys, opts.roster, { preferFilledLooks });
  if (!triggers.length) return [];
  if (!hostHas('getCharacter') || !hostHas('readImage')) return [];

  let character: unknown;
  try {
    character = await risuHost()!.getCharacter!();
  } catch (err) {
    dbg('asset-tags.best_look.fail', { message: String((err as Error)?.message || err) }, 'warn');
    return [];
  }

  const pool = await listSearchableAssets(character);
  if (!pool.assets.length) return [];

  const scored = pool.assets
    .map((a) => {
      const s = scoreAssetName(a.name, triggers);
      return s ? { ...a, score: s.score, hits: s.hits } : null;
    })
    .filter(Boolean) as ScoredAsset[];

  const out: BestLookAsset[] = [];
  const seen = new Set<string>();
  for (const tr of orderTriggersForAssetPick(triggers)) {
    const top = rankPoolForTrigger(scored, tr).find((a) => !seen.has(a.key));
    if (!top) continue;
    const bytes = await readAssetBytes(top.key);
    if (!bytes?.length) continue;
    seen.add(top.key);
    out.push({ trigger: tr, name: top.name, key: top.key, bytes });
  }
  return out;
}

/**
 * Debug probe: same pipeline as collect, but always returns a readable report.
 * Applies character lorefilter first (same as job head) when character_id is set.
 */
export async function probeAssetNaiTags(body: Record<string, unknown> = {}): Promise<ApiResult> {
  const message = cleanText(body.message ?? body.text ?? '', 20000);
  const loreIn = (Array.isArray(body.lorebook) ? body.lorebook : []) as LoreEntry[];
  const uiKeysRaw = Array.isArray(body.lore_trigger_keys)
    ? body.lore_trigger_keys.map((k) => cleanText(k, 200)).filter(Boolean)
    : [];
  const card = getConfig().card;
  const cid = cleanText(body.character_id || body.characterId || '', 200);

  let lorebook = loreIn;
  let lorefilterInfo: Record<string, unknown> = { applied: false, reason: 'skipped' };
  if (cid && card?.lorebook !== false && loreIn.length) {
    try {
      const selected = await ensureLorefilter(cid, loreIn);
      lorebook = applyLorefilter(loreIn, selected);
      lorefilterInfo = {
        applied: true,
        character_id: cid,
        selected: selected.length,
        in: loreIn.length,
        out: lorebook.length,
      };
      dbg('debug.lorefilter', lorefilterInfo, 'info');
    } catch (err) {
      lorefilterInfo = {
        applied: false,
        character_id: cid,
        reason: 'error',
        error: String((err as Error)?.message || err),
      };
      dbg('debug.lorefilter.fail', lorefilterInfo, 'warn');
    }
  } else if (!cid) {
    lorefilterInfo = { applied: false, reason: 'no_character_id' };
  } else if (card?.lorebook === false) {
    lorefilterInfo = { applied: false, reason: 'card.lorebook_off' };
  } else if (!loreIn.length) {
    lorefilterInfo = { applied: false, reason: 'empty_lorebook', character_id: cid || undefined };
  }

  // Match job path: triggers come from the (possibly filtered) lorebook only.
  const backendKeys = collectTriggeredLoreKeys(lorebook, message);
  const loreFired = explainTriggeredLoreEntries(lorebook, message);
  const relatedGroups = loreFired.map((e) => e.keys);
  const triggerPool = [...backendKeys];
  const matchTriggersAll = assetMatchTriggers(triggerPool);
  const roster = Array.isArray(body.roster) ? (body.roster as CharacterInput[]) : null;
  const matchTriggers = filterAssetTriggersForUnfilledLooks(triggerPool, roster, {
    preferFilledLooks: !!card?.unified_chat_priority,
  });
  const mode = normalizeAssetNaiTagsMode(card.asset_nai_tags);
  const settingOn = mode !== 'off';

  const siblingOnly = [
    ...new Set(
      loreFired.flatMap((e) => e.sibling_keys_not_in_message.map((k) => compactAssetKey(k, 200)).filter(Boolean)),
    ),
  ];
  const rosterIncomplete = (roster || [])
    .filter((c) => cleanText(c.name, 200) && !characterHasAppearance(c))
    .map((c) => cleanText(c.name, 200));

  const report: Record<string, unknown> = {
    setting_asset_nai_tags: settingOn,
    asset_nai_tags_mode: mode,
    lorefilter: lorefilterInfo,
    message_preview: message.slice(0, 240),
    message_len: message.length,
    lorebook_entries_in: loreIn.length,
    lorebook_entries: lorebook.length,
    /** Fired entries: which keys hit the chat vs sibling keys that still feed asset matching. */
    lore_entries_fired: loreFired.map((e) => ({
      comment: e.comment || '(no comment)',
      keys_hit_in_message: e.keys_hit_in_message,
      sibling_keys_not_in_message: e.sibling_keys_not_in_message,
      all_keys: e.keys,
    })),
    /** Sibling keys that never appeared in the message (Fallen / Angel / MISC suspects). */
    sibling_keys_exported: siblingOnly,
    /** Client keys before filter (may include entries lorefilter dropped). */
    lore_trigger_keys_ui_raw: uiKeysRaw,
    lore_trigger_keys_backend: backendKeys,
    asset_match_triggers_all: matchTriggersAll,
    asset_match_triggers: matchTriggers,
    roster_incomplete_names: rosterIncomplete,
    note:
      'lorefilter whitelist applied first when character_id set (same as job); '
      + 'leading filename words == trigger words; per trigger ≤4 reads; exact > default > profile > (normal=smil* shorter) > other; '
      + 'common tags computed per trigger group; ALL keys of a lit lore entry become asset triggers (see lore_entries_fired.sibling_keys_not_in_message)',
  };

  if (!message) {
    report.skip = 'no_message';
    return { ok: true, report };
  }
  if (!matchTriggers.length) {
    report.skip = matchTriggersAll.length ? 'no_unfilled_triggers' : 'no_long_triggers';
    return { ok: true, report };
  }
  if (!hostHas('getCharacter') || !hostHas('readImage')) {
    report.skip = 'host_api_missing';
    report.host = {
      getCharacter: hostHas('getCharacter'),
      readImage: hostHas('readImage'),
      getDatabase: hostHas('getDatabase'),
    };
    return { ok: true, report };
  }

  let character: unknown;
  try {
    character = await risuHost()!.getCharacter!();
  } catch (err) {
    report.skip = 'getCharacter_fail';
    report.error = String((err as Error)?.message || err);
    return { ok: false, message: report.error as string, report };
  }

  const pool = await listSearchableAssets(character);
  report.pool = {
    total: pool.assets.length,
    character: pool.characterCount,
    module: pool.moduleCount,
    persona: pool.personaCount,
    enabled_module_ids: pool.enabledModuleIds,
    sample_names: pool.assets.slice(0, 40).map((a) => a.name),
  };

  if (!pool.assets.length) {
    report.skip = 'no_assets';
    return { ok: true, report };
  }

  // Help diagnose “UI has 세노이.webp but no name_matches”: substring scan of the pool.
  const charish = matchTriggers.filter((t) => /[^\x00-\x7f]/.test(t) || /^(senoy|philia|awa|kurokage)$/i.test(t));
  report.pool_names_containing_triggers = charish.flatMap((tr) =>
    pool.assets
      .filter((a) => foldNameHas(a.name, tr))
      .slice(0, 8)
      .map((a) => ({ trigger: tr, name: a.name })),
  ).slice(0, 40);

  const { scored, packedRows, attempts, attemptLog } = await scoreAndReadAssets(pool.assets, matchTriggers);
  report.name_matches = scored.slice(0, 40).map((a) => ({
    name: a.name,
    key: a.key,
    score: a.score,
    hits: a.hits,
  }));
  // Which trigger pulled which files (answers “why is Saviel/MISC here?”).
  report.per_trigger_picks = orderTriggersForAssetPick(matchTriggers).map((tr) => {
    const poolForTr = rankPoolForTrigger(scored, tr);
    return {
      trigger: tr,
      lore_keys: loreKeysByCompactTrigger(triggerPool, [tr], relatedGroups).get(tr) || [],
      from_sibling_key: siblingOnly.includes(tr),
      match_count: poolForTr.length,
      top: poolForTr.slice(0, ASSETS_PER_TRIGGER).map((a) => a.name),
    };
  });
  report.read_attempts = attempts;
  report.read_log = attemptLog;
  report.picked = packedRows.map((r) => ({
    name: r.name,
    plains_count: r.plains.length,
    plains_sample: r.plains.slice(0, 12),
  }));

  if (!packedRows.length) {
    report.skip = 'no_meta_hits';
    return { ok: true, report };
  }

  const loreKeysMap = loreKeysByCompactTrigger(triggerPool, matchTriggers, relatedGroups);
  const packed = packAssetTagGroups(packedRows, loreKeysMap);
  report.packed = {
    groups: packed.groups.map((g) => ({
      trigger: g.trigger,
      lore_keys: g.lore_keys,
      common: g.common,
      assets: g.assets.map((a) => ({ name: a.name, unique: a.unique })),
    })),
  };
  report.inject_block_preview = formatAssetTagsInjectBlock(packed).slice(0, 2000);
  report.ok_picked = packedRows.length;
  return { ok: true, report };
}
