/** NovelAI vibe-transfer encoding. */
import { ENCODE_URL } from '../../core/constants.ts';
import { dbg } from '../../core/debug.ts';
import { sleep } from '../../core/util/async.ts';
import { bytesToBase64Async } from '../../core/util/bytes.ts';
import { networkFetch, readResponseBytes } from './http.ts';
import { resolveModel } from './payload.ts';

/** Encodes an image into a reusable vibe-transfer blob, retrying on gateway errors. */
export async function encodeVibe(
  token: string,
  imageBytes: Uint8Array | ArrayBuffer,
  model: string,
  informationExtracted = 1.0,
  maxRetries = 3,
): Promise<string> {
  const modelName = resolveModel(model);
  const ie = Math.max(0, Math.min(1, Number(informationExtracted) || 1.0));
  const payload = {
    image: await bytesToBase64Async(imageBytes),
    information_extracted: ie,
    model: modelName,
  };
  let lastError = '';
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      dbg('nai.encode_vibe.start', { message: modelName, ie, attempt, focus: true });
      const resp = await networkFetch(ENCODE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const status = Number(resp?.status || 0);
      if ([502, 503, 504, 520].includes(status)) {
        lastError = `HTTP ${status}`;
        await sleep(2 * attempt * 1000);
        continue;
      }
      if (status < 200 || status >= 300) {
        let detail = '';
        try {
          detail = typeof resp?.text === 'function' ? await resp.text() : '';
        } catch { /* body may not be readable as text */ }
        lastError = `HTTP ${status}: ${String(detail).slice(0, 200)}`;
        if (attempt < maxRetries) {
          await sleep(1000);
          continue;
        }
        break;
      }
      const bytes = await readResponseBytes(resp, { timeoutMs: 60000 });
      const encoded = await bytesToBase64Async(bytes);
      dbg('nai.encode_vibe.done', { message: modelName, bytes: bytes?.byteLength || 0, focus: true });
      return encoded;
    } catch (err) {
      lastError = String((err as Error)?.message || err);
      if (attempt < maxRetries) {
        await sleep(1000);
        continue;
      }
    }
  }
  throw new Error(`encode-vibe 실패 (${maxRetries}회): ${lastError}`);
}
