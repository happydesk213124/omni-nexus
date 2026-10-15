import type { SoundItem, SoundKind } from '../core/sound-types';
import { uuid } from '../core/util/text';
import { SoundPlayer } from '../providers/sound/player';
import { ttsBytes, ttsFetch } from '../providers/tts/http';
import { AUDIO_EXTENSIONS, sniffAudioMime } from '../domain/sound/audio';
import { exactSfx, pickBgm, pickSfx } from '../domain/sound/match';
import { normalizeSoundTag, soundTags } from '../domain/sound/tags';
import { loadSoundData, saveSoundData, soundData, soundReady, subscribeSound, updateSoundSettings } from '../storage/sound-store';
import { ensureSoundModules, readSoundAsset, storeSoundBytes } from '../storage/sound-module';
import { omniTts, type TtsSoundCuePlayer } from './tts-runtime';
import { ttsData } from '../storage/tts-store';
import { generateMusic, generateSoundEffect, englishText } from '../providers/sound/elevenlabs';
import { chooseBgm, chooseSfxMany, type SfxChoice } from '../providers/sound/choose';
import { joinSfxClips, sfxPartSeconds, sfxParts } from '../domain/sound/combo';
import { bgmSceneText } from '../domain/sound/scene';
import { decodeAudio } from '../providers/sound/decode';
import { encodeSfxWav, sfxWindow } from '../domain/sound/clip';

/** Folder for effects ElevenLabs made on its own, so they are easy to review. */
export const AUTO_SFX_FOLDER = '자동 생성';

/** Fetched or read audio, newest last; bounded so a long session does not grow without limit. */
const CACHE_LIMIT = 48 * 1024 * 1024;
const cache = new Map<string, { bytes: ArrayBuffer; mime: string }>();
let cached = 0;
function remember(key: string, bytes: ArrayBuffer, mime: string): void {
  if (cache.has(key)) return;
  cache.set(key, { bytes, mime }); cached += bytes.byteLength;
  for (const [old, row] of cache) { if (cached <= CACHE_LIMIT) break; cache.delete(old); cached -= row.bytes.byteLength; }
}

export async function downloadAudio(url: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  if (!/^https:\/\//i.test(url)) throw new Error('https:// 로 시작하는 오디오 파일 주소를 넣어 주세요.');
  const bytes = await ttsBytes(await ttsFetch(url, { method: 'GET' }));
  const mime = sniffAudioMime(bytes);
  if (!mime) throw new Error('오디오 파일이 아닙니다. 페이지 주소가 아니라 파일 자체를 가리키는 주소인지 확인해 주세요.');
  return { bytes, mime };
}
async function audioOf(item: SoundItem): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const hit = cache.get(item.key);
  if (hit) return hit;
  let row: { bytes: ArrayBuffer; mime: string };
  if (item.source === 'asset') {
    const bytes = await readSoundAsset(item.assetPath || '');
    if (!bytes) throw new Error(`${item.name}: 모듈에 저장한 파일을 읽지 못했습니다.`);
    row = { bytes, mime: item.mime || sniffAudioMime(bytes) || 'audio/mpeg' };
  } else row = await downloadAudio(item.url || '');
  remember(item.key, row.bytes, row.mime);
  return row;
}

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
      subscribeSound(() => this.sync());
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
    remember(item.key, audio.bytes, audio.mime);
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
    remember(item.key, bytes, mime);
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
    const clip = await this.clip(item);
    // A preview, or ▶ with TTS off: still one voice at a time.
    if (['playing', 'loading', 'paused'].includes(omniTts.player.status)) omniTts.stop();
    return this.player.playSfx(clip.bytes, clip.mime);
  }
  private clips = new Map<string, Promise<{ bytes: ArrayBuffer; mime: string }>>();
  /** An effect cut and levelled once per settings (silence, loudness, longest length); the bytes are the played clip. */
  private clip(item: SoundItem): Promise<{ bytes: ArrayBuffer; mime: string }> {
    const s = soundData().settings, options = { maxSeconds: s.sfxMaxSec, trim: s.sfxTrim, normalize: s.sfxNormalize };
    const key = JSON.stringify([item.key, options]);
    let job = this.clips.get(key);
    if (!job) {
      job = (async () => {
        const audio = await audioOf(item);
        try {
          const pcm = await decodeAudio(audio.bytes);
          return { bytes: encodeSfxWav(pcm.channels, pcm.sampleRate, sfxWindow(pcm.channels, pcm.sampleRate, options)), mime: 'audio/wav' };
        } catch { return audio; } // This browser cannot decode it: it plays as it is, if it can play it at all.
      })();
      this.clips.set(key, job);
      job.catch(() => this.clips.delete(key));
      while (this.clips.size > 24) this.clips.delete(this.clips.keys().next().value!);
    }
    return job;
  }
  /**
   * Rows of the TTS list. A BGM cue switches the music and reading goes on at
   * once (the music plays under the voice); an effect is a clip the voice player
   * plays like a line.
   */
  private cues: TtsSoundCuePlayer = {
    listed: segment => { if (!soundReady()) return false; const s = soundData().settings; return segment.kind === 'bgm' ? s.bgmEnabled && s.listBgm : s.sfxEnabled && s.listSfx; },
    automatic: segment => segment.kind === 'bgm' || (soundReady() && soundData().settings.sfxAutoPlay === 'reply'),
    play: async request => {
      if (request.segment.kind === 'bgm') await this.playBgmForTags(request.segment.tags ?? soundTags(request.segment.text));
    },
    effect: async request => {
      if (!soundReady() || !soundData().settings.sfxEnabled) return null;
      const plan = await this.sfxPlan(request.segment.text, request.segment.context || '');
      if (!plan.length) return null;
      this.player.stopSfx();
      return { ...(await this.planClip(plan)), volume: soundData().settings.sfxVolume };
    },
  };
  /**
   * ⚡: a reply's own text picks the music, for replies with no BGM cue. JEV or
   * the LLM, as the BGM matcher setting says; any other setting uses JEV when it
   * has a key, else the LLM (the effect rule). Picking music turns BGM on.
   */
  async guessBgm(reply: string): Promise<SoundItem> {
    const s = soundData().settings, tts = ttsData().settings, items = soundData().bgm;
    if (!items.length) throw new Error('등록된 BGM이 없습니다. BGM·효과음 설정에서 추가해 주세요.');
    const scene = bgmSceneText(reply);
    if (!scene) throw new Error('곡을 고를 메시지가 없습니다.');
    const engine = s.bgmMatcher === 'jev' || s.bgmMatcher === 'llm' ? s.bgmMatcher : tts.jev.key.trim() ? 'jev' : 'llm';
    const pick = await chooseBgm(scene, items, engine, tts);
    const item = items.find(row => row.key === pick) ?? null;
    if (!item) throw new Error('메시지에 맞는 곡을 고르지 못했습니다.');
    if (!s.bgmEnabled) await updateSoundSettings({ bgmEnabled: true });
    await this.play(item);
    return item;
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
  private async resolveSfx(words: readonly string[], context: string, anyEngine = false): Promise<Array<SoundItem | null>> {
    const s = soundData().settings, tts = ttsData().settings, items = soundData().sfx;
    // anyEngine: asked for on purpose (⚡), so a word-only matcher setting still uses JEV or the LLM.
    const engine = s.sfxMatcher === 'jev' || s.sfxMatcher === 'llm' ? s.sfxMatcher : s.sfxMatcher === 'auto' || anyEngine ? (tts.jev.key.trim() ? 'jev' : 'llm') : null;
    // A compound's unknown parts go in one request: one JEV question per part.
    let choices: Array<SfxChoice | null> = words.map(() => null);
    if (engine && items.length && words.length) choices = await chooseSfxMany(words, context, items, engine, tts).catch(error => { this.notice = String((error as Error).message || error); return words.map(() => null); });
    return Promise.all(words.map(async (word, i) => {
      const choice = choices[i] ?? null;
      if (choice && 'key' in choice) { const item = items.find(row => row.key === choice.key); if (item) { await this.learn(word, item.key); return item; } }
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
    const clip = await this.planClip(plan);
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
    const found: Array<SoundItem | null> = parts.map(part => pickSfx(part, data.glossary, data.sfx));
    const missing = parts.flatMap((_, i) => found[i] ? [] : [i]);
    if (missing.length) { const resolved = await this.resolveSfx(missing.map(i => parts[i]!), context); missing.forEach((i, k) => { found[i] = resolved[k] ?? null; }); }
    const unknown = parts.filter((part, i) => !found[i] && !data.unknownTerms.includes(part));
    if (unknown.length) { data.unknownTerms = [...new Set(unknown), ...data.unknownTerms].slice(0, 200); await saveSoundData(); }
    const kept = parts.flatMap((part, i) => found[i] ? [{ part, item: found[i]! }] : []);
    const seconds = sfxPartSeconds(kept.map(row => row.part), data.settings.sfxMaxSec);
    return kept.map((row, i) => ({ item: row.item, seconds: seconds[i] }));
  }
  /** One effect is its own clip; a compound's parts are cut to their shares and joined into one. */
  private planClip(plan: ReadonlyArray<{ item: SoundItem; seconds?: number }>): Promise<{ bytes: ArrayBuffer; mime: string }> {
    if (plan.length === 1 && plan[0]!.seconds === undefined) return this.clip(plan[0]!.item);
    const s = soundData().settings, options = { trim: s.sfxTrim, normalize: s.sfxNormalize };
    const key = JSON.stringify(['combo', plan.map(row => [row.item.key, Math.round((row.seconds ?? 0) * 100)]), options]);
    let job = this.clips.get(key);
    if (!job) {
      job = (async () => {
        try {
          const pcm = await Promise.all(plan.map(async row => decodeAudio((await audioOf(row.item)).bytes)));
          const rate = pcm[0]!.sampleRate;
          const joined = joinSfxClips(pcm.map((part, i) => ({ channels: part.channels, window: sfxWindow(part.channels, part.sampleRate, { ...options, maxSeconds: plan[i]!.seconds ?? s.sfxMaxSec }) })), rate);
          return { bytes: encodeSfxWav(joined, rate, { start: 0, end: joined[0]!.length, cut: false, gain: 1 }), mime: 'audio/wav' };
        } catch { return this.clip(plan[0]!.item); } // A part this browser cannot decode: the first effect alone.
      })();
      this.clips.set(key, job);
      job.catch(() => this.clips.delete(key));
      while (this.clips.size > 24) this.clips.delete(this.clips.keys().next().value!);
    }
    return job;
  }
  private async sfxFor(word: string, context: string): Promise<SoundItem | null> {
    const item = pickSfx(word, soundData().glossary, soundData().sfx) || (await this.resolveSfx([word], context))[0];
    if (item) return item;
    const data = soundData(), clean = word.trim().slice(0, 60);
    if (clean && !data.unknownTerms.includes(clean)) { data.unknownTerms = [clean, ...data.unknownTerms].slice(0, 200); await saveSoundData(); }
    return null;
  }
}
export const omniSound = new OmniSoundRuntime();
