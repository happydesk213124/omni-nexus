/**
 * Our TTS, BGM and effect instructions ride in module lorebooks, and Risu keeps
 * lorebook entries only up to its token budget, shared by the character, chat and
 * module entries (highest insertorder first; ours are 999, 998, 997). Looking at
 * what the chat model's last request carried is the only way to tell a dropped
 * instruction from a model that ignores it.
 */
export interface CueAudit { at: number; tts: boolean; bgm: boolean; sfx: boolean }
let last: CueAudit | null = null;

export function auditCues(messages: ReadonlyArray<{ content?: unknown } | null | undefined>): void {
  const text = messages.map(row => typeof row?.content === 'string' ? row.content : JSON.stringify(row?.content ?? '')).join('\n');
  last = { at: Date.now(), tts: text.includes('<OmniTTS>'), bgm: text.includes('<OmniBGM>'), sfx: text.includes('<OmniSFX>') };
}
export const lastCueAudit = (): CueAudit | null => last && { ...last };
