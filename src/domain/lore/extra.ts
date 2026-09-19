/**
 * The `lb-xnai.lb.extra` lore entry: a single always-on entry whose body holds
 * one markdown section of image tags per character.
 *
 * Only the sections a message actually unlocks may be injected — dumping the
 * whole file costs thousands of tokens and confuses the tagger. Export names are
 * part of the frozen UI contract (published as `__INLAY_LORE_EXTRA__`).
 */
import type { LoreEntry } from '../../core/types.ts';

/** One ATX heading character block from the entry body (`#`…`######`, space optional). */
export interface CharacterImageSection {
  title: string;
  hashes: string;
  body: string;
}

/** Shared preamble plus the per-character sections. */
export interface ParsedCharacterImageLore {
  header: string;
  sections: CharacterImageSection[];
}

interface HeadingMatch {
  hashes: string;
  title: string;
  start: number;
  titleEnd: number;
}

/** Line-start ATX heading. Hash count and space after `#` do not matter. */
export const LORE_SECTION_HEADING_RE = /^(#+)\s*(.+?)\s*$/gm;

/** Detect the special always-on character-image lore entry. */
export function isCharacterImageExtraLore(entry: LoreEntry | null | undefined): boolean {
  const name = String(entry?.comment || entry?.name || '').trim().toLowerCase();
  return name === 'lb-xnai.lb.extra';
}

/**
 * Parse ATX headings from lb-xnai.lb.extra body.
 * "Character Image Tags" is the shared header; every other heading is a character section.
 */
export function parseCharacterImageTagLore(content: unknown): ParsedCharacterImageLore {
  const text = String(content || '');
  if (!text.trim()) {
    return { header: '', sections: [] };
  }
  const re = new RegExp(LORE_SECTION_HEADING_RE.source, 'gm');
  const matches: HeadingMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const title = String(m[2] || '').trim();
    if (!title) continue;
    matches.push({
      hashes: m[1],
      title,
      start: m.index,
      titleEnd: m.index + m[0].length,
    });
  }
  if (!matches.length) {
    return { header: text.trimEnd(), sections: [] };
  }

  let header = text.slice(0, matches[0].start).trimEnd();
  const sections: CharacterImageSection[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const cur = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length;
    const body = text.slice(cur.titleEnd, end).replace(/^\r?\n/, '').trimEnd();
    const titleNorm = cur.title.toLowerCase();
    if (titleNorm === 'character image tags') {
      const block = text.slice(cur.start, end).trimEnd();
      header = header ? `${header}\n\n${block}` : block;
      continue;
    }
    sections.push({
      title: cur.title,
      hashes: cur.hashes,
      body,
    });
  }
  return { header: header.trimEnd(), sections };
}

/** Punctuation- and case-free name key, keeping Latin, Hangul, Kana and CJK. */
export function normalizeNameKey(name: unknown): string {
  return String(name || '')
    .replace(/[^a-zA-Z0-9\uac00-\ud7a3\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/g, '')
    .toLowerCase();
}

function nameKeySet(names: unknown): Set<string> {
  return new Set(
    (Array.isArray(names) ? names : [])
      .map((n) => normalizeNameKey(n))
      .filter(Boolean),
  );
}

function renderSections(header: string, sections: CharacterImageSection[]): string {
  if (!sections.length) return '';
  const parts: string[] = [];
  if (header) parts.push(header);
  for (const sec of sections) {
    const head = `${sec.hashes} ${sec.title}`;
    parts.push(sec.body ? `${head}\n${sec.body}` : head);
  }
  return parts.join('\n\n').trimEnd();
}

/**
 * Keep only character sections whose titles are in keepNames (trigger hits),
 * then drop any that are already filled in the roster.
 * filledNames should include each filled character's display name AND trigger aliases
 * (so ### Yoon Ji-soo drops when roster name is 윤지수 but aliases include "Yoon Ji-soo").
 * No keepNames / empty keep → omit entire entry (do not dump all sections).
 */
export function trimCharacterImageTagLore(
  content: unknown,
  filledNames: readonly string[] = [],
  keepNames: readonly string[] = [],
): string {
  const parsed = parseCharacterImageTagLore(content);
  if (!parsed.sections.length) {
    // No character sections — only keep raw body if keepNames explicitly allows dump.
    // Default: without section triggers, omit unstructured blobs.
    return '';
  }
  const keep = nameKeySet(keepNames);
  if (!keep.size) return '';
  const filled = nameKeySet(filledNames);
  const kept = parsed.sections.filter((sec) => {
    const key = normalizeNameKey(sec.title);
    return keep.has(key) && !filled.has(key);
  });
  return renderSections(parsed.header, kept);
}

/**
 * Body for an author's-note style instruction: header + matching heading sections.
 * No matching section → header only. No header either → the raw entry.
 */
export function loreExtraInstructionBody(
  content: unknown,
  keepNames: readonly string[] = [],
): string {
  const raw = String(content || '').trim();
  if (!raw) return '';
  const parsed = parseCharacterImageTagLore(raw);
  if (!parsed.sections.length) return raw;
  const trimmed = trimCharacterImageTagLore(raw, [], keepNames);
  if (trimmed) return trimmed;
  return parsed.header.trim() || raw;
}

/** Same shape as the host Author's Note system turn. */
export function formatLoreExtraAuthorNote(body: string): string {
  const text = String(body || '').trim();
  if (!text) return '';
  return (
    `# Priority: lb-xnai.lb.extra\n${text}\n`
    + '> These are instructions explicitly given by the user. If in conflict with previous instructions, this section MUST take precedence.'
  );
}

/**
 * Section titles to inject for lb-xnai.lb.extra.
 * A section matches when:
 * - its title appears in the message, OR
 * - its title equals any trigger alias from lore entries that already triggered
 *   (e.g. message has "윤지수" → 윤지수 lore keys include "Yoon Ji-soo" → section opens).
 */
export function matchCharacterImageSectionTitles(
  content: unknown,
  messageText: unknown,
  triggerAliases: readonly string[] = [],
): string[] {
  const parsed = parseCharacterImageTagLore(content);
  const hay = normalizeNameKey(messageText);
  const aliasKeys = new Set(
    (Array.isArray(triggerAliases) ? triggerAliases : [])
      .map((n) => normalizeNameKey(n))
      .filter((k) => k.length >= 2),
  );
  if (!hay && !aliasKeys.size) return [];
  const hits: string[] = [];
  for (const sec of parsed.sections) {
    const key = normalizeNameKey(sec.title);
    if (key.length < 2) continue;
    if ((hay && hay.includes(key)) || aliasKeys.has(key)) hits.push(sec.title);
  }
  return hits;
}
