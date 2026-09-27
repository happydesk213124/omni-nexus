import type { LlmMessage } from '../providers/llm/transform';
import type { BytesLike } from '../core/util/bytes';
import { bytesToBase64Async } from '../core/util/bytes';
import { prepareAutotagImage } from '../core/util/image';
import { runVisionAutotagLook } from './vision-autotag';
import { dbg } from '../core/debug';

/** Routing is an explicit user choice, never guessed from a model name. */
export async function characterImageInput(
  assets: ReadonlyArray<{ name: string; trigger: string; bytes: BytesLike }>,
  separate: boolean,
  opts: { continueOnAnalysisFailure?: boolean; signal?: AbortSignal } = {},
): Promise<LlmMessage[]> {
  const messages: LlmMessage[] = [];
  for (const asset of assets.slice(0, 5)) {
    const identity = `Character reference: ${asset.trigger}; asset: ${asset.name}`;
    if (separate) {
      try {
        const look = await runVisionAutotagLook(asset.bytes, { signal: opts.signal });
        messages.push({ role: 'user', content: `${identity}\nImage analysis (reference): ${JSON.stringify(look)}` });
      } catch (err) {
        if (opts.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
        if ((err as Error)?.name === 'AbortError' || !opts.continueOnAnalysisFailure) throw err;
        dbg('character-image.analysis.unavailable', {
          asset: asset.name, trigger: asset.trigger, message: String((err as Error)?.message || err),
        }, 'warn');
        // Provider errors are diagnostics, never appearance data or model instructions.
        messages.push({ role: 'user', content: `${identity}\nImage analysis unavailable: no usable result was received from the separate image-analysis model. Continue using only the provided text and metadata; do not infer appearance from this unavailable image.` });
      }
    } else {
      const prepared = await prepareAutotagImage(asset.bytes);
      messages.push({ role: 'user', content: [
        { type: 'text', text: identity },
        { type: 'image_url', image_url: { url: `data:${prepared.mime};base64,${await bytesToBase64Async(prepared.bytes)}` } },
      ] });
    }
  }
  return messages;
}
