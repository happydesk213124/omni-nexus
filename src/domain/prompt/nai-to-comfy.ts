/**
 * NovelAI emphasis → A1111 / ComfyUI CLIP at the send boundary only.
 * Domain tags stay `N::…::` / `{…}`; NAI generation is unchanged.
 */
import { splitNaiPromptTokens } from '../nai-meta/prompt-tags.ts';

const WEIGHT_RE = /^(-?\d+(?:\.\d+)?)::([\s\S]*?)::$/;

function peelWrapper(token: string): { kind: 'brace' | 'bracket'; inner: string; depth: number } | null {
  const t = token.trim();
  if (t.length < 2) return null;
  const open = t[0];
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close || t[t.length - 1] !== close) return null;
  let depth = 0;
  for (let i = 0; i < t.length; i += 1) {
    if (t[i] === open) depth += 1;
    else break;
  }
  let end = 0;
  for (let i = t.length - 1; i >= 0; i -= 1) {
    if (t[i] === close) end += 1;
    else break;
  }
  const n = Math.min(depth, end);
  if (n < 1) return null;
  return {
    kind: open === '{' ? 'brace' : 'bracket',
    inner: t.slice(n, t.length - n).trim(),
    depth: n,
  };
}

function convertToken(token: string): string {
  const t = token.trim();
  if (!t) return '';
  const wm = t.match(WEIGHT_RE);
  if (wm) {
    const weight = wm[1]!;
    const parts = wm[2]!.split(',').map((s) => s.trim()).filter(Boolean);
    return parts.map((part) => `(${convertToken(part) || part}:${weight})`).join(', ');
  }
  const peeled = peelWrapper(t);
  if (peeled) {
    const inner = convertToken(peeled.inner);
    const open = peeled.kind === 'brace' ? '(' : '[';
    const close = peeled.kind === 'brace' ? ')' : ']';
    return `${open.repeat(peeled.depth)}${inner}${close.repeat(peeled.depth)}`;
  }
  return t;
}

/** `2::hard::, {{happy}}` → `(hard:2), ((happy))`. */
export function naiToComfyEmphasis(text: unknown): string {
  const raw = String(text ?? '');
  if (!raw.trim()) return raw;
  return splitNaiPromptTokens(raw).map(convertToken).filter(Boolean).join(', ');
}
