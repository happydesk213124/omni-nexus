import { risuHost } from '../core/host';
import { GLOBAL_SCOPE } from '../core/constants';
import { sessionIdHash, unifiedSessionIdForCharacter } from '../core/util/text';
import { objectValue } from '../providers/tts/http';
import { listCharacters } from './characters';
import { ensureBotTtsCharacters } from '../storage/tts-store';
import { ttsBotScope } from '../storage/tts-roster';
import { voicedMessages } from '../domain/tts/excerpts';

export interface TtsChatContext {
  scope: string;
  /** Where this bot's TTS characters live: `bot:<characterId>` (or 'global'). */
  rosterScope: string;
  characterId: string;
  chatId: string;
  sessionId: string;
  character: Record<string, unknown>;
  chat: Record<string, unknown>;
  messages: Record<string, unknown>[];
}
/**
 * The bot as last read whole, its chats left out (only their ids kept): for at most BOT_MS after, the chat open is
 * read alone. The whole character carries every chat it has, megabytes in a long one, and the TTS reads the chat for
 * each message drawn anew (a streaming reply's every chunk) and each line played. A chat that is not one of its own
 * (another bot now in its place in Risu's list, a chat just made) reads it whole again.
 */
const BOT_MS = 10_000;
let bot: { index: number; at: number; character: Record<string, unknown>; chats: Set<string> } | null = null;
const chatKey = (chat: Record<string, unknown>) => String(chat.id || chat.chatId || '');
async function openChat(): Promise<{ character: Record<string, unknown>; chat: Record<string, unknown> }> {
  const host = risuHost()!;
  const lean = typeof host.getChatFromIndex === 'function' && typeof host.getCurrentCharacterIndex === 'function' && typeof host.getCurrentChatIndex === 'function';
  const [charIndex, chatIndex] = lean ? (await Promise.all([host.getCurrentCharacterIndex!(), host.getCurrentChatIndex!()]).catch(() => [NaN, NaN])).map(Number) : [NaN, NaN];
  const held = bot;
  if (held && held.index === charIndex && Number.isInteger(chatIndex) && Date.now() - held.at < BOT_MS) {
    const chat = objectValue(await (async () => host.getChatFromIndex!(charIndex, chatIndex))().catch(() => null));
    if (chatKey(chat) && held.chats.has(chatKey(chat))) return { character: { ...held.character, chats: [chat], chatPage: 0 }, chat };
  }
  const character = objectValue(await host.getCharacter!());
  const chats = Array.isArray(character.chats) ? character.chats : [];
  const chat = objectValue(chats[Number(character.chatPage) || 0]);
  if (Number.isInteger(charIndex)) {
    const { chats: _all, ...rest } = character;
    bot = { index: charIndex, at: Date.now(), character: rest, chats: new Set(chats.map(row => chatKey(objectValue(row))).filter(Boolean)) };
  }
  return { character, chat };
}
export async function currentTtsContext(): Promise<TtsChatContext> {
  const host = risuHost();
  if (!host?.getCharacter) throw new Error('현재 Risu 채팅을 읽을 수 없습니다.');
  const { character, chat } = await openChat();
  const characterId = String(character.chaId || character.id || ''), chatId = String(chat.id || chat.chatId || '');
  if (!characterId || !chatId) throw new Error('안정적인 ID가 있는 Risu 채팅을 먼저 열어 주세요.');
  await ensureBotTtsCharacters(characterId);
  return { scope: JSON.stringify([characterId, chatId]), rosterScope: ttsBotScope(characterId), characterId, chatId, sessionId: `risu_${sessionIdHash(`${characterId}|${chatId}`)}`, character, chat, messages: Array.isArray(chat.message) ? chat.message.map(objectValue) : [] };
}
/** `messages`: ids of the chat messages being voiced; their text goes along. */
export interface TtsSourceOptions { lore: boolean; persona: boolean; illustration: boolean; messages?: string[] }
export async function ttsCharacterSources(context: TtsChatContext, options: TtsSourceOptions, names: string[] = []): Promise<Record<string, unknown>> {
  const host = risuHost(), result: Record<string, unknown> = {};
  if (options.lore) {
    const raw: unknown = await host?.getCurrentLorebookEntries?.();
    const rows = Array.isArray(raw) ? raw.map(objectValue) : [];
    result.lore = rows.filter(row => {
      const name = String(row.comment || '');
      if (name.includes('omni.nexus.data') || name.startsWith('omni.nexus.tts') || name.includes('omnitts.data') || name === 'omnitts-cues') return false;
      if (!names.length) return true;
      const keys = String(row.key || '').split(',').map(k => k.trim()).filter(Boolean);
      return row.alwaysActive === true || keys.some(key => names.some(n => key.includes(n) || n.includes(key)));
    }).slice(0, 40).map(row => [String(row.comment || ''), String(row.content || '').slice(0, 4000)]);
  }
  if (options.persona && host?.getDatabase) {
    const db = objectValue(await host.getDatabase(['personas', 'selectedPersona']));
    const personas = Array.isArray(db.personas) ? db.personas.map(objectValue) : [];
    const selected = personas.find(p => p.id === db.selectedPersona) || personas[Number(db.selectedPersona)];
    if (selected) result.persona = [selected.name, String(selected.personaPrompt || '').slice(0, 6000)];
  }
  if (options.illustration) {
    const rows = [...await listCharacters(GLOBAL_SCOPE), ...await listCharacters(unifiedSessionIdForCharacter(context.characterId))];
    result.illustration = rows.filter(c => !names.length || names.some(n => c.name === n || c.aliases.includes(n))).slice(0, 100).map(c => [c.name, c.surname, c.given_name, c.aliases, c.gender, c.age]);
  }
  if (options.messages?.length) {
    const chat = voicedMessages(context.messages, options.messages);
    if (chat.length) result.chat = chat;
  }
  result.character = [String(context.character.name || ''), String(context.character.desc || '').slice(0, 6000)];
  return result;
}
