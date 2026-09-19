/**
 * Permanent chat-image tokens. Stored as `[[@inray::cardId::inxshot_…::width::height]]` (legacy omits size).
 * Display (center / hover fullscreen) is a Risu editdisplay module, not this
 * string. Strip before hashing, tagging, or placing the next shot.
 */
import { isShotAssetName, sanitizeShotId } from './gallery/shot-assets.ts';
import { cleanText } from '../core/util/text.ts';

const INRAY_TOKEN_RE = /\[\[@inray::[^\]]+\]\]/g;
const LEGACY_BAKE_RE = /\{\{#asset::inxbake_[^}]+\}\}/g;

export type BakeDimensions = { width: number; height: number };

/** Only valid intrinsic dimensions enter persisted tokens or CSS captures. */
export function bakeDimensions(width: unknown, height: unknown): BakeDimensions | undefined {
  const w = Number(width), h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 32768 || h > 32768) return undefined;
  return { width: Math.round(w), height: Math.round(h) };
}

export function bakeTokenForCard(cardId: unknown, assetName?: unknown, dimensions?: BakeDimensions): string {
  const id = sanitizeShotId(cardId);
  const name = cleanText(assetName, 400);
  if (!id || !name || !isShotAssetName(name)) return '';
  const size = dimensions && bakeDimensions(dimensions.width, dimensions.height);
  return `[[@inray::${id}::${name}${size ? `::${size.width}::${size.height}` : ''}]]`;
}

export function messageHasBakeToken(text: unknown): boolean {
  const raw = String(text || '');
  return /\[\[@inray::[^\]]+\]\]/.test(raw) || /\{\{#asset::inxbake_[^}]+\}\}/.test(raw);
}

export function htmlHasInrayBake(html: unknown): boolean {
  const raw = String(html || '');
  return /inray-bake|inray-shot|\[\[@inray::/.test(raw);
}

export function htmlHasBakeWrapForCard(html: unknown, cardId: unknown): boolean {
  const id = sanitizeShotId(cardId);
  if (!id) return false;
  const raw = String(html || '');
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`inray-bake="1"[^>]{0,240}inlay-inline-shot="${esc}"`).test(raw)
    || new RegExp(`inlay-inline-shot="${esc}"[^>]{0,240}inray-bake`).test(raw);
}

export function messageHasBakeTokenForCard(text: unknown, cardId: unknown): boolean {
  const id = sanitizeShotId(cardId);
  if (!id) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const raw = String(text || '');
  return new RegExp(`\\[\\[@inray::${escaped}::`).test(raw)
    || new RegExp(`\\{\\{#asset::inxbake_${escaped}`).test(raw);
}

export function stripBakeTokens(text: unknown): string {
  INRAY_TOKEN_RE.lastIndex = 0;
  LEGACY_BAKE_RE.lastIndex = 0;
  return String(text ?? '')
    .replace(/(^|\n?)(?:\[\[@inrayspinner::[^\]]+\]\])+(\n?)/g, (_m, before, after, offset) => offset === 0 && !before ? '' : after)
    .replace(/(^|\n?)(?:\[\[@inray::[^\]]+\]\])+(\n?)/g, (_m, before, after, offset) => offset === 0 && !before ? '' : after)
    .replace(/\{\{#asset::inxbake_[^}]+\}\}\n?/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

/** Hash / tagger prose — bake marks must not change the fingerprint. */
export function proseForHash(text: unknown): string {
  return stripBakeTokens(text);
}

export interface TaggerContextSource {
  role?: unknown;
  content?: unknown;
  data?: unknown;
}

/**
 * Recent-message context for the tagger, minus our own tokens.
 *
 * Context rows carry raw stored text, bake/spinner tokens included, while the
 * current message is numbered from stripped prose. Stripping here keeps our
 * tokens out of the prompt and lets the current message be excluded by
 * construction (stripped equality) instead of a later dedupe pass.
 */
export function filterTaggerContextMessages(
  recent: readonly TaggerContextSource[] | null | undefined,
  assistant: unknown,
): Array<{ role: string; body: string }> {
  // Same truncated basis the loop stores, so a long current message still
  // matches its own truncated context copy.
  const current = cleanText(assistant, 12000);
  const out: Array<{ role: string; body: string }> = [];
  for (const msg of recent || []) {
    const rec = (msg && typeof msg === 'object' ? msg : {}) as Record<string, unknown>;
    const role = cleanText(rec.role, 40) || 'char';
    const body = cleanText(stripBakeTokens(rec.content ?? rec.data), 12000);
    if (!body) continue;
    // The current message ships L-numbered below; never send it twice.
    if (body === current) continue;
    out.push({ role, body });
  }
  return out;
}

/** Swap one baked card's token for a reroll — same slot, new id / asset name. */
export function replaceBakeTokenCard(
  text: unknown,
  prevCardId: unknown,
  nextCardId: unknown,
  nextAssetName: unknown,
  dimensions?: BakeDimensions,
): string {
  const prev = sanitizeShotId(prevCardId);
  const token = bakeTokenForCard(nextCardId, nextAssetName, dimensions);
  if (!prev || !token) return String(text ?? '');
  const escaped = prev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text ?? '').replace(new RegExp(`\\[\\[@inray::${escaped}::[^\\]]+\\]\\]`, 'g'), match => {
    const previous = match.match(/::([0-9]+)::([0-9]+)\]\]$/);
    return bakeTokenForCard(nextCardId, nextAssetName, dimensions || (previous ? bakeDimensions(previous[1], previous[2]) : undefined));
  });
}

export function stripBakeTokenForCard(text: unknown, cardId: unknown): string {
  const id = sanitizeShotId(cardId);
  if (!id) return String(text ?? '');
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text ?? '')
    .replace(new RegExp(`(?:\\[\\[@inrayspinner::[^\\]]+\\]\\])?\\[\\[@inray::${escaped}::[^\\]]+\\]\\]\\n?`, 'g'), '')
    .replace(new RegExp(`\\{\\{#asset::inxbake_${escaped}(?:\\.webp)?\\}\\}\\n?`, 'g'), '');
}


export function spinnerToken(jobId:string, shot:number,width=1024,height=1024):string {
  if(!/^[a-zA-Z0-9_-]+$/.test(jobId) || !Number.isInteger(shot) || shot<0) throw new Error('Invalid spinner identity');
  const w=Math.max(64,Math.min(8192,Math.floor(Number(width)||1024))),h=Math.max(64,Math.min(8192,Math.floor(Number(height)||1024)));
  return `[[@inrayspinner::${jobId}_${shot}::${w}::${h}]]`;
}
export function replaceSpinner(text:string,jobId:string,shot:number,replacement:string):string {
  spinnerToken(jobId,shot);
  return text.replace(new RegExp('\\[\\[@inrayspinner::'+jobId+'_'+shot+'::[0-9]+::[0-9]+\\]\\]','g'),()=>replacement);
}
export function removeJobSpinners(text:string,jobId:string):string {
  if(!/^[a-zA-Z0-9_-]+$/.test(jobId)) throw new Error('Invalid spinner job');
  return removePendingSpinners(text,jobId+'_\\d+');
}

export function removePendingSpinners(text:string, identity='[a-zA-Z0-9_-]+'):string {
  return text.replace(new RegExp('(^|\\n?)(?:\\[\\[@inrayspinner::'+identity+'(?:::[0-9]+::[0-9]+)?\\]\\](?!\\[\\[@inray::))+(\\n?)','g'),(_m,before,after,offset)=>offset===0&&!before?'':after);
}

/** Read the exact reserved slot; never infer a slot from paragraph order. */
export function spinnerDimensions(text: string, jobId: string, shot: number): BakeDimensions | undefined {
  spinnerToken(jobId, shot);
  const match = text.match(new RegExp('\\[\\[@inrayspinner::' + jobId + '_' + shot + '::([0-9]+)::([0-9]+)\\]\\]'));
  return match ? bakeDimensions(match[1], match[2]) : undefined;
}

/** Regeneration removes image references only; reserved frame geometry survives. */
export function stripBakedReferences(text: string): string {
  return text.replace(/\[\[@inray::[^\]]+\]\]/g, '').replace(LEGACY_BAKE_RE, '');
}
/** Idempotent finalization: retain the frame and replace only its attached asset. */
export function attachBakeToSpinner(text: string, jobId: string, shot: number, token: string): string {
  spinnerToken(jobId, shot);
  const frame = new RegExp('\\[\\[@inrayspinner::'+jobId+'_'+shot+'::[0-9]+::[0-9]+\\]\\](?:\\[\\[@inray::[^\\]]+\\]\\])?', 'g');
  return text.replace(frame, match => {
    const end=match.indexOf(']]')+2, existing=match.slice(end);
    // Repeated completion must not fall back from actual dimensions to planned ones.
    if(existing && existing.split('::').slice(0,3).join('::')===token.split('::').slice(0,3).join('::')) return match;
    return match.slice(0,end)+token;
  });
}
