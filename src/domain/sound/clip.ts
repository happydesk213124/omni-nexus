/**
 * Effects come from anywhere (a library, ElevenLabs, a long ambience loop), so
 * their loudness and their silent margins differ wildly. Each one is cut and
 * levelled once, here, into a short clip; the players only play it.
 */
export interface SfxClipOptions {
  /** Longest clip in seconds; 0 keeps the whole sound. Cut clips fade out. */
  maxSeconds: number;
  /** Skip the silence before the sound starts and after it ends. */
  trim: boolean;
  /** Level every effect to the same loudness (RMS), never past a safe peak. */
  normalize: boolean;
}
export interface SfxWindow { start: number; end: number; cut: boolean; gain: number }

const SILENCE = 10 ** (-50 / 20);
const TARGET_RMS = 10 ** (-20 / 20);
const MAX_GAIN = 10 ** (18 / 20), MIN_GAIN = 10 ** (-18 / 20), PEAK = .98;

/** Which samples play, and how loud. */
export function sfxWindow(channels: readonly Float32Array[], sampleRate: number, options: SfxClipOptions): SfxWindow {
  const length = Math.min(...channels.map(channel => channel.length));
  if (!channels.length || !Number.isFinite(length) || length <= 0) return { start: 0, end: 0, cut: false, gain: 1 };
  const loud = (i: number) => channels.some(channel => Math.abs(channel[i]!) > SILENCE);
  let start = 0, end = length;
  if (options.trim) {
    while (start < length && !loud(start)) start++;
    while (end > start && !loud(end - 1)) end--;
    // A silent file plays as it is; otherwise keep a breath around the sound.
    if (start >= end) { start = 0; end = length; }
    else { start = Math.max(0, start - Math.round(sampleRate * .01)); end = Math.min(length, end + Math.round(sampleRate * .05)); }
  }
  const limit = options.maxSeconds > 0 ? Math.round(options.maxSeconds * sampleRate) : Infinity;
  const cut = end - start > limit;
  if (cut) end = start + limit;
  return { start, end, cut, gain: options.normalize ? levelGain(channels, sampleRate, start, end) : 1 };
}

/** Gated RMS over 50 ms blocks: quiet tails and gaps do not make a short hit sound loud. */
function levelGain(channels: readonly Float32Array[], sampleRate: number, start: number, end: number): number {
  const block = Math.max(1, Math.round(sampleRate * .05));
  let peak = 0, energy = 0, blocks = 0;
  for (let from = start; from < end; from += block) {
    const to = Math.min(end, from + block);
    let sum = 0;
    for (const channel of channels) for (let i = from; i < to; i++) { const v = channel[i]!; sum += v * v; const a = Math.abs(v); if (a > peak) peak = a; }
    const mean = sum / ((to - from) * channels.length);
    if (mean > SILENCE * SILENCE) { energy += mean; blocks++; }
  }
  if (!blocks || !peak) return 1;
  const gain = Math.max(MIN_GAIN, Math.min(MAX_GAIN, TARGET_RMS / Math.sqrt(energy / blocks)));
  return Math.min(gain, PEAK / peak);
}

/** 16-bit PCM WAV of the window, levelled, with short fades so a cut never clicks. */
export function encodeSfxWav(channels: readonly Float32Array[], sampleRate: number, window: SfxWindow): ArrayBuffer {
  const count = Math.max(1, Math.min(2, channels.length)), frames = Math.max(0, window.end - window.start);
  const buffer = new ArrayBuffer(44 + frames * count * 2), view = new DataView(buffer);
  const ascii = (at: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + frames * count * 2, true); ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, frames * count * 2, true);
  const fadeIn = Math.min(frames, Math.round(sampleRate * .005)), fadeOut = Math.min(frames, Math.round(sampleRate * (window.cut ? .3 : .02)));
  for (let f = 0; f < frames; f++) {
    const fade = Math.min(1, fadeIn ? f / fadeIn : 1, fadeOut ? (frames - f) / fadeOut : 1);
    for (let c = 0; c < count; c++) {
      const v = Math.max(-1, Math.min(1, (channels[c] ?? channels[0]!)[window.start + f]! * window.gain * fade));
      view.setInt16(44 + (f * count + c) * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
  }
  return buffer;
}
