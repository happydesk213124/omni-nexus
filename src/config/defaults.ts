/**
 * Frozen default configuration and prompt fallbacks.
 *
 * Both files currently carry the user's recommended settings (exported from a
 * live setup, secrets redacted): `default-settings.json` is the first-boot /
 * schema floor, `reset-factory.json` is the 전체 초기화 pack.
 * `POST /v1/settings/reset` copies the factory pack, keeps API keys, window
 * pin and card presets, then resets prompts like the prompts-tab default
 * button. Do not re-run `tools/extract-defaults.mjs` over either file.
 */

import type { Settings } from '../core/types';
import defaultSettings from './default-settings.json';
import resetFactory from './reset-factory.json';
import models from './models.json';
import promptFallbacks from './prompt-fallbacks.json';
import qualityTags from './quality-tags.json';
import ucPresets from './uc-presets.json';

export const DEFAULT_CONFIG = defaultSettings as unknown as Settings;

/** Recommended pack applied by 전체 초기화 (not first-boot). */
export const RESET_FACTORY_CONFIG = resetFactory as unknown as Settings;

export const PROMPT_FALLBACKS: Readonly<Record<string, string>> = promptFallbacks;

export const QUALITY_TAGS: Readonly<Record<string, string>> = qualityTags;

export const UC_PRESETS: Readonly<Record<string, Record<string, string>>> = ucPresets as Readonly<
  Record<string, Record<string, string>>
>;

export const MODELS: Readonly<Record<string, string>> = models as Readonly<Record<string, string>>;
