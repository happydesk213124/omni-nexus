import type { TtsSegment, TtsSettings } from '../../core/tts-types';
import type { SfxRule } from '../../core/sound-types';
import { allowedTtsText } from './filter';
import { bgmMarkers } from '../sound/tags';
import { sfxHits, withoutSfx } from '../sound/audio';
import { INLINE_SHOT_MASK_SOURCE } from '../prompt/inline-shot-pattern';

/** Sound cues to list with the spoken lines: BGM markers and the effect rules in use. */
export interface TtsSoundCues { bgm: boolean; sfxRules: readonly SfxRule[] }
export const isSoundSegment = (segment: Pick<TtsSegment, 'kind'>): boolean => segment.kind === 'bgm' || segment.kind === 'sfx';

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
/** Fish delivery cues from a comma list: short English words only, each once. */
export function toneCues(tone: string): string[] {
  return [...new Set(String(tone || '').toLowerCase().split(',').map(v => v.trim()).filter(v => /^[a-z][a-z -]{0,39}$/.test(v)))];
}
/**
 * What a line is spoken with: its own delivery first (two cues at most, as
 * before), then the speaker's base delivery, four cues in all. With no base the
 * line's tone is returned as it was written, so cached audio keeps its key.
 */
export function speechTone(line: string, base: string): string {
  const own = toneCues(line).slice(0, 2), extra = toneCues(base).filter(cue => !own.includes(cue));
  return extra.length ? [...own, ...extra].slice(0, 4).join(', ') : line;
}
export function fishText(text: string, tone: string): string {
  return toneCues(tone).slice(0, 4).map(cue => `[${cue}]`).join('') + text;
}
export function cueHeader(value:string): {speaker:string;tone:string}|null {
  let prefix=value.trim().replace(/[:：]\s*$/,'').trim();
  let tone='';
  const opening=prefix.indexOf('('),closing=prefix.indexOf(')',opening+1);
  if(opening>=0){if(closing!==prefix.length-1)return null;tone=prefix.slice(opening+1,closing).trim();if(!/^[a-z ,\-]{1,100}$/i.test(tone))return null;prefix=prefix.slice(0,opening).trim();}
  const speaker=prefix.replace(/^[\s*\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D]+/u,'').replace(/\*+$/,'').trim();
  if(!speaker||speaker.length>80||!/[\p{L}\p{N}]/u.test(speaker)||/[<>:："“”(){}\[\]|#!`~]/.test(speaker))return null;
  return {speaker,tone};
}
export function quotedCue(value:string):string|null {
  const body=value.trim();
  if(body.length>8002)return null;
  for(const [open,close] of [['"','"'],['“','”'],["'","'"],['‘','’'],['「','」'],['『','』']])if(body.startsWith(open)&&body.endsWith(close)&&body.length>2)return body.slice(1,-1);
  return null;
}
export function parseCueLine(line: string, id: string): TtsSegment | null {
  const value = line.trim();
  if (!value || value.length > 8000 || /[<>]/.test(value) || value.includes('{{') || value.includes('[[@') || /\[\[bgm:/i.test(value) || /^[|#!`~]/.test(value)) return null;
  const quotes=['"','“',"'",'‘','「','『'].map(q=>value.indexOf(q)).filter(n=>n>0).sort((a,b)=>a-b);
  for(const quote of quotes){const header=cueHeader(value.slice(0,quote)),speech=quotedCue(value.slice(quote));if(header&&speech)return {id,...header,text:speech,kind:'dialogue',start:0,end:line.length};}
  if(/[:：]\s*$/.test(value)&&cueHeader(value))return null;
  // `'혼잣말'` with nobody named: the monologue card speaks it. Apostrophes inside words (don't) don't count as quotes.
  const whole=/^['‘]/.test(value)?quotedCue(value):null;
  if(whole&&!/['‘’]/.test(whole.replace(/(?<=\p{L})['’](?=\p{L})/gu,'')))return {id,speaker:'',tone:'',text:whole,kind:'dialogue',monologue:true,start:0,end:line.length};
  // A short single-quoted word inside prose ('디지털 데이터') is emphasis, not speech.
  const prose=value.replace(/(?<=\S[ \t]?)['‘][^'‘’\n]{1,30}['’](?=[ \t]?[\p{L}\p{N}])/gu,'');
  // Parentheses are prose ((작게) 한숨을 쉬었다): only a speaker header ending in a colon is held back, above.
  if (/["“‘「『']/.test(prose) || /[:：]\s*'/.test(value)) return null;
  return { id, speaker: '', tone: '', text: value, kind: 'narration', start: 0, end: line.length };
}
const VOID_TAG = /^<(?:img|br|hr|input|source|meta|link|wbr|audio|video)\b[^>]*>$/i;
function oneLineTag(line: string): boolean {
  return VOID_TAG.test(line) || /^<[a-z][\w-]*\b[^>]*\/>$/i.test(line) || /^<!--.*-->$/.test(line) || /^<([a-z][\w-]*)\b[^>]*>.*<\/\1\s*>$/i.test(line);
}
export function parseTtsMessage(text: string, excludeTerms: readonly string[] = [], skipChars = 1, requireLetter = true, sound?: TtsSoundCues): TtsSegment[] {
  // Streaming-tag blocks are image slots, never read. Blanked in place, so every offset still points at the source.
  const lines = text.replace(new RegExp(INLINE_SHOT_MASK_SOURCE, 'gi'), block => block.replace(/[^\n]/g, ' ')).split('\n');
  const response = /^#[*\t ]*(?:Response|응답|応答|响应|OOC)[*\t ]*$/;
  const beginning = lines.findIndex(line => response.test(line.trim()));
  let fenced = false, html = false, hidden = '', post = false, offset = 0;
  const result: TtsSegment[] = [];
  /**
   * The sound cues in a line, split by where they sit in the words that are
   * read (a dialogue's quote, not its speaker header): one in the first half
   * plays before the line, one in the second half after it
   * (§끼이익§ 문이 열렸다 → effect, line; 문을 닫았다 §쾅§ → line, effect).
   */
  const cues = (line: string, number: number, at: number, spoken?: string): { before: TtsSegment[]; after: TtsSegment[] } => {
    const out = { before: [] as TtsSegment[], after: [] as TtsSegment[] }, from = spoken ? Math.max(0, line.indexOf(spoken)) : line.length - line.trimStart().length;
    const middle = from + (spoken ? spoken.length : line.trimEnd().length - from) / 2;
    const found = [
      ...(sound!.bgm ? bgmMarkers(line).map(hit => ({ index: hit.index, length: hit.length, kind: 'bgm' as const, text: hit.tags.join(', '), tags: hit.tags })) : []),
      ...sfxHits(line, sound!.sfxRules).map(hit => ({ index: hit.index, length: hit.length, kind: 'sfx' as const, text: hit.word, tags: undefined })),
    ].sort((a, b) => a.index - b.index);
    // A BGM cue always comes first: the music is set before the line.
    found.forEach((cue, k) => { if (cue.text) (cue.kind === 'sfx' && cue.index + cue.length / 2 > middle ? out.after : out.before).push({ id: `${number}:${cue.kind}${k}`, speaker: '', tone: '', text: cue.text, kind: cue.kind, ...(cue.tags ? { tags: cue.tags } : { context: line.slice(0, 300) }), start: at + cue.index, end: at + cue.index + cue.length }); });
    return out;
  };
  const none = { before: [] as TtsSegment[], after: [] as TtsSegment[] };
  for(let index=0;index<lines.length;index++) {
    const line=lines[index];
    const trimmed = line.trim();
    const tag = /^<(thoughts|think|analysis|reasoning)(?:\s|>)/i.exec(trimmed);
    if (tag) hidden = tag[1]!.toLowerCase();
    if (/^#[*\t ]*(Post-response|사후응답|事後応答)/.test(trimmed)) post = true;
    if (hidden || post || index <= beginning) {
      if (hidden && trimmed.toLowerCase().includes(`</${hidden}>`)) hidden = '';
      offset += line.length + 1; continue;
    }
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) fenced = !fenced;
    else if (!fenced) {
      // Only a tag that opens a block (<div>, <details>…) hides the lines after it;
      // a one-line tag such as <img …> or <span>…</span> hides just its own line.
      if (trimmed.startsWith('<') && !html && !oneLineTag(trimmed)) html = true;
      if (!trimmed) html = false;
      if(!html && /[:：]\s*$/.test(trimmed)){
        const header=cueHeader(trimmed),next=lines[index+1],speech=next===undefined?null:quotedCue(next);
        if(header&&speech&&!/[<>]/.test(speech)){
          const spoken = sound ? withoutSfx(speech, sound.sfxRules) : speech;
          const around = sound ? cues(next, index + 2, offset + line.length + 1, speech) : none;
          result.push(...around.before);
          if (allowedTtsText(spoken, excludeTerms, skipChars, requireLetter)) result.push({id:String(index+1),...header,text:speech,...(spoken !== speech ? { spoken } : {}),kind:'dialogue',start:offset,end:offset+line.length+1+next.length});
          result.push(...around.after);
          offset+=line.length+1+next.length+1;index++;continue;
        }
      }
      const segment = !html ? parseCueLine(line, String(index + 1)) : null;
      const around = !html && sound ? cues(line, index + 1, offset, segment?.kind === 'dialogue' ? segment.text : undefined) : none;
      result.push(...around.before);
      const spoken = segment && sound ? withoutSfx(segment.text, sound.sfxRules) : segment?.text;
      if (segment && allowedTtsText(spoken!, excludeTerms, skipChars, requireLetter)) result.push({ ...segment, ...(spoken !== segment.text ? { spoken } : {}), start: offset, end: offset + line.length });
      result.push(...around.after);
    }
    offset += line.length + 1;
  }
  return result;
}
