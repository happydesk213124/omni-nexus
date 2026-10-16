import type { SoundItem, SoundKind } from '../core/sound-types';
import { uuid } from '../core/util/text';
import { SoundPlayer } from '../providers/sound/player';
import { AUDIO_EXTENSIONS, sfxMarksProblem, sniffAudioMime } from '../domain/sound/audio';
import { exactSfx, glossarySfx, guessSfx, pickBgm } from '../domain/sound/match';
import { embedPickMany, soundEmbedSettings } from '../providers/sound/embed';
import { normalizeSoundTag, soundTags } from '../domain/sound/tags';
import { loadSoundData, saveSoundData, soundData, soundReady, subscribeSound, updateSoundSettings } from '../storage/sound-store';
import { ensureSoundModules, storeSoundBytes } from '../storage/sound-module';
import { omniTts, type TtsSoundCuePlayer } from './tts-runtime';
import { ttsData } from '../storage/tts-store';
import { generateMusic, generateSoundEffect, englishText } from '../providers/sound/elevenlabs';
import { chooseBgm, chooseSfxMany, type SfxChoice } from '../providers/sound/choose';
import { sfxPartSeconds, sfxParts } from '../domain/sound/combo';
import { bgmSceneText } from '../domain/sound/scene';
import { audioOf, downloadAudio, effectClip, planClip, rememberAudio } from './sound-clips';

/** Folder for effects ElevenLabs made on its own, so they are easy to review. */
export const AUTO_SFX_FOLDER = '자동 생성';

export class OmniSoundRuntime {
  readonly player = new SoundPlayer();
  private started?: Promise<void>;
  private moduleTimer?: ReturnType<typeof setTimeout>;
  private lastModule = '';
  notice = '';
  /** The track the BGM bar resumes when nothing is loaded. */
  private lastBgm = '';
  bgmName(): string { const key = this.player.bgmKey || this.lastBgm; return soundData().bgm.find(item => item.key === key)?.name || ''; }
  /** BGM bar play button: pause, resume, or start the last (else first) track. */
  async toggleBgm(): Promise<void> {
    if (this.player.bgmPlaying) { this.player.pauseBgm(); return; }
    if (await this.player.resumeBgm()) return;
    const item = soundData().bgm.find(row => row.key === this.lastBgm) || soundData().bgm[0];
    if (!item) throw new Error('등록된 BGM이 없습니다. BGM·효과음 설정에서 추가해 주세요.');
    await this.play(item);
  }
  init(): Promise<void> {
    return this.started ||= (async () => {
      await loadSoundData();
      this.sync();
      subscribeSound(() => { this.sync(); omniTts.refreshModule(); });
      // TTS speech lowers the music. An effect is one of the voices: the next one to
      // speak (a line, or an effect through the voice player) cuts it.
      omniTts.subscribe(() => {
        const speaking = omniTts.player.status === 'playing' || omniTts.player.status === 'loading';
        this.player.duck(speaking);
        if (speaking) this.player.stopSfx();
      });
      omniTts.setSoundCues(this.cues);
    })().catch(error => { this.started = undefined; throw error; });
  }
  private sync(): void {
    const s = soundData().settings;
    this.player.configure({ bgmVolume: s.bgmVolume, sfxVolume: s.sfxVolume, duck: s.duck });
    if (!s.bgmEnabled) this.player.stopBgm();
    // Module writes rewrite the whole Risu module list: only when what they hold changed.
    const data = soundData(), wanted = JSON.stringify([s.bgmEnabled, s.sfxEnabled, s.bgmPrompt, s.sfxCue, s.sfxFirst, s.bgmTags, s.sfxRules,
      data.bgm.filter(i => i.source === 'asset').map(i => i.assetPath), data.sfx.filter(i => i.source === 'asset').map(i => i.assetPath)]);
    if (wanted === this.lastModule) return;
    clearTimeout(this.moduleTimer);
    this.moduleTimer = setTimeout(() => {
      this.lastModule = wanted;
      void ensureSoundModules(soundData()).catch(error => { this.lastModule = ''; this.notice = String((error as Error).message || error); });
    }, 300);
  }
  list(kind: SoundKind): SoundItem[] { return kind === 'bgm' ? soundData().bgm : soundData().sfx; }

  async addFromUrl(kind: SoundKind, input: { name: string; tags: string; folder: string; url: string }): Promise<SoundItem> {
    const audio = await downloadAudio(input.url.trim());
    const item: SoundItem = { key: uuid(), kind, name: input.name.trim() || '이름 없음', tags: soundTags(input.tags), folder: input.folder, source: 'url', url: input.url.trim(), mime: audio.mime, bytes: audio.bytes.byteLength };
    rememberAudio(item.key, audio.bytes, audio.mime);
    this.list(kind).push(item); await saveSoundData();
    return item;
  }
  async addFromFile(kind: SoundKind, input: { name: string; tags: string; folder: string; file: File }): Promise<SoundItem> {
    const limit = soundData().settings.maxFileMb * 1024 * 1024;
    if (input.file.size > limit) throw new Error(`파일이 너무 큽니다 (${(input.file.size / 1048576).toFixed(1)}MB). 최대 ${soundData().settings.maxFileMb}MB · 큰 곡은 주소로 등록해 주세요.`);
    const bytes = await input.file.arrayBuffer(), mime = sniffAudioMime(bytes);
    if (!mime) throw new Error('재생할 수 있는 오디오 파일이 아닙니다 (mp3, wav, ogg, m4a, flac, webm).');
    return this.addBytes(kind, { ...input, name: input.name.trim() || input.file.name.replace(/\.[^.]+$/, '') }, bytes, mime);
  }
  /** Generates an effect (or instrumental BGM) with ElevenLabs and stores it in the kind's ⚛️ module. */
  async addFromEleven(kind: SoundKind, input: { name: string; tags: string; folder: string; prompt: string; duration: number }): Promise<SoundItem> {
    const s = soundData().settings;
    const audio = kind === 'bgm'
      ? await generateMusic(input.prompt, { key: s.elevenKey, lengthSeconds: input.duration })
      : await generateSoundEffect(input.prompt, { key: s.elevenKey, durationSeconds: input.duration || s.sfxDuration });
    return this.addBytes(kind, { ...input, name: input.name.trim() || input.prompt.slice(0, 40) }, audio.bytes, audio.mime);
  }
  private async addBytes(kind: SoundKind, input: { name: string; tags: string; folder: string }, bytes: ArrayBuffer, mime: string): Promise<SoundItem> {
    const key = uuid(), path = await storeSoundBytes(bytes);
    const item: SoundItem = { key, kind, name: input.name, tags: soundTags(input.tags), folder: input.folder, source: 'asset',
      assetName: `omnisound_${kind}_${key.slice(0, 8)}.${AUDIO_EXTENSIONS[mime] || 'mp3'}`, assetPath: path, mime, bytes: bytes.byteLength };
    rememberAudio(item.key, bytes, mime);
    if (input.folder && !soundData().folders[kind].includes(input.folder)) soundData().folders[kind].push(input.folder);
    this.list(kind).push(item); await saveSoundData();
    return item;
  }
  async remove(kind: SoundKind, keys: ReadonlySet<string>): Promise<void> {
    const list = this.list(kind).filter(item => !keys.has(item.key));
    if (kind === 'bgm') soundData().bgm = list; else soundData().sfx = list;
    // An effect that is gone must not stay the target of a glossary row.
    if (kind === 'sfx') for (const row of soundData().glossary) if (keys.has(row.sfxKey)) row.sfxKey = '';
    if (keys.has(this.player.bgmKey)) this.player.stopBgm();
    await saveSoundData();
  }
  async play(item: SoundItem): Promise<void> { await this.start(item); }
  /** Starts an item; `ended` settles when an effect has finished (a BGM at once). Wrapped: an async function would wait for a returned promise. */
  private async start(item: SoundItem): Promise<{ ended: Promise<void> }> {
    if (item.kind === 'bgm') {
      const audio = await audioOf(item);
      this.lastBgm = item.key; await this.player.playBgm(item.key, audio.bytes, audio.mime, soundData().settings.crossfadeMs); return { ended: Promise.resolve() };
    }
    const clip = await effectClip(item);
    // A preview, or ▶ with TTS off: still one voice at a time.
    if (['playing', 'loading', 'paused'].includes(omniTts.player.status)) omniTts.stop();
    return this.player.playSfx(clip.bytes, clip.mime);
  }
  /**
   * Rows of the TTS list. A BGM cue switches the music and reading goes on at
   * once (the music plays under the voice); an effect is a clip the voice player
   * plays like a line.
   */
  private cues: TtsSoundCuePlayer = {
    listed: segment => { if (!soundReady()) return false; const s = soundData().settings; return segment.kind === 'bgm' ? s.bgmEnabled && s.listBgm : s.sfxEnabled && s.listSfx; },
    automatic: segment => segment.kind === 'bgm' || (soundReady() && soundData().settings.sfxAutoPlay === 'reply'),
    marks: () => !soundReady() || !soundData().settings.sfxEnabled ? [] : soundData().settings.sfxRules.filter(rule => rule.enabled && !sfxMarksProblem(rule.open, rule.close)).map(({ open, close }) => ({ open, close })),
    play: async request => {
      if (request.segment.kind !== 'bgm') return;
      const tags = request.segment.tags ?? soundTags(request.segment.text);
      if (soundData().settings.bgmBasis === 'tags') { await this.playBgmForTags(tags); return; }
      // 메시지 문장 전체 (+ 태그): the row is where the music changes; the reply's text picks it.
      const message = request.context.messages.find(row => String(row.chatId || row.id || '') === request.messageId);
      await this.playBgmForReply(String(message?.data ?? ''), tags);
    },
    effect: async request => {
      if (!soundReady() || !soundData().settings.sfxEnabled) return null;
      const plan = await this.sfxPlan(request.segment.text, request.segment.context || '');
      if (!plan.length) return null;
      this.player.stopSfx();
      return { ...(await planClip(plan)), volume: soundData().settings.sfxVolume };
    },
  };
  /**
   * ⚡: a reply's own text picks the music, for replies with no BGM cue. JEV or
   * the LLM, as the BGM matcher setting says; any other setting uses JEV when it
   * has a key, else the LLM (the effect rule). Picking music turns BGM on.
   */
  async guessBgm(reply: string): Promise<SoundItem> {
    const s = soundData().settings;
    const item = await this.bgmForText(reply, [], true);
    if (!s.bgmEnabled) await updateSoundSettings({ bgmEnabled: true });
    await this.play(item);
    return item;
  }
  private sceneCache = new Map<string, string>();
  /** The track a reply's own text picks (JEV or the LLM); one request per reply text. */
  /** fresh: ⚡ asks again; automatic picks reuse the answer for the same reply. */
  private async bgmForText(reply: string, tags: readonly string[] = [], fresh = false): Promise<SoundItem> {
    const s = soundData().settings, tts = ttsData().settings, items = soundData().bgm;
    if (!items.length) throw new Error('등록된 BGM이 없습니다. BGM·효과음 설정에서 추가해 주세요.');
    const scene = bgmSceneText(reply);
    if (!scene) throw new Error('곡을 고를 메시지가 없습니다.');
    // 「자동」: JEV, then embedding, then the LLM (a scene has no free word match).
    const m = s.bgmMatcher, jev = !!tts.jev.key.trim(), embed = m === 'auto' || m === 'embedding' ? soundEmbedSettings(s, tts) : null;
    const steps: Array<() => Promise<string>> = [];
    if (m === 'jev' || m === 'llm') steps.push(() => chooseBgm(scene, items, m, tts, tags));
    else {
      if (m !== 'embedding' && jev) steps.push(() => chooseBgm(scene, items, 'jev', tts, tags));
      if (embed) steps.push(async () => (await embedPickMany([`${tags.length ? `BGM 태그: ${tags.join(', ')}\n` : ''}${scene}`], items, item => `${item.name}: ${item.tags.join(', ')}`, embed))[0]?.item.key || '');
      if (m === 'auto' || (m === 'tag' && !jev)) steps.push(() => chooseBgm(scene, items, 'llm', tts, tags));
      if (m === 'embedding' && !embed) throw new Error('임베딩이 설정되지 않았습니다. 소리 모델 설정의 임베딩 키를 넣어 주세요.');
    }
    const cacheKey = JSON.stringify([m, scene, tags, items.map(item => item.key).join(',')]);
    let pick = fresh ? undefined : this.sceneCache.get(cacheKey), failure: unknown;
    for (const step of pick ? [] : steps) {
      const key = await step().catch(error => { failure = error; return ''; });
      if (items.some(row => row.key === key)) { pick = key; break; }
    }
    const item = items.find(row => row.key === pick) ?? null;
    if (!item) throw failure instanceof Error ? failure : new Error('메시지에 맞는 곡을 고르지 못했습니다.');
    this.sceneCache.set(cacheKey, item.key); while (this.sceneCache.size > 50) this.sceneCache.delete(this.sceneCache.keys().next().value!);
    return item;
  }
  /**
   * The music for a reply, as 「곡을 고르는 근거」 says: its [[bgm:…]] tags (its text
   * when it has none), always its text, or its text with its tags as a hint.
   * Never turns BGM on by itself.
   */
  async playBgmForReply(reply: string, tags?: readonly string[]): Promise<string> {
    const s = soundData().settings;
    if (!s.bgmEnabled || !soundData().bgm.length) return '';
    if (s.bgmBasis === 'tags' && tags?.length) return this.playBgmForTags(tags);
    const item = await this.bgmForText(reply, s.bgmBasis === 'both' ? tags ?? [] : []);
    await this.play(item);
    return item.key;
  }
  /** BGM for a reply's tags; free word matching first. Returns the key that plays. */
  async playBgmForTags(tags: readonly string[]): Promise<string> {
    if (!soundData().settings.bgmEnabled) return '';
    const pick = pickBgm(tags, soundData().bgm, this.player.bgmKey);
    const item = soundData().bgm.find(row => row.key === pick.key);
    if (item) await this.play(item);
    return item?.key || '';
  }
  private creating = new Map<string, Promise<SoundItem | null>>();
  /** Teaches the glossary that `word` means the effect `key`. */
  private async learn(word: string, key: string): Promise<void> {
    const data = soundData(), row = data.glossary.find(r => r.sfxKey === key);
    if (row) row.terms = soundTags([...row.terms, word]); else data.glossary.push({ id: uuid(), terms: [word], sfxKey: key, enabled: true });
    data.unknownTerms = data.unknownTerms.filter(w => w !== word); await saveSoundData();
  }
  /**
   * A word the glossary does not know: JEV or the LLM picks a listed effect or
   * says none fits. Only that answer (or an empty list) makes ElevenLabs generate
   * one — without it every spelling variant would be a new paid effect.
   */
  // Words JEV or the LLM already answered "nothing fits" for, so playing them
  // never asks again. Kept per effect list and generation setting: a new effect may
  // fit after all, and with generation on the answer makes one.
  // Also this session's embedding and guess picks: unlike JEV's answers they are
  // not learned into the glossary, and remembering them keeps a word from being
  // asked again on every play.
  private unmatched = { list: '', words: new Set<string>(), picks: new Map<string, string>() };
  private memo(): { words: Set<string>; picks: Map<string, string> } {
    const s = soundData().settings, list = JSON.stringify([s.sfxAutoCreate && !!s.elevenKey.trim(), s.sfxMatcher, s.embed, !!ttsData().settings.jev.key.trim(), soundData().sfx.map(item => item.key)]);
    if (this.unmatched.list !== list) this.unmatched = { list, words: new Set(), picks: new Map() };
    return this.unmatched;
  }
  private noMatch(): Set<string> { return this.memo().words; }
  /** What a word plays with nothing asked: the glossary, or this session's earlier pick. */
  private known(word: string): SoundItem | null {
    const data = soundData(), found = glossarySfx(word, data.glossary, data.sfx);
    if (found) return found;
    const key = this.memo().picks.get(normalizeSoundTag(word));
    return key ? data.sfx.find(item => item.key === key) ?? null : null;
  }
  private prepared = new Set<string>();
  /**
   * The effects of the messages on screen, ahead of time: every unknown part of
   * every effect word goes to JEV or the LLM in one request (as the matcher
   * setting says), then each clip is cut and levelled, so a tap or continuous
   * reading never waits for either.
   */
  async prepareEffects(words: ReadonlyArray<{ text: string; context: string }>): Promise<void> {
    if (!soundReady() || !soundData().settings.sfxEnabled || !soundData().sfx.length) return;
    const fresh = words.filter(word => word.text && !this.prepared.has(word.text));
    if (!fresh.length) return;
    for (const word of fresh) this.prepared.add(word.text);
    while (this.prepared.size > 500) this.prepared.delete(this.prepared.values().next().value!);
    const data = soundData(), ask = new Map<string, string>();
    for (const word of fresh) {
      if (exactSfx(word.text, data.glossary, data.sfx)) continue;
      const parts = sfxParts(word.text);
      for (const part of parts.length > 1 ? parts : [word.text]) if (!this.known(part) && !this.noMatch().has(normalizeSoundTag(part)) && !ask.has(part)) ask.set(part, word.context);
    }
    const unknown = [...ask.keys()].slice(0, 20);
    if (unknown.length) await this.resolveSfx(unknown, ask.get(unknown[0]!) || '');
    for (const word of fresh) { const plan = await this.sfxPlan(word.text, word.context); if (plan.length) await planClip(plan).catch(() => {}); }
  }
  /**
   * Words the glossary does not know, in the order 「자동」 means: JEV, then
   * embedding, then a free guess from the effects' names and tags. A JEV "none
   * fits" is an answer and ends it there. An explicit setting uses its own step
   * (falling back to the guess); ⚡ (anyEngine) asks JEV or the LLM on purpose and
   * registers only what they pick.
   */
  private async resolveSfx(words: readonly string[], context: string, anyEngine = false): Promise<Array<SoundItem | null>> {
    const s = soundData().settings, tts = ttsData().settings, items = soundData().sfx, m = s.sfxMatcher, jev = !!tts.jev.key.trim();
    const engine = m === 'jev' || m === 'llm' ? m : anyEngine ? (jev ? 'jev' : 'llm') : m === 'auto' && jev ? 'jev' : null;
    const embed = !anyEngine && (m === 'auto' || m === 'embedding') ? soundEmbedSettings(s, tts) : null;
    // A compound's unknown parts go in one request: one JEV question per part.
    let choices: Array<SfxChoice | null> = words.map(() => null);
    if (engine && items.length && words.length) choices = await chooseSfxMany(words, context, items, engine, tts).catch(error => { this.notice = String((error as Error).message || error); return words.map(() => null); });
    // No answer from JEV (none set up, or it failed): embedding for all of them in one request, then the guess.
    const open = anyEngine ? [] : words.filter((_, i) => !choices[i]);
    const nearest = embed && open.length && items.length
      ? await embedPickMany(open.map(word => `효과음: ${word}${context ? ` · ${context.slice(0, 200)}` : ''}`), items, item => this.describeSfx(item), embed).catch(error => { this.notice = String((error as Error).message || error); return open.map(() => null); })
      : open.map(() => null);
    const fallback = new Map(open.map((word, k) => [word, nearest[k]?.item ?? guessSfx(word, items)]));
    return Promise.all(words.map(async (word, i) => {
      const choice = choices[i] ?? null;
      if (choice && 'key' in choice) { const item = items.find(row => row.key === choice.key); if (item) { await this.learn(word, item.key); return item; } }
      if (choice) this.noMatch().add(normalizeSoundTag(word));
      const picked = fallback.get(word);
      if (picked) { this.memo().picks.set(normalizeSoundTag(word), picked.key); return picked; }
      const create = !items.length || (!!choice && 'create' in choice);
      if (!create || !s.sfxAutoCreate || !s.elevenKey.trim()) return null;
      const id = normalizeSoundTag(word);
      // The same word in several lines (or a re-render) makes one effect, not several.
      let job = this.creating.get(id);
      if (!job) {
        job = (async () => {
          const prompt = (choice && 'create' in choice && choice.prompt) || s.sfxPrompt.replace('{word}', await englishText(word));
          const item = await this.addFromEleven('sfx', { name: word.slice(0, 40), tags: word, folder: AUTO_SFX_FOLDER, prompt, duration: s.sfxDuration });
          await this.learn(word, item.key); return item;
        })().catch(error => { this.notice = String((error as Error).message || error); return null; }).finally(() => this.creating.delete(id));
        this.creating.set(id, job);
      }
      return job;
    }));
  }
  /**
   * ⚡ in the glossary's unknown tab: JEV or the LLM sorts the collected words
   * into the listed effects, eight per request (one JEV question each). A word
   * nothing fits stays unknown, unless automatic generation is on.
   */
  async learnUnknown(): Promise<{ learned: number; left: number }> {
    const data = soundData();
    if (!data.sfx.length) throw new Error('등록된 효과음이 없습니다. 효과음 목록에서 먼저 추가해 주세요.');
    const words = data.unknownTerms.slice(0, 40);
    let learned = 0; this.notice = '';
    for (let i = 0; i < words.length; i += 8) learned += (await this.resolveSfx(words.slice(i, i + 8), '', true)).filter(Boolean).length;
    if (!learned && this.notice) throw new Error(this.notice);
    return { learned, left: soundData().unknownTerms.length };
  }
  /** Plays the effect for a word; an unknown word is kept for the glossary. */
  async playSfxWord(word: string, context = ''): Promise<boolean> {
    if (!soundData().settings.sfxEnabled) return false;
    const plan = await this.sfxPlan(word, context);
    if (!plan.length) return false;
    const clip = await planClip(plan);
    if (['playing', 'loading', 'paused'].includes(omniTts.player.status)) omniTts.stop();
    await this.player.playSfx(clip.bytes, clip.mime);
    return true;
  }
  /**
   * What a word plays: one effect, or a compound's parts (`콰아앙 치이익 또르르`, up
   * to four) in order, each with its share of the longest length. A word that is
   * itself an effect's name or term stays whole. Each part is matched and learned
   * on its own, so the glossary keeps one word → one effect.
   */
  private async sfxPlan(word: string, context: string): Promise<Array<{ item: SoundItem; seconds?: number }>> {
    const data = soundData(), parts = sfxParts(word), exact = exactSfx(word, data.glossary, data.sfx);
    if (parts.length <= 1 || exact) { const item = exact || await this.sfxFor(word, context); return item ? [{ item }] : []; }
    const found: Array<SoundItem | null> = parts.map(part => this.known(part));
    const missing = parts.flatMap((_, i) => found[i] ? [] : [i]);
    const ask = missing.filter(i => !this.noMatch().has(normalizeSoundTag(parts[i]!)));
    if (ask.length) { const resolved = await this.resolveSfx(ask.map(i => parts[i]!), context); ask.forEach((i, k) => { found[i] = resolved[k] ?? null; }); }
    const unknown = parts.filter((part, i) => !found[i] && !data.unknownTerms.includes(part));
    if (unknown.length) { data.unknownTerms = [...new Set(unknown), ...data.unknownTerms].slice(0, 200); await saveSoundData(); }
    const kept = parts.flatMap((part, i) => found[i] ? [{ part, item: found[i]! }] : []);
    const seconds = sfxPartSeconds(kept.map(row => row.part), data.settings.sfxMaxSec);
    return kept.map((row, i) => ({ item: row.item, seconds: seconds[i] }));
  }
  /** An effect for the embedding: its name, tags and the glossary words that call it. */
  private describeSfx(item: SoundItem): string {
    const words = soundData().glossary.filter(row => row.sfxKey === item.key).flatMap(row => row.terms);
    return `${item.name} · ${soundTags([...item.tags, ...words]).join(', ')}`;
  }
  private async sfxFor(word: string, context: string): Promise<SoundItem | null> {
    const item = this.known(word) || (this.noMatch().has(normalizeSoundTag(word)) ? null : (await this.resolveSfx([word], context))[0]);
    if (item) return item;
    const data = soundData(), clean = word.trim().slice(0, 60);
    if (clean && !data.unknownTerms.includes(clean)) { data.unknownTerms = [clean, ...data.unknownTerms].slice(0, 200); await saveSoundData(); }
    return null;
  }
}
export const omniSound = new OmniSoundRuntime();
