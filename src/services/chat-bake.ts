import { insertAtAnalysisLine, analysisBody } from '../domain/prompt/message-body';
import { measureWrite } from '../core/write-metrics';
/**
 * Write / strip `[[@inray::cardId::inxshot_…]]` on one Risu chat message.
 */
import { serializeSessionStorage } from '../storage/chat-session-store';
import { risuHost } from '../core/host';
import { toInt } from '../core/util/text';
import { bakeTokenForCard, bakeDimensions, spinnerDimensions, spinnerToken, attachBakeToSpinner, stripBakedReferences, removePendingSpinners, removeJobSpinners, replaceBakeTokenCard, stripBakeTokens } from '../domain/chat-bake';
import { isShotAssetName, shotAssetName } from '../domain/gallery/shot-assets';
import { normalizeInlineChatTextSide } from '../domain/inline-chat';
import { applyBakeTokensToBody, insertSnippetAtStrippedLine, chatBodyLineCount, probeDataUrlPixelSize } from '../ui-contract/viewer-core';
import { getConfig } from './context';
import type { BakeDimensions } from '../domain/chat-bake';
import { imageAssetRef, imageMeta, imagePng, idbGet } from '../storage/stores';
import { ensureInrayDisplayModule } from '../storage/inray-display-module';

export type BakeCardRow = {
  id?: unknown;
  line?: unknown;
  width?: number;
  height?: number;
};

/** Completion uses metadata only; explicit bake/reroll may hydrate an asset after reload. */
async function dimensionsForCard(cardId: string, supplied?: Partial<BakeDimensions>, readImage = false): Promise<BakeDimensions | undefined> {
  const explicit = bakeDimensions(supplied?.width, supplied?.height);
  if (explicit) return explicit;
  const card = await idbGet('cards', cardId);
  let meta: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(String(card?.meta_json || '{}'));
    if (parsed && typeof parsed === 'object') meta = parsed as Record<string, unknown>;
  } catch { /* Older cards may have no generation metadata. */ }
  const runtime = bakeDimensions(meta.width, meta.height) || bakeDimensions(card?.width, card?.height);
  if (runtime) return runtime;
  const image = await imageMeta(cardId);
  const indexed = bakeDimensions(image?.location.width, image?.location.height);
  if (indexed || !readImage) return indexed;
  const pixels = await imagePng(cardId);
  if (!pixels) return undefined;
  // Reuse the existing PNG/JPEG/WebP probe; encode only its bounded header, not the image.
  const header = new Uint8Array(pixels, 0, Math.min(512, pixels.byteLength));
  const size = probeDataUrlPixelSize('data:image/png;base64,' + btoa(String.fromCharCode(...header)));
  if (size) return bakeDimensions(size.w, size.h);
  // Hydration may restore recipe dimensions even when the bounded header cannot find JPEG SOF.
  return dimensionsForCard(cardId);

}

function chatMessageList(chat: Record<string, unknown>): Record<string, unknown>[] {
  const raw = chat.message ?? chat.messages;
  return Array.isArray(raw) ? raw.filter((row) => row && typeof row === 'object') as Record<string, unknown>[] : [];
}

function messageBody(msg: Record<string, unknown>): string {
  if (typeof msg.data === 'string') return msg.data;
  if (typeof msg.saying === 'string') return msg.saying;
  return '';
}

function setMessageBody(msg: Record<string, unknown>, text: string): void {
  if (typeof msg.data === 'string' || !('saying' in msg)) msg.data = text;
  else msg.saying = text;
}

async function loadTargetChat(
  charIndex: number,
  chatIndex: number,
): Promise<{ host: NonNullable<ReturnType<typeof risuHost>>; chat: Record<string, unknown> } | null> {
  const host = risuHost();
  if (!host || typeof host.getChatFromIndex !== 'function' || typeof host.setChatToIndex !== 'function') {
    return null;
  }
  if (charIndex < 0 || chatIndex < 0) return null;
  const chat = await host.getChatFromIndex(charIndex, chatIndex);
  if (!chat || typeof chat !== 'object') return null;
  return { host, chat: chat as Record<string, unknown> };
}

async function writeChat(
  host: NonNullable<ReturnType<typeof risuHost>>,
  charIndex: number,
  chatIndex: number,
  chat: Record<string, unknown>,
  opts: { refreshAssets?: boolean; messageIndex: number; previousBody: string },
): Promise<void> {
  const work = async () => {
    // Character asset registration refreshes host lookup without toggling modules.
    await serializeSessionStorage(async () => {
      const fresh = await host.getChatFromIndex!(charIndex, chatIndex) as Record<string, unknown>;
      if (!fresh || (chat.id && fresh.id !== chat.id)) throw new Error('Chat changed during bake');
      const messages = chatMessageList(fresh);
      const target = messages[opts.messageIndex];
      if (!target || messageBody(target) !== opts.previousBody) throw new Error('Message changed during bake');
      const original = chatMessageList(chat)[opts.messageIndex];
      if (String(original?.chatId || original?.id || '') !== String(target.chatId || target.id || '')) throw new Error('Message identity changed during bake');
      setMessageBody(target, messageBody(chatMessageList(chat)[opts.messageIndex]));
      if (Array.isArray(fresh.message)) fresh.message = messages;
      else fresh.messages = messages;
      await measureWrite('chat','image-tokens',()=>host.setChatToIndex!(charIndex, chatIndex, fresh));
    });
  };
  const bridge = (globalThis as typeof globalThis & {
    __INLAY_SCROLL_HOLD__?: (work: () => Promise<void>, options?: {requireMutation:boolean}) => Promise<void>;
  }).__INLAY_SCROLL_HOLD__;
  if (getConfig().card?.scroll_hold && typeof bridge === 'function') await bridge(work,{requireMutation:true});
  else await work();
  const repaint = Reflect.get(globalThis, '__OMNI_REPAINT_FANS__');
  if (typeof repaint === 'function') void Promise.resolve(repaint()).catch(() => {});
}

export async function bakeCardsIntoChatMessage(opts: {
  charIndex: number;
  chatIndex: number;
  messageIndex: number;
  cards: BakeCardRow[];
  analysisLines?: boolean;
  hostMessageId?: string;
  expectedPrefix?: string;
}): Promise<boolean> {
  const loaded = await loadTargetChat(opts.charIndex, opts.chatIndex);
  if (!loaded) return false;
  await ensureInrayDisplayModule(getConfig().card?.persist_chat_images_folded === true, getConfig().card?.inline_chat_scale_pct, { enabled: getConfig().card?.inline_msg_fan === true, userchat: getConfig().card?.userchat === true });
  const messages = chatMessageList(loaded.chat);
  const idx = Math.floor(Number(opts.messageIndex));
  if (!Number.isFinite(idx) || idx < 0 || idx >= messages.length) return false;
  const msg = messages[idx]!;
  if (opts.hostMessageId && String(msg.chatId || msg.id || '') !== opts.hostMessageId) return false;
  if (opts.expectedPrefix && !analysisBody(messageBody(msg)).startsWith(opts.expectedPrefix)) return false;
  const side = normalizeInlineChatTextSide(getConfig().card?.inline_chat_text_side);
  const placements: Array<{ line: number; cardId: string; assetName: string; dimensions?: BakeDimensions }> = [];
  for (const card of opts.cards) {
    const cardId = String(card?.id || '');
    const line = Math.floor(Number(card?.line));
    if (!cardId || !Number.isFinite(line) || line < 1) continue;
    const asset = await imageAssetRef(cardId);
    if (!asset?.path) continue;
    const assetName = isShotAssetName(asset.name) ? asset.name : shotAssetName(cardId, 'webp');
    if (!assetName) continue;
    placements.push({ line, cardId, assetName, dimensions: await dimensionsForCard(cardId, card, true) });
  }
  const previousBody = messageBody(msg);
  let next = opts.analysisLines ? stripBakeTokens(previousBody) : applyBakeTokensToBody(previousBody, placements, side);
  if (opts.analysisLines) for (const row of placements.slice().sort((a,b)=>b.line-a.line)) {
    next = insertAtAnalysisLine(next, row.line, side, bakeTokenForCard(row.cardId,row.assetName,row.dimensions));
  }
  for (const row of placements) {
    if (row.dimensions) next = replaceBakeTokenCard(next, row.cardId, row.cardId, row.assetName, row.dimensions);
  }
  if (next === messageBody(msg)) return placements.length > 0;
  setMessageBody(msg, next);
  messages[idx] = msg;
  if (Array.isArray(loaded.chat.message)) loaded.chat.message = messages;
  else loaded.chat.messages = messages;
  await writeChat(loaded.host, opts.charIndex, opts.chatIndex, loaded.chat, { refreshAssets: true, messageIndex: idx, previousBody });
  return true;
}

export async function stripBakedImagesFromChatMessage(opts: {
  charIndex: number;
  chatIndex: number;
  messageIndex: number;
}): Promise<boolean> {
  const loaded = await loadTargetChat(opts.charIndex, opts.chatIndex);
  if (!loaded) return false;
  const messages = chatMessageList(loaded.chat);
  const idx = Math.floor(Number(opts.messageIndex));
  if (!Number.isFinite(idx) || idx < 0 || idx >= messages.length) return false;
  const msg = messages[idx]!;
  const prev = messageBody(msg);
  const next = stripBakedReferences(prev).replace(/\[\[@inrayspinner::[^\]]+\]\]/g, '');
  if (next === prev) return false;
  setMessageBody(msg, next);
  messages[idx] = msg;
  if (Array.isArray(loaded.chat.message)) loaded.chat.message = messages;
  else loaded.chat.messages = messages;
  await writeChat(loaded.host, opts.charIndex, opts.chatIndex, loaded.chat, { messageIndex: idx, previousBody: prev });
  return true;
}

export async function rewriteBakedCardInChatMessage(opts: {
  charIndex: number;
  chatIndex: number;
  messageIndex: number;
  prevCardId: string;
  nextCardId: string;
  characterId?: string;
  chatId?: string;
  width?: number;
  height?: number;
}): Promise<boolean> {
  if (opts.characterId && opts.chatId) {
    const db=await risuHost()?.getDatabase?.(['characters']);
    const matches=(db?.characters || []).flatMap((char,ci)=> {
      const row=char as unknown as Record<string,unknown>;
      if(String(row.chaId || row.id)!==opts.characterId)return [];
      return (Array.isArray(row.chats)?row.chats:[]).flatMap((chat,ti)=>String(chat.id || chat.chatId)===opts.chatId?[{ci,ti}]:[]);
    });
    if(matches.length!==1)throw new Error('박제 이미지를 교체할 채팅을 찾을 수 없습니다.');
    opts={...opts,charIndex:matches[0].ci,chatIndex:matches[0].ti};
  }
  const loaded = await loadTargetChat(opts.charIndex, opts.chatIndex);
  if (!loaded) return false;
  const messages = chatMessageList(loaded.chat);
  const tokenMatches=messages.map((msg,i)=>replaceBakeTokenCard(messageBody(msg),opts.prevCardId,opts.nextCardId,'inxshot_probe.webp')!==messageBody(msg)?i:-1).filter(i=>i>=0);
  if(tokenMatches.length>1)throw new Error('중복 박제 토큰 때문에 교체 대상을 확정할 수 없습니다.');
  const idx = tokenMatches[0] ?? Math.floor(Number(opts.messageIndex));
  if (!Number.isFinite(idx) || idx < 0 || idx >= messages.length) return false;
  const msg = messages[idx]!;
  const prev = messageBody(msg);
  const asset = await imageAssetRef(opts.nextCardId);
  if(!asset?.path)throw new Error('새 이미지 에셋이 저장되지 않았습니다.');
  const assetName = asset && isShotAssetName(asset.name) ? asset.name : shotAssetName(opts.nextCardId, 'webp');
  const next = replaceBakeTokenCard(prev, opts.prevCardId, opts.nextCardId, assetName, await dimensionsForCard(opts.nextCardId, opts, true));
  if (next === prev) return false;
  setMessageBody(msg, next);
  messages[idx] = msg;
  if (Array.isArray(loaded.chat.message)) loaded.chat.message = messages;
  else loaded.chat.messages = messages;
  await writeChat(loaded.host, opts.charIndex, opts.chatIndex, loaded.chat, { refreshAssets: true, messageIndex: idx, previousBody: prev });
  return true;
}

export function persistChatImagesOn(): boolean {
  return getConfig().card?.persist_chat_images !== false;
}

export function jobChatTarget(request: {
  char_index?: unknown;
  chat_index?: unknown;
  message_index?: unknown;
  analysis_lines?: boolean;
  host_message_id?: string;
  defer_attachment?: boolean;
  assistant_text?: string;
}): { charIndex: number; chatIndex: number; messageIndex: number; analysisLines?: boolean; hostMessageId?: string; expectedPrefix?: string } {
  return {
    analysisLines: request.analysis_lines === true,
    hostMessageId: request.host_message_id,
    expectedPrefix: request.defer_attachment ? request.assistant_text : undefined,
    charIndex: toInt(request.char_index, -1),
    chatIndex: toInt(request.chat_index, -1),
    messageIndex: toInt(request.message_index, -1),
  };
}


/** Canonical tagger source: the stored Risu message body. Null when unreachable. */
export async function readStoredMessageBody(
  charIndex: unknown,
  chatIndex: unknown,
  messageIndex: unknown,
): Promise<string | null> {
  try {
    const ci = toInt(charIndex, -1), ti = toInt(chatIndex, -1), mi = toInt(messageIndex, -1);
    if (ci < 0 || ti < 0 || mi < 0) return null;
    const loaded = await loadTargetChat(ci, ti);
    if (!loaded) return null;
    const msg = chatMessageList(loaded.chat)[mi];
    if (!msg) return null;
    const body = messageBody(msg);
    return body || null;
  } catch {
    return null;
  }
}

/** One durable placeholder per job/shot; completion never recomputes its paragraph. */
export async function writeJobSpinners(opts: ReturnType<typeof jobChatTarget> & {jobId:string;shots:Array<{line?:unknown;shot_index:number;width?:number;height?:number}>}):Promise<boolean> {
  const loaded=await loadTargetChat(opts.charIndex,opts.chatIndex);if(!loaded)return false;
  await ensureInrayDisplayModule(getConfig().card?.persist_chat_images_folded === true, getConfig().card?.inline_chat_scale_pct, { enabled: getConfig().card?.inline_msg_fan === true, userchat: getConfig().card?.userchat === true });
  const msg=chatMessageList(loaded.chat)[opts.messageIndex];if(!msg)return false;
  if (opts.hostMessageId && String(msg.chatId || msg.id || '') !== opts.hostMessageId) throw new Error('Message identity changed');
  if (opts.expectedPrefix && !analysisBody(messageBody(msg)).startsWith(opts.expectedPrefix)) throw new Error('Message body changed');
  const previousBody=messageBody(msg);
  const side=normalizeInlineChatTextSide(getConfig().card?.inline_chat_text_side);
  const groups=new Map<number,string[]>();
  // All generation modes replace old marks atomically, using the same clean
  // prose as tagging so previous slot positions cannot override the new shots.
  let next=stripBakeTokens(previousBody);
  const lines=chatBodyLineCount(next);
  for(const shot of opts.shots) {
    const requested=Math.floor(Number(shot.line)||lines);
    const line=opts.analysisLines ? requested : Math.max(1,Math.min(lines,requested));
    const list=groups.get(line)||[];list.push(spinnerToken(opts.jobId,shot.shot_index,shot.width,shot.height));groups.set(line,list);
  }
  // Lines above are stripped-basis (same as the tagger's L-numbers); map back
  // to raw lines on insert so token-only rows cannot shift the slot.
  for(const [line,tokens] of [...groups].sort((a,b)=>b[0]-a[0])) next=opts.analysisLines
    ? insertAtAnalysisLine(next,line,side,tokens.join('')) : insertSnippetAtStrippedLine(next,line,side,tokens.join(''));
  setMessageBody(msg,next);
  await writeChat(loaded.host,opts.charIndex,opts.chatIndex,loaded.chat,{messageIndex:opts.messageIndex,previousBody});return true;
}
export async function finishJobSpinner(opts: ReturnType<typeof jobChatTarget> & {jobId:string;shot:number;cardId:string;width?:number;height?:number}):Promise<boolean> {
  const asset=await imageAssetRef(opts.cardId);if(!asset?.path)throw new Error('Shot asset missing');
  const loaded=await loadTargetChat(opts.charIndex,opts.chatIndex);if(!loaded)return false;
  const msg=chatMessageList(loaded.chat)[opts.messageIndex];if(!msg)return false;
  if (opts.hostMessageId && String(msg.chatId || msg.id || '') !== opts.hostMessageId) throw new Error('Message identity changed');
  if (opts.expectedPrefix && !analysisBody(messageBody(msg)).startsWith(opts.expectedPrefix)) throw new Error('Message body changed');
  const previousBody=messageBody(msg);
  const token=bakeTokenForCard(opts.cardId,asset.name, await dimensionsForCard(opts.cardId, opts) || spinnerDimensions(previousBody,opts.jobId,opts.shot));
  if(!token)throw new Error('Invalid shot asset');
  const next=attachBakeToSpinner(previousBody,opts.jobId,opts.shot,token);
  if(next===previousBody) return false;
  setMessageBody(msg,next);
  await writeChat(loaded.host,opts.charIndex,opts.chatIndex,loaded.chat,{refreshAssets:true,messageIndex:opts.messageIndex,previousBody});return true;
}
export async function finishJobSpinners(opts: ReturnType<typeof jobChatTarget> & {jobId:string;cards:Array<{shot:number;cardId:string;width?:number;height?:number}>}):Promise<boolean> {
  const replacements:Array<{shot:number;cardId:string;assetName:string;dimensions?:BakeDimensions}>=[];
  for(const card of opts.cards) {
    const asset=await imageAssetRef(card.cardId);if(!asset?.path)throw new Error('Shot asset missing');
    const token=bakeTokenForCard(card.cardId,asset.name);if(!token)throw new Error('Invalid shot asset');
    replacements.push({shot:card.shot,cardId:card.cardId,assetName:asset.name,dimensions:await dimensionsForCard(card.cardId,card)});
  }
  const loaded=await loadTargetChat(opts.charIndex,opts.chatIndex);if(!loaded)return false;
  const msg=chatMessageList(loaded.chat)[opts.messageIndex];if(!msg)return false;
  if (opts.hostMessageId && String(msg.chatId || msg.id || '') !== opts.hostMessageId) throw new Error('Message identity changed');
  if (opts.expectedPrefix && !analysisBody(messageBody(msg)).startsWith(opts.expectedPrefix)) throw new Error('Message body changed');
  const previousBody=messageBody(msg);
  let next=previousBody;
  for(const replacement of replacements) {
    const token=bakeTokenForCard(replacement.cardId,replacement.assetName,replacement.dimensions || spinnerDimensions(previousBody,opts.jobId,replacement.shot));
    const replaced=attachBakeToSpinner(next,opts.jobId,replacement.shot,token);
    if(replaced===next && !spinnerDimensions(next,opts.jobId,replacement.shot))throw new Error(`Spinner token missing at completion: ${replacement.shot}`);
    next=replaced;
  }
  if(next===previousBody)return replacements.length>0;
  setMessageBody(msg,next);
  await writeChat(loaded.host,opts.charIndex,opts.chatIndex,loaded.chat,{messageIndex:opts.messageIndex,previousBody});
  return true;
}
export async function clearJobSpinners(opts:ReturnType<typeof jobChatTarget> & {jobId:string}):Promise<void> {
  const loaded=await loadTargetChat(opts.charIndex,opts.chatIndex);if(!loaded)return;
  const msg=chatMessageList(loaded.chat)[opts.messageIndex];if(!msg)return;
  const previousBody=messageBody(msg),next=removeJobSpinners(previousBody,opts.jobId);
  if(next===previousBody)return;
  setMessageBody(msg,next);
  await writeChat(loaded.host,opts.charIndex,opts.chatIndex,loaded.chat,{messageIndex:opts.messageIndex,previousBody});
}


/** A new plugin instance cannot own any previously persisted loading placeholders. */
export async function clearAbandonedSpinners():Promise<void> {
  const host=risuHost();if(!host?.getChatFromIndex || !host.setChatToIndex)return;
  const db=await host.getDatabase?.(['characters']);if(!Array.isArray(db?.characters))return;
  for(let ci=0;ci<db.characters.length;ci++) {
    const char=db.characters[ci];if(!Array.isArray(char?.chats))continue;
    for(let ti=0;ti<char.chats.length;ti++) {
      const loaded=await loadTargetChat(ci,ti);if(!loaded)continue;
      const messages=chatMessageList(loaded.chat);
      for(let mi=0;mi<messages.length;mi++) {
        const msg=messages[mi],previousBody=messageBody(msg);
        const next=removePendingSpinners(previousBody);
        if(next===previousBody)continue;
        setMessageBody(msg,next);
        await writeChat(loaded.host,ci,ti,loaded.chat,{messageIndex:mi,previousBody});
      }
    }
  }
}
