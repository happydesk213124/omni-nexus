/**
 * Cast ids: 4-hex fingerprints baked into shot asset filenames (`...c<ID-ID>.webp`).
 * Assigned once, then immutable — a rename never changes the id. Seeded from
 * name+aliases+original on first issue; random redraw on collision.
 */
import { sessionIdHash } from '../../core/util/text.ts';

export function seedCastId(seedText: unknown): string {
  return sessionIdHash(seedText).slice(0, 4);
}

export function randomCastId(): string {
  let out = '';
  for (let i = 0; i < 4; i += 1) out += ((Math.random() * 16) | 0).toString(16);
  return out;
}

export function sanitizeCastId(value: unknown): string {
  const s = String(value ?? '').toLowerCase();
  return /^[0-9a-f]{4}$/.test(s) ? s : '';
}

/** `cab12-34cd` — empty string when no valid ids. */
export function formatCastSegment(ids: readonly unknown[]): string {
  const clean = ids.map(sanitizeCastId).filter(Boolean);
  return clean.length ? `c${clean.join('-')}` : '';
}

/** Inverse of formatCastSegment; anything else yields []. */
export function parseCastSegment(segment: unknown): string[] {
  const s = String(segment ?? '');
  if (!/^c[0-9a-f]{4}(-[0-9a-f]{4})*$/.test(s)) return [];
  return s.slice(1).split('-');
}
