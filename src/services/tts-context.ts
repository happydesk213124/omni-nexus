import { risuHost } from '../core/host';
import { GLOBAL_SCOPE } from '../core/constants';
import { sessionIdHash, unifiedSessionIdForCharacter } from '../core/util/text';
import { objectValue } from '../providers/tts/http';
import { listCharacters } from './characters';
import { ensureBotTtsCharacters } from '../storage/tts-store';
import { botFrom, holdBot } from '../storage/current-bot';
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
 * A reply streaming in. A read of the context is the whole bot copied over Risu's bridge (every chat of it, every
 * message), and the chat's watchers read it on each chunk: a long chat lagged while a reply streamed, a short one
 * did not. While one streams, the read made during it stands, its last message the text Risu just gave its output
 * scripts (what 옴니 뷰어 follows too); its end (Risu's output event, or no chunk for a while) reads the chat again.
 */
const STREAM_QUIET_MS = 1500, STREAM_NEW_MS = 4000;
let streamText = '', streamAt = 0, streamFrom = 0;
let held: { context: TtsChatContext; charIndex: number; chatIndex: number } | null = null;
/** A chunk of the reply streaming in (the frozen UI's output script hands each one here). */
export function noteStreamText(text: string): void {
  const now = Date.now();
  // A chunk after a pause (or after the end) starts another reply: a read held from the last one is not this one's.
  if (now - streamAt > STREAM_NEW_MS) { streamFrom = now; held = null; }
  streamText = String(text ?? ''); streamAt = now;
}
/** The reply ended (Risu's output event): what is read next is the saved chat. */
export function streamEnded(): void { streamAt = 0; held = null; }
/** A chunk came a moment ago. */
export function replyStreamingNow(): boolean { return streamAt > 0 && Date.now() - streamAt < STREAM_QUIET_MS; }

async function openIndices(): Promise<[number, number]> {
  const host = risuHost();
  if (!host?.getCurrentCharacterIndex || !host.getCurrentChatIndex) return [NaN, NaN];
  const [charIndex, chatIndex] = await Promise.all([host.getCurrentCharacterIndex(), host.getCurrentChatIndex()]);
  return [Number(charIndex), Number(chatIndex)];
}
/** The held read, its streaming message now the text that came last (copies: the held one stays as read). */
function withStreamText(context: TtsChatContext, text: string): TtsChatContext {
  const messages = context.messages.slice(), last = messages.length - 1;
  messages[last] = { ...messages[last], data: text };
  const raw = Array.isArray(context.chat.message) ? context.chat.message.slice() : [];
  if (raw.length) raw[raw.length - 1] = { ...objectValue(raw[raw.length - 1]), data: text };
  return { ...context, chat: { ...context.chat, message: raw }, messages };
}
async function heldWhileStreaming(): Promise<TtsChatContext | null> {
  if (!held || !replyStreamingNow()) return null;
  const read = held, [charIndex, chatIndex] = await openIndices();
  // Another chat opened meanwhile: that one is read.
  if (read !== held || charIndex !== read.charIndex || chatIndex !== read.chatIndex) return null;
  return withStreamText(read.context, streamText);
}

/**
 * Who the bot open in Risu is, from one read of it: its id, its name, and the ids of its chats.
 *
 * A read of the context was the whole bot every time (`getCharacter`: every chat it has, every message), and the
 * chat is read often: by the TTS scan after each scroll, by a tap on 🟪 or a pink slot, by the windows that list its
 * lines. With the bot known, the open chat alone is asked for (`getChatFromIndex`), and the chat's own id says the
 * bot at that place in Risu's list is still this one. A chat it has not heard of (a new chat, another bot now at
 * that place) is answered by a whole read again, as is anyone who needs the bot itself (`bot: true`). Risu's output
 * event carries the bot, so each reply tells who is open at no cost; nothing learned is trusted for more than
 * ten minutes.
 */
const KNOWN_MS = 600_000;
let known: { index: number; id: string; character: Record<string, unknown>; chats: Set<string>; at: number } | null = null;
function learn(character: Record<string, unknown>, index: number): void {
  const id = String(character.chaId || character.id || '');
  if (!id || !Number.isInteger(index) || index < 0) { known = null; return; }
  const chats = new Set<string>();
  for (const row of Array.isArray(character.chats) ? character.chats : []) { const chatId = String(objectValue(row).id || objectValue(row).chatId || ''); if (chatId) chats.add(chatId); }
  // Its name goes along; its chats, lore and assets do not (they would be as old as this read).
  known = { index, id, character: { chaId: character.chaId, id: character.id, name: character.name }, chats, at: Date.now() };
}
/** Risu's output event: the reply is saved (the next read is of the saved chat), and the bot it carries is who generated it. */
export function noteChatOutput(arg: { char?: unknown; characterIndex?: unknown } | null | undefined): void {
  streamEnded();
  const character = objectValue(arg?.char);
  if (character.chaId || character.id) learn(character, Number(arg?.characterIndex));
}
/** For tests: what was learned of the open bot is forgotten. */
export function forgetOpenBot(): void { known = null; }

function contextOf(character: Record<string, unknown>, characterId: string, chat: Record<string, unknown>, chatId: string): TtsChatContext {
  return { scope: JSON.stringify([characterId, chatId]), rosterScope: ttsBotScope(characterId), characterId, chatId, sessionId: `risu_${sessionIdHash(`${characterId}|${chatId}`)}`, character, chat, messages: Array.isArray(chat.message) ? chat.message.map(objectValue) : [] };
}
/** The open chat alone, when the bot it belongs to is the one known; null when a whole read must answer. */
async function openChatOnly(): Promise<{ context: TtsChatContext; charIndex: number; chatIndex: number } | null> {
  const host = risuHost(), bot = known;
  if (!bot || Date.now() - bot.at > KNOWN_MS || typeof host?.getChatFromIndex !== 'function') return null;
  const [charIndex, chatIndex] = await openIndices();
  if (charIndex !== bot.index || !Number.isInteger(chatIndex) || chatIndex < 0) return null;
  const chat = objectValue(await host.getChatFromIndex(charIndex, chatIndex)), chatId = String(chat.id || chat.chatId || '');
  if (known !== bot || !chatId || !bot.chats.has(chatId)) return null;
  return { context: contextOf(bot.character, bot.id, chat, chatId), charIndex, chatIndex };
}

/** `bot`: the character itself is wanted (its assets, its other chats), not only who it is: always a whole read. */
export async function currentTtsContext(want: { bot?: boolean } = {}): Promise<TtsChatContext> {
  const whole = (context: TtsChatContext) => Array.isArray(context.character.chats);
  const reused = await heldWhileStreaming().catch(() => null);
  if (reused && (!want.bot || whole(reused))) return reused;
  const host = risuHost();
  if (!host?.getCharacter) throw new Error('현재 Risu 채팅을 읽을 수 없습니다.');
  const startedAt = Date.now(), from = streamFrom;
  let open = want.bot ? null : await openChatOnly().catch(() => null);
  if (!open) {
    const character = objectValue(await host.getCharacter());
    const chats = Array.isArray(character.chats) ? character.chats : [];
    const chat = objectValue(chats[Number(character.chatPage) || 0]);
    const characterId = String(character.chaId || character.id || ''), chatId = String(chat.id || chat.chatId || '');
    if (!characterId || !chatId) throw new Error('안정적인 ID가 있는 Risu 채팅을 먼저 열어 주세요.');
    const [charIndex, chatIndex] = await openIndices().catch((): [number, number] => [NaN, NaN]);
    // Its place in Risu's list was asked after the read: learned only when the chat read is the one open there.
    if (Number.isInteger(charIndex) && chatIndex === (Number(character.chatPage) || 0)) learn(character, charIndex);
    open = { context: contextOf(character, characterId, chat, chatId), charIndex, chatIndex };
  }
  const { context, charIndex, chatIndex } = open;
  // The bot's TTS characters are read from the bot once (storage/tts-store): from this read of it, when it is one.
  await holdBot(whole(context) ? botFrom(context.character, charIndex) : null, () => ensureBotTtsCharacters(context.characterId));
  // Read after this reply's first chunk (its message is in the chat by then) while Risu still streams it: held.
  if (replyStreamingNow() && from === streamFrom && startedAt >= streamFrom && context.chat.isStreaming === true && context.messages.at(-1)?.role === 'char'
    && Number.isInteger(charIndex) && Number.isInteger(chatIndex) && streamAt > 0) held = { context, charIndex, chatIndex };
  return context;
}
/** `messages`: ids of the chat messages being voiced; their text goes along. */
export interface TtsSourceOptions { lore: boolean; persona: boolean; illustration: boolean; messages?: string[] }
/** What JEV reads about the people it picks for. Only JEV takes sources: the other engines answer from name and tags. */
export function voicePickSources(engine: string, context: TtsChatContext, names: string[], messages: string[] = []): Promise<Record<string, unknown> | undefined> {
  return engine === 'jev' ? ttsCharacterSources(context, { lore: true, persona: true, illustration: true, messages }, names) : Promise.resolve(undefined);
}
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
  // The context may know the bot by name only (currentTtsContext): its description is read here, when asked for.
  const character = 'desc' in context.character ? context.character : objectValue(await Promise.resolve(host?.getCharacter?.()).catch(() => null));
  result.character = [String(character.name || context.character.name || ''), String(character.desc || '').slice(0, 6000)];
  return result;
}
