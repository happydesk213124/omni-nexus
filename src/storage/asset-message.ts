import { risuHost } from '../core/host';
import { sessionIdHash, unifiedSessionIdForCharacter } from '../core/util/text';

type Row = Record<string, unknown>;
const obj = (value: unknown): Row => value && typeof value === 'object' ? value as Row : {};
export const bakedIds = (body: unknown): string[] => [...new Set(
  [...String(body || '').matchAll(/\[\[@inray::([^:\]\s]+)::[^\]]+\]\]/g)].map(match => match[1]),
)];

/** Search only on an explicit jump/reroll. No durable message-location index. */
export async function findAssetMessage(id: string, hint: Row = {}): Promise<Row | null> {
  for await (const target of chatTargets(hint)) {
    const messages = Array.isArray(target.chat.message) ? target.chat.message : target.chat.messages;
    if (!Array.isArray(messages)) continue;
    for (let index = 0; index < messages.length; index++) {
      const msg = obj(messages[index]);
      if (!bakedIds(msg.data ?? msg.saying).includes(id)) continue;
      return {...target.location, message_index:index, message_role:msg.role || '', content_hash:''};
    }
  }
  return null;
}

export async function messageAssetIds(sessionId: string, messageIndex: number): Promise<string[]> {
  for await (const target of chatTargets({session_id:sessionId})) {
    const messages = target.chat.message ?? target.chat.messages;
    const msg = obj(Array.isArray(messages) ? messages[messageIndex] : null);
    return bakedIds(msg.data ?? msg.saying);
  }
  return [];
}

async function* chatTargets(hint: Row): AsyncGenerator<{chat:Row;location:Row}> {
  const host = risuHost();
  const db = await host?.getDatabase?.(['characters']);
  const chars = Array.isArray(db?.characters) ? db.characters : [];
  for (let ci=0; ci<chars.length; ci++) {
    const entry=obj(chars[ci]), cid=String(entry.chaId || entry.id || '');
    if (hint.character_id && hint.character_id!==cid) continue;
    const char=obj(await host?.getCharacterFromIndex?.(ci));
    const chats=Array.isArray(char.chats)?char.chats:[];
    const sid=String(hint.session_id || '');
    for(let ti=0;ti<chats.length;ti++) {
      const entryChat=obj(chats[ti]),tid=String(entryChat.id || '');
      if(hint.chat_id && hint.chat_id!==tid) continue;
      if(sid && sid!==tid && sid!=='risu_'+sessionIdHash(cid+'|'+tid) && sid!==unifiedSessionIdForCharacter(cid)) continue;
      // Unified callers refer to the currently open chat, never arbitrarily chat zero.
      if(sid===unifiedSessionIdForCharacter(cid) && ti!==Number(char.chatPage || 0)) continue;
      const chat=obj(await host?.getChatFromIndex?.(ci,ti));
      yield {chat,location:{character_id:cid,character_name:char.name || '',char_index:ci,
        chat_id:tid,chat_name:entryChat.name || '',chat_index:ti,session_id:'risu_'+sessionIdHash(cid+'|'+tid)}};
    }
  }
}
