import type { LlmMessage } from '../providers/llm/transform';
import type { BytesLike } from '../core/util/bytes';
import { bytesToBase64Async } from '../core/util/bytes';
import { prepareAutotagImage } from '../core/util/image';
import { runVisionAutotagLook } from './vision-autotag';

/** Routing is an explicit user choice, never guessed from a model name. */
export async function characterImageInput(
  assets: ReadonlyArray<{ name: string; trigger: string; bytes: BytesLike }>,
  separate: boolean,
): Promise<LlmMessage[]> {
  const messages: LlmMessage[] = [];
  for (const asset of assets.slice(0, 5)) {
    const identity = `Character reference: ${asset.trigger}; asset: ${asset.name}`;
    if (separate) {
      const look = await runVisionAutotagLook(asset.bytes);
      messages.push({ role: 'user', content: `${identity}\nImage analysis (reference): ${JSON.stringify(look)}` });
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
