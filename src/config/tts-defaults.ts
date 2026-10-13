import type { TtsSettings } from '../core/tts-types';
import type { LlmSettings } from '../core/types';

export const TTS_RATES = [.5, .75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5];
export function ttsLlmDefaults(): LlmSettings {
  return { source: 'aux', provider: 'openai', endpoint: '', model: '', api_key: '',
    service_account_json: '', temperature: .2, max_tokens: 4096, timeout_seconds: 90,
    reasoning_effort: '', vertex_region: 'us-central1', anthropic_version: '2023-06-01' };
}
export function ttsDefaults(): TtsSettings {
  return {
    enabled: false, narration: true, narrationVoice: '', autoAssign: true, selector: 'llm',
    clickPlay: true, hoverPlay: false, autoReply: false, continuous: true,
    illustration: true, hideName: true, hideTone: true, passageLine: true, excludeText: '', skipChars: 1,
    toast: true, viewer: true, minimized: false, viewerAnchor: null, panel: '',
    rate: 1, rates: [...TTS_RATES], volume: .8, normalize: true,
    prefetch: 50, concurrency: 5, background: 5, cacheMb: 100,
    fish: { url: 'https://api.fish.audio/v1/tts', key: '', model: 's2.1-pro' },
    llm: ttsLlmDefaults(),
    translation: { provider: 'off', language: 'ja', narrationLanguage: '', url: '', key: '', llm: ttsLlmDefaults() },
    jev: { url: 'https://openrouter.ai/api/alpha/decisions', key: '', model: 'typesafe/jev-1.13', format: 'openrouter' },
  };
}
