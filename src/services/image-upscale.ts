import { tokensForFamily } from '../domain/nai/keys';
import { upscaleNaiImage } from '../providers/nai/client';
import { preserveImageMetadata } from '../domain/nai-meta/encode-generation';
import { imageDimensions } from '../domain/nai/image-output';
import { getConfig } from './context';

/** No key retry here: a failed response may already have consumed Anlas. */
export async function upscaleImage(bytes: ArrayBuffer, token?: string): Promise<ArrayBuffer> {
  const nai = getConfig().nai;
  const key = token || tokensForFamily(nai, 'v5')[0] || tokensForFamily(nai, 'v4')[0] || nai.api_key || '';
  const result = await upscaleNaiImage(key, bytes);
  // The upscaler is not responsible for preserving the source's prompt/cast.
  return preserveImageMetadata(bytes, result);
}

export function upscaleDimensions(bytes: ArrayBuffer): { width: number; height: number } {
  const dims = imageDimensions(bytes);
  if (!dims) throw new Error('이미지 해상도를 읽지 못했습니다.');
  return dims;
}
