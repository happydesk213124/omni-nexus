import { API_URL, GLOBAL_SCOPE } from '../core/constants';
import type { CharacterRecord } from '../core/types';
import type { TtsCharacter } from '../core/tts-types';
import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import { isWebpBytes, sniffImageMime } from '../core/util/bytes';
import { encodeWebpQuality } from '../core/util/image';
import { cleanText, joinTags, unifiedSessionIdForCharacter } from '../core/util/text';
import { assetMatchesExpression, emotionAssetName, emotionPrompt, expressionOfTone, sfwTags, SPRITE_NEGATIVE } from '../domain/emotion/emotions';
import { normalizeAssetPath } from '../domain/gallery/shot-assets';
import { tokensForFamily } from '../domain/nai/keys';
import { findPresetById, modelForFamily } from '../domain/nai/routing';
import { naiSamplerForFamily, naiStepsForFamily } from '../domain/nai/samplers';
import { parseRisuAssetRows, type RisuNamedAsset } from '../domain/nai-meta/risu-asset-list';
import { resolveGenerationCfgParams } from '../domain/style-preset-overrides';
import { matchIllustrationSpeaker, resolveTtsSpeaker } from '../domain/tts/identity';
import { parseTtsMessage } from '../domain/tts/segment';
import { imageBackendKind } from '../providers/comfy/client';
import { generateT2i, getNaiQuotaDetail } from '../providers/nai/client';
import { getNaiInflight } from '../providers/nai/http';
import { sleep } from '../core/util/async';
import { compactHash } from '../domain/tts/segment';
import { backgroundName, backgroundPlace, hashedPlace, placeKey, samePlace } from '../domain/viewer/place';
import { modelForRequest, type T2iRequest } from '../providers/nai/payload';
import { emotionData, loadEmotionData, noteSeenFaces, saveEmotionData, type EmotionMade } from '../storage/emotion-store';
import { putCharacterAssetRows, removeCharacterAssetRows } from '../storage/shot-character';
import { PLACE_SAMPLES } from '../config/place-samples';
import { putSharedBackgrounds, removeSharedBackgrounds, sharedBackgroundRows } from './char-ref-module';
import { loadTtsData, ttsData } from '../storage/tts-store';
import { collectAssetNaiTags, listSearchableAssets } from './asset-tags';
import { characterPreviewTags } from './character-preview';
import { ensureCostumes } from '../domain/character/costume';
import { listCharacters } from './characters';
import { getConfig } from './context';

/**
 * TTS · 감정 에셋: a standing image per TTS character and face, shown by the viewer.
 * Found first among the bot's own images, else made from the character's looks
 * with fixed tags (no LLM) and saved as the bot's asset `이름_감정.png`.
 */
export interface EmotionBot { id: string; index: number; character: Record<string, unknown> }
/** shared: a background every bot uses (drawn for a sample place, kept in the 참고이미지 module). costume: not the default one's. */
export interface EmotionSprite { face: string; name: string; path: string; source: 'bot' | 'omni'; shared?: boolean; costume?: number }

/** Every name a TTS character goes by: card name, triggers, given names, family+given both ways. */
export function emotionNames(c: Pick<TtsCharacter, 'name' | 'triggers' | 'surname' | 'givenName' | 'surnameAliases' | 'givenAliases'>): string[] {
  const families = [c.surname, ...(c.surnameAliases || [])].filter(Boolean), givens = [c.givenName, ...(c.givenAliases || [])].filter(Boolean);
  const all = [c.name, ...(c.triggers || []), ...givens, ...families.flatMap(f => givens.flatMap(g => [f + g, `${f} ${g}`, g + f, `${g} ${f}`]))];
  return [...new Set(all.map(n => String(n || '').trim()).filter(n => n.length >= 2))];
}

export async function currentEmotionBot(): Promise<EmotionBot | null> {
  const host = risuHost();
  if (!host?.getCurrentCharacterIndex || !host.getCharacterFromIndex) return null;
  const index = Number(await host.getCurrentCharacterIndex());
  if (!Number.isInteger(index) || index < 0) return null;
  const character = await host.getCharacterFromIndex(index) as Record<string, unknown> | null;
  const id = cleanText(character?.chaId || character?.id, 200);
  return id && character ? { id, index, character } : null;
}

// The bot's images: its assets, its emotion images and enabled modules. Read once, then
// again behind when five minutes old, never waited on: a full read of its assets (every
// module) is not cheap on a phone, and a line in the viewer must not wait for it. A
// sprite Omni saves joins at once, registered or not.
const POOL_MS = 300_000;
let pool: { bot: string; at: number; assets: RisuNamedAsset[] } | undefined;
let reading: { bot: string; job: Promise<RisuNamedAsset[]> } | undefined;
function readPool(bot: EmotionBot): Promise<RisuNamedAsset[]> {
  if (reading?.bot === bot.id) return reading.job;
  const job: Promise<RisuNamedAsset[]> = (async () => {
    const listed = await listSearchableAssets(bot.character).catch(() => ({ assets: [] as RisuNamedAsset[] }));
    const assets = [...parseRisuAssetRows(bot.character.emotionImages), ...listed.assets];
    pool = { bot: bot.id, at: Date.now(), assets };
    return assets;
  })().finally(() => { if (reading?.job === job) reading = undefined; });
  reading = { bot: bot.id, job };
  return job;
}
/** The bot's images as known now (an old list is read again behind); undefined before the first read. */
function poolNow(bot: EmotionBot): RisuNamedAsset[] | undefined {
  if (pool?.bot !== bot.id) return undefined;
  if (Date.now() - pool.at > POOL_MS) void readPool(bot).catch(() => {});
  return pool.assets;
}
const botImages = (bot: EmotionBot): Promise<RisuNamedAsset[]> => { const now = poolNow(bot); return now ? Promise.resolve(now) : readPool(bot); };
export function forgetEmotionPool(): void { pool = undefined; }

/**
 * This person's image for this face (in this costume, 0 the default one), as known now, with
 * no wait: Omni's own (newest) first, then the bot's when allowed. undefined while the bot's
 * images have never been read (findSprite reads them).
 */
export function spriteNow(c: TtsCharacter, face: string, bot: EmotionBot, costume = 0): EmotionSprite | null | undefined {
  const data = emotionData(), worn = costume ? { costume } : {};
  for (let i = data.made.length - 1; i >= 0; i--) {
    const m = data.made[i]!;
    if (m.bot === bot.id && m.person === c.id && m.face === face && (m.costume ?? 0) === costume) return { face, name: m.name, path: m.path, source: 'omni', ...worn };
  }
  if (!data.settings.useExisting) return null;
  const assets = poolNow(bot);
  if (!assets) return undefined;
  // A costume's are Omni's own (`omni_이름_c2_happy`, in the bot once registered): its number reads as part of the name.
  const names = costume ? emotionNames(c).map(name => `${name}_c${costume}`) : emotionNames(c);
  const hit = assets.find(asset => assetMatchesExpression(asset.name, names, face));
  return hit ? { face, name: hit.name, path: hit.key, source: 'bot', ...worn } : null;
}
export async function findSprite(c: TtsCharacter, face: string, bot: EmotionBot, costume = 0): Promise<EmotionSprite | null> {
  await loadEmotionData();
  const now = spriteNow(c, face, bot, costume);
  if (now !== undefined) return now;
  await botImages(bot);
  return spriteNow(c, face, bot, costume) ?? null;
}

/** The illustration roster's person for a TTS character, if any. */
async function rosterPerson(c: TtsCharacter, bot: EmotionBot): Promise<CharacterRecord | null> {
  const people = [...await listCharacters(GLOBAL_SCOPE).catch(() => []), ...await listCharacters(unifiedSessionIdForCharacter(bot.id)).catch(() => [])];
  return people.find(p => matchIllustrationSpeaker(p, [c], c.scope) === c) ?? null;
}
/** The illustration character's costumes, by their numbers (0 the default one): what a cue's `이름_2` names. [] with none. */
export async function spriteCostumes(c: TtsCharacter, bot: EmotionBot): Promise<Array<{ index: number; name: string; note: string }>> {
  const person = await rosterPerson(c, bot);
  return person ? ensureCostumes(person).costumes.map((costume, index) => ({ index, name: costume.name, note: cleanText(costume.note, 120) })) : [];
}
/**
 * The looks a sprite is drawn from: the roster's, else the bot's asset metadata. '' when neither has any.
 * A costume other than the default is the illustration character's only: none there, nothing to draw it from.
 */
export async function spriteLooks(c: TtsCharacter, bot: EmotionBot, costume = 0): Promise<string> {
  const person = await rosterPerson(c, bot);
  if (costume) {
    if (!person || !ensureCostumes(person).costumes[costume]) throw new Error(`${c.name}에게 ${costume}번 코스튬이 없습니다. 삽화 캐릭터 탭에서 코스튬을 확인해 주세요.`);
    return characterPreviewTags(person, costume);
  }
  // The default costume, whichever the roster has on now: a face is the same person on every line.
  const roster = person ? characterPreviewTags(person, 'default') : '';
  if (cleanText(roster)) return roster;
  const collected = await collectAssetNaiTags(emotionNames(c), { characterId: bot.id, roster: person ? [person] : [] }).catch(() => null);
  const group = collected?.packed.groups[0];
  return group ? group.common.join(', ') : '';
}

// One sprite at a time, each asked for once; the asset tab and the viewer read `spriteJobs`.
const jobs = new Map<string, Promise<EmotionSprite>>();
let chain: Promise<unknown> = Promise.resolve();
export const spriteJobKey = (bot: string, person: string, face: string, costume = 0): string => `${bot}\u0000${person}\u0000${face}${costume ? `\u0000c${costume}` : ''}`;
export const spriteJobs = (): ReadonlySet<string> => new Set(jobs.keys());
/**
 * A draw that failed is tried again, never at once and never never: after 30 s, then a
 * minute, then two, up to ten (a viewer redraws often, and each try may cost Anlas).
 * 만들기 in the asset tab asks at once.
 */
const failures = new Map<string, { at: number; count: number; message: string; noLooks: boolean }>();
const backoff = (count: number): number => Math.min(600_000, 30_000 * 2 ** Math.max(0, count - 1));
/** Nothing to draw a face from (no roster looks, no asset tags): 옴니 뷰어 offers to make them (외형 없음 · 눌러서 만들기). */
export class NoLooksError extends Error {}
/** What the viewer says under a face it has no picture for: being drawn, or why it failed (`noLooks`: for want of looks). */
export function spriteStatus(bot: string, person: string, face: string, costume = 0): { state: 'running' | 'failed' | ''; message: string; noLooks?: boolean } {
  const key = spriteJobKey(bot, person, face, costume);
  if (jobs.has(key)) return { state: 'running', message: '' };
  const failed = failures.get(key);
  return failed ? { state: 'failed', message: failed.message, ...(failed.noLooks ? { noLooks: true } : {}) } : { state: '', message: '' };
}
/** Their looks made: every face of theirs that failed is asked for again at once, as if it never had. */
export function forgetSpriteFailures(bot: string, person: string): void {
  const theirs = spriteJobKey(bot, person, '');
  let forgot = false;
  for (const key of [...failures.keys()]) if (key.startsWith(theirs)) { failures.delete(key); forgot = true; }
  if (forgot) notify();
}
function queueJob(key: string, draw: () => Promise<EmotionSprite>, force: boolean): Promise<EmotionSprite> {
  const running = jobs.get(key);
  if (running) return running;
  const failed = failures.get(key);
  if (!force && failed && Date.now() < failed.at + backoff(failed.count)) return Promise.reject(new Error(failed.message));
  const job = chain.catch(() => {}).then(draw).then(sprite => { failures.delete(key); return sprite; }, error => {
    failures.set(key, { at: Date.now(), count: (failures.get(key)?.count || 0) + 1, message: String((error as Error)?.message || error).slice(0, 160), noLooks: error instanceof NoLooksError });
    throw error;
  }).finally(() => { jobs.delete(key); notify(); });
  jobs.set(key, job); chain = job; notify();
  return job;
}

/** Draws and saves one sprite. The bot's asset list gets it once no reply is streaming. `force`: no waiting out a failure. */
export function makeSprite(c: TtsCharacter, face: string, bot: EmotionBot, force = false, costume = 0): Promise<EmotionSprite> {
  return queueJob(spriteJobKey(bot.id, c.id, face, costume), () => drawSprite(c, face, bot, costume), force);
}
/**
 * A picture Omni made that can no longer be read (its file gone, or saved where Risu
 * cannot read it back) is forgotten, so it is drawn again: it no longer counts as made.
 */
export async function forgetMade(bot: string, person: string, face: string, costume = 0): Promise<void> {
  const data = await loadEmotionData(), before = data.made.length;
  data.made = data.made.filter(m => !(m.bot === bot && m.person === person && m.face === face && (m.costume ?? 0) === costume));
  if (data.made.length !== before) await saveEmotionData();
}
const listeners = new Set<() => void>();
export function subscribeSprites(callback: () => void): () => void { listeners.add(callback); return () => listeners.delete(callback); }
const notify = () => { for (const callback of listeners) callback(); };

/**
 * One NovelAI image with the active style preset, saved as a Risu asset. Waits for
 * NovelAI to be free first (one generation at a time per account: an illustration
 * job running alongside would make one of them fail).
 */
async function drawAndSave(input: { prompt: (presetPositive: string, family: 'v5' | 'v4') => string; negative?: string; width: number; height: number; family?: 'v5' | 'v4'; effort?: 'high' | 'medium'; webp?: number }): Promise<{ bytes: Uint8Array; path: string }> {
  const settings = (await loadEmotionData()).settings, config = getConfig();
  const nai = input.effort ? { ...config.nai, effort_v5: input.effort } : config.nai;
  if (imageBackendKind(nai) === 'comfy') throw new Error('감정 에셋은 NovelAI로만 만듭니다.');
  const family = input.family ?? settings.family, token = tokensForFamily(nai, family)[0] || '';
  if (!token) throw new Error('NovelAI API 키를 먼저 넣어 주세요.');
  const card = config.card, presets = Array.isArray(card.presets) ? card.presets : [];
  const preset = findPresetById(presets, cleanText(card.active_preset_id, 120)) ?? presets[0] ?? null;
  const familyNai = { ...nai, steps: naiStepsForFamily(nai, family), sampler: naiSamplerForFamily(nai, family) };
  const params = resolveGenerationCfgParams(familyNai, { cfg_scale: preset?.cfg_scale, cfg_rescale: preset?.cfg_rescale, steps: preset?.steps, sampler: preset?.sampler, scheduler: preset?.scheduler });
  const req: T2iRequest = {
    prompt: input.prompt(cleanText(preset?.positive || ''), family), negative_prompt: joinTags(cleanText(preset?.negative || ''), input.negative), width: input.width, height: input.height,
    seed: Math.floor(Math.random() * 4294967295) || 1, steps: params.steps, cfg_scale: params.cfg_scale, cfg_rescale: params.cfg_rescale,
    sampler: params.sampler, scheduler: params.scheduler, model: modelForRequest(modelForFamily(nai, family)), var_plus: false, characters: [],
  };
  while (getNaiInflight() > 0) await sleep(1500);
  const result = await generateT2i(token, req, cleanText(nai.request_url) || API_URL, { timeoutMs: 180000 });
  let bytes = new Uint8Array(result.raw_bytes);
  // Kept as WebP at this quality when asked (a background: blurred anyway); where WebP cannot be written, as drawn.
  if (input.webp) {
    const out = await encodeWebpQuality(bytes, input.webp).catch(() => null);
    if (out && isWebpBytes(new Uint8Array(out))) bytes = new Uint8Array(out);
  }
  const host = risuHost();
  if (!host?.saveAsset) throw new Error('Risu 에셋 저장을 쓸 수 없습니다.');
  const path = normalizeAssetPath(cleanText(await host.saveAsset(bytes.slice()), 800));
  if (!path) throw new Error('감정 에셋 파일을 저장하지 못했습니다.');
  return { bytes, path };
}
async function remember(owner: string, person: string, face: string, name: string, path: string, costume = 0): Promise<void> {
  const data = emotionData();
  data.made = [...data.made.filter(m => !(m.bot === owner && m.person === person && m.face === face && (m.costume ?? 0) === costume)), { bot: owner, person, face, name, path, registered: false, at: Date.now(), ...(costume ? { costume } : {}) }];
  await saveEmotionData();
  registerWhenIdle();
}
async function drawSprite(c: TtsCharacter, face: string, bot: EmotionBot, costume = 0): Promise<EmotionSprite> {
  const settings = (await loadEmotionData()).settings;
  const looks = sfwTags(await spriteLooks(c, bot, costume));
  if (!looks) throw new NoLooksError(`${c.name}의 외형 태그가 없습니다. 삽화 캐릭터 탭에서 외형을 채우면 만들 수 있습니다.`);
  const { bytes, path } = await drawAndSave({
    width: settings.width, height: settings.height, negative: SPRITE_NEGATIVE, effort: settings.effort === 'follow' ? undefined : settings.effort,
    prompt: (style, family) => emotionPrompt({ looks: joinTags(style, looks), face, faceTags: settings.faceTags[face],
      pose: settings.pose, prefix: settings.prefix, suffix: settings.suffix, transparent: family === 'v5' && settings.transparent }),
  });
  const name = emotionAssetName(c.name, face, sniffImageMime(bytes) === 'image/webp' ? 'webp' : 'png', costume);
  await remember(bot.id, c.id, face, name, path, costume);
  dbg('emotion.sprite', { message: `${c.name}${costume ? ` · ${costume}번 코스튬` : ''} · ${face}`, path });
  return { face, name, path, source: 'omni', ...(costume ? { costume } : {}) };
}

// ── place backgrounds ──────────────────────────────────────────────────────
/** Backgrounds live beside sprites in the store, under this person key and the place as their face. */
export const PLACE_PERSON = '__place__';
export { backgroundName, placeKey };
/** A background for a sample place is every bot's: its record's owner, and its home the 참고이미지 module. */
export const SHARED_BOT = '*';
export const isSamplePlace = (place: string): boolean => PLACE_SAMPLES.some(sample => samePlace(sample, place));
const ownerOf = (place: string, bot: EmotionBot | null): string => isSamplePlace(place) ? SHARED_BOT : bot?.id || '';
// Records saved before faces kept their whole length hold only the first 40 characters of the tags.
const recordFor = (m: EmotionMade, k: string) => m.person === PLACE_PERSON && (m.face === k || samePlace(m.face, k) || (m.face.length === 40 && k.startsWith(m.face)));
/**
 * The bot's own asset rows, as its character holds them. Not botImages: that lists every
 * enabled module's too, and the 참고이미지 module's shared backgrounds would pass for the bot's.
 */
const ownAssets = (bot: EmotionBot): RisuNamedAsset[] => parseRisuAssetRows(bot.character.additionalAssets);
/** Every place this bot has its own background for: Omni's records and its assets named by their tags. */
export async function backgroundPlaces(bot: EmotionBot): Promise<string[]> {
  const out: string[] = [];
  const add = (place: string) => { const k = placeKey(place); if (k && !out.some(known => samePlace(known, k))) out.push(k); };
  for (const m of [...(await loadEmotionData()).made].reverse()) if (m.bot === bot.id && m.person === PLACE_PERSON) add(m.face);
  for (const asset of ownAssets(bot)) { const place = backgroundPlace(String(asset.name || '')); if (place && !hashedPlace(place)) add(place); }
  return out;
}
/** Every place there is a background for in every chat: Omni's records and the 참고이미지 module's. */
export async function sharedBackgroundPlaces(): Promise<string[]> {
  const out: string[] = [];
  const add = (place: string) => { const k = placeKey(place); if (k && !out.some(known => samePlace(known, k))) out.push(k); };
  for (const m of [...(await loadEmotionData()).made].reverse()) if (m.bot === SHARED_BOT && m.person === PLACE_PERSON) add(m.face);
  for (const [name] of await sharedBackgroundRows()) { const place = backgroundPlace(name); if (place && !hashedPlace(place)) add(place); }
  return out;
}
/** The shared background for a place: Omni's record, else the 참고이미지 module's (drawn on another device, or the record is gone). */
export async function findSharedBackground(place: string): Promise<EmotionSprite | null> {
  const k = placeKey(place);
  if (!k) return null;
  const made = [...(await loadEmotionData()).made].reverse().find(m => m.bot === SHARED_BOT && recordFor(m, k));
  if (made) return { face: k, name: made.name, path: made.path, source: 'omni', shared: true };
  const row = (await sharedBackgroundRows()).find(([name]) => { const named = backgroundPlace(name); return !!named && samePlace(named, k); });
  return row ? { face: k, name: row[0], path: row[1], source: 'omni', shared: true } : null;
}
/** A place's background for this bot: its own first (what it was drawn for), then the one every bot uses. */
export async function findBackground(place: string, bot: EmotionBot): Promise<EmotionSprite | null> {
  const k = placeKey(place);
  if (!k) return null;
  const made = [...(await loadEmotionData()).made].reverse().find(m => m.bot === bot.id && recordFor(m, k));
  if (made) return { face: k, name: made.name, path: made.path, source: 'omni' };
  // The bot's own assets: one drawn before (`omni_bg_<tags>`, earlier `bg_<tags>` or `bg_<hash>`).
  const hash = compactHash(k).slice(0, 12);
  const hit = (await botImages(bot)).find(asset => { const named = backgroundPlace(String(asset.name || '')); return !!named && (named === hash || samePlace(named, k)); });
  if (hit) return { face: k, name: hit.name, path: hit.key, source: 'bot' };
  return findSharedBackground(k);
}
/** Its drawing's state (being drawn, failed and why), for the place's owner: the bot, or every bot for a sample. */
export const backgroundStatus = (place: string, bot: EmotionBot | null): ReturnType<typeof spriteStatus> => spriteStatus(ownerOf(place, bot), PLACE_PERSON, placeKey(place));
/**
 * A place with nobody in it, drawn once and kept as `omni_bg_<tags>`: V5 at medium effort
 * (a background is blurred behind the cast anyway, so the cheaper pass does), nobody in
 * it by a strong `2::no humans::`, and the place's own tags. A sample place's is every
 * bot's, in the 참고이미지 module (no bot needed); any other the bot's own asset.
 */
export function makeBackground(place: string, bot: EmotionBot | null, force = false): Promise<EmotionSprite> {
  const k = placeKey(place), owner = ownerOf(k, bot), shared = owner === SHARED_BOT;
  if (!owner) return Promise.reject(new Error('이 장소의 배경은 봇과의 채팅을 연 뒤 그릴 수 있습니다.'));
  return queueJob(spriteJobKey(owner, PLACE_PERSON, k), async () => {
    const v5 = !!tokensForFamily(getConfig().nai, 'v5')[0];
    // Wide (the stage is), WebP at 50: blurred behind the cast, the detail is never seen.
    const { bytes, path } = await drawAndSave({ width: 1216, height: 832, family: v5 ? 'v5' : undefined, effort: 'medium', webp: 0.5, negative: '1girl, 1boy, people, person, character, crowd, text',
      prompt: style => joinTags(style, '2::no humans::, scenery, wide shot, detailed background', k) });
    const name = backgroundName(k, sniffImageMime(bytes) === 'image/webp' ? 'webp' : 'png');
    await remember(owner, PLACE_PERSON, k, name, path);
    dbg('emotion.background', { message: `${shared ? '(shared) ' : ''}${k}`, path });
    return { face: k, name, path, source: 'omni' as const, shared };
  }, force);
}
/** The asset names a place's background goes by now (its record's, and any named for its tags). */
async function backgroundNames(k: string, bot: EmotionBot | null, shared: boolean): Promise<string[]> {
  const owner = shared ? SHARED_BOT : bot?.id || '', names = new Set<string>();
  for (const m of (await loadEmotionData()).made) if (m.bot === owner && recordFor(m, k)) names.add(m.name);
  const listed = shared ? (await sharedBackgroundRows()).map(([name]) => name) : bot ? ownAssets(bot).map(asset => String(asset.name || '')) : [];
  for (const name of listed) { const named = backgroundPlace(name); if (named && samePlace(named, k)) names.add(name); }
  return [...names];
}
/** Drawn again: the new picture takes the place's name; one under an older name goes. */
export async function redrawBackground(place: string, bot: EmotionBot | null, shared: boolean): Promise<EmotionSprite> {
  const k = placeKey(place), before = await backgroundNames(k, bot, shared);
  const made = await makeBackground(k, shared ? null : bot, true);
  const stale = before.filter(name => name !== made.name);
  if (stale.length) await takeOff(stale, bot, shared);
  return made;
}
/** Deleted: its record and its asset rows (the bot's, or the 참고이미지 module's). Drawn again only when wanted again. */
export async function deleteBackground(place: string, bot: EmotionBot | null, shared: boolean): Promise<void> {
  const k = placeKey(place), owner = shared ? SHARED_BOT : bot?.id || '';
  await takeOff(await backgroundNames(k, bot, shared), bot, shared);
  const data = await loadEmotionData();
  data.made = data.made.filter(m => !(m.bot === owner && recordFor(m, k)));
  failures.delete(spriteJobKey(owner, PLACE_PERSON, k));
  await saveEmotionData();
  notify();
}
async function takeOff(names: string[], bot: EmotionBot | null, shared: boolean): Promise<void> {
  if (!names.length) return;
  if (shared) { await removeSharedBackgrounds(names); return; }
  if (!bot) return;
  // A character write carries the chats too: never while a reply streams.
  if (replyStreaming()) throw new Error('응답이 오는 중에는 봇을 고치지 않습니다. 끝난 뒤 다시 눌러 주세요.');
  await removeCharacterAssetRows({ id: bot.id, index: bot.index }, names);
  forgetEmotionPool();
}

// ── made ahead, while NovelAI idles ────────────────────────────────────────
/**
 * After a reply: the faces its speakers showed and its place, made before the
 * viewer needs them. Only while no reply streams and NovelAI is free, only what
 * the account generates without Anlas, and a few per reply.
 */
const AHEAD_PER_REPLY = 6;
let freeCheck: { at: number; free: boolean } | undefined;
async function generatesFree(): Promise<boolean> {
  if (freeCheck && Date.now() - freeCheck.at < 10 * 60_000) return freeCheck.free;
  const settings = (await loadEmotionData()).settings, token = tokensForFamily(getConfig().nai, settings.family)[0] || '';
  let free = false;
  try {
    const q = await getNaiQuotaDetail(token) as { opus?: boolean; unlimitedImageGeneration?: boolean; v5_usage?: { remaining: number } };
    free = !!(q.opus || q.unlimitedImageGeneration) && (settings.family !== 'v5' || !q.v5_usage || q.v5_usage.remaining > 0);
  } catch { free = false; }
  freeCheck = { at: Date.now(), free };
  return free;
}
export async function makeAhead(wants: ReadonlyArray<{ person: TtsCharacter; face: string; costume?: number } | { place: string }>, bot: EmotionBot): Promise<number> {
  const settings = (await loadEmotionData()).settings;
  if (!settings.enabled || !settings.autoGenerate || !wants.length || !await generatesFree()) return 0;
  let queued = 0;
  for (const want of wants) {
    if (queued >= AHEAD_PER_REPLY) break;
    if ('place' in want) {
      if (!settings.placeBackgrounds || !placeKey(want.place) || await findBackground(want.place, bot)) continue;
      void makeBackground(want.place, bot).catch(() => {}); queued++;
    } else {
      const costume = want.costume ?? 0;
      if (await findSprite(want.person, want.face, bot, costume) || !await spriteLooks(want.person, bot, costume).catch(() => '')) continue;
      void makeSprite(want.person, want.face, bot, false, costume).catch(() => {}); queued++;
    }
  }
  return queued;
}

// A character write carries the chats too: never while a reply streams.
const POLL_MS = 1500;
let registerTimer: ReturnType<typeof setTimeout> | undefined;
const replyStreaming = (): boolean => { const live = Reflect.get(globalThis, '__OMNI_REPLY_STREAMING__'); return typeof live === 'function' && !!live(); };
export function registerWhenIdle(): void {
  if (registerTimer) return;
  registerTimer = setTimeout(() => {
    registerTimer = undefined;
    if (replyStreaming() || jobs.size) { registerWhenIdle(); return; }
    void registerMadeSprites().catch(error => dbg('emotion.register', { message: String((error as Error)?.message || error) }, 'warn'));
  }, POLL_MS);
}
/** Sprites saved but not yet in their bot's asset list: one write per bot. */
export async function registerMadeSprites(): Promise<void> {
  const data = await loadEmotionData(), waiting = data.made.filter(m => !m.registered);
  if (!waiting.length) return;
  const host = risuHost();
  const byBot = new Map<string, EmotionMade[]>();
  for (const m of waiting) byBot.set(m.bot, [...(byBot.get(m.bot) || []), m]);
  for (const [botId, rows] of byBot) {
    // Every bot's (a sample place): into the 참고이미지 module, apart from any bot.
    if (botId === SHARED_BOT) {
      try { await putSharedBackgrounds(rows.map(m => ({ name: m.name, path: m.path }))); for (const m of rows) m.registered = true; }
      catch (error) { dbg('emotion.register.shared', { message: String((error as Error)?.message || error) }, 'warn'); }
      continue;
    }
    const index = await botIndex(botId);
    if (index < 0 || !host) continue;
    await putCharacterAssetRows({ id: botId, index }, rows.map(m => ({ name: m.name, path: m.path })));
    for (const m of rows) m.registered = true;
  }
  forgetEmotionPool();
  await saveEmotionData();
}
/**
 * 고아 메모 정리: the records of pictures whose bot is gone from Risu, or whose person from TTS 캐릭터. Nothing else
 * ever drops them (a redraw replaces its own, a background's delete takes its own). Only the records, never the
 * files: those are Risu's assets. A shared background (every bot's) and a place stay. Null when Risu's bot list
 * cannot be read: then nothing counts as gone.
 */
export interface OrphanMade { records: EmotionMade[]; bots: number; people: number; bytes: number }
const madeKey = (m: EmotionMade): string => [m.bot, m.person, m.face, m.costume ?? 0].join('|');
export async function orphanMade(): Promise<OrphanMade | null> {
  const db = await risuHost()?.getDatabase?.(['characters']).catch(() => null);
  const list = Array.isArray(db?.characters) ? db!.characters as Array<{ chaId?: unknown }> : null;
  if (!list) return null;
  const bots = new Set(list.map(c => String(c?.chaId || '')).filter(Boolean));
  const people = new Set((await loadTtsData()).characters.map(c => c.id));
  const records = (await loadEmotionData()).made.filter(m => m.bot !== SHARED_BOT && (!bots.has(m.bot) || (m.person !== PLACE_PERSON && !people.has(m.person))));
  return { records, bots: new Set(records.filter(m => !bots.has(m.bot)).map(m => m.bot)).size,
    people: new Set(records.filter(m => bots.has(m.bot)).map(m => m.person)).size, bytes: JSON.stringify(records).length };
}
export async function forgetOrphans(records: readonly EmotionMade[]): Promise<number> {
  const gone = new Set(records.map(madeKey)), data = await loadEmotionData(), before = data.made.length;
  data.made = data.made.filter(m => !gone.has(madeKey(m)));
  if (data.made.length !== before) { forgetEmotionPool(); await saveEmotionData(); notify(); }
  return before - data.made.length;
}
async function botIndex(botId: string): Promise<number> {
  const bot = await currentEmotionBot();
  if (bot?.id === botId) return bot.index;
  const db = await risuHost()?.getDatabase?.(['characters']).catch(() => null);
  const list = Array.isArray(db?.characters) ? db!.characters as Array<{ chaId?: unknown }> : [];
  return list.findIndex(c => String(c?.chaId || '') === botId);
}

/**
 * The faces each TTS character showed in these replies (their `(tone)` headers),
 * remembered for the asset tab. Returns the faces found per TTS character id.
 */
export function collectFaces(replies: readonly string[], scope: string): Map<string, Set<string>> {
  const tts = ttsData(), words = emotionData().settings.words, found = new Map<string, Set<string>>();
  for (const reply of replies) for (const segment of parseTtsMessage(String(reply || ''))) {
    if (segment.kind !== 'dialogue' || !segment.speaker) continue;
    const face = expressionOfTone(segment.tone, words);
    const who = face ? resolveTtsSpeaker(segment.speaker, tts.characters, scope) : null;
    if (!who || !face) continue;
    found.set(who.id, (found.get(who.id) ?? new Set()).add(face));
  }
  let changed = false;
  for (const [id, faces] of found) changed = noteSeenFaces(id, [...faces]) || changed;
  if (changed) void saveEmotionData().catch(() => {});
  return found;
}
