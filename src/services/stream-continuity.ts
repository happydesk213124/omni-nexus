import type { JobRequest, TaggerResult } from '../core/types';
import { cleanText } from '../core/util/text';
import { parseWearState, type WearState } from '../domain/character/wear-state';
import { costumePickReadable } from '../domain/character/costume';

/**
 * Streaming-tag blocks of one reply are separate jobs but one story: a block that
 * leaves out wear_state or costume keeps what an earlier block of the same reply
 * set, as the shots of one tagger call do. Each block used to read only the
 * session note, which is written when the reply ends, so between blocks the clothes
 * came back and went again.
 *
 * Memory only, a few rows per reply: no chat or note write while Risu streams (a
 * whole-chat write mid-reply can put back an older text). Blocks are recorded when
 * their jobs are created and read by block number, never in the order images finish.
 */
export interface StreamOutfit { name: string; wear?: WearState; costume?: unknown }
type Reply = { blocks: Map<number, StreamOutfit[]>; saved: string };
const replies = new Map<string, Reply>();
/** Replies kept: a regenerated reply has a new stream id, so old ones only age out. */
const KEEP = 16;

function replyKey(request: Partial<JobRequest>): string {
  const parts = [request.stream_id, request.character_id, request.chat_id, request.host_message_id].map(v => cleanText(v, 200));
  return parts[0] && parts[3] && Number.isInteger(request.inline_block) ? parts.join('\u0000') : '';
}

/** The outfit each character of a shot states outright; left-out fields stay out. */
export function statedOutfits(tagged: TaggerResult | null | undefined): StreamOutfit[] {
  const shot = tagged?.scenes?.[0]?.shots?.[0];
  const chars = Array.isArray(shot?.characters) ? shot!.characters : [];
  const out: StreamOutfit[] = [];
  for (const ch of chars) {
    const name = cleanText(ch?.name, 200);
    if (!name) continue;
    // Legacy `nude` 0–3 counts as stated, exactly as resolveWearState reads it.
    const legacy = ch && Object.prototype.hasOwnProperty.call(ch, 'nude') && ch.nude != null && ch.nude !== '';
    const wear = parseWearState(ch.wear_state) || (legacy ? parseWearState(ch.nude) || 'clothed' : null);
    const costume = costumePickReadable(ch.costume) ? ch.costume : undefined;
    if (wear || costume !== undefined) out.push({ name, ...(wear ? { wear } : {}), ...(costume !== undefined ? { costume } : {}) });
  }
  return out;
}

/** A block's stated outfits, again after a broken block is repaired. */
export function recordStreamBlock(request: Partial<JobRequest>, tagged?: TaggerResult | null): void {
  const key = replyKey(request);
  if (!key) return;
  let reply = replies.get(key);
  if (!reply) {
    reply = { blocks: new Map(), saved: '' };
    replies.set(key, reply);
    while (replies.size > KEEP) replies.delete(replies.keys().next().value!);
  }
  reply.blocks.set(request.inline_block!, statedOutfits(tagged ?? request.inline_tagged));
}

/** A tap's earlier blocks as sent in the request: only well-formed rows survive. */
export function outfitsFromRequest(raw: unknown): StreamOutfit[][] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).map(list => (Array.isArray(list) ? list : []).flatMap((row: unknown) => {
    const r = row && typeof row === 'object' ? row as Record<string, unknown> : null;
    const name = cleanText(r?.name, 200), wear = parseWearState(r?.wear);
    const costume = costumePickReadable(r?.costume) ? r!.costume : undefined;
    return name && (wear || costume !== undefined) ? [{ name, ...(wear ? { wear } : {}), ...(costume !== undefined ? { costume } : {}) }] : [];
  }));
}

/** What the reply's earlier blocks stated, in block order; empty outside a streaming reply. */
export function streamOutfitsBefore(request: Partial<JobRequest>): StreamOutfit[][] {
  const reply = replies.get(replyKey(request));
  if (!reply) return [];
  return [...reply.blocks].filter(([n]) => n < request.inline_block!).sort((a, b) => a[0] - b[0]).map(([, list]) => list);
}

/**
 * Every block of the reply in block order, as shots for the one note write. Null
 * when this exact state is already saved, so later blocks of the reply skip the
 * chat read and write.
 */
export function streamReplyOutfitsToSave(request: Partial<JobRequest>): Array<{ characters: StreamOutfit[] }> | null {
  const reply = replies.get(replyKey(request));
  if (!reply) return null;
  const shots = [...reply.blocks].sort((a, b) => a[0] - b[0]).map(([, characters]) => ({ characters: characters.map(row => ({ ...row, ...(row.wear ? { wear_state: row.wear } : {}) })) }));
  const signature = JSON.stringify(shots);
  if (signature === reply.saved) return null;
  reply.saved = signature;
  return shots;
}

/** For tests: forget every reply. */
export function resetStreamContinuity(): void { replies.clear(); }
