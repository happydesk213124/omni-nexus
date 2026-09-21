/**
 * Manual roster fill from personas / character-lore / CharInfo.
 * Lore picks reuse the job asset scan + char_looks prepass.
 * No NAI meta → one best-ranked asset via autotag, then lore body.
 * Persona / CharInfo with NAI meta use the same looks messages + mergeRoster.
 */
import { dbg } from '../core/debug';
import { hostHas, risuHost } from '../core/host';
import { GLOBAL_SCOPE } from '../core/constants';
import type { ApiResult, JobRequest, LoreEntry } from '../core/types';
import { asU8, bytesToBase64Async, u8ToArrayBuffer } from '../core/util/bytes';
import { PRESET_LOOK_WEBP_QUALITY } from '../core/util/char-ref-size';
import { parseJsonLoose } from '../core/util/object';
import { cleanText, parseAliasList } from '../core/util/text';
import { resolveCharacter } from '../domain/character/roster';
import { COSTUME_FIELDS } from '../domain/character/costume';
import { characterHasAppearance } from '../domain/character/tags';
import { formatLoreExtraAuthorNote, isCharacterImageExtraLore, loreExtraInstructionBody, trimCharacterImageTagLore } from '../domain/lore/extra';
import { resolveLlmRole } from '../domain/llm/roles';
import {
  formatAssetTagsInjectBlock,
  packAssetTagGroups,
  packedAssetNames,
  restoreAssetTagWeights,
  tagsFromImageBytes,
  type PackedAssetTags,
} from '../domain/nai-meta/index';
import { assetMatchTriggers, compactAssetKey, originalTagFromPlains } from '../domain/nai-meta/match';
import { prepareAutotagImage } from '../core/util/image';
import type { LlmContentPart, LlmMessage } from '../providers/llm/transform';
import { callLlm } from './llm-call';
import {
  collectAssetNaiTags,
  collectBestLookAssets,
  loadLookAssetsFromTargets,
  setLastAssetWeightMap,
  type AssetLookPreview,
  type BestLookAsset,
} from './asset-tags';
import { getConfig } from './context';
import {
  listCharacters,
  mergeRosterFromTagged,
  rosterForSession,
  upsertCharacter,
} from './characters';
import { fetchHostLorebookEntries, fetchCharacterLorebookEntries, getLorefilterPayload } from './lorefilter';
import { seedCharRefsFromLooks, setCharRefImage } from './nai-assets';
import { buildCharacterLooksMessages } from './tagger';
import { characterPrompt } from './character-prompt';
import { runVisionAutotagLook } from './vision-autotag';
import { characterSource } from './character-source';

const META_PER = 8;
const VISION_PER = 4;
const TEXT_TOKEN_BUDGET = 60_000;
const PARALLEL_MAX = 10;

export type ImportKind = 'persona' | 'lore' | 'charinfo';

export interface AnalyzeAssetLookOptions {
  name?: unknown;
  aliases?: unknown;
  assetName?: unknown;
  sessionId?: unknown;
  characterId?: unknown;
}

interface ImportPick {
  kind: ImportKind;
  id: string;
}

interface ResolvedRow {
  pick: ImportPick;
  name: string;
  aliases: string[];
  text: string;
  bytes: Uint8Array | null;
  plains: string[];
  weightMap: Map<string, string>;
  originalHint: string;
}

function estimateTokens(s: string): number {
  return Math.max(1, Math.ceil(s.length / 2));
}

async function readHostImage(path: string): Promise<Uint8Array | null> {
  const host = risuHost();
  if (!host || typeof host.readImage !== 'function' || !path) return null;
  try {
    const data = await host.readImage(path);
    if (!data) return null;
    if (data instanceof ArrayBuffer) return asU8(data);
    if (data instanceof Uint8Array) return data;
    if (typeof Blob !== 'undefined' && data instanceof Blob) return asU8(await data.arrayBuffer());
    if (typeof data === 'string') {
      const m = data.match(/^data:[^;]+;base64,(.+)$/i);
      const b64 = m ? m[1] : data.replace(/\s+/g, '');
      try {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i);
        return u8;
      } catch {
        return null;
      }
    }
  } catch (err) {
    dbg('char-import.read.fail', { message: String((err as Error)?.message || err) }, 'warn');
  }
  return null;
}

async function mapPool<T>(
  items: T[],
  parallel: boolean,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const n = parallel ? Math.min(PARALLEL_MAX, Math.max(1, items.length)) : 1;
  let i = 0;
  const worker = async (): Promise<void> => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      await fn(items[idx]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) || 1 }, () => worker()));
}

function looksRequest(opts: {
  sessionId: string;
  characterId: string;
  names: string[];
  lorebook?: LoreEntry[];
  triggerKeys?: string[];
}): JobRequest {
  return {
    session_id: opts.sessionId,
    character_id: opts.characterId,
    assistant_text: opts.names.join('\n'),
    lorebook: opts.lorebook || [],
    lore_trigger_keys: opts.triggerKeys || [],
  };
}

function packedFromMetaRows(rows: ResolvedRow[]): PackedAssetTags {
  const loreKeys = new Map<string, string[]>();
  for (const r of rows) {
    const tr = compactAssetKey(r.name, 200) || r.name;
    loreKeys.set(tr, parseAliasList([r.name, ...r.aliases]));
  }
  return packAssetTagGroups(
    rows.map((r) => ({
      name: r.name,
      plains: r.plains,
      weightMap: r.weightMap,
      trigger: compactAssetKey(r.name, 200) || r.name,
    })),
    loreKeys,
  );
}

function originalHintsFrom(rows: ResolvedRow[], extra: Record<string, string> = {}): Record<string, string> {
  const hints: Record<string, string> = { ...extra };
  const add = (key: string, tag: string) => {
    const ck = compactAssetKey(key, 200);
    if (!ck || !tag) return;
    const prev = hints[ck];
    if (!prev || tag.length > prev.length) hints[ck] = tag;
  };
  for (const r of rows) {
    if (!r.originalHint) continue;
    add(r.name, r.originalHint);
    for (const a of r.aliases) add(a, r.originalHint);
  }
  return hints;
}

async function parseLooks(
  messages: LlmMessage[],
  role: 'asset_char' | 'autotag' = 'asset_char',
): Promise<Record<string, unknown>[]> {
  const images = messages.some(m => Array.isArray(m.content) && m.content.some(p => typeof p !== 'string' && p.type === 'image_url'));
  const selectedRole = images && getConfig().card.image_analysis_separate === true ? 'autotag' : role;
  const raw = await callLlm(resolveLlmRole(getConfig(), selectedRole), messages);
  const parsed = parseJsonLoose(raw) as { new_characters?: unknown };
  const list = Array.isArray(parsed?.new_characters) ? parsed.new_characters : [];
  if (list.length) return list.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const rec = parsed as Record<string, unknown>;
    if (rec.appearance || rec.attire || rec.gender) return [rec];
  }
  return [];
}

function stampIdentity(
  chars: Record<string, unknown>[],
  rows: ResolvedRow[],
): Record<string, unknown>[] {
  return chars.map((c, i) => {
    const named = cleanText(c.name, 200);
    const row = rows.find((r) => cleanText(r.name, 200) === named)
      || rows.find((r) => r.aliases.some((a) => cleanText(a, 200) === named))
      || rows[i];
    if (!row) return c;
    return {
      ...c,
      name: named || row.name,
      aliases: parseAliasList([
        ...(Array.isArray(c.aliases) ? c.aliases : []),
        ...row.aliases,
        row.name,
      ]),
    };
  });
}

async function saveLooks(
  sessionId: string,
  characterId: string,
  chars: Record<string, unknown>[],
  hints: Record<string, string>,
  weightMap?: Map<string, string>,
): Promise<void> {
  if (!chars.length) return;
  if (weightMap?.size) {
    setLastAssetWeightMap(weightMap);
    for (const c of chars) {
      c.appearance = restoreAssetTagWeights(c.appearance, weightMap);
      c.attire = restoreAssetTagWeights(c.attire, weightMap);
      if (c.bottoms != null) c.bottoms = restoreAssetTagWeights(c.bottoms, weightMap);
      c.accessories = restoreAssetTagWeights(c.accessories, weightMap);
    }
  }
  await mergeRosterFromTagged({
    sessionId,
    tagged: { new_characters: chars, scenes: [] },
    shotChars: [],
    characterId,
    assetLooks: true,
    originalHints: hints,
  });
}

/** Persona / CharInfo face → empty 참고이미지 (module webp @ 0.9, never overwrite). */
async function seedImportFaceRefs(scope: string, rows: ResolvedRow[]): Promise<void> {
  const faces = rows.filter((r) => (
    (r.pick.kind === 'persona' || r.pick.kind === 'charinfo')
    && r.name
    && r.bytes?.byteLength
  ));
  if (!faces.length) return;
  const list = await listCharacters(scope);
  for (const r of faces) {
    const hit = resolveCharacter(r.name, list)
      || r.aliases.map((a) => resolveCharacter(a, list)).find(Boolean);
    if (!hit) continue;
    try {
      await setCharRefImage(hit.scope || scope, hit.id, u8ToArrayBuffer(r.bytes!), {
        overwrite: false,
        quality: PRESET_LOOK_WEBP_QUALITY,
      });
    } catch (err) {
      dbg('char_ref.seed.import.face.fail', {
        name: r.name,
        message: String((err as Error)?.message || err),
      }, 'warn');
    }
  }
}

async function foldPickAliases(scope: string, rows: ResolvedRow[]): Promise<void> {
  const list = await listCharacters(scope);
  for (const r of rows) {
    if (!r.aliases.length) continue;
    const hit = resolveCharacter(r.name, list)
      || r.aliases.map((a) => resolveCharacter(a, list)).find(Boolean);
    if (!hit) continue;
    await upsertCharacter(hit.scope || scope, {
      id: hit.id,
      name: hit.name,
      aliases: parseAliasList([...(hit.aliases || []), ...r.aliases, r.name, hit.name]),
    });
  }
}

function assignLookBytes(rows: ResolvedRow[], looks: BestLookAsset[]): void {
  for (const row of rows) {
    if (row.bytes?.length) continue;
    const keys = new Set(assetMatchTriggers(parseAliasList([row.name, ...row.aliases])));
    const hit = looks.find((l) => keys.has(compactAssetKey(l.trigger, 200)));
    if (hit) row.bytes = hit.bytes;
  }
}

async function runPackedLooks(
  sessionId: string,
  characterId: string,
  packed: PackedAssetTags,
  previews: AssetLookPreview[],
  rows: ResolvedRow[],
  lorebook: LoreEntry[],
  extraHints: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  setLastAssetWeightMap(packed.weightMap || new Map());
  const block = formatAssetTagsInjectBlock(packed);
  const names = packedAssetNames(packed);
  const triggerKeys = rows.flatMap((r) => [r.name, ...r.aliases]).filter(Boolean);
  const messages = await buildCharacterLooksMessages(
    looksRequest({
      sessionId,
      characterId,
      names: rows.map((r) => r.name),
      lorebook,
      triggerKeys,
    }),
    block,
    names,
    previews,
  );
  const chars = stampIdentity(await parseLooks(messages, 'asset_char'), rows);
  if (!chars.length) return [];
  await saveLooks(
    sessionId,
    characterId,
    chars,
    originalHintsFrom(rows, extraHints),
    packed.weightMap,
  );
  await foldPickAliases(sessionId, rows);
  return chars;
}

async function looksSystem(): Promise<string> {
  return characterPrompt('batch');
}

async function runVisionBatch(scope: string, characterId: string, rows: ResolvedRow[]): Promise<void> {
  try {
    const sys = await characterPrompt('batch');
    const parts: LlmContentPart[] = [{
      type: 'text',
      text:
        'Return {"new_characters":[...]} using the shared character rules. Use the supplied names and lore_keys as aliases.\n'
        + 'Images are in the same order. Return JSON only.\n'
        + rows.map((r) => {
          const keys = parseAliasList([r.name, ...r.aliases]).join(', ');
          return `- ${r.name} (lore_keys: ${keys})${r.text ? `\n${cleanText(r.text, 800)}` : ''}`;
        }).join('\n'),
    }];
    for (const r of rows) {
      if (!r.bytes?.length) continue;
      const prepared = await prepareAutotagImage(r.bytes);
      const b64 = await bytesToBase64Async(prepared.bytes);
      parts.push({ type: 'text', text: `Image name: ${r.name}` });
      parts.push({ type: 'image_url', image_url: { url: `data:${prepared.mime || 'image/png'};base64,${b64}` } });
    }
    const chars = stampIdentity(
      await parseLooks([{ role: 'system', content: sys }, { role: 'user', content: parts }], 'autotag'),
      rows,
    );
    if (!chars.length) throw new Error('이미지 분석 결과에 캐릭터 외형이 없습니다.');
    await saveLooks(scope, characterId, chars, originalHintsFrom(rows));
    await foldPickAliases(scope, rows);
  } catch (err) {
    dbg('char-import.vision.fail', { message: String((err as Error)?.message || err) }, 'warn');
    throw err;
  }
}

async function runTextBatch(
  scope: string,
  characterId: string,
  rows: ResolvedRow[],
  xnai = false,
): Promise<boolean> {
  try {
    const sys = await looksSystem();
    const messages: LlmMessage[] = [{ role: 'system', content: sys }];
    if (xnai) {
      const hostLore = await (characterId ? fetchCharacterLorebookEntries(characterId) : fetchHostLorebookEntries());
      const extra = hostLore.find((e) => isCharacterImageExtraLore(e));
      const raw = cleanText(extra?.content || String(extra?.data || ''), 50000);
      const names = rows.flatMap((r) => [r.name, ...r.aliases]);
      const note = formatLoreExtraAuthorNote(rows.some(row => row.pick.kind === 'persona')
        ? trimCharacterImageTagLore(raw, [], names)
        : loreExtraInstructionBody(raw, names));
      if (note) messages.push({ role: 'system', content: note });
    }
    const body = rows.map((r) => {
      const keys = parseAliasList([r.name, ...r.aliases]).join(', ');
      return `### ${r.name}\nlore_keys: ${keys || r.name}\n${r.text || '(no description)'}`;
    }).join('\n\n');
    messages.push({
      role: 'user',
      content:
        '# Reference: descriptions\n'
        + body
        + '\n\nFill `new_characters` for each heading. Use lore_keys for name/aliases. JSON only.',
    });
    const chars = stampIdentity(await parseLooks(messages), rows);
    if (!chars.length) return false;
    await saveLooks(scope, characterId, chars, originalHintsFrom(rows));
    await foldPickAliases(scope, rows);
    return true;
  } catch (err) {
    dbg('char-import.text.fail', { message: String((err as Error)?.message || err) }, 'warn');
    return false;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function chunkText(rows: ResolvedRow[]): ResolvedRow[][] {
  const out: ResolvedRow[][] = [];
  let cur: ResolvedRow[] = [];
  let tokens = 0;
  for (const r of rows) {
    const t = estimateTokens(r.text || r.name);
    if (cur.length && tokens + t > TEXT_TOKEN_BUDGET) {
      out.push(cur);
      cur = [];
      tokens = 0;
    }
    cur.push(r);
    tokens += t;
  }
  if (cur.length) out.push(cur);
  return out;
}

function rowHasLooks(
  row: ResolvedRow,
  roster: Awaited<ReturnType<typeof rosterForSession>>,
): boolean {
  const hit = resolveCharacter(row.name, roster)
    || row.aliases.map((a) => resolveCharacter(a, roster)).find(Boolean);
  return Boolean(hit && characterHasAppearance(hit));
}

async function stillMissing(
  sessionId: string,
  characterId: string,
  rows: ResolvedRow[],
): Promise<ResolvedRow[]> {
  const roster = await rosterForSession(sessionId, '', characterId, []);
  return rows.filter((r) => !rowHasLooks(r, roster));
}

async function personasFromHost(): Promise<Array<Record<string, unknown>>> {
  if (!hostHas('getDatabase')) return [];
  try {
    const db = await risuHost()!.getDatabase!(['personas']);
    const list = db && Array.isArray((db as { personas?: unknown }).personas)
      ? (db as { personas: unknown[] }).personas
      : [];
    return list.filter((p) => p && typeof p === 'object') as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}


export async function listImportPicker(kind: string, characterId: string): Promise<ApiResult> {
  const mode = cleanText(kind, 40).toLowerCase() || 'session';
  if (mode === 'persona') {
    const personas = await personasFromHost();
    const items = personas.map((p, i) => {
      const id = cleanText(p.id, 80) || `p:${i}`;
      return {
        kind: 'persona' as const,
        id,
        name: cleanText(p.name, 200) || `persona ${i + 1}`,
        preview: cleanText(p.note || p.personaPrompt, 240),
        keys: [],
        text: [cleanText(p.note, 12000), cleanText(p.personaPrompt, 12000)].filter(Boolean).join('\n').slice(0, 12000),
        badge: '페소',
        has_image: Boolean(cleanText(p.icon, 400)),
      };
    });
    return { ok: true, kind: 'persona', items, lore_empty: false };
  }
  const cid = cleanText(characterId, 200);
  const lfRaw = cid ? await getLorefilterPayload({ character_id: cid }) : {};
  const lf = lfRaw as Record<string, unknown>;
  const selected = Array.isArray(lf.selected) ? lf.selected as string[] : [];
  const catalog = Array.isArray(lf.catalog) ? lf.catalog as Array<{ id: string; title: string; content?: string; keys?: string[] }> : [];
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const loreItems = selected.map((id) => {
    const row = byId.get(id);
    return {
      kind: 'lore' as const,
      id,
      name: cleanText(row?.title, 200) || id,
      preview: cleanText(row?.content, 240),
      keys: (Array.isArray(row?.keys) ? row.keys : [])
        .map((k) => cleanText(k, 80))
        .filter(Boolean),
      text: cleanText(row?.content, 12000),
      badge: (Array.isArray(row?.keys) ? row.keys : [])
        .map((k) => cleanText(k, 80))
        .filter(Boolean)
        .join(', ')
        .slice(0, 160),
      has_image: false,
    };
  });
  const ch = await characterSource(characterId);
  const desc = cleanText(ch?.description || ch?.desc, 12000);
  const charName = cleanText(ch?.name, 200) || 'CharInfo';
  const charinfo = {
    kind: 'charinfo' as const,
    id: 'charinfo',
    name: charName,
    preview: desc.slice(0, 240),
    keys: [],
    text: desc,
    badge: 'charinfo',
    has_image: Boolean(cleanText(ch?.image, 400)),
  };
  return {
    ok: true,
    kind: 'session',
    items: [charinfo, ...loreItems],
    lore_empty: !loreItems.length,
  };
}

async function tagsFromPickBytes(bytes: Uint8Array | null): Promise<{
  plains: string[];
  weightMap: Map<string, string>;
}> {
  if (!bytes?.length) return { plains: [], weightMap: new Map() };
  const tags = await tagsFromImageBytes(bytes);
  return { plains: tags?.plains || [], weightMap: tags?.weightMap || new Map() };
}

function normalizeAnalyzedAssetLook(
  raw: Record<string, unknown>,
  source: 'metadata' | 'vision',
  weightMap: Map<string,string> = new Map(),
): ApiResult {
  const out: Record<string,unknown>={
    ok:true,
    source,
    gender:cleanText(raw.gender,40),
    name:cleanText(raw.name,200),
    original:cleanText(raw.original,240),
    aliases:parseAliasList(raw.aliases),
  };
  for(const key of COSTUME_FIELDS) {
    const value=cleanText(raw[key],4000);
    out[key]=weightMap.size?restoreAssetTagWeights(value,weightMap):value;
  }
  return out as ApiResult;
}

/** Analyze one Risu asset without mutating the roster. Metadata takes precedence over vision. */
export async function analyzeAssetLook(
  bytes: Uint8Array,
  opts: AnalyzeAssetLookOptions = {},
): Promise<ApiResult> {
  if(!bytes.length)throw new Error('image is empty');
  const name=cleanText(opts.name,200)||cleanText(opts.assetName,200)||'character';
  const aliases=parseAliasList(opts.aliases);
  const sessionId=cleanText(opts.sessionId,200);
  const characterId=cleanText(opts.characterId,200);
  const tags=await tagsFromImageBytes(bytes);
  if(tags?.plains?.length) {
    const row:ResolvedRow={
      pick:{kind:'charinfo',id:'asset'},
      name,
      aliases,
      text:'',
      bytes,
      plains:tags.plains,
      weightMap:tags.weightMap||new Map(),
      originalHint:originalTagFromPlains(tags.plains,name),
    };
    const packed=packedFromMetaRows([row]);
    const lorebook=await (characterId ? fetchCharacterLorebookEntries(characterId) : fetchHostLorebookEntries()).catch(()=>[]);
    const messages=await buildCharacterLooksMessages(
      looksRequest({sessionId,characterId,names:[name],lorebook,triggerKeys:[name,...aliases]}),
      formatAssetTagsInjectBlock(packed),
      packedAssetNames(packed),
      [],
    );
    const looks=stampIdentity(await parseLooks(messages,'asset_char'),[row]);
    if(!looks.length)throw new Error('에셋 태거가 외형 정보를 반환하지 않았습니다.');
    return normalizeAnalyzedAssetLook(looks[0]!, 'metadata', packed.weightMap||new Map());
  }
  const lorebook=await (characterId ? fetchCharacterLorebookEntries(characterId) : fetchHostLorebookEntries()).catch(()=>[]);
  const needles=parseAliasList([name,...aliases]).map(v=>v.toLocaleLowerCase());
  const loreRef=lorebook.filter(entry=>{
    const head=[entry.comment,...parseAliasList(entry.keys),...parseAliasList(entry.key)].join(' ').toLocaleLowerCase();
    return needles.some(needle=>head.includes(needle));
  }).map(entry=>cleanText(entry.content,1600)).filter(Boolean).join('\n').slice(0,2500);
  const look=await runVisionAutotagLook(bytes,{loreRef});
  return normalizeAnalyzedAssetLook(look as unknown as Record<string,unknown>,'vision');
}

async function resolvePicks(picks: ImportPick[], characterId: string): Promise<ResolvedRow[]> {
  const personas = await personasFromHost();
  const ch = await characterSource(characterId);
  const cid = cleanText(characterId, 200) || cleanText(String(ch?.chaId || ch?.chid || ''), 200);
  const lfRaw = cid ? await getLorefilterPayload({ character_id: cid }) : null;
  const lf = (lfRaw || {}) as Record<string, unknown>;
  const catalog = Array.isArray(lf.catalog)
    ? (lf.catalog as Array<{ id: string; title: string; content?: string; keys?: string[] }>)
    : [];
  const byLore = new Map(catalog.map((c) => [c.id, c]));
  const out: ResolvedRow[] = [];
  for (const pick of picks) {
    if (pick.kind === 'persona') {
      const idx = personas.findIndex((p, i) => (cleanText(p.id, 80) || `p:${i}`) === pick.id);
      const p = idx >= 0 ? personas[idx]! : null;
      if (!p) continue;
      const name = cleanText(p.name, 200) || pick.id;
      const text = cleanText(p.personaPrompt || p.note, 12000);
      const bytes = await readHostImage(cleanText(p.icon, 400));
      const tags = await tagsFromPickBytes(bytes);
      out.push({
        pick,
        name,
        aliases: parseAliasList(p.aliases),
        text,
        bytes,
        plains: tags.plains,
        weightMap: tags.weightMap,
        originalHint: originalTagFromPlains(tags.plains, name),
      });
      continue;
    }
    if (pick.kind === 'charinfo') {
      const name = cleanText(ch?.name, 200) || 'character';
      const text = cleanText(ch?.description || ch?.desc, 12000);
      const bytes = await readHostImage(cleanText(ch?.image, 400));
      const tags = await tagsFromPickBytes(bytes);
      out.push({
        pick,
        name,
        aliases: [],
        text,
        bytes,
        plains: tags.plains,
        weightMap: tags.weightMap,
        originalHint: originalTagFromPlains(tags.plains, name),
      });
      continue;
    }
    const row = byLore.get(pick.id);
    if (!row) continue;
    const name = cleanText(row.title, 200) || pick.id;
    const text = cleanText(row.content, 12000);
    const aliases = Array.isArray(row.keys) ? row.keys.map((k) => cleanText(k, 200)).filter(Boolean) : [];
    out.push({
      pick,
      name,
      aliases,
      text,
      bytes: null,
      plains: [],
      weightMap: new Map(),
      originalHint: '',
    });
  }
  return out;
}

async function runLoreAssetLooksChunk(
  sessionId: string,
  characterId: string,
  rows: ResolvedRow[],
  lorebook: LoreEntry[],
): Promise<void> {
  const triggerKeys = parseAliasList(rows.flatMap((r) => [r.name, ...r.aliases]));
  if (!triggerKeys.length) return;
  const roster = await rosterForSession(sessionId, '', characterId, []);
  const collected = await collectAssetNaiTags(triggerKeys, {
    withPreviews: false,
    characterId,
    roster,
    lorebook,
    message: triggerKeys.join('\n'),
  });
  if (!collected?.block) {
    dbg('char-import.lore.no_assets', { names: rows.map((r) => r.name) });
    return;
  }
  assignLookBytes(rows, await loadLookAssetsFromTargets(collected.refTargets || []));
  try {
    await runPackedLooks(
      sessionId,
      characterId,
      collected.packed,
      [],
      rows,
      lorebook,
      collected.originalHints || {},
    );
  } catch (err) {
    dbg('char-import.lore.fail', { message: String((err as Error)?.message || err) }, 'warn');
  }
}

async function runLoreAssetLooks(
  sessionId: string,
  characterId: string,
  rows: ResolvedRow[],
  parallel: boolean,
): Promise<void> {
  if (!rows.length) return;
  const hostLore = await (characterId ? fetchCharacterLorebookEntries(characterId) : fetchHostLorebookEntries());
  const lorebook: LoreEntry[] = hostLore.length
    ? hostLore
    : rows.map((r) => ({
      comment: r.name,
      content: r.text,
      keys: r.aliases,
      key: r.aliases,
    }));
  await mapPool(chunk(rows, META_PER), parallel, async (part) => {
    await runLoreAssetLooksChunk(sessionId, characterId, part, lorebook);
  });
}

export async function runImportFill(body: Record<string, unknown>): Promise<ApiResult> {
  const scope = cleanText(body.scope || body.session_id, 200)
    || (cleanText(body.kind, 40) === 'persona' ? GLOBAL_SCOPE : '');
  const sessionId = cleanText(body.session_id, 200);
  const writeScope = cleanText(body.scope, 200) === GLOBAL_SCOPE || body.global === true
    ? GLOBAL_SCOPE
    : (sessionId || scope || GLOBAL_SCOPE);
  const parallel = body.parallel === true || body.parallel === 'true';
  const xnai = body.xnai === true || body.xnai === 'true';
  const rawPicks = Array.isArray(body.picks) ? body.picks : [];
  const picks: ImportPick[] = rawPicks
    .map((p) => {
      if (!p || typeof p !== 'object') return null;
      const rec = p as Record<string, unknown>;
      const kind = cleanText(rec.kind, 20) as ImportKind;
      const id = cleanText(rec.id, 200);
      if (!id || (kind !== 'persona' && kind !== 'lore' && kind !== 'charinfo')) return null;
      return { kind, id };
    })
    .filter((x): x is ImportPick => Boolean(x));
  if (!picks.length) return { ok: false, error: { code: 'bad_request', message: 'picks required' } };

  const characterId = cleanText(body.character_id || body.characterId, 200);
  const resolved = await resolvePicks(picks, characterId);
  const roster = await rosterForSession(writeScope, '', characterId, []);
  const work = resolved.filter((r) => r.name && !rowHasLooks(r, roster));

  const lore = work.filter((r) => r.pick.kind === 'lore');
  const own = work.filter((r) => r.pick.kind !== 'lore');

  await runLoreAssetLooks(writeScope, characterId, lore, parallel);

  const loreNeedImg = (await stillMissing(writeScope, characterId, lore))
    .filter((r) => !r.bytes?.length);
  if (loreNeedImg.length) {
    const triggerKeys = parseAliasList(loreNeedImg.flatMap((r) => [r.name, ...r.aliases]));
    const rosterAfter = await rosterForSession(writeScope, '', characterId, []);
    const looks = await collectBestLookAssets(triggerKeys, { roster: rosterAfter, characterId });
    assignLookBytes(loreNeedImg, looks);
  }

  const hostLore = own.length || lore.length ? await (characterId ? fetchCharacterLorebookEntries(characterId) : fetchHostLorebookEntries()) : [];

  for (const row of own) {
    const names = [row.name, ...row.aliases];
    const refs = hostLore.filter(isCharacterImageExtraLore)
      .map(entry => trimCharacterImageTagLore(entry.content || entry.data, [], names)).filter(Boolean);
    if (refs.length) {
      row.text = refs.join('\n\n') + '\n\n' + row.text;
      await runTextBatch(writeScope, characterId, [row]);
    }
  }

  const meta = (await stillMissing(writeScope, characterId, own)).filter((r) => r.plains.length);
  const metaChunks = chunk(meta, META_PER);
  await mapPool(metaChunks, parallel, async (rows) => {
    try {
      const packed = packedFromMetaRows(rows);
      await runPackedLooks(writeScope, characterId, packed, [], rows, hostLore);
    } catch (err) {
      dbg('char-import.meta.fail', { message: String((err as Error)?.message || err) }, 'warn');
    }
  });

  const vision = (await stillMissing(writeScope, characterId, [...own, ...lore]))
    .filter((r) => !r.plains.length && r.bytes?.length);
  const visChunks = chunk(vision, VISION_PER);
  await mapPool(visChunks, parallel, async (rows) => {
    await runVisionBatch(writeScope, characterId, rows);
  });

  const seen = new Set<string>();
  const textRows = (await stillMissing(writeScope, characterId, work)).filter((r) => {
    const k = `${r.pick.kind}:${r.pick.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const textChunks = chunkText(textRows);
  await mapPool(textChunks, parallel, async (rows) => {
    await runTextBatch(writeScope, characterId, rows, xnai);
  });

  const leftover = await stillMissing(writeScope, characterId, work);
  const filled = work.length - leftover.length;
  await seedImportFaceRefs(writeScope, resolved);
  await seedCharRefsFromLooks(await listCharacters(writeScope), characterId).catch((err) => {
    dbg('char_ref.seed.import.fail', { message: String((err as Error)?.message || err) }, 'warn');
  });

  dbg('char-import.done', {
    scope: writeScope,
    picks: picks.length,
    filled,
    failed: leftover.length,
    vision_to_text: 0,
    parallel,
    xnai,
  });
  return {
    ok: true,
    filled,
    failed: leftover.map((r) => r.name),
    skipped: resolved.length - work.length,
    vision_to_text: 0,
    message: '',
  };
}
