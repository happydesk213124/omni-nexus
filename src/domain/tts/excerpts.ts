/**
 * The chat messages a voice is being chosen for, as the evidence for its speaker.
 *
 * A speaker with no lorebook entry is otherwise known only by name, so gender,
 * age and delivery were guesses. The message whose lines are about to be read
 * shows how they talk. Only those messages go (the ones being voiced), each
 * capped, never the rest of the chat, and never our own tokens, blocks or markup.
 */
export const MESSAGE_LIMITS = { messages: 3, chars: 8000 };

/** Reply text as a reader sees it: no image tokens, streaming-tag blocks, HTML or CBS. */
export function excerptText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\[\[(inxw?\d{1,3})\]\][\s\S]*?\[\[\/\1\]\]/g, '')
    .replace(/\[\[[^\]\n]{0,4096}\]\]/g, '')
    .replace(/\{\{[^}\n]{0,512}\}\}/g, '')
    .replace(/<[^>\n]{0,2048}>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Those messages' text, in chat order, found by the id a TTS request carries. */
export function voicedMessages(messages: readonly Record<string, unknown>[], ids: readonly string[], limits = MESSAGE_LIMITS): string[] {
  const wanted = new Set(ids.map(String).filter(Boolean));
  if (!wanted.size) return [];
  return messages
    .filter(message => wanted.has(String(message.chatId || message.id || '')))
    .slice(-limits.messages)
    .map(message => excerptText(message.data ?? message.content).slice(0, limits.chars))
    .filter(Boolean);
}
