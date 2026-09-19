/** NAI v4_prompt character centers (0–1). Enable use_coords only when complete. */

export function isValidNaiCoord(raw: unknown): raw is number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return false;
  return raw >= 0 && raw <= 1;
}

export function readNaiCoord(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return isValidNaiCoord(n) ? n : null;
}

export interface CoordPair {
  x: number;
  y: number;
}

/** Same spot within a hundredth — LLM 0.5 vs 0.50 should not count as a spread. */
function sameCoord(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

function anyPairStacked(pairs: CoordPair[]): boolean {
  for (let i = 0; i < pairs.length; i += 1) {
    for (let j = i + 1; j < pairs.length; j += 1) {
      const a = pairs[i]!;
      const b = pairs[j]!;
      if (sameCoord(a.x, b.x) && sameCoord(a.y, b.y)) return true;
    }
  }
  return false;
}

/**
 * use_coords only when the toggle is on, 2+ characters, and every one has
 * a valid 0–1 pair. Do not invent missing spots — a filled-in spread would
 * put one face at the top and the rest at waist height.
 * Two characters on the same spot (even if a third differs) is not a layout.
 */
export function shouldUseNaiCoords(
  enabled: boolean,
  pairs: Array<CoordPair | null | undefined>,
): boolean {
  if (!enabled || pairs.length < 2) return false;
  if (!pairs.every((p) => p != null && isValidNaiCoord(p.x) && isValidNaiCoord(p.y))) return false;
  return !anyPairStacked(pairs as CoordPair[]);
}
