import type { CharacterRecord } from '../core/types';
import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import { cleanText, stripCbs, writeSessionId } from '../core/util/text';
import { characterTriggers } from '../domain/character/roster';
import { characterHasAppearance } from '../domain/character/tags';
import { comicGenOn } from '../domain/comic/kind';
import { effectiveComicLlmBatch } from '../domain/comic/params';
import { formatPrevLocationLine } from '../domain/tagging/location';
import { authorNoteSystemContent } from '../domain/tagging/session-note';
import { isOwnLlmRequest } from '../providers/llm/own-requests';
import { loadTaggerRoster } from './characters';
import { getConfig } from './context';
import { getPrompt } from './settings';
import { chatNoteSessionId, getSessionAuthorNote, rosterWithSessionOutfits, sessionAuthorNoteLlmContent } from './session-author-note';
import { taggerRules } from './tagger';

/**
 * Streaming tag generation (생성 옵션 → "Risu 메인 모델 메시지 스트리밍 중에 태그 생성").
 * The chat model writes `[[inxN]]{shot}[[/inxN]]` into its reply; this module
 * gives it the rules. Two parts, placed for prompt caching:
 *  - the rules, fixed until settings or prompts change, right after the first
 *    message (ahead of everything that varies per turn);
 *  - this chat's registered people and previous place, before the last user turn.
 * Character descriptions and story lorebooks are not repeated: Risu already sends them.
 */
export const INLINE_RULES_MARK = '# Omni Nexus · image shots in your reply';
export const INLINE_STATE_MARK = '# Omni Nexus · image state for this chat';
const ROSTER_LIMIT = 40;

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

export interface InlineScope { sessionId?: unknown; characterId?: unknown; chatId?: unknown }

function rosterLine(char: CharacterRecord): string {
  const aliases = characterTriggers(char).filter(name => name !== char.name).slice(0, 6);
  const costume = cleanText(char.active_costume, 80);
  return `- ${cleanText(char.name, 120)}${aliases.length ? ` (also: ${aliases.join(', ')})` : ''} — ${characterHasAppearance(char)
    ? `looks saved${costume && costume !== 'default' ? `, wearing ${costume}` : ''}`
    : 'looks missing: give full looks in new_characters'}`;
}

/** The varying part for one chat: who is registered, where the last image was, this chat's note. */
export async function inlineTagState(scope: InlineScope): Promise<string> {
  const characterId = cleanText(scope.characterId, 200), chatId = cleanText(scope.chatId, 200);
  const sessionId = writeSessionId({ sessionId: scope.sessionId, characterId });
  if (!sessionId) return '';
  const noteId = chatNoteSessionId(sessionId, { character_id: characterId, chat_id: chatId });
  let roster = await loadTaggerRoster({ sessionId, unifiedSessionId: sessionId, characterId });
  const note = noteId ? await getSessionAuthorNote(noteId).catch(() => null) : null;
  if (note) roster = rosterWithSessionOutfits(roster, note);
  const people = roster.filter(char => cleanText(char.name, 200)).slice(0, ROSTER_LIMIT).map(rosterLine);
  const location = formatPrevLocationLine((note as { location?: unknown } | null)?.location ?? '');
  const sessionNote = noteId ? await sessionAuthorNoteLlmContent(noteId) : '';
  if (!people.length && !location && !sessionNote) return '';
  return [
    INLINE_STATE_MARK,
    people.length ? `Registered characters (reuse these exact names in "characters"; never repeat a saved one in new_characters):\n${people.join('\n')}` : '',
    location,
    sessionNote,
  ].filter(Boolean).join('\n\n');
}

let lastScope: InlineScope | null = null;
let state = { key: '', text: '' };
let refreshing: Promise<void> | null = null;
const scopeKey = (scope: InlineScope) => JSON.stringify([cleanText(scope.sessionId, 200), cleanText(scope.characterId, 200), cleanText(scope.chatId, 200)]);

/**
 * Called whenever the UI knows the live chat. The request hook only reads the
 * cached text: it must never ask the host anything (a slow bridge would hold
 * every chat request).
 */
export function refreshInlineTagState(scope: InlineScope | null = lastScope): Promise<void> {
  if (!scope || !inlineTagsOn()) return Promise.resolve();
  lastScope = scope;
  const key = scopeKey(scope);
  const task = (refreshing ?? Promise.resolve()).catch(() => {}).then(async () => {
    const text = await inlineTagState(scope).catch(error => { dbg('inline-tags.state', { message: String(error) }, 'warn'); return ''; });
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

async function beforeRequest(messages: OpenAIChat[], mode: string): Promise<OpenAIChat[]> {
  try {
    if (!inlineTagsOn()) return messages;
    // Only the chat model's own reply; never our tagger borrowing that model.
    const skip = mode !== 'model' ? `mode ${mode}` : !Array.isArray(messages) || !messages.length ? 'no messages' : isOwnLlmRequest(messages) ? 'own tagger call' : '';
    // Shown in 디버그: whether Risu called us at all, and what was sent. A provider
    // plugin that rebuilds the prompt from its own preset can still drop it later.
    if (skip) { dbg('inline-tags.request', { message: `skipped · ${skip}` }); return messages; }
    const rules = await inlineTagRules(), stateText = lastScope && state.key === scopeKey(lastScope) ? state.text : '';
    const placed = placeInlineTagPrompts(messages, rules, stateText);
    dbg('inline-tags.request', { message: placed === messages ? 'already present' : `inserted · rules ${rules.length} chars after message 1, chat state ${stateText.length} chars`, msgs: placed.length });
    // People registered by this reply's blocks show up from the next request on.
    void refreshInlineTagState();
    return placed;
  } catch (error) {
    dbg('inline-tags.request', { message: String((error as Error)?.message || error) }, 'warn');
    return messages;
  }
}

let installed = false;
export async function installInlineTags(): Promise<void> {
  if (installed) return;
  installed = true;
  Reflect.set(globalThis, '__OMNI_INLINE_TAGS__', { scope: (scope: InlineScope) => { void refreshInlineTagState(scope); } });
  const host = risuHost();
  if (typeof host?.addRisuReplacer !== 'function') { dbg('inline-tags.replacer', { message: 'unavailable on this Risu' }, 'warn'); return; }
  // Risu asks for the 'replacer' permission here; a refusal registers nothing, silently.
  await host.addRisuReplacer('beforeRequest', beforeRequest);
  dbg('inline-tags.replacer', { message: 'registered' });
}
