import type { TtsSettings } from '../core/tts-types';
import { ttsData, updateTtsSettings } from '../storage/tts-store';
import { withoutPrivateAddresses } from '../core/util/export-secrets';

export const TTS_SETTINGS_FILE = 'omnitts-settings';
type Secrets = Pick<TtsSettings, 'fish' | 'irodori' | 'gemini' | 'eleven' | 'llm' | 'translation' | 'jev'>;

/** Every setting except credentials, so the file can be shared as-is. */
export function exportableTtsSettings(settings: TtsSettings): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(settings)) as TtsSettings;
  copy.fish.key = ''; copy.fish.routerKey = ''; copy.irodori.key = ''; copy.gemini.key = ''; copy.gemini.serviceAccountJson = ''; copy.eleven.key = ''; copy.jev.key = ''; copy.translation.key = ''; copy.translation.googleKey = ''; copy.translation.deeplKey = '';
  for (const llm of [copy.llm, copy.translation.llm]) { llm.api_key = ''; llm.service_account_json = ''; }
  // The Irodori server is this device's own (a home or Tailscale address): a shared file names none, and an import
  // keeps the reader's. Any other address that is a private one goes the same way.
  copy.irodori.url = '';
  const scrubbed = JSON.parse(JSON.stringify(copy, (_key, value: unknown) => typeof value === 'string' ? withoutPrivateAddresses(value) : value)) as TtsSettings;
  // Window placement belongs to this screen, not to the shared preset.
  const { viewerAnchor: _anchor, minimized: _minimized, panel: _panel, enabled: _enabled, ...rest } = scrubbed;
  return { type: TTS_SETTINGS_FILE, version: 1, settings: rest };
}

/** Applies a shared file over the current settings, keeping this device's keys. */
export async function importTtsSettings(raw: unknown): Promise<void> {
  const file = raw && typeof raw === 'object' ? raw as { type?: unknown; settings?: unknown } : null;
  if (file?.type !== TTS_SETTINGS_FILE || !file.settings || typeof file.settings !== 'object') throw new Error('TTS 설정 파일이 아닙니다. 「설정 내보내기」로 만든 JSON을 골라 주세요.');
  const current = ttsData().settings, incoming = file.settings as Partial<TtsSettings>;
  const keep: Secrets = JSON.parse(JSON.stringify({ fish: current.fish, irodori: current.irodori, gemini: current.gemini, eleven: current.eleven, llm: current.llm, translation: current.translation, jev: current.jev }));
  const next: Partial<TtsSettings> = { ...incoming,
    fish: { ...keep.fish, ...incoming.fish, key: keep.fish.key, routerKey: keep.fish.routerKey },
    // The server and its voices are this device's too: a shared file's 127.0.0.1 is someone else's PC.
    irodori: { ...keep.irodori, ...incoming.irodori, key: keep.irodori.key, url: keep.irodori.url, voice: keep.irodori.voice },
    gemini: { ...keep.gemini, ...incoming.gemini, key: keep.gemini.key, serviceAccountJson: keep.gemini.serviceAccountJson },
    // ElevenLabs's voices are an account's own: a shared file's default voice is not in this one.
    eleven: { ...keep.eleven, ...incoming.eleven, key: keep.eleven.key, voice: keep.eleven.voice, listed: keep.eleven.listed },
    llm: { ...keep.llm, ...incoming.llm, api_key: keep.llm.api_key, service_account_json: keep.llm.service_account_json },
    jev: { ...keep.jev, ...incoming.jev, key: keep.jev.key },
    translation: { ...keep.translation, ...incoming.translation, key: keep.translation.key, googleKey: keep.translation.googleKey, deeplKey: keep.translation.deeplKey,
      llm: { ...keep.translation.llm, ...incoming.translation?.llm, api_key: keep.translation.llm.api_key, service_account_json: keep.translation.llm.service_account_json } },
    enabled: current.enabled, viewerAnchor: current.viewerAnchor, minimized: current.minimized, panel: current.panel };
  await updateTtsSettings(next);
}
