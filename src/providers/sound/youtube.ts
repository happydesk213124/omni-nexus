import { dbg } from '../../core/debug';
import { risuHost } from '../../core/host';

/**
 * YouTube BGM's player. Risu's chat sanitizer lets a YouTube embed through and no
 * other iframe, and a plugin can make no iframe of its own: so a hidden seed embed
 * is planted in a message the chat draws (see {@link plantYoutubeSeed}), cloned once
 * under <body> as the player (an iframe reloads when it moves, so it never moves
 * again: only its style changes), and driven from here with the embed's postMessage
 * protocol. Which window is ours: the YouTube windows that answer `listening` before
 * the clone are someone else's; the new one that answers after it is the player.
 */
const ORIGIN = 'https://www.youtube.com';
const ID = 'omni-bgm';
// YouTube's sample video from its embed docs: embeddable, and replaced by the first track.
const SEED_VIDEO = 'M7lc1UVf-VE';
// display:none and loading=lazy: the seed itself never loads; only its clone, placed in view, does.
export const YOUTUBE_SEED_HTML = `<div data-omni-yt-seed="1" style="display:none"><iframe data-omni-yt="1" src="${ORIGIN}/embed/${SEED_VIDEO}?enablejsapi=1&amp;playsinline=1&amp;rel=0" width="320" height="180" loading="lazy" allow="autoplay; encrypted-media" frameborder="0"></iframe></div>`;
const SEED = '[data-omni-yt-seed] iframe';
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

let wanted = false, plantedAt = 0;
/**
 * The display handler: while a seed is wanted, one message the chat draws gets it (one
 * every few seconds at most, so a redraw never fills the chat with them). Risu calls a
 * display handler on every draw, each a call across to the plugin: so it is registered
 * only while a seed is wanted (see {@link YoutubeTube}), never for the whole session.
 */
export function plantYoutubeSeed(content: string): string {
  if (!wanted || Date.now() - plantedAt < 4000) return content;
  plantedAt = Date.now();
  return `${content}\n\n${YOUTUBE_SEED_HTML}`;
}

/** YouTube's player states: -1 not started, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
export class YoutubeTube {
  private doc: SafeDocument | null = null;
  private el: SafeElement | null = null;
  private win: Window | null = null;
  private making: Promise<void> | null = null;
  private known = new Set<unknown>();
  private seeking = false;
  private state = -1;
  private time = 0;
  private length = 0;
  private video = '';
  private level = 0;
  private fading: ReturnType<typeof setInterval> | undefined;
  private error = 0;
  private hidden = false;
  private tapNeeded = false;
  /** The BGM item playing (or paused) here; '' when stopped. */
  key = '';
  onChange: () => void = () => {};

  get playing(): boolean { return !!this.key && (this.state === 1 || this.state === 3); }
  get paused(): boolean { return !!this.key && this.state === 2; }
  get progress(): { current: number; duration: number } { return { current: this.time, duration: this.length }; }

  private listen = (event: MessageEvent): void => {
    if (event.origin !== ORIGIN) return;
    let data: { event?: string; info?: unknown } | null = null;
    try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
    if (!data || typeof data !== 'object') return;
    const source = event.source;
    if (!this.win) {
      // Before the clone: someone else's player. After it: the new one is ours.
      if (!source) return;
      if (this.seeking && !this.known.has(source)) this.win = source as Window; else this.known.add(source);
      return;
    }
    if (source !== this.win) return;
    if (data.event === 'onError') { this.error = Number(data.info) || 1; return; }
    const info = data.event === 'onStateChange' ? { playerState: data.info } : data.event === 'infoDelivery' && data.info && typeof data.info === 'object' ? data.info as Record<string, unknown> : null;
    if (!info) return;
    if (Number.isFinite(Number(info.currentTime))) this.time = Number(info.currentTime);
    if (Number.isFinite(Number(info.duration)) && Number(info.duration) > 0) this.length = Number(info.duration);
    if (info.playerState !== undefined && Number.isFinite(Number(info.playerState))) {
      const state = Number(info.playerState), was = this.state;
      this.state = state;
      // BGM loops: a track that ends starts again.
      if (state === 0 && this.key) { this.send('seekTo', [0, true]); this.send('playVideo'); }
      if (state === 1 && this.tapNeeded) { this.tapNeeded = false; void this.place().catch(() => {}); void this.fadeTo(this.key ? this.pendingLevel : 0, 600); }
      if (state !== was) this.onChange();
    }
  };

  private frames(): Window[] {
    const out: Window[] = [];
    try { const all = window.parent.frames; for (let i = 0; i < all.length; i++) { try { out.push(all[i] as Window); } catch { /* gone */ } } } catch { /* none */ }
    return out;
  }
  private post(win: Window, message: Record<string, unknown>): void {
    try { win.postMessage(JSON.stringify({ ...message, id: ID, channel: 'widget' }), ORIGIN); } catch { /* not a YouTube window */ }
  }
  private broadcast(): void { for (const win of this.frames()) if (win !== window) this.post(win, { event: 'listening' }); }
  private send(func: string, args: unknown[] = []): void { if (this.win) this.post(this.win, { event: 'command', func, args }); }

  /** Where the player sits: small, low on the left; or out of sight (but laid out, so it loads). A blocked play shows it for a tap. */
  private style(): string {
    const box = 'position:fixed;left:10px;bottom:96px;width:200px;height:113px;border:0;border-radius:10px;background:#000;margin:0';
    return this.hidden && !this.tapNeeded ? `${box};opacity:0;pointer-events:none;z-index:-1` : `${box};z-index:30;box-shadow:0 6px 22px rgba(0,0,0,.45)${this.tapNeeded ? ';outline:3px solid #e3c27a' : ''}`;
  }
  private async place(): Promise<void> { await this.el?.setStyleAttribute(this.style()); }

  /** The player, made once: the seed found (or planted and waited for), cloned, and its window told apart. */
  ensure(): Promise<void> {
    if (this.win && this.el) return Promise.resolve();
    return this.making ||= this.make().finally(() => { this.making = null; });
  }
  private async make(): Promise<void> {
    window.removeEventListener('message', this.listen);
    window.addEventListener('message', this.listen);
    const doc = this.doc ||= await risuHost()?.getRootDocument?.() ?? null;
    if (!doc) throw new Error('Risu 화면에 접근할 수 없어 유튜브를 틀 수 없습니다.');
    // A player left by an earlier run of the plugin answers to nobody now.
    const stale = await doc.querySelectorAll('[x-omni-yt-tv]') as SafeClassArray<SafeElement> | SafeElement[];
    const n = Array.isArray(stale) ? stale.length : await stale.length();
    for (let i = 0; i < n; i++) { const node = Array.isArray(stale) ? stale[i] : await stale.at(i); if (node) await quiet(node.remove()); }
    const seed = await doc.querySelector(SEED) ?? await this.plant(doc);
    if (!seed) throw new Error('유튜브 플레이어를 놓을 자리를 아직 못 찾았습니다. 채팅이 한 번 그려지면 다시 시도해요.');
    this.win = null; this.known.clear(); this.seeking = false;
    this.broadcast(); await sleep(450); this.broadcast(); await sleep(250);
    const body = await doc.querySelector('body');
    if (!body) throw new Error('Risu 화면을 찾지 못했습니다.');
    const el = await seed.cloneNode(false);
    await el.setAttribute('x-omni-yt-tv', '1');
    this.el = el;
    await this.place();
    await body.appendChild(el);
    this.seeking = true;
    for (let i = 0; i < 50 && !this.win; i++) { this.broadcast(); await sleep(300); }
    this.seeking = false;
    if (!this.win) { await quiet(el.remove()); this.el = null; throw new Error('유튜브 플레이어가 응답하지 않습니다.'); }
    dbg('bgm.youtube.ready', {});
  }

  /** A seed in the next message the chat draws: the display handler is there for that wait only. */
  private async plant(doc: SafeDocument): Promise<SafeElement | null> {
    const host = risuHost(), plant = (content: string) => plantYoutubeSeed(content);
    if (typeof host?.addRisuScriptHandler !== 'function') return null;
    await host.addRisuScriptHandler('display', plant);
    wanted = true; plantedAt = 0;
    try {
      let seed: SafeElement | null = null;
      for (let i = 0; i < 24 && !seed; i++) { await sleep(500); seed = await doc.querySelector(SEED); }
      return seed;
    } finally {
      wanted = false;
      await quiet(host.removeRisuScriptHandler?.('display', plant));
    }
  }

  private volume(level: number): void { this.level = level; this.send('setVolume', [Math.round(Math.max(0, Math.min(1, level)) * 100)]); }
  /** A fade is a few volume steps (the embed has no ramp of its own). */
  private fadeTo(level: number, ms: number): Promise<void> {
    clearInterval(this.fading);
    const from = this.level, steps = Math.max(1, Math.round(ms / 80));
    if (ms <= 0 || Math.abs(level - from) < .01) { this.volume(level); return Promise.resolve(); }
    let i = 0;
    return new Promise(resolve => {
      this.fading = setInterval(() => {
        i++;
        this.volume(from + (level - from) * Math.min(1, i / steps));
        if (i >= steps) { clearInterval(this.fading); resolve(); }
      }, 80);
    });
  }
  private async until(test: () => boolean, ms: number): Promise<boolean> {
    for (let t = 0; t < ms; t += 100) { if (test()) return true; await sleep(100); }
    return test();
  }
  /**
   * Plays a video for a BGM item, faded in to `level`. Rejects when YouTube cannot play
   * it (removed, embedding off) or the browser holds it back (no tap yet): the player
   * then shows itself to be tapped once, and the caller may play a file instead.
   */
  async play(key: string, video: string, options: { level: number; fadeMs: number; hidden: boolean }): Promise<void> {
    await this.ensure();
    this.hidden = options.hidden;
    if (this.key === key && this.video === video && this.state === 1) { await this.fadeTo(options.level, 300); return; }
    this.key = key; this.video = video; this.error = 0; this.state = -1; this.time = 0; this.length = 0;
    this.volume(0);
    this.send('loadVideoById', [{ videoId: video, startSeconds: 0 }]);
    this.onChange();
    const started = await this.until(() => this.state === 1 || !!this.error, 6000);
    if (this.error) {
      const code = this.error;
      this.key = ''; this.send('pauseVideo'); this.onChange();
      throw new Error(code === 101 || code === 150 ? '이 유튜브 영상은 다른 사이트에서 재생할 수 없게 막혀 있습니다.' : code === 100 ? '유튜브 영상을 찾을 수 없습니다 (삭제·비공개).' : `유튜브 재생 오류 (${code})`);
    }
    if (!started) {
      // Held back until a tap (no tap has reached YouTube's window yet): the player shows
      // itself; the track stays loaded, and comes in at its level once it is tapped.
      this.tapNeeded = true; this.pendingLevel = options.level;
      await this.place(); this.onChange();
      throw Object.assign(new Error('브라우저가 유튜브 자동 재생을 막았습니다. 왼쪽 아래 유튜브 창을 한 번 눌러 주세요.'), { tap: true });
    }
    await this.place();
    await this.fadeTo(options.level, options.fadeMs);
  }
  /** A track waits for the tap that lets it play. */
  get waiting(): boolean { return this.tapNeeded && !!this.key; }
  private pendingLevel = 0;
  setLevel(level: number): void { if (this.key) void this.fadeTo(level, 250); }
  pause(): void { if (this.key) { this.send('pauseVideo'); this.state = 2; this.onChange(); } }
  async resume(): Promise<boolean> {
    if (!this.key || !this.win) return false;
    this.send('playVideo');
    return this.until(() => this.state === 1, 2500);
  }
  seek(seconds: number): void { if (this.key) this.send('seekTo', [Math.max(0, seconds), true]); }
  async stop(fadeMs = 600): Promise<void> {
    if (this.tapNeeded) { this.tapNeeded = false; await this.place(); }
    if (!this.key) return;
    const key = this.key;
    await this.fadeTo(0, fadeMs);
    if (this.key !== key) return;
    this.send('pauseVideo'); this.key = ''; this.state = 2; this.onChange();
  }
  /** The player shown, or kept out of sight, as the setting says. */
  async setHidden(hidden: boolean): Promise<void> { this.hidden = hidden; await this.place(); }
}
const quiet = (value: unknown): Promise<unknown> => Promise.resolve(value).catch(() => undefined);
