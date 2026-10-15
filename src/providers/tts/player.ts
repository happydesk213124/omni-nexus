export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'blocked' | 'error';
export class TtsPlayer {
  private audio?: HTMLAudioElement;
  private context?: AudioContext;
  private gain?: GainNode;
  private url = '';
  private epoch = 0;
  private current = '';
  private state: PlaybackState = 'idle';
  private unlocked = false;
  private unlocking?: Promise<void>;
  private rate = 1;
  private volume = .8;
  private decibels = 0;
  onChange: (state: PlaybackState, error?: string) => void = () => {};
  onEnded: (key: string) => void = () => {};
  get status(): PlaybackState { return this.state; }
  get ready(): boolean { return this.unlocked && this.context?.state === 'running'; }
  get key(): string { return this.current; }
  get progress(): { current: number; duration: number } { return { current: this.audio?.currentTime || 0, duration: this.audio?.duration || 0 }; }
  private emit(state: PlaybackState, error?: string): void { this.state = state; this.onChange(state, error); }
  private ensure(): HTMLAudioElement {
    if (!this.audio) {
      if (typeof Audio !== 'function' || typeof AudioContext !== 'function') throw new Error('이 Risu 환경에서는 음성 재생 API를 사용할 수 없습니다.');
      this.audio = new Audio();
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.context.createMediaElementSource(this.audio).connect(this.gain).connect(this.context.destination);
      this.configure(this.rate, this.volume, this.decibels);
    }
    return this.audio;
  }
  unlock(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return this.unlocking ||= this.activate().finally(() => { this.unlocking = undefined; });
  }
  private async activate(): Promise<void> {
    const audio = this.ensure();
    // Both calls happen synchronously inside the iframe's own click handler.
    // No permission or activation flag is assumed before they resolve.
    const resumed = this.context!.resume();
    const empty = new Uint8Array(46);
    const view = new DataView(empty.buffer);
    const ascii = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    ascii(0, 'RIFF'); view.setUint32(4, 38, true); ascii(8, 'WAVEfmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, 2, true);
    this.stop();
    const ticket = this.epoch;
    this.url = URL.createObjectURL(new Blob([empty], { type: 'audio/wav' }));
    audio.src = this.url;
    const played = audio.play();
    try {
      await Promise.all([resumed, played]);
      if (ticket !== this.epoch) return;
      this.unlocked = this.context!.state === 'running';
      if (!this.unlocked) throw new Error('음성 재생 활성화 버튼을 다시 눌러 주세요.');
      this.stop();
    } catch (error) {
      if (ticket !== this.epoch) return;
      this.unlocked = false; this.stop(); this.emit('blocked'); throw error;
    }
  }
  configure(rate: number, volume: number, gain = this.decibels): void {
    this.rate = Math.max(.25, Math.min(4, rate));
    this.volume = Math.max(0, Math.min(1, volume));
    this.decibels = Math.max(-24, Math.min(12, gain));
    // Assigning src resets playbackRate to defaultPlaybackRate, so set both.
    if (this.audio) { this.audio.defaultPlaybackRate = this.rate; this.audio.playbackRate = this.rate; this.audio.preservesPitch = true; }
    if (this.gain) this.gain.gain.value = this.volume * 10 ** (this.decibels / 20);
  }
  stop(): void {
    this.epoch++;
    if (this.audio) { this.audio.onended = null; this.audio.onerror = null; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = ''; this.current = ''; this.emit('idle');
  }
  pause(): void {
    if (this.state === 'loading') { this.stop(); return; }
    if (this.state !== 'playing') return;
    this.audio?.pause(); this.emit('paused');
  }
  async resume(): Promise<void> {
    if (this.state !== 'paused' || !this.audio) return;
    const ticket = this.epoch;
    try { await this.audio.play(); if (ticket === this.epoch) this.emit('playing'); }
    catch { if (ticket === this.epoch) this.emit('blocked', '설정에서 음성 재생을 활성화해 주세요.'); }
  }
  seek(seconds: number): void { if (this.audio && Number.isFinite(this.audio.duration)) this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, seconds)); }
  /** `load` may name its type: sound effects play here too (one voice at a time, the same ■ and bar). */
  async play(key: string, load: () => Promise<ArrayBuffer | { bytes: ArrayBuffer; mime: string }>, gain?: number): Promise<void> {
    if (this.current === key && (this.state === 'playing' || this.state === 'loading')) return;
    this.stop();
    const ticket = this.epoch;
    this.current = key; this.emit('loading');
    try {
      const loaded = await load();
      if (ticket !== this.epoch) return;
      // Not instanceof: bytes from the host bridge are another realm's ArrayBuffer.
      const typed = loaded as { bytes?: ArrayBuffer; mime?: unknown };
      const { bytes, mime } = typeof typed.mime === 'string' && typed.bytes ? { bytes: typed.bytes, mime: typed.mime } : { bytes: loaded as ArrayBuffer, mime: 'audio/mpeg' };
      const audio = this.ensure();
      this.configure(this.rate, this.volume, gain ?? this.decibels);
      this.url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      audio.src = this.url;
      this.configure(this.rate, this.volume, gain ?? this.decibels);
      audio.onended = () => { if (ticket === this.epoch) { this.stop(); this.onEnded(key); } };
      audio.onerror = () => { if (ticket === this.epoch) { this.stop(); this.emit('error', '음성 파일을 재생하지 못했습니다.'); } };
      await audio.play();
      // Some engines settle the rate only once media is playing.
      if (audio.playbackRate !== this.rate) audio.playbackRate = this.rate;
      if (ticket === this.epoch) this.emit('playing');
    } catch (error) {
      if (ticket !== this.epoch) return;
      this.stop();
      const blocked = error instanceof Error && error.name === 'NotAllowedError';
      this.emit(blocked ? 'blocked' : 'error', blocked ? '설정에서 음성 재생을 활성화해 주세요.' : String((error as Error)?.message || error));
    }
  }
}
