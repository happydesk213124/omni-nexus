import { risuHost } from '../../core/host';
import type { LlmSettings } from '../../core/types';
import { cleanText } from '../../core/util/text';
import { normalizeLlmSource, risuModeForSource } from './transform';

/** API v3 hides main/sub model names, but exposes explicitly separated auxiliary ids. */
export async function llmModelName(llm: LlmSettings): Promise<string> {
  const source = normalizeLlmSource(llm.source);
  if (source === 'custom') return cleanText(llm.model);
  if (source === 'main') return '';
  const host = risuHost();
  if (typeof host?.getDatabase !== 'function') return '';
  try {
    const db = await host.getDatabase(['seperateModelsForAxModels', 'seperateModels']);
    if (!db?.seperateModelsForAxModels) return '';
    const mode = risuModeForSource(source) as keyof NonNullable<DatabaseSubset['seperateModels']>;
    return cleanText(db.seperateModels?.[mode]);
  } catch {
    return '';
  }
}
