/**
 * Filter / strip / restore NovelAI prompt tags for asset→tagger injection.
 *
 * Emphasis forms (`N::…::`, braces, brackets) are stripped to plain tags for the
 * LLM; a weight map lets us restore the original form when saving new_characters.
 */
import { cleanText, joinTags } from '../../core/util/text.ts';

/** Exact denylist (lowercase). `year` is only these three literals — never substring. */
const DROP_EXACT = new Set([
  'year 2024',
  'year 2025',
  'year 2026',
  'cowboy shot',
  'looking at viewer',
  'best quality',
  'amazing quality',
  'very aesthetic',
  'highres',
  'incredibly absurdres',
  'best illustration',
  'artist collaboration',
]);

const WEIGHT_RE = /^(-?\d+(?:\.\d+)?)::([\s\S]*?)::$/;

export interface FilteredPromptTags {
  /** Plain tags sent to the tagger. */
  plains: string[];
  /** lowercase plain → preferred restore form (with emphasis when original had it). */
  weightMap: Map<string, string>;
}

export interface PackedAssetTriggerGroup {
  /** Compact lore/asset match trigger this group was picked for. */
  trigger: string;
  /** Original lorebook spellings that compact to `trigger` (for name/aliases). */
  lore_keys: string[];
  /** Tags shared by every asset in this trigger group. */
  common: string[];
  assets: Array<{ name: string; unique: string[] }>;
}

export interface PackedAssetTags {
  /** One block per trigger (common computed within that trigger's assets only). */
  groups: PackedAssetTriggerGroup[];
  weightMap: Map<string, string>;
}

/** Flat asset names across all trigger groups (dbg / callers). */
export function packedAssetNames(packed: PackedAssetTags): string[] {
  return packed.groups.flatMap((g) => g.assets.map((a) => a.name));
}

/** Split a prompt keeping `N::…::` and brace/bracket groups intact across commas. */
export function splitNaiPromptTokens(text: unknown): string[] {
  const raw = cleanText(text);
  if (!raw) return [];
  const tokens: string[] = [];
  let buf = '';
  let i = 0;
  let brace = 0;
  let bracket = 0;
  let inWeight = false;

  const flush = (): void => {
    const t = buf.trim();
    if (t) tokens.push(t);
    buf = '';
  };

  while (i < raw.length) {
    const ch = raw[i]!;

    // Start of weight group when not nested in braces/brackets.
    if (!inWeight && brace === 0 && bracket === 0) {
      const rest = raw.slice(i);
      const wm = rest.match(/^(-?\d+(?:\.\d+)?)::/);
      if (wm) {
        flush();
        inWeight = true;
        buf = wm[0]!;
        i += wm[0]!.length;
        continue;
      }
    }

    if (inWeight) {
      buf += ch;
      if (ch === ':' && raw[i + 1] === ':') {
        buf += ':';
        i += 2;
        inWeight = false;
        flush();
        // Skip trailing comma/space after weight group.
        while (i < raw.length && (raw[i] === ',' || raw[i] === ' ')) i += 1;
        continue;
      }
      i += 1;
      continue;
    }

    if (ch === '{') {
      brace += 1;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === '}' && brace > 0) {
      brace -= 1;
      buf += ch;
      i += 1;
      if (brace === 0 && bracket === 0) {
        flush();
        while (i < raw.length && (raw[i] === ',' || raw[i] === ' ')) i += 1;
      }
      continue;
    }
    if (ch === '[') {
      bracket += 1;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === ']' && bracket > 0) {
      bracket -= 1;
      buf += ch;
      i += 1;
      if (brace === 0 && bracket === 0) {
        flush();
        while (i < raw.length && (raw[i] === ',' || raw[i] === ' ')) i += 1;
      }
      continue;
    }

    if (ch === ',' && brace === 0 && bracket === 0) {
      flush();
      i += 1;
      while (i < raw.length && raw[i] === ' ') i += 1;
      continue;
    }

    buf += ch;
    i += 1;
  }
  flush();
  return tokens;
}

function isNegativeWeight(token: string): boolean {
  return /^-\d+(?:\.\d+)?::/.test(token.trim());
}

function containsArtist(token: string): boolean {
  return /artist\s*:/i.test(token);
}

/** Collapse `_` / `-` / spaces so `simple-background` ≡ `white background`. */
function normalizeTagKey(key: string): string {
  return key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Drop `background`, `white background`, `simple-background`, … */
function isBackgroundTag(key: string): boolean {
  const n = normalizeTagKey(key);
  return n === 'background' || n.endsWith(' background');
}

/** Drop `straight on` / `straight-on` / `straighton`. */
function isStraightOnTag(key: string): boolean {
  const n = normalizeTagKey(key);
  return n === 'straight on' || n.replace(/\s+/g, '') === 'straighton';
}

function shouldDropPlain(key: string): boolean {
  if (!key || DROP_EXACT.has(key)) return true;
  if (isBackgroundTag(key)) return true;
  if (isStraightOnTag(key)) return true;
  return false;
}

/** Peel one layer of matching `{}` or `[]` wrappers; returns null if not wrapped. */
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

function wrapEmphasis(plain: string, kind: 'brace' | 'bracket' | 'weight', depthOrWeight: number | string): string {
  if (kind === 'weight') return `${depthOrWeight}::${plain}::`;
  const open = kind === 'brace' ? '{' : '[';
  const close = kind === 'brace' ? '}' : ']';
  const n = Math.max(1, Number(depthOrWeight) || 1);
  return `${open.repeat(n)}${plain}${close.repeat(n)}`;
}

/**
 * Expand one raw token into plain tags + restore forms.
 * Multi-tag weight/brace groups assign the same emphasis kind to each plain.
 */
export function expandTokenPlains(token: string): Array<{ plain: string; restore: string }> {
  const t = token.trim();
  if (!t) return [];

  const wm = t.match(WEIGHT_RE);
  if (wm) {
    const weight = wm[1]!;
    const inner = wm[2]!.trim();
    const parts = inner.split(',').map((s) => s.trim()).filter(Boolean);
    return parts.map((plain) => ({
      plain,
      restore: wrapEmphasis(plain, 'weight', weight),
    }));
  }

  let cur = t;
  let kind: 'brace' | 'bracket' | null = null;
  let depth = 0;
  for (;;) {
    const peeled = peelWrapper(cur);
    if (!peeled) break;
    kind = peeled.kind;
    depth = peeled.depth;
    cur = peeled.inner;
  }
  if (kind) {
    const parts = cur.split(',').map((s) => s.trim()).filter(Boolean);
    return parts.map((plain) => ({
      plain,
      restore: wrapEmphasis(plain, kind!, depth),
    }));
  }

  return [{ plain: t, restore: t }];
}

/** Filter artist / year / quality / background / straight-on / negatives; strip emphasis; build weight map. */
export function filterAssetPromptTags(prompt: unknown): FilteredPromptTags {
  const plains: string[] = [];
  const weightMap = new Map<string, string>();
  const seen = new Set<string>();

  for (const token of splitNaiPromptTokens(prompt)) {
    if (isNegativeWeight(token)) continue;
    for (const { plain, restore } of expandTokenPlains(token)) {
      if (containsArtist(plain) || containsArtist(restore)) continue;
      const key = plain.toLowerCase();
      if (shouldDropPlain(key)) continue;
      if (!weightMap.has(key)) weightMap.set(key, restore);
      if (seen.has(key)) continue;
      seen.add(key);
      plains.push(plain);
    }
  }
  return { plains, weightMap };
}

function setLower(tags: readonly string[]): Set<string> {
  return new Set(tags.map((t) => t.toLowerCase()).filter(Boolean));
}

function packOneTriggerGroup(
  trigger: string,
  assets: Array<{ name: string; plains: string[]; weightMap: Map<string, string> }>,
  loreKeys: readonly string[] = [],
): PackedAssetTriggerGroup {
  if (!assets.length) return { trigger, lore_keys: [...loreKeys], common: [], assets: [] };

  let commonSet = setLower(assets[0]!.plains);
  for (let i = 1; i < assets.length; i += 1) {
    const next = setLower(assets[i]!.plains);
    commonSet = new Set([...commonSet].filter((k) => next.has(k)));
  }

  const common: string[] = [];
  const commonSeen = new Set<string>();
  for (const p of assets[0]!.plains) {
    const k = p.toLowerCase();
    if (!commonSet.has(k) || commonSeen.has(k)) continue;
    commonSeen.add(k);
    common.push(p);
  }

  const outAssets = assets.map((a) => {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const p of a.plains) {
      const k = p.toLowerCase();
      if (commonSet.has(k) || seen.has(k)) continue;
      seen.add(k);
      unique.push(p);
    }
    return { name: a.name, unique };
  });

  return { trigger, lore_keys: [...loreKeys], common, assets: outAssets };
}

/**
 * Intersection + per-asset unique tags, **per trigger**.
 * Rows should include `trigger` from the pick loop; missing trigger → one `"_"` group.
 * `loreKeysByTrigger` maps compact trigger → original lore spellings.
 */
export function packAssetTagGroups(
  assets: Array<{
    name: string;
    plains: string[];
    weightMap: Map<string, string>;
    trigger?: string;
  }>,
  loreKeysByTrigger: ReadonlyMap<string, readonly string[]> | null = null,
): PackedAssetTags {
  const weightMap = new Map<string, string>();
  for (const a of assets) {
    for (const [k, v] of a.weightMap) {
      if (!weightMap.has(k)) weightMap.set(k, v);
    }
  }
  if (!assets.length) return { groups: [], weightMap };

  const byTrigger = new Map<string, typeof assets>();
  for (const a of assets) {
    const tr = cleanText(a.trigger, 200) || '_';
    const list = byTrigger.get(tr) || [];
    list.push(a);
    byTrigger.set(tr, list);
  }

  // Preserve first-seen trigger order (pick order).
  const groups: PackedAssetTriggerGroup[] = [];
  for (const [tr, rows] of byTrigger) {
    const loreKeys = loreKeysByTrigger?.get(tr) || [];
    groups.push(packOneTriggerGroup(tr, rows, loreKeys));
  }
  return { groups, weightMap };
}

/** Format packed tags for the tagger system message (English labels — fewer tokens). */
export function formatAssetTagsInjectBlock(packed: PackedAssetTags): string {
  const lines: string[] = [];
  lines.push('## NovelAI character asset tags (ground truth for new_characters looks)');
  lines.push('Use ONLY tags from this block for appearance / attire / accessories (clothes, jewelry, weapons included).');
  lines.push('Do not invent looks outside this list. Use lore_keys for name/aliases; asset names hint outfits.');
  for (const g of packed.groups) {
    lines.push('');
    lines.push(`## trigger \`${g.trigger}\``);
    lines.push(
      `lore_keys: ${g.lore_keys.length ? g.lore_keys.join(', ') : g.trigger}`,
    );
    lines.push(`common: ${g.common.length ? g.common.join(', ') : '(none)'}`);
    for (const a of g.assets) {
      lines.push('');
      lines.push(`asset \`${a.name}\`:`);
      lines.push(`  ${a.unique.length ? a.unique.join(', ') : '(no unique tags)'}`);
    }
  }
  return lines.join('\n');
}

/** Re-apply stored emphasis forms to a comma-separated tag string. */
export function restoreAssetTagWeights(tags: unknown, weightMap: Map<string, string> | null | undefined): string {
  if (!weightMap?.size) return cleanText(tags);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of splitNaiPromptTokens(tags)) {
    // Already weighted/braced — keep as-is.
    if (WEIGHT_RE.test(token) || peelWrapper(token)) {
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(token);
      continue;
    }
    for (const { plain } of expandTokenPlains(token)) {
      const key = plain.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(weightMap.get(key) || plain);
    }
  }
  return joinTags(...out);
}

export function mergeWeightMaps(...maps: Array<Map<string, string> | null | undefined>): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of maps) {
    if (!m) continue;
    for (const [k, v] of m) {
      if (!out.has(k)) out.set(k, v);
    }
  }
  return out;
}
