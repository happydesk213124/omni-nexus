/**
 * Opaque embedding for the shipped prompt pack.
 *
 * Not real secrecy — the key ships in the same bundle — but the raw files are
 * no longer readable as plaintext in `dist/` or on a public raw URL. Casual
 * GitHub browsing and string-searching for prompt text should not hit them.
 */

const CODEC_VERSION = 1;
const XOR_KEY = 'inlay-nexus-prompt-pack-v1';

export type EncodedPromptPack = { readonly __enc: string; readonly __v: number };

const textEncoder = () => new TextEncoder();
const textDecoder = () => new TextDecoder();

function xorBytes(data: Uint8Array, key: string): Uint8Array {
  const keyBytes = textEncoder().encode(key);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    out[i] = data[i]! ^ keyBytes[i % keyBytes.length]!;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Build-time: pack plaintext prompts into an opaque payload. */
export function encodePromptPack(pack: Record<string, string>): EncodedPromptPack {
  const json = JSON.stringify(pack);
  const xored = xorBytes(textEncoder().encode(json), XOR_KEY);
  return { __v: CODEC_VERSION, __enc: bytesToBase64(xored) };
}

/** Runtime / audit: recover the plaintext pack, or pass through a legacy plain object. */
export function decodePromptPack(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  if (typeof obj.__enc === 'string') {
    const version = Number(obj.__v ?? 1);
    if (version !== CODEC_VERSION) return {};
    try {
      const json = textDecoder().decode(xorBytes(base64ToBytes(obj.__enc), XOR_KEY));
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    } catch {
      return {};
    }
  }
  // Backward-compatible: tests / parity host may still inject plaintext.
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export function isEncodedPromptPack(raw: unknown): raw is EncodedPromptPack {
  return !!raw && typeof raw === 'object' && typeof (raw as EncodedPromptPack).__enc === 'string';
}
