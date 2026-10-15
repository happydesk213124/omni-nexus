import type { SfxWindow } from './clip';

/**
 * A compound effect word (`콰아앙 치이익 또르르`) is several sounds in a row. Each
 * part is matched and learned on its own, then the parts play as one clip.
 */
export const SFX_MAX_PARTS = 4;

/** The sounds in a word, split at spaces and marks; one part when there is nothing to split. */
export function sfxParts(word: string): string[] {
  const parts = String(word || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return parts.length > 1 ? parts.slice(0, SFX_MAX_PARTS) : [String(word || '').trim()].filter(Boolean);
}

/**
 * How long each part plays: a sound written longer is longer (쾅·콰앙 1 s,
 * 콰아앙·끼이이익 2 s, 콰아아아앙 3 s). Together they fit the longest effect,
 * shrunk evenly when they would not.
 */
export function sfxPartSeconds(parts: readonly string[], maxSeconds: number): number[] {
  const seconds = parts.map(part => { const letters = [...part.replace(/[^\p{L}\p{N}]/gu, '')].length; return letters <= 2 ? 1 : letters <= 4 ? 2 : 3; });
  const total = seconds.reduce((sum, n) => sum + n, 0);
  return maxSeconds > 0 && total > maxSeconds ? seconds.map(n => n * maxSeconds / total) : seconds;
}

/** The parts' windows one after another, each levelled, with a short crossfade between them. */
export function joinSfxClips(clips: ReadonlyArray<{ channels: readonly Float32Array[]; window: SfxWindow }>, sampleRate: number, overlapSeconds = .04): Float32Array[] {
  const count = Math.max(1, Math.min(2, ...clips.map(clip => clip.channels.length)));
  const overlap = Math.round(sampleRate * overlapSeconds);
  const lengths = clips.map(clip => Math.max(0, clip.window.end - clip.window.start));
  const total = Math.max(0, lengths.reduce((sum, n) => sum + n, 0) - overlap * Math.max(0, clips.length - 1));
  const out = Array.from({ length: count }, () => new Float32Array(total));
  let at = 0;
  clips.forEach((clip, k) => {
    const frames = lengths[k]!, fadeIn = Math.min(frames, k ? overlap : Math.round(sampleRate * .005));
    // A part cut at its share fades out over a breath; a whole one only meets the next.
    const fadeOut = Math.min(frames, Math.max(k < clips.length - 1 ? overlap : 0, Math.round(sampleRate * (clip.window.cut ? .15 : .02))));
    for (let c = 0; c < count; c++) {
      const target = out[c]!, source = clip.channels[c] ?? clip.channels[0]!;
      for (let f = 0; f < frames && at + f < total; f++) {
        const fade = Math.min(1, fadeIn ? f / fadeIn : 1, fadeOut ? (frames - f) / fadeOut : 1) * clip.window.gain;
        target[at + f] = target[at + f]! + source[clip.window.start + f]! * fade;
      }
    }
    at += frames - overlap;
  });
  return out;
}
