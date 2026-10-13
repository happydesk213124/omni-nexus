// Mirrors the shot-tag editor's speech tail (src/tag-studio/peel.ts): the bubble
// sits at the end of the character caption and may itself contain commas.
const SPEECH_TAIL = /(?:speechbubble|speech bubble|thought bubble|narration box)?\s*,?\s*(?:korean|english|japanese)\s+text\s*:\s*([\s\S]+)$/i;

/** The line a character says in an illustration prompt, without NAI weighting. */
export function illustrationSpeech(prompt: string): string {
  const match = SPEECH_TAIL.exec(prompt);
  if (!match) return '';
  return match[1]!.replace(/\s*::\s*$/, '').replace(/^[{[(\s]+|[}\])\s]+$/g, '').trim();
}
