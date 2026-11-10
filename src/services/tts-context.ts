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
let held: { context: TtsChatContext; charIndex: number; chatIndex: number; whole: boolean } | null = null;
/**
 * Who the open bot is, from its last whole read. The chat's watchers read the context every time the chat screen
 * changes, and only the open chat can have changed for them: its bot, every other chat and message of it, was copied
 * over Risu's bridge each time. Read again when the open chat is one it did not have (another bot, a new chat) or
 * after a while, so an edited description reaches a voice pick late by this much at worst.
 */
const BOT_KEPT_MS = 300_000;
let kept: { host: unknown; charIndex: number; at: number; chats: Set<string>; character: Record<string, unknown> } | null = null;
/** A chunk of the reply streaming in (the frozen UI's output script hands each one here). */
export function noteStreamText(text: string): void {
  const now = Date.now();
  // A chunk after a pause (or after the end) starts another reply: a read held from the last one is not this one's.
  if (now - streamAt > STREAM_NEW_MS) { streamFrom = now; held = null; }
  streamText = String(text ?? ''); streamAt = now;
}
/** The reply ended (Risu's output event): what is read next is the saved chat. */
export function streamEnded(): void { streamAt = 0; held = null; }
/**
 * Risu's output event (services/chat-output.ts): the reply is saved, and the bot it carries, whole, is the one that
 * wrote it: who the open bot is is known from it with no read of its own.
 */
export function noteChatOutput(arg: { char?: unknown; characterIndex?: unknown } | null | undefined): void {
  streamEnded();
  const character = objectValue(arg?.char), charIndex = Number(arg?.characterIndex);
  if (!(character.chaId || character.id) || !Array.isArray(character.chats) || !Number.isInteger(charIndex) || charIndex < 0) return;
  kept = { host: risuHost(), charIndex, at: Date.now(), chats: new Set(character.chats.map(chat => String(objectValue(chat).id || objectValue(chat).chatId || ''))),
    character: { chaId: character.chaId, id: character.id, name: character.name, desc: character.desc } };
}
/** For tests: who the open bot is is forgotten. */
export function forgetOpenBot(): void { kept = null; }
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
async function heldWhileStreaming(chatOnly: boolean): Promise<TtsChatContext | null> {
  if (!held || !replyStreamingNow() || (!held.whole && !chatOnly)) return null;
  const read = held, [charIndex, chatIndex] = await openIndices();
  // Another chat opened meanwhile: that one is read.
  if (read !== held || charIndex !== read.charIndex || chatIndex !== read.chatIndex) return null;
  return withStreamText(read.context, streamText);
}

async function contextOf(character: Record<string, unknown>, chat: Record<string, unknown>): Promise<TtsChatContext> {
  const characterId = String(character.chaId || character.id || ''), chatId = String(chat.id || chat.chatId || '');
  if (!characterId || !chatId) throw new Error('안정적인 ID가 있는 Risu 채팅을 먼저 열어 주세요.');
  await ensureBotTtsCharacters(characterId);
  return { scope: JSON.stringify([characterId, chatId]), rosterScope: ttsBotScope(characterId), characterId, chatId, sessionId: `risu_${sessionIdHash(`${characterId}|${chatId}`)}`, character, chat, messages: Array.isArray(chat.message) ? chat.message.map(objectValue) : [] };
}
async function wholeBotRead(): Promise<TtsChatContext> {
  const host = risuHost();
  if (!host?.getCharacter) throw new Error('현재 Risu 채팅을 읽을 수 없습니다.');
  const [value, [charIndex]] = await Promise.all([host.getCharacter(), openIndices().catch((): [number, number] => [NaN, NaN])]);
  const character = objectValue(value);
  const chats = (Array.isArray(character.chats) ? character.chats : []).map(objectValue);
  // The bot's TTS characters are read from the bot (storage/tts-store): from this read of it, not a second one.
  const context = await holdBot(Number.isInteger(charIndex) ? botFrom(character, charIndex) : null, () => contextOf(character, chats[Number(character.chatPage) || 0] ?? {}));
  kept = Number.isInteger(charIndex) ? { host, charIndex, at: Date.now(), chats: new Set(chats.map(chat => String(chat.id || chat.chatId || ''))),
    character: { chaId: character.chaId, id: character.id, name: character.name, desc: character.desc } } : null;
  return context;
}
/** The open chat alone, under the bot as last read; null when that read does not answer for it. */
async function openChatRead(): Promise<TtsChatContext | null> {
  const host = risuHost(), bot = kept;
  if (!bot || bot.host !== host || Date.now() - bot.at > BOT_KEPT_MS || typeof host?.getChatFromIndex !== 'function') return null;
  const [charIndex, chatIndex] = await openIndices();
  if (charIndex !== bot.charIndex || !Number.isInteger(chatIndex) || chatIndex < 0) return null;
  const chat = objectValue(await host.getChatFromIndex(charIndex, chatIndex));
  return bot.chats.has(String(chat.id || chat.chatId || '')) ? contextOf(bot.character, chat) : null;
}
/**
 * The chat open in Risu. `chatOnly`: for those who read its messages and need to know only who the bot is; its
 * `character` then holds no more than that, its name and its description.
 */
// `bot`: the bot itself is wanted, as without `chatOnly` (a whole read).
export async function currentTtsContext(options: { chatOnly?: boolean; bot?: boolean } = {}): Promise<TtsChatContext> {
  const chatOnly = options.chatOnly === true;
  const reused = await heldWhileStreaming(chatOnly).catch(() => null);
  if (reused) return reused;
  const startedAt = Date.now(), from = streamFrom;
  const light = chatOnly ? await openChatRead().catch(() => null) : null;
  const context = light ?? await wholeBotRead();
  // Read after this reply's first chunk (its message is in the chat by then) while Risu still streams it: held.
  if (replyStreamingNow() && from === streamFrom && startedAt >= streamFrom && context.chat.isStreaming === true && context.messages.at(-1)?.role === 'char') {
    const [charIndex, chatIndex] = await openIndices().catch((): [number, number] => [NaN, NaN]);
    if (Number.isInteger(charIndex) && Number.isInteger(chatIndex) && from === streamFrom && streamAt > 0) held = { context, charIndex, chatIndex, whole: !light };
  }
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
  result.character = [String(context.character.name || ''), String(context.character.desc || '').slice(0, 6000)];
  return result;
}
