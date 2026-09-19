import { isOfficialNaiGenerateUrl } from '../../core/constants';

export type NaiConnectionProbeKind = 'comfy-skip' | 'mirror-skip' | 'official-anlas';

/**
 * Live Anlas /system_stats only make sense on official NovelAI.
 * Comfy and NAI-protocol mirrors have no Anlas endpoint we can trust.
 */
export function naiConnectionProbeKind(nai: {
  backend?: string | null;
  request_url?: string | null;
} | null | undefined): NaiConnectionProbeKind {
  if (String(nai?.backend || '').toLowerCase() === 'comfy') return 'comfy-skip';
  if (!isOfficialNaiGenerateUrl(nai?.request_url)) return 'mirror-skip';
  return 'official-anlas';
}
