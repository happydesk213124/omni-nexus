/**
 * Read the baked character line aloud. Host speech API if present, else Web Speech.
 */

import { getConfig } from './context';
import { stripBakeTokens } from '../domain/chat-bake';
import { cleanText, stripCbs } from '../core/util/text';

type HostSpeak = {
  speak?: (text: string, opts?: { rate?: number; voice?: string }) => unknown;
};

function hostSpeak(): HostSpeak {
  const risu = (globalThis as { risuai?: HostSpeak }).risuai;
  if (risu && typeof risu.speak === 'function') return risu;
  const inlay = (globalThis as { __INLAY_HOST_TTS__?: HostSpeak }).__INLAY_HOST_TTS__;
  if (inlay && typeof inlay.speak === 'function') return inlay;
  return {};
}

export function ttsEnabled(): boolean {
  const card = getConfig()?.card;
  return Boolean(card?.power) && Boolean(card?.tts_on);
}

export function proseForSpeech(raw: unknown): string {
  const stripped = stripBakeTokens(String(raw ?? ''));
  return cleanText(stripCbs(stripped), 8000);
}

export function speakText(raw: unknown): boolean {
  if (!ttsEnabled()) return false;
  const text = proseForSpeech(raw);
  if (!text) return false;
  const card = getConfig()?.card;
  const rate = Number(card?.tts_rate);
  const voice = String(card?.tts_voice || '').trim();
  const host = hostSpeak();
  if (typeof host.speak === 'function') {
    try {
      host.speak(text, { rate: Number.isFinite(rate) ? rate : 1, voice });
      return true;
    } catch {
      /* fall through to speechSynthesis */
    }
  }
  const synth = globalThis.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return false;
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = Number.isFinite(rate) ? Math.max(0.5, Math.min(2, rate)) : 1;
    if (voice) {
      const match = synth.getVoices().find((v) => v.voiceURI === voice || v.name === voice);
      if (match) u.voice = match;
    }
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function speakAfterBake(request: { assistant_text?: unknown; power?: unknown } | null | undefined): void {
  if (!request) return;
  speakText(request.assistant_text);
}
