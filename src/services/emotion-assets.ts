import { API_URL, GLOBAL_SCOPE } from '../core/constants';
import type { CharacterRecord } from '../core/types';
import type { TtsCharacter } from '../core/tts-types';
import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import { sniffImageMime } from '../core/util/bytes';
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
import { modelForRequest, type T2iRequest } from '../providers/nai/payload';
import { emotionData, loadEmotionData, noteSeenFaces, saveEmotionData, type EmotionMade } from '../storage/emotion-store';
import { putCharacterAssetRows } from '../storage/shot-character';
import { ttsData } from '../storage/tts-store';
import { collectAssetNaiTags, listSearchableAssets } from './asset-tags';
import { characterPreviewTags } from './character-preview';
import { listCharacters } from './characters';
import { getConfig } from './context';

/**
 * TTS · 감정 에셋: a standing image per TTS character and face, shown by the viewer.
 * Found first among the bot's own images, else made from the character's looks
 * with fixed tags (no LLM) and saved as the bot's asset `이름_감정.png`.
 */
export interface EmotionBot { id: string; index: number; character: Record<string, unknown> }
export interface EmotionSprite { face: string; name: string; path: string; source: 'bot' | 'omni' }

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

// The bot's images: its assets, its emotion images and enabled modules. Read once
// every five minutes at most (a full read of its assets is not cheap on a phone); a
// sprite Omni saves joins at once, registered or not.
const POOL_MS = 300_000;
let pool: { bot: string; at: number; assets: RisuNamedAsset[] } | undefined;
async function botImages(bot: EmotionBot): Promise<RisuNamedAsset[]> {
  if (!pool || pool.bot !== bot.id || Date.now() - pool.at > POOL_MS) {
    const listed = await listSearchableAssets(bot.character).catch(() => ({ assets: [] as RisuNamedAsset[] }));
    pool = { bot: bot.id, at: Date.now(), assets: [...parseRisuAssetRows(bot.character.emotionImages), ...listed.assets] };
  }
  return pool.assets;
}
export function forgetEmotionPool(): void { pool = undefined; }

/** This person's image for this face: Omni's own (newest) first, then the bot's when allowed. */
export async function findSprite(c: TtsCharacter, face: string, bot: EmotionBot): Promise<EmotionSprite | null> {
  const data = await loadEmotionData();
  const mine = [...data.made].reverse().find(m => m.bot === bot.id && m.person === c.id && m.face === face);
  if (mine) return { face, name: mine.name, path: mine.path, source: 'omni' };
  if (!data.settings.useExisting) return null;
  const names = emotionNames(c);
  const hit = (await botImages(bot)).find(asset => assetMatchesExpression(asset.name, names, face));
  return hit ? { face, name: hit.name, path: hit.key, source: 'bot' } : null;
}

/** The illustration roster's person for a TTS character, if any. */
async function rosterPerson(c: TtsCharacter, bot: EmotionBot): Promise<CharacterRecord | null> {
  const people = [...await listCharacters(GLOBAL_SCOPE).catch(() => []), ...await listCharacters(unifiedSessionIdForCharacter(bot.id)).catch(() => [])];
  return people.find(p => matchIllustrationSpeaker(p, [c], c.scope) === c) ?? null;
}
/** The looks a sprite is drawn from: the roster's, else the bot's asset metadata. '' when neither has any. */
export async function spriteLooks(c: TtsCharacter, bot: EmotionBot): Promise<string> {
  const person = await rosterPerson(c, bot);
  const roster = person ? characterPreviewTags(person) : '';
  if (cleanText(roster)) return roster;
  const collected = await collectAssetNaiTags(emotionNames(c), { characterId: bot.id, roster: person ? [person] : [] }).catch(() => null);
  const group = collected?.packed.groups[0];
  return group ? group.common.join(', ') : '';
}

// One sprite at a time, each asked for once; the asset tab and the viewer read `spriteJobs`.
const jobs = new Map<string, Promise<EmotionSprite>>();
let chain: Promise<unknown> = Promise.resolve();
export const spriteJobKey = (bot: string, person: string, face: string): string => `${bot}\u0000${person}\u0000${face}`;
export const spriteJobs = (): ReadonlySet<string> => new Set(jobs.keys());
/**
 * A draw that failed is tried again, never at once and never never: after 30 s, then a
 * minute, then two, up to ten (a viewer redraws often, and each try may cost Anlas).
 * 만들기 in the asset tab asks at once.
 */
const failures = new Map<string, { at: number; count: number; message: string }>();
const backoff = (count: number): number => Math.min(600_000, 30_000 * 2 ** Math.max(0, count - 1));
/** What the viewer says under a face it has no picture for: being drawn, or why it failed. */
export function spriteStatus(bot: string, person: string, face: string): { state: 'running' | 'failed' | ''; message: string } {
  const key = spriteJobKey(bot, person, face);
  if (jobs.has(key)) return { state: 'running', message: '' };
  const failed = failures.get(key);
  return failed ? { state: 'failed', message: failed.message } : { state: '', message: '' };
}
function queueJob(key: string, draw: () => Promise<EmotionSprite>, force: boolean): Promise<EmotionSprite> {
  const running = jobs.get(key);
  if (running) return running;
  const failed = failures.get(key);
  if (!force && failed && Date.now() < failed.at + backoff(failed.count)) return Promise.reject(new Error(failed.message));
  const job = chain.catch(() => {}).then(draw).then(sprite => { failures.delete(key); return sprite; }, error => {
    failures.set(key, { at: Date.now(), count: (failures.get(key)?.count || 0) + 1, message: String((error as Error)?.message || error).slice(0, 160) });
    throw error;
  }).finally(() => { jobs.delete(key); notify(); });
  jobs.set(key, job); chain = job; notify();
  return job;
}

/** Draws and saves one sprite. The bot's asset list gets it once no reply is streaming. `force`: no waiting out a failure. */
export function makeSprite(c: TtsCharacter, face: string, bot: EmotionBot, force = false): Promise<EmotionSprite> {
  return queueJob(spriteJobKey(bot.id, c.id, face), () => drawSprite(c, face, bot), force);
}
/**
 * A picture Omni made that can no longer be read (its file gone, or saved where Risu
 * cannot read it back) is forgotten, so it is drawn again: it no longer counts as made.
 */
export async function forgetMade(bot: string, person: string, face: string): Promise<void> {
  const data = await loadEmotionData(), before = data.made.length;
  data.made = data.made.filter(m => !(m.bot === bot && m.person === person && m.face === face));
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
async function drawAndSave(input: { prompt: (presetPositive: string, family: 'v5' | 'v4') => string; negative?: string; width: number; height: number; family?: 'v5' | 'v4'; effort?: 'medium' }): Promise<{ bytes: Uint8Array; path: string }> {
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
  const bytes = new Uint8Array(result.raw_bytes);
  const host = risuHost();
  if (!host?.saveAsset) throw new Error('Risu 에셋 저장을 쓸 수 없습니다.');
  const path = normalizeAssetPath(cleanText(await host.saveAsset(bytes.slice()), 800));
  if (!path) throw new Error('감정 에셋 파일을 저장하지 못했습니다.');
  return { bytes, path };
}
async function remember(bot: EmotionBot, person: string, face: string, name: string, path: string): Promise<void> {
  const data = emotionData();
  data.made = [...data.made.filter(m => !(m.bot === bot.id && m.person === person && m.face === face)), { bot: bot.id, person, face, name, path, registered: false, at: Date.now() }];
  await saveEmotionData();
  registerWhenIdle();
}
async function drawSprite(c: TtsCharacter, face: string, bot: EmotionBot): Promise<EmotionSprite> {
  const settings = (await loadEmotionData()).settings;
  const looks = sfwTags(await spriteLooks(c, bot));
  if (!looks) throw new Error(`${c.name}의 외형 태그가 없습니다. 삽화 캐릭터 탭에서 외형을 채우면 만들 수 있습니다.`);
  const { bytes, path } = await drawAndSave({
    width: settings.width, height: settings.height, negative: SPRITE_NEGATIVE,
    prompt: (style, family) => emotionPrompt({ looks: joinTags(style, looks), face, faceTags: settings.faceTags[face],
      pose: settings.pose, prefix: settings.prefix, suffix: settings.suffix, transparent: family === 'v5' && settings.transparent }),
  });
  const name = emotionAssetName(c.name, face, sniffImageMime(bytes) === 'image/webp' ? 'webp' : 'png');
  await remember(bot, c.id, face, name, path);
  dbg('emotion.sprite', { message: `${c.name} · ${face}`, path });
  return { face, name, path, source: 'omni' };
}

// ── place backgrounds ──────────────────────────────────────────────────────
/** Backgrounds live beside sprites in the store, under this person key and the place as their face. */
export const PLACE_PERSON = '__place__';
/** One background per place: its tags, lowercased, deduplicated, in order. */
export const placeKey = (place: string): string => [...new Set(String(place || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 16).join(', ');
export async function findBackground(place: string, bot: EmotionBot): Promise<EmotionSprite | null> {
  const k = placeKey(place);
  if (!k) return null;
  const made = [...(await loadEmotionData()).made].reverse().find(m => m.bot === bot.id && m.person === PLACE_PERSON && m.face === k);
  return made ? { face: k, name: made.name, path: made.path, source: 'omni' } : null;
}
/**
 * A place with nobody in it, drawn once and kept as the bot's asset `bg_….png`: V5 at
 * medium effort (a background is blurred behind the cast anyway, so the cheaper pass
 * does), nobody in it by a strong `2::no humans::`, and the place's own tags.
 */
export function makeBackground(place: string, bot: EmotionBot, force = false): Promise<EmotionSprite> {
  const k = placeKey(place);
  return queueJob(spriteJobKey(bot.id, PLACE_PERSON, k), async () => {
    const v5 = !!tokensForFamily(getConfig().nai, 'v5')[0];
    const { bytes, path } = await drawAndSave({ width: 1216, height: 832, family: v5 ? 'v5' : undefined, effort: 'medium', negative: '1girl, 1boy, people, person, character, crowd, text',
      prompt: style => joinTags(style, '2::no humans::, scenery, wide shot, detailed background', k) });
    const name = `bg_${compactHash(k).slice(0, 12)}.${sniffImageMime(bytes) === 'image/webp' ? 'webp' : 'png'}`;
    await remember(bot, PLACE_PERSON, k, name, path);
    dbg('emotion.background', { message: k, path });
    return { face: k, name, path, source: 'omni' as const };
  }, force);
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
export async function makeAhead(wants: ReadonlyArray<{ person: TtsCharacter; face: string } | { place: string }>, bot: EmotionBot): Promise<number> {
  const settings = (await loadEmotionData()).settings;
  if (!settings.enabled || !settings.autoGenerate || !wants.length || !await generatesFree()) return 0;
  let queued = 0;
  for (const want of wants) {
    if (queued >= AHEAD_PER_REPLY) break;
    if ('place' in want) {
      if (!settings.placeBackgrounds || !placeKey(want.place) || await findBackground(want.place, bot)) continue;
      void makeBackground(want.place, bot).catch(() => {}); queued++;
    } else {
      if (await findSprite(want.person, want.face, bot) || !await spriteLooks(want.person, bot).catch(() => '')) continue;
      void makeSprite(want.person, want.face, bot).catch(() => {}); queued++;
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
    const index = await botIndex(botId);
    if (index < 0 || !host) continue;
    await putCharacterAssetRows({ id: botId, index }, rows.map(m => ({ name: m.name, path: m.path })));
    for (const m of rows) m.registered = true;
  }
  forgetEmotionPool();
  await saveEmotionData();
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
