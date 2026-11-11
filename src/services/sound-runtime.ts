import type { SoundItem, SoundKind } from '../core/sound-types';
import { uuid } from '../core/util/text';
import { dbg } from '../core/debug';
import { SoundPlayer } from '../providers/sound/player';
import { AUDIO_EXTENSIONS, sfxMarksProblem, sniffAudioMime } from '../domain/sound/audio';
import { BGM_DRAW, bgmPool, drawBgm, drawBgmByScene, drawBgmFromPool, exactSfx, glossarySfx, guessSfx, tagScore } from '../domain/sound/match';
import { suggestSfx } from '../domain/sound/find';
import { embedPickSfx, embedRank, embedScores, soundEmbedSettings } from '../providers/sound/embed';
import { sampleSfxEnglish } from '../config/sound-samples';
import { ELEVEN_PACK, ELEVEN_PACK_FOLDER, type ElevenPackItem } from '../config/sound-eleven-pack';
import { BGM_CUE_SCENE_MAX, normalizeSoundTag, soundTags } from '../domain/sound/tags';
import { loadSoundData, saveSoundData, soundData, soundReady, subscribeSound, updateSoundSettings } from '../storage/sound-store';
import { ensureSoundModules, storeSoundBytes } from '../storage/sound-module';
import { omniTts, type TtsSoundCuePlayer } from './tts-runtime';
import { ttsData } from '../storage/tts-store';
import { generateMusic, generateSoundEffect, englishText } from '../providers/sound/elevenlabs';
import { chooseBgm, chooseSfxMany, type SfxChoice } from '../providers/sound/choose';
import { sfxPartSeconds, sfxParts } from '../domain/sound/combo';
import { bgmSceneText } from '../domain/sound/scene';
import { audioOf, downloadAudio, effectClip, forgetAudio, planClip, prefetchAudio, rememberAudio } from './sound-clips';
import { bgmDeviceCache } from '../storage/bgm-cache';
import { youtubeVideoId, youtubeWatchUrl } from '../domain/sound/youtube';
import { ttsFetch, ttsJson } from '../providers/tts/http';
import type { SfxTerm } from '../core/sound-types';

/** The story an effect word is matched with: before, its own line, after (domain/tts/segment.ts), cut to this. */
const SFX_CONTEXT_MAX = 700;
/** JEV and the LLM are shown this many effects at most; a longer list is narrowed to the nearest first. */
const ENGINE_CANDIDATES = 60;

/** Folder for effects ElevenLabs made on its own, so they are easy to review. */
export const AUTO_SFX_FOLDER = '자동 생성';
/** How long after start YouTube's player is made ahead: after Risu has loaded and drawn the chat. */
const TUBE_AHEAD_MS = 15_000;
const NO_TUBE_SFX = '효과음은 유튜브 링크로 등록할 수 없습니다 (짧은 소리는 늦게 납니다). 오디오 파일 주소를 넣어 주세요.';

export class OmniSoundRuntime {
  readonly player = new SoundPlayer();
  private started?: Promise<void>;
  private moduleTimer?: ReturnType<typeof setTimeout>;
  private lastModule = '';
  notice = '';
  /** The track the BGM bar resumes when nothing is loaded. */
  private lastBgm = '';
  /**
   * BGM fetched ahead, one track at a time so a phone never stalls on several
   * large writes: a reply's [[bgm:…]] picks, the tracks around the current one when
   * the viewer list opens, and 「미리 받기」 on the list. Already kept ones are skipped.
   */
  private prefetching: Promise<unknown> = Promise.resolve();
  private queued = new Set<string>();
  prefetchBgm(items: readonly SoundItem[]): Promise<number> {
    const fresh = items.filter(item => item.kind === 'bgm' && item.source === 'url' && !this.queued.has(item.key));
    for (const item of fresh) this.queued.add(item.key);
    const run = this.prefetching.catch(() => {}).then(async () => {
      let fetched = 0;
      for (const item of fresh) {
        try { if (soundData().settings.bgmCacheMb > 0 && await prefetchAudio(item)) fetched++; }
        catch (error) { dbg('bgm.prefetch', { message: String((error as Error)?.message || error).slice(0, 160) }, 'warn'); }
        finally { this.queued.delete(item.key); }
      }
      return fetched;
    });
    this.prefetching = run;
    return run;
  }
  /**
   * The tracks the cues on screen would play, fetched before reading reaches them: the latest few only, one after
   * another (each pick with a scene may ask the embedding once), and the pick is remembered so the cue plays it.
   */
  prefetchBgmForTags(cues: ReadonlyArray<{ tags: readonly string[]; scene?: string }>): void {
    if (!soundReady() || !soundData().settings.bgmEnabled) return;
    void (async () => {
      const picks: SoundItem[] = [];
      for (const cue of cues.slice(-BGM_PREFETCH_CUES)) { const key = await this.bgmForTags(cue.tags, cue.scene || '', ''); const item = soundData().bgm.find(row => row.key === key); if (item) picks.push(item); }
      if (picks.length) await this.prefetchBgm(picks);
    })().catch(error => dbg('bgm.prefetch.pick', { message: String((error as Error)?.message || error).slice(0, 160) }, 'warn'));
  }
  /** The viewer list opened: the tracks before and after the current one. */
  prefetchBgmAround(key: string): void {
    const items = soundData().bgm, at = items.findIndex(item => item.key === key);
    if (at >= 0) void this.prefetchBgm([items[at + 1], items[at - 1]].filter((item): item is SoundItem => !!item));
  }
  bgmCacheUsage(): { bytes: number; count: number } { return { bytes: bgmDeviceCache.bytes, count: bgmDeviceCache.count }; }
  clearBgmCache(): Promise<void> { return bgmDeviceCache.clear(); }
  /** The track being fetched counts as the current one: the bar names it at once. */
  bgmName(): string { const key = this.bgmLoading || this.player.bgmKey || this.lastBgm; return soundData().bgm.find(item => item.key === key)?.name || ''; }
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
      // Made ahead, the first track starts at once; but never while Risu is still loading:
      // YouTube's player is a whole page of its own.
      this.tubeAt = Date.now() + TUBE_AHEAD_MS;
      setTimeout(() => this.prepareTube(), TUBE_AHEAD_MS);
    })().catch(error => { this.started = undefined; throw error; });
  }
  /** With YouTube tracks listed and BGM on, the player is made ahead (a while after start): the first track starts at once. */
  private tubeTried = false;
  private tubeAt = Infinity;
  private prepareTube(): void {
    const s = soundData().settings;
    if (this.tubeTried || Date.now() < this.tubeAt || !s.bgmEnabled || !s.youtubeBgm || !soundData().bgm.some(item => item.source === 'youtube')) return;
    // Its page loads while no reply streams: a reply being written (and tagged) is when a stall shows most.
    const live = Reflect.get(globalThis, '__OMNI_REPLY_STREAMING__');
    if (typeof live === 'function' && live()) { setTimeout(() => this.prepareTube(), 5000); return; }
    this.tubeTried = true;
    void this.player.prepareTube().catch(error => { this.tubeTried = false; dbg('bgm.youtube.prepare', { message: String((error as Error)?.message || error) }, 'warn'); });
  }
  private sync(): void {
    const s = soundData().settings;
    this.player.configure({ bgmVolume: s.bgmVolume, sfxVolume: s.sfxVolume, duck: s.duck });
    void bgmDeviceCache.configure(s.bgmCacheMb).catch(error => dbg('bgm.cache.limit', { message: String(error) }, 'warn'));
    if (!s.bgmEnabled) this.player.stopBgm();
    this.player.setTubeHidden(s.youtubeHidden);
    if (this.started) this.prepareTube();
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
    const video = youtubeVideoId(input.url);
    if (video) {
      if (kind !== 'bgm') throw new Error(NO_TUBE_SFX);
      const url = youtubeWatchUrl(video);
      const item: SoundItem = { key: uuid(), kind, name: input.name.trim() || await youtubeTitle(url) || '유튜브 곡', tags: soundTags(input.tags), folder: input.folder, source: 'youtube', url };
      this.list(kind).push(item); await saveSoundData();
      return item;
    }
    const audio = await downloadAudio(input.url.trim());
    const item: SoundItem = { key: uuid(), kind, name: input.name.trim() || '이름 없음', tags: soundTags(input.tags), folder: input.folder, source: 'url', url: input.url.trim(), mime: audio.mime, bytes: audio.bytes.byteLength };
    rememberAudio(item.key, audio.bytes, audio.mime);
    this.list(kind).push(item); await saveSoundData();
    return item;
  }
  /**
   * 수정 pointing a link tile at another link: checked as a link being added is (an audio file; a YouTube link for
   * BGM only), and nothing changes when it fails. What was fetched and cut from the old link is forgotten, so the
   * tile sounds as its new link at once; the caller saves. A file tile has no link to change.
   */
  async relink(kind: SoundKind, item: SoundItem, link: string): Promise<void> {
    const url = link.trim();
    if (url === (item.url || '')) return;
    if (item.source !== 'url' && item.source !== 'youtube') throw new Error('파일로 올린 소리는 링크가 없습니다. 지우고 새로 추가해 주세요.');
    const video = youtubeVideoId(url);
    // An example's stand-in file is the old song's: YouTube failing, the new link must not play it.
    if (video) {
      if (kind !== 'bgm') throw new Error(NO_TUBE_SFX);
      forgetAudio(item.key);
      Object.assign(item, { source: 'youtube', url: youtubeWatchUrl(video) });
      delete item.mime; delete item.bytes; delete item.fallbackUrl;
      return;
    }
    const audio = await downloadAudio(url);
    forgetAudio(item.key);
    Object.assign(item, { source: 'url', url, mime: audio.mime, bytes: audio.bytes.byteLength });
    delete item.fallbackUrl;
    rememberAudio(item.key, audio.bytes, audio.mime);
  }
  async addFromFile(kind: SoundKind, input: { name: string; tags: string; folder: string; file: File }): Promise<SoundItem> {
    const limit = soundData().settings.maxFileMb * 1024 * 1024;
    if (input.file.size > limit) throw new Error(`파일이 너무 큽니다 (${(input.file.size / 1048576).toFixed(1)}MB). 최대 ${soundData().settings.maxFileMb}MB · 큰 곡은 주소로 등록해 주세요.`);
    const bytes = await input.file.arrayBuffer(), mime = sniffAudioMime(bytes);
    if (!mime) throw new Error('재생할 수 있는 오디오 파일이 아닙니다 (mp3, wav, ogg, m4a, flac, webm).');
    return this.addBytes(kind, { ...input, name: input.name.trim() || input.file.name.replace(/\.[^.]+$/, '') }, bytes, mime);
  }
  /** Generates an effect (or instrumental BGM) with ElevenLabs and stores it in the kind's ⚛️ module. */
  async addFromEleven(kind: SoundKind, input: { name: string; tags: string; folder: string; prompt: string; duration: number; note?: string }): Promise<SoundItem> {
    const s = soundData().settings;
    const audio = kind === 'bgm'
      ? await generateMusic(input.prompt, { key: s.elevenKey, lengthSeconds: input.duration })
      : await generateSoundEffect(input.prompt, { key: s.elevenKey, durationSeconds: input.duration || s.sfxDuration });
    return this.addBytes(kind, { ...input, name: input.name.trim() || input.prompt.slice(0, 40) }, audio.bytes, audio.mime);
  }
  /** The 「ElevenLabs 묶음」 effects not made yet (by name, in its folder). */
  elevenPackMissing(): ElevenPackItem[] {
    const made = new Set(soundData().sfx.filter(item => item.folder === ELEVEN_PACK_FOLDER).map(item => item.name));
    return ELEVEN_PACK.filter(row => !made.has(row.name));
  }
  /** Makes the missing 「ElevenLabs 묶음」 effects one after another; one that fails (a refused prompt) does not stop the rest. */
  async makeElevenPack(progress: (done: number, all: number) => void = () => {}): Promise<{ made: number; failed: number; error: string }> {
    const rows = this.elevenPackMissing();
    let made = 0, failed = 0, error = '';
    for (const [i, row] of rows.entries()) {
      progress(i, rows.length);
      try { await this.addFromEleven('sfx', { name: row.name, tags: row.tags.join(', '), folder: ELEVEN_PACK_FOLDER, note: row.note, prompt: row.prompt, duration: row.duration }); made++; }
      catch (e) { failed++; error = String((e as Error)?.message || e).slice(0, 200); }
    }
    progress(rows.length, rows.length);
    return { made, failed, error };
  }
  private async addBytes(kind: SoundKind, input: { name: string; tags: string; folder: string; note?: string }, bytes: ArrayBuffer, mime: string): Promise<SoundItem> {
    const key = uuid(), path = await storeSoundBytes(bytes);
    const item: SoundItem = { key, kind, name: input.name, tags: soundTags(input.tags), folder: input.folder, ...(input.note?.trim() ? { note: input.note.trim().slice(0, 300) } : {}), source: 'asset',
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
  /** Until when YouTube counts as failing here (tracks with a file skip it meanwhile). */
  private tubeDownUntil = 0;
  /** The BGM track still being fetched: its buttons spin until it plays. */
  bgmLoading = '';
  async play(item: SoundItem): Promise<void> { await this.start(item); }
  /** Starts an item; `ended` settles when an effect has finished (a BGM at once). Wrapped: an async function would wait for a returned promise. */
  private async start(item: SoundItem): Promise<{ ended: Promise<void> }> {
    if (item.kind === 'bgm') {
      this.bgmLoading = item.key; this.player.onChange();
      try {
        const s = soundData().settings, video = item.source === 'youtube' ? youtubeVideoId(item.url || '') : '';
        // YouTube failed a moment ago (no player yet, a blocked video): a track with a file plays that at
        // once instead of waiting for YouTube again; one with no file still tries.
        if (video && s.youtubeBgm && (Date.now() >= this.tubeDownUntil || !item.fallbackUrl)) {
          try { await this.player.playTube(item.key, video, s.crossfadeMs, s.youtubeHidden); this.tubeDownUntil = 0; this.lastBgm = item.key; return { ended: Promise.resolve() }; }
          // YouTube could not play it here: the track's own file, when it has one.
          catch (error) {
            if (!(error as { tap?: boolean }).tap) { this.tubeDownUntil = Date.now() + 90_000; this.tubeTried = false; }
            if (!item.fallbackUrl) throw error;
            dbg('bgm.youtube.fallback', { message: String((error as Error)?.message || error).slice(0, 160) }, 'warn');
          }
        }
        if (item.source === 'youtube' && !item.fallbackUrl) throw new Error(`${item.name}: 유튜브 곡입니다. BGM 설정에서 「유튜브로 재생」을 켜 주세요.`);
        const audio = await audioOf(item.source === 'youtube' ? { ...item, source: 'url', url: item.fallbackUrl } : item);
        this.lastBgm = item.key; await this.player.playBgm(item.key, audio.bytes, audio.mime, soundData().settings.crossfadeMs);
      } finally { if (this.bgmLoading === item.key) { this.bgmLoading = ''; this.player.onChange(); } }
      return { ended: Promise.resolve() };
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
      if (soundData().settings.bgmBasis === 'tags') { await this.playBgmForTags(tags, request.segment.context || ''); return; }
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
    // Each step ranks the best tracks; the song is drawn from its top three (see drawBgm).
    const steps: Array<() => Promise<string[]>> = [];
    if (m === 'jev' || m === 'llm') steps.push(() => chooseBgm(scene, items, m, tts, tags));
    else {
      if (m !== 'embedding' && jev) steps.push(() => chooseBgm(scene, items, 'jev', tts, tags));
      if (embed) steps.push(async () => (await embedRank(`${tags.length ? `BGM 태그: ${tags.join(', ')}\n` : ''}${scene}`, items, describeBgm, embed, BGM_DRAW)).map(item => item.key));
      if (m === 'auto' || (m === 'tag' && !jev)) steps.push(() => chooseBgm(scene, items, 'llm', tts, tags));
      if (m === 'embedding' && !embed) throw new Error('임베딩이 설정되지 않았습니다. TTS·BGM·JEV 모델 설정의 임베딩 키를 넣어 주세요.');
    }
    const cacheKey = JSON.stringify([m, scene, tags, items.map(item => item.key).join(',')]);
    let pick = fresh ? undefined : this.sceneCache.get(cacheKey), failure: unknown;
    for (const step of pick ? [] : steps) {
      const ranked = (await step().catch(error => { failure = error; return [] as string[]; })).filter(key => items.some(row => row.key === key));
      if (ranked.length) { pick = drawBgm(ranked, this.player.bgmKey); break; }
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
  async playBgmForReply(reply: string, tags?: readonly string[], scene = ''): Promise<string> {
    const s = soundData().settings;
    if (!s.bgmEnabled || !soundData().bgm.length) return '';
    if (s.bgmBasis === 'tags' && tags?.length) return this.playBgmForTags(tags, scene);
    const item = await this.bgmForText(reply, s.bgmBasis === 'both' ? tags ?? [] : []);
    await this.play(item);
    return item.key;
  }
  /** BGM for a cue's tags and the scene after it (bgmForTags). Returns the key that plays. */
  async playBgmForTags(tags: readonly string[], scene = ''): Promise<string> {
    if (!soundData().settings.bgmEnabled) return '';
    const key = await this.bgmForTags(tags, scene, this.player.bgmKey);
    const item = soundData().bgm.find(row => row.key === key);
    if (item) await this.play(item);
    return item?.key || '';
  }
  /** A cue's pick, by its tags and scene: fetching ahead and playing agree, and the cue played again is the same song. */
  private cuePicks = new Map<string, Promise<string>>();
  /**
   * The track for a cue's tags. The one playing stays while no other shares more tags. Else the tags leave a pool
   * (bgmPool: the ten that share the most), and in it the scene picks: with an embedding set up and 곡 고르는 방식 on
   * 자동 or 임베딩, the start of what follows the cue is compared with each track's name, tags and 상황, and the song
   * is drawn among the nearest. With no embedding, no scene, or a failed request, it is drawn from the pool.
   */
  private async bgmForTags(tags: readonly string[], scene: string, current: string): Promise<string> {
    const s = soundData().settings, items = soundData().bgm, playing = items.find(item => item.key === current);
    const pool = bgmPool(tags, items);
    if (!pool.rows.length) return current;
    if (playing && tagScore(tags, playing) >= pool.best) return current;
    const text = scene.replace(/\s+/g, ' ').trim().slice(0, BGM_CUE_SCENE_MAX), memo = text ? JSON.stringify([tags, text]) : '';
    const kept = memo ? await this.cuePicks.get(memo)?.catch(() => '') : '';
    if (kept && items.some(item => item.key === kept)) return kept;
    const pick = (async () => {
      const embed = text && pool.rows.length > 1 && (s.bgmMatcher === 'auto' || s.bgmMatcher === 'embedding') ? soundEmbedSettings(s, ttsData().settings) : null;
      if (embed) {
        try { const key = drawBgmByScene(pool, await embedScores(`장면: ${text}`, pool.rows.map(row => describeBgm(row.item)), embed)); if (key) return key; }
        catch (error) { dbg('bgm.scene', { message: String((error as Error)?.message || error).slice(0, 160) }, 'warn'); }
      }
      return drawBgmFromPool(pool);
    })();
    if (memo) { this.cuePicks.set(memo, pick); while (this.cuePicks.size > 100) this.cuePicks.delete(this.cuePicks.keys().next().value!); }
    return pick;
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
  /** 「임베딩만」: the glossary is neither read nor taught, and the same word may be another sound in another story. */
  private embedOnly(): boolean { return soundData().settings.sfxMatcher === 'embedding-only'; }
  /** The glossary as matching reads it: none at all for 「임베딩만」. */
  private glossary(): readonly SfxTerm[] { return this.embedOnly() ? [] : soundData().glossary; }
  /** This session's pick for a word; with 「임베딩만」 for the word in that story (쾅 of a door is not 쾅 of a gun). */
  private pickKey(word: string, context: string): string { return this.embedOnly() ? `${normalizeSoundTag(word)}\n${context.slice(0, SFX_CONTEXT_MAX)}` : normalizeSoundTag(word); }
  /** What a word plays with nothing asked: the glossary, or this session's earlier pick. */
  private known(word: string, context = ''): SoundItem | null {
    const data = soundData(), found = glossarySfx(word, this.glossary(), data.sfx);
    if (found) return found;
    const key = this.memo().picks.get(this.pickKey(word, context));
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
    const data = soundData(), ask = new Map<string, { word: string; context: string }>();
    for (const word of fresh) {
      // 「임베딩만」 asks for every word: an effect's own tag is a hint there, not the answer.
      if (!this.embedOnly() && exactSfx(word.text, data.glossary, data.sfx)) continue;
      const parts = sfxParts(word.text);
      // Each word goes with its own story (all of them once went with the first word's).
      for (const part of parts.length > 1 ? parts : [word.text]) { const id = this.pickKey(part, word.context); if (!this.known(part, word.context) && !this.noMatch().has(normalizeSoundTag(part)) && !ask.has(id)) ask.set(id, { word: part, context: word.context }); }
    }
    const unknown = [...ask.values()].slice(0, 20);
    if (unknown.length) await this.resolveSfx(unknown.map(row => row.word), unknown.map(row => row.context));
    for (const word of fresh) { const plan = await this.sfxPlan(word.text, word.context); if (plan.length) await planClip(plan).catch(() => {}); }
  }
  /**
   * Words the glossary does not know, in the order 「자동」 means: JEV, then
   * embedding, then a free guess from the effects' names and tags, then the
   * closest spelling. A JEV "none fits" makes a new effect when ElevenLabs
   * generation is on; otherwise the closest effect plays anyway. An explicit
   * setting uses its own step (falling back to the guess); ⚡ (anyEngine) asks JEV
   * or the LLM on purpose and registers only what they pick.
   */
  private async resolveSfx(words: readonly string[], contexts: string | readonly string[], anyEngine = false): Promise<Array<SoundItem | null>> {
    const s = soundData().settings, tts = ttsData().settings, items = soundData().sfx, m = s.sfxMatcher, jev = !!tts.jev.key.trim();
    const storyOf = (i: number) => (typeof contexts === 'string' ? contexts : contexts[i] ?? '').slice(0, SFX_CONTEXT_MAX);
    const engine = m === 'jev' || m === 'llm' ? m : anyEngine ? (jev ? 'jev' : 'llm') : m === 'auto' && jev ? 'jev' : null;
    const embed = !anyEngine && (m === 'auto' || m === 'embedding' || m === 'embedding-only') ? soundEmbedSettings(s, tts) : null;
    if (m === 'embedding-only' && !embed && !anyEngine) this.notice = '「임베딩만」인데 임베딩이 설정되지 않았습니다. 설정 › 임베딩을 넣어 주세요 (지금은 이름·태그 글자로 고릅니다).';
    // A compound's unknown parts go in one request: one JEV question per part.
    let choices: Array<SfxChoice | null> = words.map(() => null);
    if (engine && items.length && words.length) {
      const shown = await this.shortlist(words, words.map((_, i) => storyOf(i)), items);
      choices = await chooseSfxMany(words, typeof contexts === 'string' ? storyOf(0) : words.map((_, i) => storyOf(i)), shown, engine, tts).catch(error => { this.notice = String((error as Error).message || error); return words.map(() => null); });
    }
    // No answer from JEV (none set up, or it failed): embedding for all of them in one request, then the guess.
    const generates = s.sfxAutoCreate && !!s.elevenKey.trim();
    const open = anyEngine ? [] : words.flatMap((word, i) => !choices[i] || (!generates && 'create' in choices[i]!) ? [{ word, i }] : []);
    const nearest = embed && open.length && items.length
      ? await embedPickSfx(open.map(row => ({ word: row.word, context: storyOf(row.i) })), items, item => this.describeSfx(item), embed, (word, item) => this.ownTag(word, item)).catch(error => { this.notice = String((error as Error).message || error); return open.map(() => []); })
      : open.map(() => []);
    const fallback = new Map(open.map((row, k) => [row.i, nearest[k]?.[0]?.item ?? guessSfx(row.word, items) ?? suggestSfx(row.word, this.glossary(), items, 1)[0] ?? null]));
    return Promise.all(words.map(async (word, i) => {
      const choice = choices[i] ?? null;
      if (choice && 'key' in choice) { const item = items.find(row => row.key === choice.key); if (item) { await this.learn(word, item.key); return item; } }
      if (choice) this.noMatch().add(normalizeSoundTag(word));
      const picked = fallback.get(i);
      if (picked) { this.memo().picks.set(this.pickKey(word, storyOf(i)), picked.key); while (this.memo().picks.size > 1000) this.memo().picks.delete(this.memo().picks.keys().next().value!); return picked; }
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
  /** A word spelled as one of the effect's own name or tags (up to spacing and marks): a hint for the embedding. */
  private ownTag(word: string, item: SoundItem): boolean { return exactSfx(word, [], [item]) === item; }
  /**
   * The effects JEV or the LLM is shown: all of them when they fit, else the nearest to the words first, by the
   * embedding when one is set up (else by how they sound), so an effect late in a long list can still be picked.
   * Once only the first 60 of the 226 examples were ever shown.
   */
  private async shortlist(words: readonly string[], stories: readonly string[], items: readonly SoundItem[]): Promise<readonly SoundItem[]> {
    if (items.length <= ENGINE_CANDIDATES) return items;
    const embed = soundEmbedSettings(soundData().settings, ttsData().settings), per = Math.max(10, Math.floor(ENGINE_CANDIDATES / Math.max(1, words.length)));
    const picked = new Map<string, SoundItem>();
    if (embed) {
      const ranked = await embedPickSfx(words.map((word, i) => ({ word, context: stories[i] ?? '' })), items, item => this.describeSfx(item), embed, (word, item) => this.ownTag(word, item), per).catch(() => [] as Array<Array<{ item: SoundItem }>>);
      for (const rows of ranked) for (const row of rows) picked.set(row.item.key, row.item);
    }
    for (const word of words) for (const item of suggestSfx(word, this.glossary(), items, per)) picked.set(item.key, item);
    for (const item of items) { if (picked.size >= ENGINE_CANDIDATES) break; picked.set(item.key, item); }
    return [...picked.values()].slice(0, ENGINE_CANDIDATES);
  }
  /**
   * 「맞춰 보기」: the effects the embedding puts nearest a word in a story, best first, with their scores, so the
   * reader sees what it would play and why (nothing is played, learned or kept).
   */
  async tryEffectMatch(word: string, story: string): Promise<Array<{ name: string; score: number; folder: string }>> {
    const s = soundData().settings, embed = soundEmbedSettings(s, ttsData().settings);
    if (!embed) throw new Error('임베딩이 설정되지 않았습니다. 아래 임베딩 칸을 먼저 채워 주세요.');
    if (!word.trim()) throw new Error('효과음 단어를 적어 주세요.');
    const [rows = []] = await embedPickSfx([{ word: word.trim(), context: story.trim().slice(0, SFX_CONTEXT_MAX) }], soundData().sfx, item => this.describeSfx(item), embed, (w, item) => this.ownTag(w, item), 5);
    return rows.map(row => ({ name: row.item.name, folder: row.item.folder, score: Math.round(row.score * 1000) / 1000 }));
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
    const data = soundData(), parts = sfxParts(word), exact = exactSfx(word, this.glossary(), data.sfx);
    // 「임베딩만」: a word that is an effect's own name stays whole, but the embedding still says which effect it is.
    if (parts.length <= 1 || exact) { const item = (!this.embedOnly() && exact) || await this.sfxFor(word, context); return item ? [{ item }] : []; }
    const found: Array<SoundItem | null> = parts.map(part => this.known(part, context));
    const missing = parts.flatMap((_, i) => found[i] ? [] : [i]);
    const ask = missing.filter(i => !this.noMatch().has(normalizeSoundTag(parts[i]!)));
    if (ask.length) { const resolved = await this.resolveSfx(ask.map(i => parts[i]!), context); ask.forEach((i, k) => { found[i] = resolved[k] ?? null; }); }
    const unknown = parts.filter((part, i) => !found[i] && !data.unknownTerms.includes(part));
    if (unknown.length) { data.unknownTerms = [...new Set(unknown), ...data.unknownTerms].slice(0, 200); await saveSoundData(); }
    const kept = parts.flatMap((part, i) => found[i] ? [{ part, item: found[i]! }] : []);
    const seconds = sfxPartSeconds(kept.map(row => row.part), data.settings.sfxMaxSec);
    return kept.map((row, i) => ({ item: row.item, seconds: seconds[i] }));
  }
  /**
   * An effect for the embedding: its name, the sound words it is heard as (its tags, and the glossary's words unless
   * 「임베딩만」), when it is heard (상황), and for an example still as shipped the same in English: an onomatopoeia is
   * Korean only, but the story around it is matched better with both.
   */
  private describeSfx(item: SoundItem): string {
    const words = this.glossary().filter(row => row.sfxKey === item.key).flatMap(row => row.terms);
    const english = item.source === 'url' && item.url ? sampleSfxEnglish(item.url, item.note) : '';
    return [item.name, `의성어: ${soundTags([...item.tags, ...words]).join(', ')}`, item.note ? `상황: ${item.note}` : '', english].filter(Boolean).join(' · ');
  }
  private async sfxFor(word: string, context: string): Promise<SoundItem | null> {
    const item = this.known(word, context) || (this.noMatch().has(normalizeSoundTag(word)) ? null : (await this.resolveSfx([word], context))[0]);
    if (item) return item;
    const data = soundData(), clean = word.trim().slice(0, 60);
    if (clean && !data.unknownTerms.includes(clean)) { data.unknownTerms = [clean, ...data.unknownTerms].slice(0, 200); await saveSoundData(); }
    return null;
  }
}
/** A track as the embedding reads it: its name, folder, tags and 상황 (the scene it suits). */
export const describeBgm = (item: SoundItem): string => [item.name, item.folder, item.tags.join(', '), item.note ? `상황: ${item.note}` : ''].filter(Boolean).join(' · ');
/** How many of the cues on screen have their track fetched ahead: the latest ones, where reading is. */
const BGM_PREFETCH_CUES = 4;
export const omniSound = new OmniSoundRuntime();

/** A YouTube video's title, for a link added without a name ('' when YouTube does not say). */
async function youtubeTitle(url: string): Promise<string> {
  try {
    const response = await ttsFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { method: 'GET' });
    const data = await ttsJson(response) as { title?: unknown } | null;
    return typeof data?.title === 'string' ? data.title.slice(0, 120) : '';
  } catch { return ''; }
}
