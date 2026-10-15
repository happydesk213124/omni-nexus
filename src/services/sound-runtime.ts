import type { SoundItem, SoundKind } from '../core/sound-types';
import { uuid } from '../core/util/text';
import { SoundPlayer } from '../providers/sound/player';
import { ttsBytes, ttsFetch } from '../providers/tts/http';
import { AUDIO_EXTENSIONS, sniffAudioMime } from '../domain/sound/audio';
import { pickBgm, pickSfx } from '../domain/sound/match';
import { soundTags } from '../domain/sound/tags';
import { loadSoundData, saveSoundData, soundData, subscribeSound } from '../storage/sound-store';
import { ensureSoundModules, readSoundAsset, storeSoundBytes } from '../storage/sound-module';
import { omniTts } from './tts-runtime';

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
      // TTS speech lowers the music; nothing else listens for it.
      omniTts.subscribe(() => this.player.duck(omniTts.player.status === 'playing' || omniTts.player.status === 'loading'));
    })().catch(error => { this.started = undefined; throw error; });
  }
  private sync(): void {
    const s = soundData().settings;
    this.player.configure({ bgmVolume: s.bgmVolume, sfxVolume: s.sfxVolume, duck: s.duck });
    if (!s.bgmEnabled) this.player.stopBgm();
    // Module writes rewrite the whole Risu module list: only when what they hold changed.
    const data = soundData(), wanted = JSON.stringify([s.bgmEnabled, s.sfxEnabled, s.bgmPrompt, s.bgmTags, s.sfxRules,
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
    const key = uuid(), path = await storeSoundBytes(bytes);
    const item: SoundItem = { key, kind, name: input.name.trim() || input.file.name.replace(/\.[^.]+$/, ''), tags: soundTags(input.tags), folder: input.folder, source: 'asset',
      assetName: `omnisound_${kind}_${key.slice(0, 8)}.${AUDIO_EXTENSIONS[mime] || 'mp3'}`, assetPath: path, mime, bytes: bytes.byteLength };
    remember(item.key, bytes, mime);
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
  async play(item: SoundItem): Promise<void> {
    const audio = await audioOf(item);
    if (item.kind === 'bgm') { this.lastBgm = item.key; await this.player.playBgm(item.key, audio.bytes, audio.mime, soundData().settings.crossfadeMs); }
    else await this.player.playSfx(audio.bytes, audio.mime);
  }
  /** BGM for a reply's tags; free word matching first. Returns the key that plays. */
  async playBgmForTags(tags: readonly string[]): Promise<string> {
    if (!soundData().settings.bgmEnabled) return '';
    const pick = pickBgm(tags, soundData().bgm, this.player.bgmKey);
    const item = soundData().bgm.find(row => row.key === pick.key);
    if (item) await this.play(item);
    return item?.key || '';
  }
  /** Plays the effect for a word; an unknown word is kept for the glossary. */
  async playSfxWord(word: string): Promise<boolean> {
    if (!soundData().settings.sfxEnabled) return false;
    const item = pickSfx(word, soundData().glossary, soundData().sfx);
    if (item) { await this.play(item); return true; }
    const data = soundData(), clean = word.trim().slice(0, 60);
    if (clean && !data.unknownTerms.includes(clean)) { data.unknownTerms = [clean, ...data.unknownTerms].slice(0, 200); await saveSoundData(); }
    return false;
  }
}
export const omniSound = new OmniSoundRuntime();
