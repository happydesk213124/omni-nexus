import type { SoundSettings } from '../core/sound-types';
import { soundData, updateSoundSettings } from '../storage/sound-store';

export const SOUND_SETTINGS_FILE = 'omnisound-settings';

/** The BGM·효과음 settings without the ElevenLabs key, so the file can be shared as-is. */
export function exportableSoundSettings(settings: SoundSettings): Record<string, unknown> {
  const { elevenKey: _key, ...rest } = JSON.parse(JSON.stringify(settings)) as SoundSettings;
  return { type: SOUND_SETTINGS_FILE, version: 1, settings: rest };
}

/**
 * Applies a shared file over the current settings. This device keeps its key
 * and its two on/off switches: turning BGM or effects on installs a module, which
 * is the user's call here, not the file's (the TTS settings file does the same).
 */
export async function importSoundSettings(raw: unknown): Promise<void> {
  const file = raw && typeof raw === 'object' ? raw as { type?: unknown; settings?: unknown } : null;
  if (file?.type !== SOUND_SETTINGS_FILE || !file.settings || typeof file.settings !== 'object') throw new Error('BGM·효과음 설정 파일이 아닙니다. 「설정 파일 · 내보내기」로 만든 JSON을 골라 주세요.');
  const current = soundData().settings;
  await updateSoundSettings({ ...(file.settings as Partial<SoundSettings>), elevenKey: current.elevenKey, bgmEnabled: current.bgmEnabled, sfxEnabled: current.sfxEnabled });
}
