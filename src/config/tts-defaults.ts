import type { TtsSettings } from '../core/tts-types';
import type { LlmSettings } from '../core/types';

/** Status-panel defaults; seeded once into existing settings, then user-owned. */
// § is the effect mark: a line with one is read with the effect taken out (segment.ts),
// so it no longer stops the line. Saves that have it keep it until it is removed by hand.
export const TTS_DEFAULT_EXCLUDES = ['┣', '::', 'DD_', '✨Upcoming'] as const;
/** Read as the words inside: Fish takes [..] (s2) and (..) (s1) as delivery tags. */
export const TTS_DEFAULT_OMITS = ['[', ']', '(', ')'] as const;
export const TTS_RATES = [.5, .75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5];
export function ttsLlmDefaults(): LlmSettings {
  return { source: 'aux', provider: 'openai', endpoint: '', model: '', api_key: '',
    service_account_json: '', temperature: .2, max_tokens: 4096, timeout_seconds: 90,
    reasoning_effort: '', vertex_region: 'us-central1', anthropic_version: '2023-06-01' };
}
export function ttsDefaults(): TtsSettings {
  return {
    enabled: false, narration: true, narrationVoice: '', autoAssign: true, assignWithChat: true, selector: 'llm',
    clickPlay: true, hoverPlay: false, autoReply: false, continuous: true,
    illustration: true, hideName: false, hideTone: false, passageLine: true, excludeText: TTS_DEFAULT_EXCLUDES.join(', '), excludeSeed: 1, stripBrackets: true, skipSymbolOnly: true, omitCharacters: TTS_DEFAULT_OMITS.join(', '), omitSeed: 1, omitParenText: false, controlGutter: false, tone: '', skipChars: 1,
    toast: true, viewer: true, minimized: false, viewerAnchor: null, panel: '', characterFilter: 'all', characterFolder: '*',
    rate: 1, rates: [...TTS_RATES], volume: .95, normalize: true,
    prefetch: 50, concurrency: 5, background: 5, cacheMb: 10,
    fish: { url: 'https://api.fish.audio/v1/tts', key: '', model: 's2.1-pro', via: 'fish', routerKey: '' },
    llm: ttsLlmDefaults(),
    translation: { provider: 'google-free', language: 'ja', narrationLanguage: 'original', url: '', key: '', llm: ttsLlmDefaults() },
    jev: { url: 'https://openrouter.ai/api/alpha/decisions', key: '', model: 'typesafe/jev-1.13', format: 'openrouter' },
  };
}
