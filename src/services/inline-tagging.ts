import type { CharacterRecord } from '../core/types';
import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import { cleanText, sessionIdHash, stripCbs, writeSessionId } from '../core/util/text';
import { characterTriggers } from '../domain/character/roster';
import { ensureCostumes } from '../domain/character/costume';
import { characterHasAppearance, formatWearStateForPrompt } from '../domain/character/tags';
import { comicGenOn } from '../domain/comic/kind';
import { effectiveComicLlmBatch } from '../domain/comic/params';
import { formatPrevLocationLine } from '../domain/tagging/location';
import { castInTexts, orderCast } from '../domain/tagging/recent-cast';
import { authorNoteSystemContent } from '../domain/tagging/session-note';
import { isOwnLlmRequest } from '../providers/llm/own-requests';
import { auditCues, lastCueAudit } from './cue-audit';
import { loadTaggerRoster } from './characters';
import { getConfig } from './context';
import { getPrompt } from './settings';
import { chatNoteSessionId, getSessionAuthorNote, rememberRecentCast, rosterWithSessionOutfits, sessionAuthorNoteLlmContent, sessionRecentCast } from './session-author-note';
import { taggerRules } from './tagger';

/**
 * Streaming tag generation (생성 옵션 → "Risu 메인 모델 메시지 스트리밍 중에 태그 생성").
 * The chat model writes `[[inxN]]{shot}[[/inxN]]` into its reply; this module
 * gives it the rules. Two parts, placed for prompt caching:
 *  - the rules, fixed until settings or prompts change, right after the first
 *    message (ahead of everything that varies per turn);
 *  - this chat's registered people (most recently named first, with their
 *    costumes and what they wear now) and previous place, before the last user turn.
 * Character descriptions and story lorebooks are not repeated: Risu already sends them.
 */
export const INLINE_RULES_MARK = '# Omni Nexus · image shots in your reply';
export const INLINE_STATE_MARK = '# Omni Nexus · image state for this chat';
// The people most recently named in this chat; the rest are far less likely in the next reply.
const ROSTER_LIMIT = 20;
// Replies read each turn for who was just named. Older ones live on in the remembered order.
const RECENT_REPLIES = 2;
// How long a chat request may wait for this chat's roster before going without it.
const STATE_BUDGET_MS = 2500;

export function inlineTagsOn(): boolean {
  const card = getConfig().card;
  return card?.stream_inline_tags === true && card.power !== false;
}

function imageRange(): { min: number; max: number } {
  const card = getConfig().card;
  const min = Math.max(1, Number(card.image_min ?? 1) || 1);
  return { min, max: Math.max(min, Number(card.image_max ?? 3) || 3) };
}

function blockRules(min: number, max: number): string {
  const count = min === max ? `exactly ${max}` : `between ${min} and ${max}`;
  return [
    INLINE_RULES_MARK,
    'Write your reply exactly as you normally would. Also mark its illustrations for the Omni Nexus image generator:',
    `- Where an image belongs, put one block on its own line, directly after the line it shows: [[inx1]]{...}[[/inx1]]. Number the blocks 1, 2, 3… in each reply. Write ${count} blocks per reply, at its most visual moments.`,
    '- Each block holds ONE shot as one raw JSON object: the fields of one scenes[].shots[] item from the format below, plus "place" (that shot\'s place tags). No "line" or "paragraph": the block\'s position is the image position.',
    '- A person who is new, or listed below as missing looks, gets "new_characters" (and "new_costumes" when costumes are on) inside the first block that shows them, in the format below. Registered people keep their exact names.',
    '- Double-quoted JSON only inside the block: no markdown, no comments. Never put a block inside dialogue quotes, code, a status panel or thinking. Never mention or explain the blocks; the story stays exactly as it would be without them.',
    'The rules below were written for a separate tagging step that returns one JSON object for a numbered message. Here they only describe what goes inside each block; anything about returning a single object, L numbers, line or paragraph does not apply.',
  ].join('\n');
}

/** The fixed part. Same settings and prompts give the same text, byte for byte. */
export async function inlineTagRules(): Promise<string> {
  const card = getConfig().card;
  const { min, max } = imageRange();
  const withMain = comicGenOn(card) && effectiveComicLlmBatch(card) === 'with_main';
  const comicNote = withMain ? cleanText(card.comic_author_note, 8000) : '';
  return [
    blockRules(min, max),
    await taggerRules(card, { imageMin: min, imageMax: max, inline: true }),
    authorNoteSystemContent("Global Author's Note", await getPrompt('global_author_note')),
    authorNoteSystemContent("Author's Note", await getPrompt('author_note')),
    comicNote ? `# Priority: Comic author's note\n${comicNote}\nIf this conflicts with earlier rules, follow this note (except never emit comic/manga/hatching/thick outlines). Put the page on comic_page, not on the shot root.` : '',
  ].filter(Boolean).map(part => stripCbs(part)).join('\n\n');
}

export interface InlineScope { sessionId?: unknown; characterId?: unknown; chatId?: unknown; recent?: unknown }

function rosterLine(char: CharacterRecord, withCostumes: boolean): string {
  const aliases = characterTriggers(char).filter(name => name !== char.name).slice(0, 6);
  const head = `- ${cleanText(char.name, 120)}${aliases.length ? ` (also: ${aliases.join(', ')})` : ''}`;
  if (!characterHasAppearance(char)) return `${head} — looks missing: give full looks in new_characters`;
  const { costumes, active_costume } = ensureCostumes(char);
  const worn = costumes[active_costume];
  // Names and notes only: the generator fills in the saved looks, the model only has to pick one.
  const catalog = withCostumes ? costumes.map((c, i) => [`${c.name}[${i}]`, cleanText(c.note, 60)].filter(Boolean).join(' ')).join('; ') : '';
  return [`${head} — looks saved`, catalog ? `costumes: ${catalog}` : '',
    withCostumes && worn ? `wearing ${worn.name}[${active_costume}]` : '', `wear_state=${formatWearStateForPrompt(char.wear_state)}`].filter(Boolean).join(' | ');
}

/** The varying part for one chat: who is registered (most recently named first), where the last image was, this chat's note. */
export async function inlineTagState(scope: InlineScope): Promise<string> {
  const characterId = cleanText(scope.characterId, 200), chatId = cleanText(scope.chatId, 200);
  const sessionId = writeSessionId({ sessionId: scope.sessionId, characterId });
  if (!sessionId) return '';
  const noteId = chatNoteSessionId(sessionId, { character_id: characterId, chat_id: chatId });
  let roster = await loadTaggerRoster({ sessionId, unifiedSessionId: sessionId, characterId });
  const note = noteId ? await getSessionAuthorNote(noteId).catch(() => null) : null;
  if (note) roster = rosterWithSessionOutfits(roster, note);
  roster = roster.filter(char => cleanText(char.name, 200));
  const recent = Array.isArray(scope.recent) ? scope.recent.map(text => String(text ?? '')) : [];
  if (noteId) {
    const order = orderCast(roster, castInTexts(recent, roster), await sessionRecentCast(noteId));
    rememberRecentCast(noteId, order.map(char => cleanText(char.id || char.name, 200)));
    roster = order;
  }
  const withCostumes = getConfig().card?.costume === true;
  const people = roster.slice(0, ROSTER_LIMIT).map(char => rosterLine(char, withCostumes));
  const location = formatPrevLocationLine((note as { location?: unknown } | null)?.location ?? '');
  const sessionNote = noteId ? await sessionAuthorNoteLlmContent(noteId) : '';
  if (!people.length && !location && !sessionNote) return '';
  return [
    INLINE_STATE_MARK,
    people.length ? `Registered characters, most recently in the story first (reuse these exact names in "characters"; never repeat a saved one in new_characters; pick a listed costume instead of registering the same look again):\n${people.join('\n')}` : '',
    location,
    sessionNote,
  ].filter(Boolean).join('\n\n');
}

/** The chat open in Risu now, with its last replies (newest first). */
async function liveScope(): Promise<InlineScope | null> {
  const host = risuHost();
  if (!host?.getCurrentCharacterIndex || !host.getCharacterFromIndex) return null;
  const charIndex = Number(await host.getCurrentCharacterIndex());
  const character = await host.getCharacterFromIndex(charIndex) as { chaId?: unknown; id?: unknown; chatPage?: unknown; chats?: unknown } | null;
  const chats = Array.isArray(character?.chats) ? character!.chats as Array<{ id?: unknown; chatId?: unknown; message?: unknown }> : [];
  const chatIndex = Number(typeof host.getCurrentChatIndex === 'function' ? await host.getCurrentChatIndex() : character?.chatPage) || 0;
  const chat = chats[chatIndex];
  const characterId = cleanText(character?.chaId || character?.id, 200), chatId = cleanText(chat?.id || chat?.chatId, 200);
  if (!characterId || !chatId) return null;
  const messages = Array.isArray(chat?.message) ? chat!.message as Array<{ role?: unknown; data?: unknown }> : [];
  const recent = messages.filter(m => m?.role === 'char').slice(-RECENT_REPLIES).reverse().map(m => String(m.data ?? ''));
  return { sessionId: `risu_${sessionIdHash(`${characterId}|${chatId}`)}`, characterId, chatId, recent };
}

let lastScope: InlineScope | null = null;
let state = { key: '', text: '' };
let refreshing: Promise<void> | null = null;
const scopeKey = (scope: InlineScope) => JSON.stringify([cleanText(scope.sessionId, 200), cleanText(scope.characterId, 200), cleanText(scope.chatId, 200)]);

/**
 * Rebuilds the chat state, for the given chat or (null) the one open in Risu.
 * Every chat request waits for it within a budget, so it is read fresh each turn.
 */
export function refreshInlineTagState(scope: InlineScope | null = lastScope): Promise<void> {
  if (!inlineTagsOn()) return Promise.resolve();
  const task = (refreshing ?? Promise.resolve()).catch(() => {}).then(async () => {
    const target = scope ?? await liveScope().catch(error => { dbg('inline-tags.chat', { message: String(error) }, 'warn'); return null; });
    if (!target) return;
    lastScope = target;
    const key = scopeKey(target);
    const text = await inlineTagState(target).catch(error => { dbg('inline-tags.state', { message: String(error) }, 'warn'); return ''; });
    if (lastScope && scopeKey(lastScope) === key) state = { key, text };
  });
  refreshing = task;
  void task.finally(() => { if (refreshing === task) refreshing = null; });
  return task;
}

/** Pure placement: rules after the first message, state before the last user turn. */
export function placeInlineTagPrompts(messages: OpenAIChat[], rules: string, stateText: string): OpenAIChat[] {
  if (!rules || messages.some(row => typeof row?.content === 'string' && row.content.startsWith(INLINE_RULES_MARK))) return messages;
  const out = [...messages];
  out.splice(Math.min(1, out.length), 0, { role: 'system', content: rules });
  if (stateText) {
    let last = -1;
    for (let i = out.length - 1; i >= 0; i--) if (out[i]!.role === 'user') { last = i; break; }
    out.splice(last >= 0 ? last : out.length, 0, { role: 'system', content: stateText });
  }
  return out;
}

/**
 * What the settings row shows under the switch: whether Risu accepted the hook,
 * and what the last request it called us for got. Without it a refused
 * permission and a skipped request look the same: nothing in the prompt.
 */
export interface InlineTagStatus { registered: 'yes' | 'no' | 'pending'; lastAt: number; last: string }
const status: InlineTagStatus = { registered: 'pending', lastAt: 0, last: '' };
export const inlineTagStatus = (): InlineTagStatus => ({ ...status });
function noteRequest(text: string): void {
  status.lastAt = Date.now(); status.last = text;
  dbg('inline-tags.request', { message: text });
}

// Original Risu keeps a plugin's request hooks across a plugin reload (it clears
// providers and edit hooks, not replacers), so an earlier instance of this plugin
// may still be called. Once unloaded it must step aside.
let disposed = false;
// Settings load lazily (the UI's first request boots the bridge). A chat request
// can come first; it must not read the defaults as the user's switch.
let settingsReady: () => Promise<unknown> = async () => {};

async function beforeRequest(messages: OpenAIChat[], mode: string): Promise<OpenAIChat[]> {
  try {
    if (disposed) return messages;
    await settingsReady().catch(() => {});
    // The only hook that sees the chat model's prompt: also note which of our instructions made it in.
    if (mode === 'model' && Array.isArray(messages) && !isOwnLlmRequest(messages)) auditCues(messages);
    if (!inlineTagsOn()) {
      if (mode === 'model') noteRequest(getConfig().card?.power === false ? 'off · power' : `off · switch (${String(getConfig().card?.stream_inline_tags)})`);
      return messages;
    }
    // Only the chat model's own reply; never our tagger borrowing that model.
    const skip = mode !== 'model' ? `mode ${mode}` : !Array.isArray(messages) || !messages.length ? 'no messages' : isOwnLlmRequest(messages) ? 'own tagger call' : '';
    // A provider plugin that rebuilds the prompt from its own preset, or the
    // bot's own request trigger, can still drop what was inserted here.
    if (skip) { if (mode === 'model') noteRequest(`skipped · ${skip}`); return messages; }
    // Read this chat now: who is registered changes with every reply's blocks, and
    // the user may have switched chats. A slow host sends the rules without the state.
    const live = await Promise.race([refreshInlineTagState(null).then(() => true), new Promise<false>(r => setTimeout(() => r(false), STATE_BUDGET_MS))]);
    const rules = await inlineTagRules(), stateText = live && lastScope && state.key === scopeKey(lastScope) ? state.text : '';
    const placed = placeInlineTagPrompts(messages, rules, stateText);
    noteRequest(placed === messages ? 'already present' : `inserted · rules ${rules.length} chars, chat state ${stateText.length} chars${live ? '' : ' (chat not read in time)'}`);
    return placed;
  } catch (error) {
    dbg('inline-tags.request', { message: String((error as Error)?.message || error) }, 'warn');
    return messages;
  }
}

let installed = false;
export async function installInlineTags(opts: { ready?: () => Promise<unknown> } = {}): Promise<void> {
  if (installed) return;
  installed = true;
  if (opts.ready) settingsReady = opts.ready;
  Reflect.set(globalThis, '__OMNI_INLINE_TAGS__', { scope: (scope: InlineScope) => { void refreshInlineTagState(scope); }, status: inlineTagStatus, cues: lastCueAudit });
  const host = risuHost();
  if (typeof host?.addRisuReplacer !== 'function') { status.registered = 'no'; dbg('inline-tags.replacer', { message: 'unavailable on this Risu' }, 'warn'); return; }
  // Risu asks for the 'replacer' permission here; a refusal registers nothing and
  // says nothing. The call itself resolving is all we can observe.
  try { await host.addRisuReplacer('beforeRequest', beforeRequest); status.registered = 'yes'; }
  catch (error) { status.registered = 'no'; throw error; }
  if (typeof host.onUnload === 'function') await host.onUnload(() => { disposed = true; void Promise.resolve(host.removeRisuReplacer?.('beforeRequest', beforeRequest)).catch(() => {}); });
  dbg('inline-tags.replacer', { message: 'registered' });
}
