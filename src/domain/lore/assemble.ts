/**
 * Lorebook assembly for the tagger prompt.
 *
 * Two things happen here: normal lore entries are scored against the message and
 * the best few are kept, and the `lb-xnai.lb.extra` entry is reduced to only the
 * character sections the message unlocked. The trimming is guarded twice because
 * a single untrimmed dump costs more tokens than the rest of the prompt together.
 */
import type { LoreEntry, LoreExtraMode } from '../../core/types.ts';
import { cleanText, compactText, normalizeAlias, parseAliasList } from '../../core/util/text.ts';
import type { CharacterInput } from '../character/identity.ts';
import { characterTriggers } from '../character/roster.ts';
import { characterHasAppearance } from '../character/tags.ts';
import {
  isCharacterImageExtraLore,
  LORE_SECTION_HEADING_RE,
  matchCharacterImageSectionTitles,
  trimCharacterImageTagLore,
} from './extra.ts';

/** Every usable trigger key of a lore entry, primary and secondary. */
export function loreEntryKeys(entry: LoreEntry): string[] {
  const raw: unknown = entry.key || entry.keys || entry.trigger || '';
  let parts: string[];
  if (Array.isArray(raw)) parts = raw.map((x) => cleanText(x, 200));
  else {
    const text = cleanText(raw, 2000);
    parts = text ? text.split(/[,|\n]/) : [];
  }
  const second = entry.secondkey || entry.second_key || '';
  if (second) parts.push(...parseAliasList(second));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const p = cleanText(part, 200);
    const key = normalizeAlias(p);
    const compact = p ? compactText(p) : '';
    if (!key || seen.has(key)) continue;
    // \uf000-prefixed keys are Risu's internal folder/decorator markers.
    if (p.startsWith('\uf000')) continue;
    if (compact.length < 2) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** How many times a lore key occurs in the message, spaced or compacted. */
export function loreKeyHitsMessage(key: unknown, hay: string, hayCompact: string): number {
  const nk = normalizeAlias(key);
  const ck = compactText(key);
  if (ck.length < 2) return 0;
  const countOcc = (haystack: string, needle: string): number => {
    if (!haystack || !needle || needle.length < 2) return 0;
    let n = 0;
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      n += 1;
      from = at + needle.length;
    }
    return n;
  };
  return Math.max(countOcc(hay, nk), countOcc(hayCompact, ck));
}

export interface TriggeredLoreEntryExplain {
  /** Lore comment / title if present. */
  comment: string;
  /** Every key on the entry (exported to asset matching when any key hits). */
  keys: string[];
  /** Subset of keys that actually appear in the message. */
  keys_hit_in_message: string[];
  /**
   * Sibling keys that did NOT appear in the message but still become asset-match
   * triggers because the entry fired. This is how `Fallen`/`MISC` sneak in.
   */
  sibling_keys_not_in_message: string[];
}

/** Fired lore entries with sibling-key breakdown (debug / asset-tag probe). */
export function explainTriggeredLoreEntries(
  entries: LoreEntry[] | null | undefined,
  message: unknown,
): TriggeredLoreEntryExplain[] {
  const hay = cleanText(message).toLowerCase();
  const hayCompact = compactText(message);
  if (!hay) return [];
  const out: TriggeredLoreEntryExplain[] = [];
  for (const entry of entries || []) {
    if (typeof entry !== 'object' || isCharacterImageExtraLore(entry)) continue;
    const mode = cleanText(entry.mode || '', 40).toLowerCase();
    const keyRaw = cleanText(entry.key || '', 2000);
    if (mode === 'folder' || keyRaw.startsWith('\uf000folder:')) continue;
    const keys = loreEntryKeys(entry);
    if (!keys.length) continue;
    const hitKeys: string[] = [];
    for (const key of keys) {
      if (loreKeyHitsMessage(key, hay, hayCompact) > 0) hitKeys.push(key);
    }
    if (!hitKeys.length) continue;
    const hitNorm = new Set(hitKeys.map((k) => normalizeAlias(k)));
    const siblings = keys.filter((k) => !hitNorm.has(normalizeAlias(k)));
    const comment = cleanText(
      (entry as { comment?: unknown; name?: unknown }).comment
        ?? (entry as { name?: unknown }).name
        ?? '',
      200,
    );
    out.push({
      comment,
      keys,
      keys_hit_in_message: hitKeys,
      sibling_keys_not_in_message: siblings,
    });
  }
  return out;
}

/** All trigger keys from lore entries that hit the message (not only the hitting key). */
export function collectTriggeredLoreKeys(
  entries: LoreEntry[] | null | undefined,
  message: unknown,
): string[] {
  const explained = explainTriggeredLoreEntries(entries, message);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of explained) {
    for (const key of row.keys) {
      const nk = normalizeAlias(key);
      if (!nk || seen.has(nk)) continue;
      seen.add(nk);
      out.push(key);
    }
  }
  return out;
}

/** True when content still looks like the whole Character Image Tags dump. */
export function isUntrimmedCharacterImageTagDump(
  content: unknown,
  keepNames: readonly string[] = [],
): boolean {
  const text = String(content || '');
  if (!/character\s*image\s*tags/i.test(text)) return false;
  const heads = text.match(new RegExp(LORE_SECTION_HEADING_RE.source, 'gm')) || [];
  const sectionHeads = heads.filter((h) => !/character\s*image\s*tags/i.test(h));
  const keep = Array.isArray(keepNames) ? keepNames.filter(Boolean).length : 0;
  // More character sections than unlocked names → still the whole file.
  return sectionHeads.length >= 3 && (keep === 0 || sectionHeads.length > keep + 1);
}

/** Name + trigger aliases for roster rows that already have appearance (used to drop lb-xnai sections). */
export function filledNamesForLoreExtra(roster: CharacterInput[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const char of roster || []) {
    if (!characterHasAppearance(char)) continue;
    for (const token of characterTriggers(char)) {
      const text = cleanText(token, 200);
      const key = normalizeAlias(text);
      if (!text || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

/**
 * True when any lore entry trigger equals a character trigger (normalized alias).
 * Used to skip story lore that only exists because a filled character's name fired.
 */
export function loreEntrySharesCharacterTrigger(
  entry: LoreEntry | null | undefined,
  characterTriggersList: readonly string[] | null | undefined,
): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const charKeys = new Set<string>();
  for (const token of characterTriggersList || []) {
    const key = normalizeAlias(token);
    if (key) charKeys.add(key);
  }
  if (!charKeys.size) return false;
  for (const key of loreEntryKeys(entry)) {
    const nk = normalizeAlias(key);
    if (nk && charKeys.has(nk)) return true;
  }
  return false;
}

/** Normalize card.lore_extra → "tags" | "full" | "off". */
export function normalizeLoreExtraMode(value: unknown): LoreExtraMode {
  if (value === false || value === 'false' || value === 'off' || value === 'none') return 'off';
  if (value === 'full') return 'full';
  return 'tags'; // true / "tags" / "sections" / unset
}

/**
 * Trigger-matched lore + lb-xnai.lb.extra sections unlocked by those lore triggers.
 * Example: message "윤지수…" hits 윤지수 lore whose keys include "Yoon Ji-soo"
 * → only the Yoon Ji-soo section from lb-xnai.lb.extra is injected.
 */
export function assembleLorebookForTagger(
  entries: LoreEntry[] | null | undefined,
  message: unknown,
  filledNames: readonly string[] = [],
  limit = 5,
  contentLimit = 1200,
  triggerKeysOverride: readonly string[] | null = null,
  loreExtraMode: unknown = 'tags',
): LoreEntry[] {
  const list = Array.isArray(entries) ? entries : [];
  const mode = normalizeLoreExtraMode(loreExtraMode);
  // All lb-xnai.lb.extra entries (UI may already have pre-trimmed copies).
  const extras = mode === 'off' ? [] : list.filter((e) => isCharacterImageExtraLore(e));
  const others = list.filter((e) => !isCharacterImageExtraLore(e));
  const matched = filterLorebookByMessage(others, message, limit, contentLimit);
  const triggeredKeys = Array.isArray(triggerKeysOverride) && triggerKeysOverride.length
    ? triggerKeysOverride.map((k) => cleanText(k, 200)).filter(Boolean)
    : collectTriggeredLoreKeys(others, message);
  const out: LoreEntry[] = [];
  for (const extra of extras) {
    const raw = cleanText(extra.content || extra.data || '', 50000);
    if (!raw) continue;
    if (mode === 'full') {
      // Whole lore entry as-is (may include custom prompt text + all character tags).
      out.push({
        comment: cleanText(extra.comment || extra.name || 'lb-xnai.lb.extra', 200),
        content: raw,
        key: 'full',
        always: true,
        lore_extra_mode: 'full',
      });
    } else {
      const keepNames = matchCharacterImageSectionTitles(raw, message, triggeredKeys);
      // Empty trim = unlocked sections already filled (name/alias) → omit, do not re-inject raw.
      const trimmed = keepNames.length
        ? trimCharacterImageTagLore(raw, filledNames, keepNames)
        : '';
      if (trimmed && !isUntrimmedCharacterImageTagDump(trimmed, keepNames)) {
        out.push({
          comment: cleanText(extra.comment || extra.name || 'lb-xnai.lb.extra', 200),
          content: trimmed,
          key: keepNames.join(', '),
          always: true,
          lore_extra_mode: 'tags',
        });
      }
    }
  }
  for (const entry of matched) {
    // Filled character name/alias as lore key → skip (looks already on roster; burns tokens).
    if (loreEntrySharesCharacterTrigger(entry, filledNames)) continue;
    // Belt-and-suspenders: never let a normal lore slot carry the full dump.
    const content = cleanText(entry.content || entry.data || '', contentLimit);
    if (isUntrimmedCharacterImageTagDump(content, [])) continue;
    out.push(entry);
  }
  return out;
}

/** The `limit` best lore entries whose keys occur in the message, most hits first. */
export function filterLorebookByMessage(
  entries: LoreEntry[] | null | undefined,
  message: unknown,
  limit = 5,
  contentLimit = 1200,
): LoreEntry[] {
  const hay = cleanText(message).toLowerCase();
  const hayCompact = compactText(message);
  if (!hay) return [];
  const scored: Array<{ comment: string; content: string; key: string; hits: number }> = [];
  for (const entry of entries || []) {
    if (typeof entry !== 'object') continue;
    if (isCharacterImageExtraLore(entry)) continue;
    const mode = cleanText(entry.mode || '', 40).toLowerCase();
    const keyRaw = cleanText(entry.key || '', 2000);
    if (mode === 'folder' || keyRaw.startsWith('\uf000folder:')) continue;
    const content = cleanText(entry.content || entry.data || '', contentLimit);
    if (!content) continue;
    const keys = loreEntryKeys(entry);
    if (!keys.length) continue;
    let hits = 0;
    for (const key of keys) hits += loreKeyHitsMessage(key, hay, hayCompact);
    if (hits <= 0) continue;
    scored.push({
      comment: cleanText(entry.comment || entry.name || '', 200),
      content,
      key: keyRaw,
      hits,
    });
  }
  scored.sort((a, b) => b.hits - a.hits || String(a.comment).localeCompare(String(b.comment)));
  return scored.slice(0, Math.max(1, limit)).map(({ hits, ...rest }) => rest);
}
