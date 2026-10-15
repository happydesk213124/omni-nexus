/**
 * Two channels in the plugin iframe: BGM (looping, crossfaded between two decks,
 * ducked while TTS speaks) and effects (one at a time; with TTS on, effects in the
 * chat play through the voice player instead, so they and the lines never overlap). The iframe's
 * audio activation is shared with TTS: once the user enabled playback there, these
 * elements may play too.
 */
interface Deck { audio: HTMLAudioElement; gain: GainNode; url: string; key: string }

export class SoundPlayer {
  private context?: AudioContext;
  private bgmBus?: GainNode;
  private sfxBus?: GainNode;
  private decks: Deck[] = [];
  private live = 0;
  private sfx: { audio: HTMLAudioElement; url: string }[] = [];
  private bgmVolume = .5;
  private sfxVolume = .8;
  private ducked = false;
  private duckLevel = .35;
  private muted = false;
  onChange: () => void = () => {};
  get bgmKey(): string { return this.decks[this.live]?.key || ''; }
  get bgmPlaying(): boolean { const deck = this.decks[this.live]; return !!deck?.key && !deck.audio.paused; }
  get isMuted(): boolean { return this.muted; }
  /** Paused, not stopped: the deck keeps its track and position. */
  get bgmPaused(): boolean { const deck = this.decks[this.live]; return !!deck?.key && deck.audio.paused; }
  get bgmProgress(): { current: number; duration: number } {
    const audio = this.decks[this.live]?.audio;
    return { current: audio?.currentTime || 0, duration: audio && Number.isFinite(audio.duration) ? audio.duration : 0 };
  }
  pauseBgm(): void { const deck = this.decks[this.live]; if (deck?.key && !deck.audio.paused) { deck.audio.pause(); this.onChange(); } }
  async resumeBgm(): Promise<boolean> {
    const deck = this.decks[this.live];
    if (!deck?.key || !deck.audio.paused) return !!deck?.key;
    await this.ensure().resume(); await deck.audio.play(); this.onChange();
    return true;
  }

  private ensure(): AudioContext {
    if (this.context) return this.context;
    if (typeof AudioContext !== 'function' || typeof Audio !== 'function') throw new Error('이 Risu 환경에서는 오디오 재생 API를 사용할 수 없습니다.');
    const context = this.context = new AudioContext();
    this.bgmBus = context.createGain(); this.sfxBus = context.createGain();
    this.bgmBus.connect(context.destination); this.sfxBus.connect(context.destination);
    for (let i = 0; i < 2; i++) {
      const audio = new Audio(); audio.loop = true;
      const gain = context.createGain(); gain.gain.value = 0;
      context.createMediaElementSource(audio).connect(gain).connect(this.bgmBus);
      this.decks.push({ audio, gain, url: '', key: '' });
    }
    this.apply();
    return context;
  }
  private apply(): void {
    if (!this.bgmBus || !this.sfxBus || !this.context) return;
    const now = this.context.currentTime;
    const bgm = this.muted ? 0 : this.bgmVolume * (this.ducked ? this.duckLevel : 1);
    this.bgmBus.gain.cancelScheduledValues(now); this.bgmBus.gain.setTargetAtTime(bgm, now, .12);
    this.sfxBus.gain.value = this.muted ? 0 : this.sfxVolume;
  }
  configure(options: { bgmVolume?: number; sfxVolume?: number; duck?: number; muted?: boolean }): void {
    if (options.bgmVolume != null) this.bgmVolume = Math.max(0, Math.min(1, options.bgmVolume));
    if (options.sfxVolume != null) this.sfxVolume = Math.max(0, Math.min(1, options.sfxVolume));
    if (options.duck != null) this.duckLevel = Math.max(0, Math.min(1, options.duck));
    if (options.muted != null) this.muted = options.muted;
    this.apply(); this.onChange();
  }
  /** Lowers BGM while another voice (TTS) plays. */
  duck(active: boolean): void { if (this.ducked !== active) { this.ducked = active; this.apply(); } }

  /** Starts `key` on the idle deck and crossfades to it. The same key keeps playing. */
  async playBgm(key: string, bytes: ArrayBuffer, mime: string, fadeMs = 1500): Promise<void> {
    const context = this.ensure();
    if (this.bgmKey === key && this.bgmPlaying) return;
    await context.resume();
    const next = this.decks[1 - this.live]!, previous = this.decks[this.live]!;
    if (next.url) URL.revokeObjectURL(next.url);
    next.url = URL.createObjectURL(new Blob([bytes], { type: mime || 'audio/mpeg' }));
    next.key = key; next.audio.src = next.url; next.audio.currentTime = 0;
    await next.audio.play();
    const now = context.currentTime, fade = Math.max(.05, fadeMs / 1000);
    next.gain.gain.cancelScheduledValues(now); next.gain.gain.setValueAtTime(0, now); next.gain.gain.linearRampToValueAtTime(1, now + fade);
    previous.gain.gain.cancelScheduledValues(now); previous.gain.gain.setValueAtTime(previous.gain.gain.value, now); previous.gain.gain.linearRampToValueAtTime(0, now + fade);
    this.live = 1 - this.live;
    const stale = previous.key;
    setTimeout(() => { if (previous.key === stale && this.decks[this.live] !== previous) { previous.audio.pause(); previous.key = ''; } }, fadeMs + 100);
    this.onChange();
  }
  stopBgm(fadeMs = 600): void {
    const deck = this.decks[this.live];
    if (!deck || !this.context) return;
    const now = this.context.currentTime;
    deck.gain.gain.cancelScheduledValues(now); deck.gain.gain.setValueAtTime(deck.gain.gain.value, now); deck.gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
    const key = deck.key;
    setTimeout(() => { if (deck.key === key) { deck.audio.pause(); deck.key = ''; this.onChange(); } }, fadeMs + 50);
  }
  /** Cuts the effect that is playing, if any. */
  stopSfx(): void {
    for (const row of this.sfx.splice(0)) { row.audio.pause(); URL.revokeObjectURL(row.url); }
  }
  /** One effect at a time: a new one cuts the last. `ended` settles when it stops for any reason. */
  async playSfx(bytes: ArrayBuffer, mime: string): Promise<{ ended: Promise<void> }> {
    const context = this.ensure();
    await context.resume();
    this.stopSfx();
    const audio = new Audio(), url = URL.createObjectURL(new Blob([bytes], { type: mime || 'audio/mpeg' }));
    context.createMediaElementSource(audio).connect(this.sfxBus!);
    const row = { audio, url }; this.sfx.push(row);
    let finish = () => {};
    const ended = new Promise<void>(resolve => { finish = resolve; });
    audio.addEventListener('ended', () => { this.sfx = this.sfx.filter(x => x !== row); URL.revokeObjectURL(url); finish(); }, { once: true });
    audio.addEventListener('error', () => finish(), { once: true });
    audio.addEventListener('pause', () => finish(), { once: true });
    audio.src = url;
    await audio.play();
    return { ended };
  }
  stopAll(): void {
    for (const deck of this.decks) { deck.audio.pause(); deck.key = ''; }
    for (const row of this.sfx.splice(0)) { row.audio.pause(); URL.revokeObjectURL(row.url); }
    this.onChange();
  }
}
