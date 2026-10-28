import { analysisBody } from './prompt/message-body';
/**
 * Permanent chat-image tokens. Stored as `[[@inray::cardId::inxshot_…::width::height]]` (legacy omits size).
 * Display (center / hover fullscreen) is a Risu editdisplay module, not this
 * string. Strip before hashing, tagging, or placing the next shot.
 */
import { isShotAssetName, sanitizeShotId } from './gallery/shot-assets.ts';
import { cleanText } from '../core/util/text.ts';
import { imageHistoryRoot } from './gallery/image-history';
import { inlineShotBlocks, waitingBlock } from './prompt/inline-shots';
import { INLINE_WAIT_BLOCK_SOURCE } from './prompt/inline-shot-pattern';

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

/**
 * Pink waiting slots: the streaming-tag blocks in their waiting form and older
 * [[@inraywait]] tokens. A tag job that lays its spinners out afresh takes them
 * out with the old spinners and baked images: the message's pictures start over,
 * and a slot left behind would draw one of the same scenes again.
 */
export function stripWaitSlots(text: string): string {
  return text.replace(new RegExp(INLINE_WAIT_BLOCK_SOURCE, 'g'), '').replace(/\[\[@inraywait::[^\]]+\]\]/g, '');
}

/** A later streaming batch must retain slots owned by every earlier sibling. */
/**
 * `cardIds`: bare tokens of these images stay too. A streaming-tag reply bakes its
 * finished images in place of their blocks when it ends, with no spinner around them,
 * and a later write for the same reply must not take them out again.
 */
export function stripBakeTokensExceptJobs(text: string, jobIds: readonly string[], cardIds: readonly string[] = []): string {
  const kept: string[]=[];
  let prefix='\u0000omni-stream-frame-';
  while(text.includes(prefix))prefix+='\u0000';
  const keep=(token:string)=>{kept.push(token);return prefix+(kept.length-1)+'\u0000';};
  const masked=text.replace(/\[\[@inrayspinner::([a-zA-Z0-9_-]+)_\d+::\d+::\d+\]\](?:\[\[@inray::[^\]]+\]\])*/g,(token,id)=>{
    if(!jobIds.includes(id))return token;
    return keep(token);
  }).replace(/\[\[@inray::([^:\]]+)::[^\]]*\]\]/g,(token,id)=>cardIds.includes(id)?keep(token):token);
  return stripBakeTokens(masked).replace(new RegExp(prefix+'(\\d+)\u0000','g'),(_token,index)=>kept[Number(index)]);
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
    const body = cleanText(analysisBody(stripBakeTokens(rec.content ?? rec.data)), 12000);
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
  return String(text ?? '').replace(new RegExp(`(\\[\\[@inrayspinner::[a-zA-Z0-9_-]+::[0-9]+::[0-9]+\\]\\]\\s*)?\\[\\[@inray::${escaped}::[^\\]]+\\]\\]`, 'g'), (match, frame: string | undefined) => {
    const previous = match.match(/::([0-9]+)::([0-9]+)\]\]$/);
    // The paired display rule takes its geometry from the reserved frame.
    // Update it only when the replacement image has a known size.
    const size = bakeDimensions(dimensions?.width, dimensions?.height);
    const nextFrame = size && frame
      ? frame.replace(/::[0-9]+::[0-9]+\]\]/, `::${size.width}::${size.height}]]`)
      : frame || '';
    return nextFrame + bakeTokenForCard(nextCardId, nextAssetName, dimensions || (previous ? bakeDimensions(previous[1], previous[2]) : undefined));
  });
}

/** Keep revisions together; the last token is the displayed/pinned choice. */
export function appendBakeRevision(text: string, previous: string, id: string, asset: string, dimensions?: BakeDimensions, pin = false, replaceLatest = false): string {
  const root = imageHistoryRoot(previous);
  const revision = /_([rs]\d+)$/.exec(id)?.[1] || '';
  let token = bakeTokenForCard(id, asset, dimensions);
  if (!token) return text;
  if (revision || pin) token = token.replace(/\]\]$/, `${revision ? '_' + revision : ''}${pin ? '_pin' : ''}]]`);
  const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const groupPattern = new RegExp('(?:\\[\\[@inrayspinner::[^\\]]+\\]\\]\\s*)?(?:\\[\\[@inray::' + escapedRoot + '(?:_[rs]\\d+)?::[^\\]]+\\]\\]\\s*)+', 'g');
  return text.replace(groupPattern, group => {
    if (![...group.matchAll(/\[\[@inray::([^:]+)::/g)].some(match => imageHistoryRoot(match[1]!) === root)) return group;
    let next = group.replace(/(\[\[@inray::[^\]]+?)_pin\]\]/g, '$1]]').trimEnd();
    if (replaceLatest) next = next.replace(/\[\[@inray::[^\]]+\]\]$/, '');
    if (pin) {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      next = next.replace(new RegExp('\\[\\[@inray::' + escaped + '::[^\\]]+\\]\\]', 'g'), '');
    }
    if (dimensions) next = next.replace(/(\[\[@inrayspinner::[^:]+)::\d+::\d+\]\]/, `$1::${dimensions.width}::${dimensions.height}]]`);
    return next + token + (group.match(/\s*$/)?.[0] || '');
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


/**
 * A slot that has a shot but no image yet (streaming tags with 「이미지 바로 생성」
 * off, or a failed slot). Drawn as the pink spinner; a tap generates it. The shot
 * itself waits in plugin storage under `id`, never in the chat.
 */
const WAIT_ID = /^[a-zA-Z0-9_-]{1,64}$/;
export function waitToken(id: string, width = 832, height = 1216): string {
  if (!WAIT_ID.test(id)) throw new Error('Invalid wait slot');
  const size = bakeDimensions(width, height) ?? { width: 832, height: 1216 };
  return `[[@inraywait::${id}::${size.width}::${size.height}]]`;
}
/**
 * A waiting slot is either an older `[[@inraywait::id::w::h]]` token, or (`bN`) the
 * streaming-tag block N itself in its waiting form, `[[inxwN]]{json}[[/inxwN]]`,
 * sized by the aspect its JSON names. Every slot helper takes both.
 */
const BLOCK_ID = /^b(\d{1,3})$/;
export const isBlockWaitId = (id: string): boolean => BLOCK_ID.test(id);
export function waitSlotBlock(text: string, id: string): { text: string; body: string; start: number } | null {
  const hit = BLOCK_ID.exec(id);
  return hit ? waitingBlock(text, Number(hit[1])) : null;
}
export function waitTokenDimensions(text: string, id: string): BakeDimensions | undefined {
  if (!WAIT_ID.test(id)) return undefined;
  if (isBlockWaitId(id)) {
    const block = waitSlotBlock(text, id); if (!block) return undefined;
    const aspect = /"aspect"\s*:\s*"(landscape|square)"/.exec(block.body)?.[1];
    return aspect === 'landscape' ? bakeDimensions(1216, 832) : aspect === 'square' ? bakeDimensions(1024, 1024) : bakeDimensions(832, 1216);
  }
  const hit = new RegExp(`\\[\\[@inraywait::${id}::([0-9]+)::([0-9]+)\\]\\]`).exec(text);
  return hit ? bakeDimensions(hit[1], hit[2]) : undefined;
}
/**
 * Every pink slot of a message, top to bottom: streaming blocks in their waiting form or
 * never drawn (`bN`), and slots whose shot is kept (`[[@inraywait::id]]`).
 */
export function pinkSlotIds(text: string): string[] {
  const rows: Array<{ id: string; at: number }> = [];
  for (const hit of text.matchAll(new RegExp(INLINE_WAIT_BLOCK_SOURCE, 'g'))) rows.push({ id: `b${Number(hit[1])}`, at: hit.index! });
  for (const block of inlineShotBlocks(text)) rows.push({ id: `b${block.n}`, at: block.start });
  for (const hit of text.matchAll(/\[\[@inraywait::([a-zA-Z0-9_-]{1,64})::[0-9]+::[0-9]+\]\]/g)) rows.push({ id: hit[1]!, at: hit.index! });
  const seen = new Set<string>();
  return rows.sort((a, b) => a.at - b.at).filter(row => !seen.has(row.id) && !!seen.add(row.id)).map(row => row.id);
}
export function replaceWaitToken(text: string, id: string, replacement: string): string {
  if (!WAIT_ID.test(id)) return text;
  if (isBlockWaitId(id)) { const block = waitSlotBlock(text, id); return block ? text.slice(0, block.start) + replacement + text.slice(block.start + block.text.length) : text; }
  return text.replace(new RegExp(`\\[\\[@inraywait::${id}::[0-9]+::[0-9]+\\]\\]`, 'g'), () => replacement);
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

// A spinner with its image attached is done; only a bare one is still waiting for it.
const PENDING_SPINNER = /\[\[@inrayspinner::([a-zA-Z0-9_-]{1,64})::([0-9]+)::([0-9]+)\]\](?!\s{0,128}\[\[@inray::)/g;
/** The spinners that never got their image, by identity (`jobId_shot`). */
export function pendingSpinnerIds(text: string): string[] {
  return [...text.matchAll(PENDING_SPINNER)].map(match => match[1]!);
}
/**
 * The named bare spinners become waiting slots of the same identity and size: the
 * pink slot a double tap generates, from the shot kept for it (inline-wait-store).
 */
export function parkSpinners(text: string, ids: ReadonlySet<string>): string {
  return text.replace(PENDING_SPINNER, (match, id: string, width: string, height: string) => ids.has(id) ? waitToken(id, Number(width), Number(height)) : match);
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
