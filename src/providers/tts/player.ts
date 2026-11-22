export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'blocked' | 'error';
/** Fish answers in mp3; an Irodori server without FFmpeg answers in wav. A wav labelled mpeg does not play everywhere. */
export function audioMime(bytes: ArrayBuffer): string {
  try {
    const head = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength)), tag = (at: number) => String.fromCharCode(...head.subarray(at, at + 4));
    return tag(0) === 'RIFF' && tag(8) === 'WAVE' ? 'audio/wav' : 'audio/mpeg';
  } catch { return 'audio/mpeg'; }
}
export type EchoLevel = 'off' | 'light' | 'medium' | 'strong';
/** 생각 에코: how much of the voice goes into the echo, and how much of each repeat comes back. */
const ECHO: Record<EchoLevel, { send: number; feedback: number }> = { off: { send: 0, feedback: 0 }, light: { send: .22, feedback: .25 }, medium: { send: .36, feedback: .38 }, strong: { send: .52, feedback: .5 } };
const ECHO_SECONDS = .17;
export class TtsPlayer {
  private audio?: HTMLAudioElement;
  private context?: AudioContext;
  private gain?: GainNode;
  private echoSend?: GainNode;
  private echoFeedback?: GainNode;
  private echoLevel: EchoLevel = 'off';
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
      // 생각 에코: a send beside the dry path (voice → send → delay ⟲ feedback → out). Only the send is switched, so the
      // tail of a thought rings out under the next line instead of being cut. Absent where the engine has no delay node.
      if (typeof this.context.createDelay === 'function') {
        const delay = this.context.createDelay(1);
        delay.delayTime.value = ECHO_SECONDS;
        this.echoSend = this.context.createGain(); this.echoFeedback = this.context.createGain();
        this.gain.connect(this.echoSend); this.echoSend.connect(delay); delay.connect(this.echoFeedback); this.echoFeedback.connect(delay); delay.connect(this.context.destination);
        this.echo(this.echoLevel);
      }
      this.configure(this.rate, this.volume, this.decibels);
    }
    return this.audio;
  }
  /**
   * `quiet`: a click anywhere in the plugin's own window (its TTS tab, a switch) tries this by itself, so the popup
   * asking for it is rarely needed: refused, nothing is said (the popup still comes when a line wants to play).
   */
  unlock(quiet = false): Promise<void> {
    if (this.ready) return Promise.resolve();
    return this.unlocking ||= this.activate(quiet).finally(() => { this.unlocking = undefined; });
  }
  /** An unlock under way (begun by a click a moment ago): what a prompt waits on before it asks. */
  get pending(): Promise<void> | undefined { return this.unlocking; }
  /**
   * Once unlocked, WebKit (every iPhone browser) still stops the context when the page or the plugin's window is
   * hidden, the phone locked, or another app's sound cuts in ('suspended', or its own 'interrupted'). It can be
   * resumed with no new tap then: tried before anyone is asked to tap again. True when it runs.
   */
  async wake(): Promise<boolean> {
    if (this.ready) return true;
    if (!this.unlocked || !this.context) return false;
    try { await Promise.race([this.context.resume(), new Promise(done => setTimeout(done, 600))]); } catch { /* still stopped */ }
    return this.ready;
  }
  private async activate(quiet = false): Promise<void> {
    const audio = this.ensure();
    // Both calls happen synchronously inside the iframe's own click handler.
    // No permission or activation flag is assumed before they resolve.
    const resumed = this.context!.resume();
    // A tenth of a second of silence (800 samples at 8 kHz): WebKit refused a clip of one sample as no media at all,
    // and the unlock failed every time on an iPhone.
    const samples = 800, empty = new Uint8Array(44 + samples * 2);
    const view = new DataView(empty.buffer);
    const ascii = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    ascii(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); ascii(8, 'WAVEfmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, samples * 2, true);
    if (quiet) this.halt(); else this.stop();
    const ticket = this.epoch;
    this.url = URL.createObjectURL(new Blob([empty], { type: 'audio/wav' }));
    audio.src = this.url;
    const played = audio.play();
    try {
      await Promise.all([resumed, played]);
      if (ticket !== this.epoch) return;
      this.unlocked = this.context!.state === 'running';
      if (!this.unlocked) throw new Error('음성 재생 활성화 버튼을 다시 눌러 주세요.');
      if (quiet) this.halt(); else this.stop();
    } catch (error) {
      if (ticket !== this.epoch) return;
      this.unlocked = false; this.halt(); if (!quiet) this.emit('blocked'); throw error;
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
  /** 생각 에코 for what plays next (and what is playing): 'off' lets a tail already ringing die away by itself. */
  echo(level: EchoLevel): void {
    this.echoLevel = level;
    if (this.echoSend) this.echoSend.gain.value = ECHO[level].send;
    if (this.echoFeedback && level !== 'off') this.echoFeedback.gain.value = ECHO[level].feedback;
  }
  stop(): void { this.halt(); this.emit('idle'); }
  /**
   * stop() with nothing told: a quiet unlock (a tap anywhere in the window) runs inside that tap, before the tapped
   * switch's own change; a state told then redraws the settings from what is saved, and the switch springs back.
   */
  private halt(): void {
    this.epoch++;
    if (this.audio) { this.audio.onended = null; this.audio.onerror = null; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = ''; this.current = '';
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
      const { bytes, mime } = typeof typed.mime === 'string' && typed.bytes ? { bytes: typed.bytes, mime: typed.mime } : { bytes: loaded as ArrayBuffer, mime: audioMime(loaded as ArrayBuffer) };
      const audio = this.ensure();
      this.configure(this.rate, this.volume, gain ?? this.decibels);
      this.url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      audio.src = this.url;
      this.configure(this.rate, this.volume, gain ?? this.decibels);
      audio.onended = () => { if (ticket === this.epoch) { this.stop(); this.onEnded(key); } };
      audio.onerror = () => { if (ticket === this.epoch) { this.stop(); this.emit('error', '음성 파일을 재생하지 못했습니다.'); } };
      // A context WebKit stopped (the window was hidden a moment) plays silence: woken first, never waited on.
      if (this.context && this.context.state !== 'running') void this.context.resume().catch(() => undefined);
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
