import { analysisBody } from '../prompt/message-body';

/**
 * A reply as the scene a BGM picker reads: the prose only (no image tokens,
 * streaming-tag blocks, reasoning or BGM markers). A long reply keeps its start
 * and the part nearest the end, where the scene is now.
 */
export function bgmSceneText(raw: unknown, max = 4000): string {
  const text = analysisBody(String(raw ?? '')).replace(/\[\[bgm:[^\]\n]*\]\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= max) return text;
  const head = Math.round(max * .35);
  return `${text.slice(0, head)}\n…\n${text.slice(text.length - (max - head))}`;
}
