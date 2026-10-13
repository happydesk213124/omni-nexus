import type { LlmSettings } from '../core/types';
import type { TtsSettings } from '../core/tts-types';
import { ttsData, updateTtsSettings } from '../storage/tts-store';
import { parseRates } from '../domain/tts/library';
import { omniTts } from '../services/tts-runtime';
import { el, input, val, set, text, on, run } from './common';
import { promptAudioActivation } from './activation';

const booleans: Record<string, keyof TtsSettings> = { 'tts-normalize': 'normalize', 'click-play': 'clickPlay', 'hover-play': 'hoverPlay', 'auto-play': 'autoReply', 'illustration-read': 'illustration', continuous: 'continuous', narration: 'narration', floating: 'viewer', 'hide-name': 'hideName', 'hide-tone': 'hideTone', 'tts-toast-enabled': 'toast', 'auto-voice': 'autoAssign', 'strip-brackets': 'stripBrackets' };
const numbers: Record<string, keyof TtsSettings> = { speed: 'rate', volume: 'volume', 'tts-skip-chars': 'skipChars', prefetch: 'prefetch', concurrency: 'concurrency', 'background-concurrency': 'background', 'cache-limit': 'cacheMb' };
const source: Record<string, LlmSettings['source']> = { model: 'main', submodel: 'aux', emotion: 'emotion', translate: 'translate', memory: 'memory', otherAx: 'other' };
function llmChoice(model: LlmSettings): string { return Object.entries(source).find(([,v]) => v === model.source)?.[0] || (model.provider === 'google' ? 'Gemini' : model.provider === 'anthropic' ? 'Anthropic' : 'OpenAI 호환'); }
function llmFrom(choice: string, old: LlmSettings, prefix: string): LlmSettings { return { ...old, source: source[choice] || 'custom', provider: choice === 'Gemini' ? 'google' : choice === 'Anthropic' ? 'anthropic' : 'openai', model: val(`${prefix}-model`), endpoint: val(`${prefix}-url`), api_key: val(`${prefix}-key`) }; }
export function syncPower(): void {
  const s = ttsData().settings;
  if (!el('tts-controls')) return;
  if(input('tts-power').checked!==s.enabled) input('tts-power').checked = s.enabled;
  if(el<HTMLFieldSetElement>('tts-controls').disabled===s.enabled) el<HTMLFieldSetElement>('tts-controls').disabled = !s.enabled;
  if(el('tts-off-notice').hidden!==s.enabled) el('tts-off-notice').hidden = s.enabled;
  el('tts-settings-root').classList.toggle('tts-disabled', !s.enabled);
  if (!s.enabled) document.querySelectorAll<HTMLDialogElement>('#tts-dialogs dialog[open]').forEach(node=>node.close());
  text('audio-enable-settings', omniTts.player.ready ? '음성 활성화됨 ♪' : '음성 재생 활성화 ♪');
  text('cache-usage', `캐시 ${omniTts.cache.count}개 · ${(omniTts.cache.bytes / 1024 / 1024).toFixed(1)} MB`);
}
function bindExcludeText(): void {
  const field = el<HTMLTextAreaElement>('tts-exclude-text'); if (!field) return;
  field.value = ttsData().settings.excludeText;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => { clearTimeout(timer); timer = undefined; if (ttsData().settings.excludeText !== field.value) run(() => updateTtsSettings({ excludeText: field.value })); };
  field.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 400); });
  field.addEventListener('change', save);
}
export function bindTtsSettings(): void {
  const s = ttsData().settings;
  for (const [id, key] of Object.entries(booleans)) { input(id).checked = Boolean(s[key]); on(id, () => updateTtsSettings({ [key]: input(id).checked }), 'change'); }
  for (const [id, key] of Object.entries(numbers)) {
    set(id, Number(s[key]) * (id === 'volume' ? 100 : 1));
    on(id, async () => { await updateTtsSettings({ [key]: Number(val(id)) / (id === 'volume' ? 100 : 1) }); text('speed-value', `${ttsData().settings.rate.toFixed(2)}×`); text('volume-value', `${Math.round(ttsData().settings.volume * 100)}%`); }, 'change');
  }
  input('speed').min = '.25'; input('speed').max = '4';
  text('speed-value', `${s.rate.toFixed(2)}×`); text('volume-value', `${Math.round(s.volume * 100)}%`);
  set('speed-presets', s.rates.join(', ')); on('speed-presets', () => updateTtsSettings({ rates: parseRates(val('speed-presets'), s.rates) }), 'change');
  set('voice-selector-engine', s.selector); on('voice-selector-engine', () => updateTtsSettings({ selector: val('voice-selector-engine') as 'llm' | 'jev' }), 'change');
  on('tts-power', async () => { await omniTts.power(input('tts-power').checked); if(input('tts-power').checked)promptAudioActivation(); }, 'change');
  on('audio-enable-settings', promptAudioActivation);
  on('clear-cache', async () => { if (confirm('TTS 음성·번역 캐시를 비울까요?')) await omniTts.clearCache(); });
  set('tts-fish-key', s.fish.key); set('tts-fish-model', s.fish.model); set('tts-fish-url', s.fish.url);
  for (const id of ['tts-fish-key', 'tts-fish-model', 'tts-fish-url']) on(id, () => updateTtsSettings({ fish: { key: val('tts-fish-key'), model: val('tts-fish-model'), url: val('tts-fish-url') } }), 'change');
  set('helper-model', llmChoice(s.llm)); set('tts-llm-model', s.llm.model); set('tts-llm-url', s.llm.endpoint); set('tts-llm-key', s.llm.api_key);
  for (const id of ['helper-model', 'tts-llm-model', 'tts-llm-url', 'tts-llm-key']) on(id, () => updateTtsSettings({ llm: llmFrom(val('helper-model'), ttsData().settings.llm, 'tts-llm') }), 'change');
  set('jev-provider', s.jev.url.includes('openrouter.ai') ? 'openrouter' : s.jev.url.includes('typesafe.ai') ? 'typesafe' : 'custom');
  set('jev-url', s.jev.url); set('jev-model', s.jev.model); set('jev-key', s.jev.key); set('jev-format', s.jev.format === 'typesafe' ? 'systemone' : 'decisions');
  on('jev-provider', () => { const kind = val('jev-provider'); if (kind !== 'custom') { set('jev-url', kind === 'typesafe' ? 'https://api.typesafe.ai/v1/systemone' : 'https://openrouter.ai/api/alpha/decisions'); set('jev-model', kind === 'typesafe' ? 'jev-1.13.0' : 'typesafe/jev-1.13'); } saveJev(); }, 'change');
  const saveJev = () => updateTtsSettings({ jev: { url: val('jev-url'), model: val('jev-model'), key: val('jev-key'), format: val('jev-format') === 'systemone' ? 'typesafe' : 'openrouter' } });
  for (const id of ['jev-url', 'jev-model', 'jev-key', 'jev-format']) on(id, saveJev, 'change');
  set('translation', s.translation.provider); set('language', ['en', 'ja'].includes(s.translation.language) ? s.translation.language : 'custom'); set('custom-lang', s.translation.language);
  set('tts-google-key', s.translation.provider === 'google' ? s.translation.key : ''); set('tts-deepl-key', s.translation.provider === 'deepl' ? s.translation.key : ''); set('tts-deepl-plan', s.translation.url.includes('api-free') ? 'API Free' : 'API Pro');
  set('translation-model', Object.entries(source).find(([,v]) => v === s.translation.llm.source)?.[0] || 'separate');
  set('tts-translation-url', s.translation.llm.endpoint); set('tts-translation-model', s.translation.llm.model); set('tts-translation-key', s.translation.llm.api_key);
  const narration = s.translation.narrationLanguage;
  set('narration-language', ['', 'original', 'ko', 'ja', 'en'].includes(narration) ? narration : 'custom'); set('narration-custom-lang', ['', 'original'].includes(narration) ? '' : narration);
  const translationUi = () => { el('custom-lang-wrap').hidden = val('language') !== 'custom'; el('narration-custom-lang-wrap').hidden = val('narration-language') !== 'custom'; };
  for (const id of ['translation', 'language', 'custom-lang', 'narration-language', 'narration-custom-lang', 'translation-model', 'tts-google-key', 'tts-deepl-key', 'tts-deepl-plan', 'tts-translation-url', 'tts-translation-model', 'tts-translation-key']) on(id, () => {
    translationUi(); const choice = val('translation-model'), provider = val('translation') === 'custom' ? 'llm' : val('translation');
    return updateTtsSettings({ translation: { provider: provider as TtsSettings['translation']['provider'], language: val('language') === 'custom' ? val('custom-lang') : val('language'), narrationLanguage: val('narration-language') === 'custom' ? val('narration-custom-lang').trim() : val('narration-language'), key: provider === 'google' ? val('tts-google-key') : val('tts-deepl-key'), url: provider === 'deepl' ? (val('tts-deepl-plan') === 'API Free' ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate') : '', llm: choice === 'shared' ? { ...ttsData().settings.llm } : llmFrom(choice, ttsData().settings.translation.llm, 'tts-translation') } });
  }, 'change');
  translationUi(); bindExcludeText(); syncPower();
  const unsubscribe = omniTts.subscribe(syncPower);
  const root = el('tts-settings-root');
  const observer = new MutationObserver(() => { if (!root.isConnected) { unsubscribe(); observer.disconnect(); } }); observer.observe(document.body, { childList: true, subtree: true });
  void run(() => omniTts.init());
}
