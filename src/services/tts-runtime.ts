import type { TtsCharacter, TtsSegment, TtsSettings } from '../core/tts-types';
import { TtsQueue } from '../domain/tts/queue';
import { isSoundSegment, speechTone, synthesisSignature } from '../domain/tts/segment';
import { allowedTtsText, ttsExcludeTerms, ttsSpokenText } from '../domain/tts/filter';
import { ttsCharacterGain, ttsSegmentOwner, ttsSegmentRole } from '../domain/tts/identity';
import { TtsAudioCache } from '../storage/tts-cache';
import { TtsTranslationCache } from '../storage/tts-translations';
import { loadTtsData, ttsData, subscribeTts, updateTtsSettings } from '../storage/tts-store';
import { ensureTtsModule } from '../storage/tts-module';
import { synthesizeFish } from '../providers/tts/fish';
import { TtsHttpError } from '../providers/tts/http';
import { TtsPlayer } from '../providers/tts/player';
import { translateTts } from '../providers/tts/translation';
import { ensureTtsSpeakers } from './tts-characters';
import type { TtsChatContext } from './tts-context';
import { clearTtsVoiceError, recordTtsVoiceError, TtsVoiceRecovery } from './tts-recovery';

/** tone / model: a preview's own base delivery and model (the character popup's unsaved fields). */
export interface TtsRequest { segment: TtsSegment; context: TtsChatContext; messageId: string; sourceKey?: string; fishId?: string; gain?: number; tone?: string; model?: string }
/**
 * BGM·효과음 rows in the list. The sound runtime registers itself here, so TTS
 * never imports it (it already listens to TTS to lower the music).
 */
export interface TtsSoundCuePlayer {
  /** Shown in the list and playable from it. */
  listed(segment: TtsSegment): boolean;
  /** Played on its own while reading continues; otherwise reading steps over it. */
  automatic(segment: TtsSegment): boolean;
  /** A BGM row: resolves once the change has started (the music plays under the voice). */
  play(request: TtsRequest): Promise<void>;
  /**
   * An effect row as a clip. It plays through the voice player like a line: one
   * sound at a time, stopped by ■, shown on the bar, and reading goes on when it
   * ends. null: no effect fits the word.
   */
  effect(request: TtsRequest): Promise<{ bytes: ArrayBuffer; mime: string; volume: number } | null>;
}
interface Prepared { request: TtsRequest; text: string; signature: string; fishId: string; gain: number; rate?: number; settings: TtsSettings; character?: TtsCharacter; language: string; tone: string }
export class OmniTtsRuntime {
  readonly player = new TtsPlayer();
  readonly cache = new TtsAudioCache();
  readonly queue = new TtsQueue<ArrayBuffer>();
  private translations = new TtsTranslationCache();
  private translating = new Map<string, Promise<string>>();
  private failedAudio = new Map<string, number>();
  private recovery = new TtsVoiceRecovery();
  private listeners = new Set<() => void>();
  private started?: Promise<void>;
  private subscribed = false;
  private changeTail: Promise<void> = Promise.resolve();
  private cacheBudget = 0;
  private scope = '';
  private intent = 0;
  private viewport = 0;
  private standalone = false;
  private sequence: TtsRequest[] = [];
  private messageSequence: TtsRequest[] = [];
  private readingSequence: TtsRequest[] = [];
  private sequenceIndex = -1;
  private moduleSignature = '';
  private settingsSignature = '';
  private sound?: TtsSoundCuePlayer;
  notice = '';
  stage = '';
  get current(): TtsRequest | undefined { return this.sequence[this.sequenceIndex]; }
  get list(): readonly TtsRequest[] { return this.messageSequence.filter(request => this.eligible(request)); }
  subscribe(callback: () => void): () => void { this.listeners.add(callback); return () => this.listeners.delete(callback); }
  private emit(): void { for (const callback of this.listeners) callback(); }
  report(error: unknown): void { this.notice = String((error as Error)?.message || error); this.emit(); }
  setSoundCues(player: TtsSoundCuePlayer): void { this.sound = player; this.emit(); }
  async init(): Promise<void> {
    return this.started ||= (async () => {
      await loadTtsData();
      if (!this.subscribed) {
        subscribeTts(() => { void this.synchronize().catch(error => this.report(error)); });
        this.subscribed = true;
      }
      this.queue.onChange = () => this.emit();
      this.player.onChange = (_state, error) => { if (error) this.notice = error; this.emit(); };
      this.player.onEnded = () => { if (ttsData().settings.continuous && !this.standalone) void this.next(1, true); };
      await this.translations.init();
      await this.synchronize();
    })().catch(error => { this.started = undefined; throw error; });
  }
  private synchronize(): Promise<void> {
    const result = this.changeTail.catch(() => {}).then(() => this.changed());
    this.changeTail = result;
    return result;
  }
  private async changed(): Promise<void> {
    const s = ttsData().settings;
    this.queue.configure(s.concurrency, s.background);
    this.player.configure(s.rate, s.volume);
    const generation = JSON.stringify([s.enabled, s.fish, s.translation, s.normalize, s.excludeText, s.skipChars, s.stripBrackets, s.omitCharacters, s.skipSymbolOnly]);
    if (generation !== this.settingsSignature) {
      this.failedAudio.clear();
      this.settingsSignature = generation; this.viewport++; this.queue.cancelPending(); this.stop();
    }
    if (!s.enabled) { this.stop(); this.queue.cancelPending(); }
    if (this.current && !this.eligible(this.current) && ['playing', 'loading', 'paused'].includes(this.player.status)) this.stop();
    this.emit();
    if (!s.enabled && !this.moduleSignature) return;
    const moduleKey = JSON.stringify([s.enabled, s.hideName, s.hideTone, s.illustration, s.passageLine, s.excludeText, s.skipChars, s.skipSymbolOnly]);
    if (moduleKey !== this.moduleSignature) { await ensureTtsModule(s); this.moduleSignature = moduleKey; }
    if (s.enabled && this.cacheBudget !== s.cacheMb) { await this.cache.configure(s.cacheMb); this.cacheBudget = s.cacheMb; }
  }
  setContext(context: TtsChatContext): void {
    if (this.scope === context.scope) return;
    this.scope = context.scope; this.viewport++; this.stop(); this.sequence = []; this.messageSequence = []; this.readingSequence = []; this.sequenceIndex = -1; this.queue.cancelPending();
  }
  reading(requests:TtsRequest[]):void {
    this.readingSequence=requests;
    if(this.player.status==='playing'||this.player.status==='loading'||this.player.status==='paused')return;
    const current=this.current,index=requests.findIndex(r=>r.messageId===current?.messageId&&r.segment.id===current.segment.id&&this.eligible(r));
    const next=index>=0?index:requests.findIndex(r=>this.eligible(r));
    const changed=this.sequenceIndex!==next||JSON.stringify(this.messageSequence.map(r=>[r.messageId,r.segment.id,r.segment.text]))!==JSON.stringify(requests.map(r=>[r.messageId,r.segment.id,r.segment.text]));
    this.sequence=requests;this.sequenceIndex=next;this.messageSequence=requests;this.standalone=false;
    if(changed)this.emit();
  }
  async power(enabled: boolean): Promise<void> {
    if (!enabled) { this.viewport++; this.stop(); this.queue.cancelPending(); }
    await updateTtsSettings({ enabled });
    await this.synchronize();
  }
  stop(): void { this.intent++; this.queue.cancelWaitingPlayback(); this.player.stop(); }
  reservePlayback(): number { this.stop(); return this.intent; }
  playbackReserved(reservation: number): boolean { return reservation === this.intent && ttsData().settings.enabled; }
  pause(): void { this.intent++; this.queue.cancelWaitingPlayback(); this.player.pause(); }
  async clearCache(): Promise<void> { this.viewport++; this.queue.cancelPending(); await this.cache.clear(); await this.translations.clear(); this.emit(); }
  private eligible(request: TtsRequest): boolean {
    if (isSoundSegment(request.segment)) return !!this.sound?.listed(request.segment);
    const s = ttsData().settings;
    return (request.segment.kind !== 'narration' || s.narration) && allowedTtsText(request.segment.text, ttsExcludeTerms(s.excludeText), s.skipChars, s.skipSymbolOnly);
  }
  async play(requests: TtsRequest[], index: number, reservation?: number): Promise<void> {
    await this.init();
    if (reservation !== undefined && reservation !== this.intent) return;
    if (!ttsData().settings.enabled) return;
    const request = requests[index];
    if (!request || !this.eligible(request)) return;
    this.setContext(request.context);
    if (isSoundSegment(request.segment)) { await this.playCue(requests, index); return; }
    const key = JSON.stringify([request.context.scope, request.messageId, request.segment.id, request.segment.text, request.fishId]);
    if (this.player.key === key && ['playing', 'loading'].includes(this.player.status)) return;
    this.stop();
    const ticket = this.intent;
    this.sequence = requests; this.sequenceIndex = index;
    if (request.segment.kind === 'dialogue' || request.segment.kind === 'narration') this.messageSequence = requests;
    this.standalone = request.segment.kind === 'audition';
    this.notice = '';
    const valid = () => ticket === this.intent && request.context.scope === this.scope && ttsData().settings.enabled && this.eligible(request);
    await this.player.play(key, async () => {
      const prepared = await this.prepare([request], valid);
      if (!valid() || !prepared[0]) throw new Error('재생 요청이 변경되었습니다.');
      this.player.configure(prepared[0].rate ?? ttsData().settings.rate, ttsData().settings.volume, prepared[0].gain);
      return this.audio(prepared[0], 0, valid);
    });
  }
  /** An effect from its chat ▶: like tapping a line, it takes over from whatever is playing. */
  async playEffect(requests: TtsRequest[], index: number): Promise<boolean> {
    await this.init();
    const request = requests[index];
    if (!request || request.segment.kind !== 'sfx' || !this.sound) return false;
    this.setContext(request.context);
    return this.effect(requests, index);
  }
  private async effect(requests: TtsRequest[], index: number): Promise<boolean> {
    const request = requests[index]!;
    this.stop();
    const ticket = this.intent;
    this.sequence = requests; this.sequenceIndex = index; this.messageSequence = requests; this.standalone = false; this.notice = '';
    const clip = this.sound!.effect(request).catch(error => { this.report(error); return null; });
    let missing = false;
    await this.player.play(JSON.stringify(['sfx', request.context.scope, request.messageId, request.segment.id, request.segment.text]), async () => {
      const found = await clip;
      if (ticket !== this.intent) throw new Error('재생 요청이 변경되었습니다.');
      // Stopping first keeps the player quiet: no effect is not a playback error.
      if (!found) { missing = true; this.player.stop(); throw new Error('no effect'); }
      this.player.configure(1, found.volume, 0);
      return found;
    }, 0);
    if (!missing || ticket !== this.intent) return !missing;
    if (!this.notice) this.report(new Error(`「${request.segment.text}」에 맞는 효과음이 없습니다. 효과음 용어집에서 지정해 주세요.`));
    // Reading goes on as if it had played.
    if (ttsData().settings.enabled && ttsData().settings.continuous) await this.next(1, true);
    return false;
  }
  private async playCue(requests: TtsRequest[], index: number): Promise<void> {
    if (requests[index]?.segment.kind === 'sfx') { await this.effect(requests, index); return; }
    this.stop();
    const ticket = this.intent;
    this.sequence = requests; this.sequenceIndex = index; this.messageSequence = requests; this.standalone = false; this.notice = '';
    this.emit();
    try { await this.sound!.play(requests[index]!); }
    catch (error) { this.report(error); }
    if (ticket === this.intent && ttsData().settings.continuous) await this.next(1, true);
  }
  async replay(): Promise<void> {
    const requests=this.readingSequence.length?this.readingSequence:this.sequence;
    const current=requests.findIndex(r=>r.messageId===this.current?.messageId&&r.segment.id===this.current.segment.id);
    const index=current>=0&&this.eligible(requests[current])?current:requests.findIndex(r=>this.eligible(r));
    if(index<0){this.report(new Error('현재 화면에 재생할 대사가 없습니다.'));return;}
    await this.play(requests,index);
  }
  /** Asks Fish for a new take of the current line instead of the cached clip. */
  async regenerate(): Promise<void> {
    const requests = this.sequence.length ? this.sequence : this.readingSequence;
    const index = this.sequence.length ? this.sequenceIndex : requests.findIndex(r => this.eligible(r));
    const request = requests[index];
    if (!request || !this.eligible(request) || isSoundSegment(request.segment)) { this.report(new Error('다시 만들 대사가 없습니다. 목록에서 대사 줄을 먼저 골라 주세요.')); return; }
    this.stop();
    const ticket = this.intent;
    const prepared = await this.prepare([request], () => ticket === this.intent && ttsData().settings.enabled);
    if (ticket !== this.intent || !prepared[0]) return;
    this.failedAudio.delete(prepared[0].signature);
    await this.cache.remove(prepared[0].signature);
    if (ticket !== this.intent) return;
    await this.play(requests, index, ticket);
  }
  /** `reading`: continuous reading moved on by itself, so cues that only play on a tap are stepped over. */
  async next(delta: number, reading = false): Promise<void> {
    let index = this.sequenceIndex + delta;
    const skip = (r: TtsRequest) => !this.eligible(r) || (reading && isSoundSegment(r.segment) && !this.sound?.automatic(r.segment));
    while (index >= 0 && index < this.sequence.length && skip(this.sequence[index])) index += delta;
    if (index >= 0 && index < this.sequence.length) await this.play(this.sequence, index);
  }
  private async prepare(requests: TtsRequest[], valid: () => boolean): Promise<Prepared[]> {
    if (!requests.length || !valid()) return [];
    const context = requests[0].context;
    this.stage = '화자 확인'; this.emit();
    await ensureTtsSpeakers(context, requests.filter(r => !r.fishId).map(r => r.segment.speaker).filter(Boolean), valid);
    if (!valid()) return [];
    const settings = JSON.parse(JSON.stringify(ttsData().settings)) as TtsSettings;
    const prepared = requests.flatMap(request => {
      // Narration, unnamed illustration lines and monologues use their role cards (the bot's own, or the global one).
      const character = ttsSegmentOwner(request.segment, ttsData().characters, context.rosterScope);
      const role = ttsSegmentRole(request.segment);
      const voiceKey = role === 'narrator' ? character?.voiceKey || settings.narrationVoice : character?.voiceKey;
      const voice = ttsData().voices.find(v => v.key === voiceKey);
      const fishId = request.fishId || character?.fishId || voice?.fishId || '';
      const recoverable = !request.fishId && character && request.segment.kind !== 'audition' && !role;
      // The speaker's own base delivery and model, else the settings' ones.
      const own = (value: unknown) => typeof value === 'string' ? value.trim() : '';
      const base = own(request.tone) || own(character?.tone) || settings.tone, model = own(request.model) || own(character?.model);
      const voiceSettings = model ? { ...settings, fish: { ...settings.fish, model } } : settings;
      return fishId ? [{ request, text: ttsSpokenText(request.segment.spoken ?? request.segment.text, settings.omitCharacters), signature: '', fishId, gain: request.gain ?? (character ? ttsCharacterGain(character) : 0), rate: character?.rate, settings: voiceSettings, language: (character?.language || '').trim(), tone: speechTone(request.segment.tone, base), character: recoverable ? JSON.parse(JSON.stringify(character)) as TtsCharacter : undefined }] : [];
    });
    if (!prepared.length) throw new Error('캐릭터 또는 나레이션 음성을 먼저 지정해 주세요.');
    const missing: Prepared[] = [];
    // A character's own language wins over the setting; with translation OFF
    // it still translates through the key-free Google service.
    const target = (p: Prepared) => p.language || ttsTargetLanguage(p.request.segment, settings);
    const provider = (p: Prepared): TtsSettings['translation']['provider'] => settings.translation.provider === 'off' && p.language && p.language !== 'original' ? 'google-free' : settings.translation.provider;
    const cacheKey = (p: Prepared) => JSON.stringify([provider(p), target(p), settings.translation.url, settings.translation.llm.source, settings.translation.llm.endpoint, settings.translation.llm.model, p.request.segment.speaker, p.request.segment.tone, p.text]);
    for (const p of prepared) {
      if (p.request.segment.kind === 'audition' || provider(p) === 'off' || target(p) === 'original') continue;
      const text = this.translations.get(cacheKey(p));
      if (text !== undefined) p.text = text; else missing.push(p);
    }
    if (missing.length) {
      this.stage = '번역'; this.emit();
      const fresh = [...new Map(missing.filter(p=>!this.translating.has(cacheKey(p))).map(p=>[cacheKey(p),p])).values()];
      // Narration may have its own target language, so batch per language.
      for (const route of new Set(fresh.map(p => JSON.stringify([provider(p), target(p)])))) {
        const [via, language] = JSON.parse(route) as [TtsSettings['translation']['provider'], string];
        const group = fresh.filter(p => provider(p) === via && target(p) === language);
        const batch = translateTts(group.map(p=>({...p.request.segment,text:p.request.segment.spoken??p.request.segment.text})),{ ...settings, translation: { ...settings.translation, provider: via, language } });
        group.forEach((p,i)=>{const key=cacheKey(p), row=batch.then(values=>values[i]);this.translating.set(key,row);void row.finally(()=>{if(this.translating.get(key)===row)this.translating.delete(key);}).catch(()=>{});});
      }
      const translated=await Promise.all(missing.map(p=>this.translating.get(cacheKey(p))!));
      if (!valid()) return [];
      missing.forEach((p,i)=>{this.translations.put(cacheKey(p),translated[i]);p.text=translated[i];});
      void this.translations.flush().catch(error => this.report(error));
    }
    for (const p of prepared) {
      p.text = ttsSpokenText(p.text, settings.omitCharacters);
      p.signature = synthesisSignature(p.text, p.tone, p.fishId, p.settings);
    }
    return prepared;
  }
  private async audio(p: Prepared, priority: number, valid: () => boolean, canRecover = true): Promise<ArrayBuffer> {
    const cached = await this.cache.get(p.signature);
    if (cached) return cached;
    if (!valid()) throw new Error('TTS 요청이 변경되었습니다.');
    if (priority > 0 && (this.failedAudio.get(p.signature) || 0) > Date.now() - 30_000) throw new Error('음성 생성 재시도 대기 중입니다.');
    const generation = this.cache.generation;
    try { return await this.queue.request(p.signature, async () => {
      const again = await this.cache.get(p.signature); if (again) return again;
      if (!ttsData().settings.enabled) throw new Error('TTS가 꺼져 있습니다.');
      this.stage = canRecover ? '음성 생성' : '대체 음성 생성'; this.emit();
      let bytes: ArrayBuffer;
      try { bytes = await synthesizeFish(p.text, p.tone, p.fishId, p.settings); }
      catch (error) {
        this.failedAudio.set(p.signature, Date.now());
        if (this.failedAudio.size > 100) this.failedAudio.delete(this.failedAudio.keys().next().value!);
        if (error instanceof TtsHttpError && error.status) await recordTtsVoiceError(p.fishId, error.status);
        throw error;
      }
      this.failedAudio.delete(p.signature);
      // Real audio came back: an earlier error notice and this voice's error record no longer apply.
      void clearTtsVoiceError(p.fishId).catch(error => this.report(error));
      if (this.notice) { this.notice = ''; this.emit(); }
      // Publish bytes immediately; persistent storage must not hold a Fish slot
      // or delay playback. The cache exposes pending writes for deduplication.
      void this.cache.put(p.signature, bytes, generation).catch(error => this.report(error));
      return bytes;
    }, priority); }
    catch (error) {
      if (!canRecover || !(error instanceof TtsHttpError) || error.status !== 400 || !p.character || p.character.fixed || !valid()) throw error;
      // Bytes can be shared across characters, but their replacement choices
      // and cancellation intents cannot. Release the original queue slot first.
      this.stage = '대체 음성 선택'; this.emit();
      const fishId = await this.recovery.select(p.character, p.fishId, p.settings, valid);
      if (!fishId || !valid()) throw error;
      const signature = synthesisSignature(p.text, p.tone, fishId, p.settings);
      return this.audio({ ...p, fishId, signature }, priority, valid, false);
    }
  }
  async prefetch(requests: TtsRequest[]): Promise<void> {
    await this.init();
    const s = ttsData().settings;
    if (!s.enabled || !s.fish.key.trim()) return;
    if (!s.prefetch || !requests.length) { this.viewport++; this.queue.retainBackground(new Set()); return; }
    this.setContext(requests[0].context);
    const ticket = ++this.viewport;
    this.queue.retainBackground(new Set());
    const valid = () => ticket === this.viewport && ttsData().settings.enabled;
    try {
      const selected = requests.filter(r => this.eligible(r) && !isSoundSegment(r.segment)).slice(0, s.prefetch);
      const ready: TtsRequest[] = [], unassigned: TtsRequest[] = [];
      for (const request of selected) {
        const character = ttsSegmentOwner(request.segment, ttsData().characters, request.context.rosterScope);
        const voiceKey = ttsSegmentRole(request.segment) === 'narrator' ? character?.voiceKey || s.narrationVoice : character?.voiceKey;
        const assigned = request.fishId || character?.fishId || ttsData().voices.find(v => v.key === voiceKey)?.fishId;
        (assigned ? ready : unassigned).push(request);
      }
      // Preparing unknown speakers can take a model round trip; known voices
      // are independent and should start warming the cache during that call.
      await Promise.all([ready, unassigned].filter(group => group.length).map(async group => {
        const prepared = await this.prepare(group, valid);
        if (!valid()) return;
        prepared.forEach(p => { if (this.cache.has(p.signature)) return; void this.audio(p, selected.indexOf(p.request) + 1, valid).catch(error => { if (valid()) this.report(error); }); });
      }));
    } catch (error) { if (valid()) this.report(error); }
  }
}
export function ttsTargetLanguage(segment: Pick<TtsSegment, 'kind'>, settings: Pick<TtsSettings, 'translation'>): string {
  void segment;
  return settings.translation.language;
}
export const omniTts = new OmniTtsRuntime();
