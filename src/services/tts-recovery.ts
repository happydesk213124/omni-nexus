import type { TtsCharacter, TtsSettings } from '../core/tts-types';
import { fishVoiceId } from '../domain/tts/library';
import { selectTtsVoices } from '../providers/tts/selection';
import { saveTtsData, ttsData } from '../storage/tts-store';

export async function recordTtsVoiceError(fishId: string, status: number): Promise<void> {
  const voices = ttsData().voices.filter(voice => fishVoiceId(voice.fishId) === fishVoiceId(fishId));
  if (!voices.length) return;
  const lastAt = Date.now();
  for (const voice of voices) voice.error = { count: (voice.error?.count || 0) + 1, lastAt, status };
  await saveTtsData();
  if (typeof document !== 'undefined') document.dispatchEvent(new Event('omnitts-library'));
}

interface Replacement { fishId: string; character: string }
interface Pending { promise: Promise<Replacement | undefined>; listeners: Set<() => boolean> }

/** Several prefetched lines for one character must share one paid recommendation. */
export class TtsVoiceRecovery {
  private pending = new Map<string, Pending>();
  private completed = new Map<string, Replacement>();

  async select(character: TtsCharacter, failedId: string, settings: TtsSettings, current: () => boolean): Promise<string | undefined> {
    if (character.fixed || !current()) return;
    const snapshot = JSON.stringify(character), settingsSnapshot = JSON.stringify(settings);
    const key = JSON.stringify([snapshot, failedId, settingsSnapshot]);
    const validSettings = () => ttsData().settings.enabled && JSON.stringify(ttsData().settings) === settingsSnapshot;
    const latest = () => ttsData().characters.find(row => row.id === character.id && row.scope === character.scope);
    let replacement = this.completed.get(key);
    if (!replacement) {
      let task = this.pending.get(key);
      if (!task) {
        const listeners = new Set<() => boolean>();
        const valid = () => validSettings() && [...listeners].some(listener => listener()) && JSON.stringify(latest()) === snapshot;
        // Start after the caller registers its intent, including a foreground
        // reader joining an already running background recommendation.
        const promise = Promise.resolve().then(async (): Promise<Replacement | undefined> => {
          if (!valid()) return;
          const candidates = ttsData().voices.filter(voice => fishVoiceId(voice.fishId) && fishVoiceId(voice.fishId) !== fishVoiceId(failedId)).map(voice => ({ ...voice, tags: [...voice.tags] }));
          if (!candidates.length) throw new Error('400 오류가 난 음성을 대신할 후보가 없습니다.');
          const selected = await selectTtsVoices([character], candidates, settings, 'llm');
          if (!valid()) return;
          const chosen = selected.get(character.id)![0];
          const voice = ttsData().voices.find(row => row.key === chosen.key && row.fishId === chosen.fishId);
          if (!voice) return;
          const row = latest()!;
          row.voiceKey = voice.key; row.fishId = voice.fishId;
          const result = { fishId: voice.fishId, character: JSON.stringify(row) };
          await saveTtsData();
          if (typeof document !== 'undefined') document.dispatchEvent(new Event('omnitts-library'));
          this.completed.set(key, result);
          if (this.completed.size > 100) this.completed.delete(this.completed.keys().next().value!);
          return result;
        }).finally(() => { this.pending.delete(key); });
        task = { promise, listeners };
        this.pending.set(key, task);
      }
      task.listeners.add(current);
      try { replacement = await task.promise; }
      finally { task.listeners.delete(current); }
    }
    if (replacement && current() && validSettings() && JSON.stringify(latest()) === replacement.character) return replacement.fishId;
  }
}
