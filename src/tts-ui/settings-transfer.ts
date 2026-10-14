import type { TtsSettings } from '../core/tts-types';
import { ttsData, updateTtsSettings } from '../storage/tts-store';

export const TTS_SETTINGS_FILE = 'omnitts-settings';
type Secrets = Pick<TtsSettings, 'fish' | 'llm' | 'translation' | 'jev'>;

/** Every setting except credentials, so the file can be shared as-is. */
export function exportableTtsSettings(settings: TtsSettings): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(settings)) as TtsSettings;
  copy.fish.key = ''; copy.jev.key = ''; copy.translation.key = '';
  for (const llm of [copy.llm, copy.translation.llm]) { llm.api_key = ''; llm.service_account_json = ''; }
  // Window placement belongs to this screen, not to the shared preset.
  const { viewerAnchor: _anchor, minimized: _minimized, panel: _panel, enabled: _enabled, ...rest } = copy;
  return { type: TTS_SETTINGS_FILE, version: 1, settings: rest };
}

/** Applies a shared file over the current settings, keeping this device's keys. */
export async function importTtsSettings(raw: unknown): Promise<void> {
  const file = raw && typeof raw === 'object' ? raw as { type?: unknown; settings?: unknown } : null;
  if (file?.type !== TTS_SETTINGS_FILE || !file.settings || typeof file.settings !== 'object') throw new Error('TTS 설정 파일이 아닙니다. 「설정 내보내기」로 만든 JSON을 골라 주세요.');
  const current = ttsData().settings, incoming = file.settings as Partial<TtsSettings>;
  const keep: Secrets = JSON.parse(JSON.stringify({ fish: current.fish, llm: current.llm, translation: current.translation, jev: current.jev }));
  const next: Partial<TtsSettings> = { ...incoming,
    fish: { ...keep.fish, ...incoming.fish, key: keep.fish.key },
    llm: { ...keep.llm, ...incoming.llm, api_key: keep.llm.api_key, service_account_json: keep.llm.service_account_json },
    jev: { ...keep.jev, ...incoming.jev, key: keep.jev.key },
    translation: { ...keep.translation, ...incoming.translation, key: keep.translation.key,
      llm: { ...keep.translation.llm, ...incoming.translation?.llm, api_key: keep.translation.llm.api_key, service_account_json: keep.translation.llm.service_account_json } },
    enabled: current.enabled, viewerAnchor: current.viewerAnchor, minimized: current.minimized, panel: current.panel };
  await updateTtsSettings(next);
}
