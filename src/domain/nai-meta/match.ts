/**
 * Match lore trigger keys to Risu additionalAssets names.
 *
 * Filename and trigger are split into words on non-letter/non-number
 * (`senoy_default` → senoy, default). A hit requires the trigger words to
 * equal the **leading** filename words — not a substring anywhere
 * (`awa` does not match `kurokage_away`).
 *
 * Hangul triggers may be short; Latin/Hanja-only keys still need length ≥3
 * on the compact form (trigger eligibility only).
 *
 * Per-trigger pick order (higher first), up to {@link ASSETS_PER_TRIGGER}:
 * 1. Exact word-list match (e.g. `Senoy.webp`)
 * 2. Prefix + look word: default > profile > (normal = smil*, shorter name wins)
 * 3. Prefix only; shorter name wins
 */
import { cleanText } from '../../core/util/text.ts';
import type { CharacterInput } from '../character/identity.ts';
import { characterTriggers, pickUnifiedWinners } from '../character/roster.ts';
import { characterHasAppearance } from '../character/tags.ts';

const MIN_LATIN_HANJA_LEN = 3;
/** Hangul syllables + jamo (covers NFD names before NFC normalize). */
const HANGUL_RE = /[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/;

/** Look-word bands after exact match (higher first). normal and smil* share a band. */
const LOOK_BANDS: ReadonlyArray<{ rank: number; test: (word: string) => boolean }> = [
  { rank: 3, test: (w) => w === 'default' },
  { rank: 2, test: (w) => w === 'profile' },
  { rank: 1, test: (w) => w === 'normal' || w.startsWith('smil') },
];

/** Split basename / trigger / tag on anything that is not a letter or number. */
const WORD_SPLIT = /[^\p{L}\p{N}]+/gu;

/** Max assets kept per lore trigger (with NAI meta). */
export const ASSETS_PER_TRIGGER = 4;

/**
 * Fold + drop separators that users treat as absent (space / - / _ / .).
 * Remaining characters are joined — do not use these as split points.
 */
export function compactAssetKey(value: unknown, max = 400): string {
  return cleanText(value, max)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s_\-.]/g, '');
}

/** Basename without extension, then compacted. */
export function assetBasenameCompact(name: unknown): string {
  const folded = cleanText(name, 400)
    .normalize('NFC')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, '');
  return folded.replace(/[\s_\-.]/g, '');
}

/** Lowercased words of a filename / trigger / tag (extension stripped for names). */
export function assetNameWords(value: unknown): string[] {
  const raw = cleanText(value, 400).normalize('NFC').toLowerCase();
  if (!raw) return [];
  const noExt = raw.replace(/\.[a-z0-9]{2,5}$/i, '');
  return noExt.split(WORD_SPLIT).map((w) => w.trim()).filter(Boolean);
}

/** True when `prefix` words equal the leading words of `full`. */
export function wordsStartWith(full: readonly string[], prefix: readonly string[]): boolean {
  if (!prefix.length || full.length < prefix.length) return false;
  return prefix.every((w, i) => full[i] === w);
}

/** @deprecated Prefer {@link assetBasenameCompact}. */
export function assetBasename(name: unknown): string {
  return cleanText(name, 400)
    .normalize('NFC')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, '');
}

/** True when the key has Hangul — short Korean names are allowed. */
export function triggerHasHangul(key: string): boolean {
  return HANGUL_RE.test(key);
}

/** Lore trigger eligible for asset name matching (length checked after compact). */
export function isAssetMatchTrigger(key: unknown): boolean {
  const t = compactAssetKey(key, 200);
  if (!t) return false;
  if (triggerHasHangul(t)) return true;
  return t.length >= MIN_LATIN_HANJA_LEN;
}

/**
 * Drop lore triggers that belong to characters who already have looks.
 * Keep incomplete-character triggers and triggers that match nobody on the roster
 * (possible new cast). Empty roster → no filtering.
 *
 * `preferFilledLooks`: same person across linked chats — a filled row beats an
 * empty one, then this filter sees only that winner. Without it an empty twin
 * keeps the trigger (incomplete keys win) and the asset looks LLM runs again.
 */
export function filterAssetTriggersForUnfilledLooks(
  triggers: readonly unknown[],
  roster: readonly CharacterInput[] | null | undefined,
  opts?: { preferFilledLooks?: boolean },
): string[] {
  const eligible = assetMatchTriggers(triggers);
  if (!roster?.length) return eligible;
  const rows = opts?.preferFilledLooks
    ? pickUnifiedWinners([...roster], characterHasAppearance)
    : roster;

  const filledKeys = new Set<string>();
  const incompleteKeys = new Set<string>();
  for (const char of rows) {
    const keys = characterTriggers(char)
      .map((t) => compactAssetKey(t, 200))
      .filter((k) => k.length >= 2);
    if (characterHasAppearance(char)) {
      for (const k of keys) filledKeys.add(k);
    } else if (cleanText(char.name, 200)) {
      for (const k of keys) incompleteKeys.add(k);
    }
  }

  return eligible.filter((tr) => {
    const k = compactAssetKey(tr, 200);
    if (!k) return false;
    if (incompleteKeys.has(k)) return true;
    if (filledKeys.has(k)) return false;
    return true;
  });
}

/**
 * @deprecated Kept for older tests — matching no longer uses tokens.
 * Splits a folded basename on common separators (does not drive scoring).
 */
export function assetNameTokens(name: unknown): string[] {
  const base = assetBasename(name);
  if (!base) return [];
  return base
    .split(/[\s_\-/\\.|()]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export interface CharRefSeedMatch {
  characterId: string;
  recordScope: string;
  trigger: string;
}

/**
 * Pair found look-asset triggers to roster rows (name / alias compact match).
 * One look per character, one character per look. Rows without an id are skipped.
 */
export function matchFoundLooksToRoster(
  roster: readonly CharacterInput[] | null | undefined,
  found: ReadonlyArray<{ trigger: string }>,
): CharRefSeedMatch[] {
  const out: CharRefSeedMatch[] = [];
  const usedChars = new Set<string>();
  const usedTriggers = new Set<string>();
  for (const look of found || []) {
    const trig = compactAssetKey(look.trigger, 200);
    if (!trig || usedTriggers.has(trig)) continue;
    for (const rec of roster || []) {
      const id = cleanText(rec.id, 200);
      if (!id || usedChars.has(id)) continue;
      const keys = new Set(assetMatchTriggers(characterTriggers(rec)));
      if (!keys.has(trig)) continue;
      out.push({
        characterId: id,
        recordScope: String(rec.scope || ''),
        trigger: look.trigger,
      });
      usedChars.add(id);
      usedTriggers.add(trig);
      break;
    }
  }
  return out;
}

/** Lore trigger keys eligible for asset matching (returned compacted + deduped). */
export function assetMatchTriggers(triggers: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of triggers) {
    if (!isAssetMatchTrigger(raw)) continue;
    const t = compactAssetKey(raw, 200);
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * For each compact match trigger, collect original lore spellings for the inject block.
 *
 * 1. Raw keys that compact to the trigger (e.g. `Senoy` / `sen-oy` → `senoy`).
 * 2. If a fired lore entry contains any key that compacts to the trigger, **all** keys
 *    of that entry are included (so `Senoy` pulls `세노이` / `추기경` from the same row).
 */
export function loreKeysByCompactTrigger(
  rawTriggers: readonly unknown[],
  compactTriggers: readonly string[],
  relatedKeyGroups: readonly (readonly unknown[])[] = [],
): Map<string, string[]> {
  const allowed = new Set(
    compactTriggers.map((t) => compactAssetKey(t, 200)).filter(Boolean),
  );
  const out = new Map<string, string[]>();
  const seen = new Map<string, Set<string>>();

  const add = (compact: string, displayRaw: unknown) => {
    if (!allowed.has(compact)) return;
    const display = cleanText(displayRaw, 200);
    if (!display) return;
    let list = out.get(compact);
    let seenSet = seen.get(compact);
    if (!list) {
      list = [];
      seenSet = new Set();
      out.set(compact, list);
      seen.set(compact, seenSet!);
    }
    const fold = display.normalize('NFC').toLowerCase();
    if (seenSet!.has(fold)) return;
    seenSet!.add(fold);
    list.push(display);
  };

  for (const raw of rawTriggers) {
    const display = cleanText(raw, 200);
    if (!display) continue;
    const compact = compactAssetKey(display, 200);
    if (!compact) continue;
    add(compact, display);
  }

  for (const group of relatedKeyGroups) {
    const displays = (group || []).map((k) => cleanText(k, 200)).filter(Boolean);
    if (!displays.length) continue;
    const groupCompacts = new Set(
      displays.map((d) => compactAssetKey(d, 200)).filter((c) => c && allowed.has(c)),
    );
    if (!groupCompacts.size) continue;
    for (const compact of groupCompacts) {
      for (const display of displays) add(compact, display);
    }
  }

  return out;
}

/**
 * Longer triggers first so `백주원` claims assets before short `주원`/`juwon`
 * aliases of the same cast member burn the per-trigger budget alone.
 */
export function orderTriggersForAssetPick(triggers: readonly string[]): string[] {
  return [...triggers].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export interface AssetMatchScore {
  name: string;
  key: string;
  score: number;
  hits: string[];
}

function lookBand(words: readonly string[]): number {
  let best = 0;
  for (const word of words) {
    for (const band of LOOK_BANDS) {
      if (band.test(word) && band.rank > best) best = band.rank;
    }
  }
  return best;
}

/**
 * Priority within one trigger's candidate pool (higher = better).
 * exact → default → profile → (normal = smil*, shorter wins) → other prefix.
 */
export function assetPriorityForTrigger(name: unknown, trigger: string): number {
  const trigWords = assetNameWords(trigger);
  if (!trigWords.length) return -1;
  const fileWords = assetNameWords(name);
  if (!wordsStartWith(fileWords, trigWords)) return -1;

  const exact = fileWords.length === trigWords.length;
  const band = lookBand(fileWords);
  const shortBonus = Math.max(0, 2_000 - fileWords.join('').length);

  if (exact) return 5_000_000 + shortBonus;
  if (band) return 1_000_000 + band * 200_000 + shortBonus;
  return 1_000_000 + shortBonus;
}

/** Name-rank a trigger's pool (highest first). Caller slices before reading bytes. */
export function rankPoolForTrigger<T extends RankedAssetCandidate>(
  scored: readonly T[],
  trigger: string,
): T[] {
  return scored
    .filter((a) => a.hits.includes(trigger))
    .sort(
      (a, b) =>
        assetPriorityForTrigger(b.name, trigger) - assetPriorityForTrigger(a.name, trigger)
        || a.name.localeCompare(b.name),
    );
}

/** Longer trigger wins when several prefix-match the same file. */
function triggerClaimScore(trigger: string): number {
  const words = assetNameWords(trigger);
  const joined = words.join('');
  return words.length * 10_000 + joined.length;
}

/** Score asset name vs triggers: leading-word prefix, best look priority. */
export function scoreAssetName(name: unknown, triggers: readonly string[]): AssetMatchScore | null {
  const display = cleanText(name, 400);
  if (!display) return null;
  const fileWords = assetNameWords(display);
  if (!fileWords.length) return null;
  const hits: string[] = [];
  let bestClaim = -1;
  for (const tr of triggers) {
    const folded = compactAssetKey(tr, 200);
    const trigWords = assetNameWords(folded || tr);
    if (!trigWords.length || !wordsStartWith(fileWords, trigWords)) continue;
    const claim = triggerClaimScore(folded || tr);
    if (claim > bestClaim) {
      bestClaim = claim;
      hits.length = 0;
      hits.push(folded || trigWords.join(''));
    } else if (claim === bestClaim && folded && !hits.includes(folded)) {
      hits.push(folded);
    }
  }
  if (!hits.length) return null;
  const bestPri = Math.max(...hits.map((h) => assetPriorityForTrigger(display, h)));
  return {
    name: display,
    key: display,
    score: bestPri,
    hits,
  };
}

/**
 * From NAI plains, pick the identity tag for `original`.
 * Stem `florian` + plains `florian (pokemon)`, `happy` → `florian (pokemon)`.
 */
export function originalTagFromPlains(plains: readonly string[], identity: unknown): string {
  const stem = assetNameWords(identity);
  if (!stem.length) return '';
  let best = '';
  for (const raw of plains) {
    const display = cleanText(raw, 400);
    if (!display) continue;
    const words = assetNameWords(display);
    if (!wordsStartWith(words, stem)) continue;
    if (display.length > best.length) best = display;
  }
  return best;
}

export interface RankedAssetCandidate {
  name: string;
  key: string;
  /** Storage key for read/cache (caller fills if different from name). */
  storageKey?: string;
  score: number;
  hits: string[];
}

/**
 * Pick up to {@link ASSETS_PER_TRIGGER} candidates per trigger (deduped by key).
 * Does not read image bytes — caller tries meta in this order.
 */
export function pickAssetsPerTrigger<T extends RankedAssetCandidate>(
  scored: readonly T[],
  triggers: readonly string[],
  perTrigger = ASSETS_PER_TRIGGER,
): T[] {
  const orderedTriggers = orderTriggersForAssetPick(triggers);
  const picked: T[] = [];
  const seen = new Set<string>();

  for (const tr of orderedTriggers) {
    const pool = rankPoolForTrigger(scored, tr).filter((a) => !seen.has(a.key));

    let got = 0;
    for (const asset of pool) {
      if (got >= perTrigger) break;
      if (seen.has(asset.key)) continue;
      seen.add(asset.key);
      picked.push(asset);
      got += 1;
    }
  }
  return picked;
}
