import type { TtsSegment, TtsSettings } from '../../core/tts-types';

export function cueLineKey(line: string): string {
  let a = 0, b = 0;
  for (const byte of new TextEncoder().encode(line.trim())) { a = (a * 131 + byte) % 2147483647; b = (b * 137 + byte) % 2147483629; }
  return `${a}-${b}`;
}

export function compactHash(value: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b, 33) ^ c; }
  return (a >>> 0).toString(16) + '-' + (b >>> 0).toString(16);
}
export function synthesisSignature(text: string, tone: string, fishId: string, settings: TtsSettings): string {
  // Message id, character spelling, local volume and playback speed don't affect bytes.
  return JSON.stringify([1, settings.fish.url, settings.fish.model, fishId, tone.trim().toLowerCase(), text, settings.normalize, 'mp3']);
}
export function fishText(text: string, tone: string): string {
  const cues = tone.toLowerCase().split(',').map(v => v.trim()).filter(v => /^[a-z][a-z -]{0,39}$/.test(v)).slice(0, 2);
  return cues.map(cue => `[${cue}]`).join('') + text;
}
export function parseCueLine(line: string, id: string): TtsSegment | null {
  const value = line.trim();
  if (!value || value.length > 8000 || /[<>]/.test(value) || value.includes('{{') || value.includes('[[@') || /^[|#!`~]/.test(value)) return null;
  const start = value.indexOf('('), end = value.indexOf(')', start + 1);
  if (start > 0 && start <= 80 && end > start && end - start <= 100) {
    const speaker = value.slice(0, start).trim(), tone = value.slice(start + 1, end).trim();
    let body = value.slice(end + 1).trim();
    if (body.startsWith(':')) body = body.slice(1).trim();
    if (body.length > 2 && /^[a-z ,\-]+$/i.test(tone) && ((body.startsWith('"') && body.endsWith('"')) || (body.startsWith('“') && body.endsWith('”')))) {
      return { id, speaker, tone, text: body.slice(1, -1), kind: 'dialogue', start: 0, end: line.length };
    }
  }
  if (/[()"“]/.test(value)) return null;
  return { id, speaker: '', tone: '', text: value, kind: 'narration', start: 0, end: line.length };
}
export function parseTtsMessage(text: string): TtsSegment[] {
  const lines = text.split('\n');
  const response = /^#[*\t ]*(?:Response|응답|応答|响应|OOC)[*\t ]*$/;
  const beginning = lines.findIndex(line => response.test(line.trim()));
  let fenced = false, html = false, hidden = '', post = false, offset = 0;
  const result: TtsSegment[] = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const tag = /^<(thoughts|think|analysis|reasoning)(?:\s|>)/i.exec(trimmed);
    if (tag) hidden = tag[1]!.toLowerCase();
    if (/^#[*\t ]*(Post-response|사후응답|事後応答)/.test(trimmed)) post = true;
    if (hidden || post || index <= beginning) {
      if (hidden && trimmed.toLowerCase().includes(`</${hidden}>`)) hidden = '';
      offset += line.length + 1; return;
    }
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) fenced = !fenced;
    else if (!fenced) {
      if (trimmed.startsWith('<')) html = true;
      if (!trimmed) html = false;
      const segment = !html ? parseCueLine(line, String(index + 1)) : null;
      if (segment) result.push({ ...segment, start: offset, end: offset + line.length });
    }
    offset += line.length + 1;
  });
  return result;
}
