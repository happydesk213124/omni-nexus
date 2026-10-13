import type { TtsSegment, TtsSettings } from '../core/tts-types';
import { TtsQueue } from '../domain/tts/queue';
import { synthesisSignature } from '../domain/tts/segment';
import { allowedTtsText, ttsExcludeTerms, ttsSpokenText } from '../domain/tts/filter';
import { resolveTtsSpeaker } from '../domain/tts/identity';
import { TtsAudioCache } from '../storage/tts-cache';
import { TtsTranslationCache } from '../storage/tts-translations';
import { loadTtsData, ttsData, subscribeTts, updateTtsSettings } from '../storage/tts-store';
import { ensureTtsModule } from '../storage/tts-module';
import { synthesizeFish } from '../providers/tts/fish';
import { TtsPlayer } from '../providers/tts/player';
import { translateTts } from '../providers/tts/translation';
import { ensureTtsSpeakers } from './tts-characters';
import type { TtsChatContext } from './tts-context';

export interface TtsRequest { segment: TtsSegment; context: TtsChatContext; messageId: string; sourceKey?: string; fishId?: string; gain?: number }
interface Prepared { request: TtsRequest; text: string; signature: string; fishId: string; gain: number; settings: TtsSettings }
export class OmniTtsRuntime {
  readonly player = new TtsPlayer();
  readonly cache = new TtsAudioCache();
  readonly queue = new TtsQueue<ArrayBuffer>();
  private translations = new TtsTranslationCache();
  private translating = new Map<string, Promise<string>>();
  private failedAudio = new Map<string, number>();
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
  notice = '';
  stage = '';
  get current(): TtsRequest | undefined { return this.sequence[this.sequenceIndex]; }
  get list(): readonly TtsRequest[] { return this.messageSequence.filter(request => this.eligible(request)); }
  subscribe(callback: () => void): () => void { this.listeners.add(callback); return () => this.listeners.delete(callback); }
  private emit(): void { for (const callback of this.listeners) callback(); }
  report(error: unknown): void { this.notice = String((error as Error)?.message || error); this.emit(); }
  async init(): Promise<void> {
    return this.started ||= (async () => {
      await loadTtsData();
      if (!this.subscribed) {
        subscribeTts(() => { void this.synchronize().catch(error => this.report(error)); });
        this.subscribed = true;
      }
      this.queue.onChange = () => this.emit();
      this.player.onChange = (_state, error) => { if (error) this.notice = error; this.emit(); };
      this.player.onEnded = () => { if (ttsData().settings.continuous && !this.standalone) void this.next(1); };
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
    const generation = JSON.stringify([s.enabled, s.fish, s.translation, s.normalize, s.excludeText, s.skipChars, s.stripBrackets]);
    if (generation !== this.settingsSignature) {
      this.failedAudio.clear();
      this.settingsSignature = generation; this.viewport++; this.queue.cancelPending(); this.stop();
    }
    if (!s.enabled) { this.stop(); this.queue.cancelPending(); }
    if (this.current && !this.eligible(this.current) && ['playing', 'loading', 'paused'].includes(this.player.status)) this.stop();
    this.emit();
    if (!s.enabled && !this.moduleSignature) return;
    const moduleKey = JSON.stringify([s.enabled, s.hideName, s.hideTone, s.illustration, s.passageLine, s.excludeText, s.skipChars]);
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
    const s = ttsData().settings;
    return (request.segment.kind !== 'narration' || s.narration) && allowedTtsText(request.segment.text, ttsExcludeTerms(s.excludeText), s.skipChars);
  }
  async play(requests: TtsRequest[], index: number, reservation?: number): Promise<void> {
    await this.init();
    if (reservation !== undefined && reservation !== this.intent) return;
    if (!ttsData().settings.enabled) return;
    const request = requests[index];
    if (!request || !this.eligible(request)) return;
    this.setContext(request.context);
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
      this.player.configure(ttsData().settings.rate, ttsData().settings.volume, prepared[0].gain);
      return this.audio(prepared[0], 0, valid);
    });
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
    if (!request || !this.eligible(request)) { this.report(new Error('다시 만들 대사가 없습니다. 목록에서 줄을 먼저 골라 주세요.')); return; }
    this.stop();
    const ticket = this.intent;
    const prepared = await this.prepare([request], () => ticket === this.intent && ttsData().settings.enabled);
    if (ticket !== this.intent || !prepared[0]) return;
    this.failedAudio.delete(prepared[0].signature);
    await this.cache.remove(prepared[0].signature);
    if (ticket !== this.intent) return;
    await this.play(requests, index, ticket);
  }
  async next(delta: number): Promise<void> {
    let index = this.sequenceIndex + delta;
    while (index >= 0 && index < this.sequence.length && !this.eligible(this.sequence[index])) index += delta;
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
      const character = request.segment.speaker ? resolveTtsSpeaker(request.segment.speaker, ttsData().characters, context.rosterScope) : null;
      // An illustration line without a named speaker falls back to the narrator.
      const voiceKey = request.segment.kind === 'narration' || (request.segment.kind === 'illustration' && !request.segment.speaker) ? settings.narrationVoice : character?.voiceKey;
      const voice = ttsData().voices.find(v => v.key === voiceKey);
      const fishId = request.fishId || character?.fishId || voice?.fishId || '';
      return fishId ? [{ request, text: ttsSpokenText(request.segment.text, settings.stripBrackets), signature: '', fishId, gain: request.gain ?? character?.gain ?? 0, settings }] : [];
    });
    if (!prepared.length) throw new Error('캐릭터 또는 나레이션 음성을 먼저 지정해 주세요.');
    const missing: Prepared[] = [];
    const target = (p: Prepared) => ttsTargetLanguage(p.request.segment, settings);
    const cacheKey = (p: Prepared) => JSON.stringify([settings.translation.provider, target(p), settings.translation.url, settings.translation.llm.source, settings.translation.llm.endpoint, settings.translation.llm.model, p.request.segment.speaker, p.request.segment.tone, p.text]);
    for (const p of prepared) {
      if (p.request.segment.kind === 'audition' || settings.translation.provider === 'off' || target(p) === 'original') continue;
      const text = this.translations.get(cacheKey(p));
      if (text !== undefined) p.text = text; else missing.push(p);
    }
    if (missing.length) {
      this.stage = '번역'; this.emit();
      const fresh = [...new Map(missing.filter(p=>!this.translating.has(cacheKey(p))).map(p=>[cacheKey(p),p])).values()];
      // Narration may have its own target language, so batch per language.
      for (const language of new Set(fresh.map(target))) {
        const group = fresh.filter(p => target(p) === language);
        const batch = translateTts(group.map(p=>p.request.segment),{ ...settings, translation: { ...settings.translation, language } });
        group.forEach((p,i)=>{const key=cacheKey(p), row=batch.then(values=>values[i]);this.translating.set(key,row);void row.finally(()=>{if(this.translating.get(key)===row)this.translating.delete(key);}).catch(()=>{});});
      }
      const translated=await Promise.all(missing.map(p=>this.translating.get(cacheKey(p))!));
      if (!valid()) return [];
      missing.forEach((p,i)=>{this.translations.put(cacheKey(p),translated[i]);p.text=translated[i];});
      void this.translations.flush().catch(error => this.report(error));
    }
    for (const p of prepared) p.signature = synthesisSignature(p.text, p.request.segment.tone, p.fishId, settings);
    return prepared;
  }
  private async audio(p: Prepared, priority: number, valid: () => boolean): Promise<ArrayBuffer> {
    const cached = await this.cache.get(p.signature);
    if (cached) return cached;
    if (!valid()) throw new Error('TTS 요청이 변경되었습니다.');
    if (priority > 0 && (this.failedAudio.get(p.signature) || 0) > Date.now() - 30_000) throw new Error('음성 생성 재시도 대기 중입니다.');
    const generation = this.cache.generation;
    return this.queue.request(p.signature, async () => {
      const again = await this.cache.get(p.signature); if (again) return again;
      if (!ttsData().settings.enabled) throw new Error('TTS가 꺼져 있습니다.');
      this.stage = '음성 생성'; this.emit();
      let bytes: ArrayBuffer;
      try { bytes = await synthesizeFish(p.text, p.request.segment.tone, p.fishId, p.settings); }
      catch(error) { this.failedAudio.set(p.signature,Date.now()); if(this.failedAudio.size>100)this.failedAudio.delete(this.failedAudio.keys().next().value!); throw error; }
      this.failedAudio.delete(p.signature);
      // Publish bytes immediately; persistent storage must not hold a Fish slot
      // or delay playback. The cache exposes pending writes for deduplication.
      void this.cache.put(p.signature, bytes, generation).catch(error => this.report(error));
      return bytes;
    }, priority);
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
      const selected = requests.filter(r => this.eligible(r)).slice(0, s.prefetch);
      const ready: TtsRequest[] = [], unassigned: TtsRequest[] = [];
      for (const request of selected) {
        const character = resolveTtsSpeaker(request.segment.speaker, ttsData().characters, request.context.rosterScope);
        const voiceKey = request.segment.kind === 'narration' ? s.narrationVoice : character?.voiceKey;
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
  const narration = settings.translation.narrationLanguage.trim();
  return segment.kind === 'narration' && narration ? narration : settings.translation.language;
}
export const omniTts = new OmniTtsRuntime();
