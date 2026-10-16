import type { LoreEntry } from '../../core/types.ts';
import { isCharacterImageExtraLore, normalizeNameKey, trimCharacterImageTagLore } from './extra.ts';

/**
 * What 명령수정 may show the model about one character: its own section of
 * `lb-xnai.lb.extra`, and lorebook entries whose keys or title name it. Only
 * those — the whole lorebook would cost thousands of tokens and pull in other
 * people's looks.
 */
export interface CharacterLoreReference { lb_xnai?: string; lorebook?: Array<{ title: string; text: string }> }
export const CHARACTER_LORE_LIMITS = { entries: 5, chars: 3000, total: 8000 } as const;

// The plugin's own stored data rides in lore entries too; it is never story.
const OWN_ENTRY = /^(?:omni\.nexus\.|omni-|omnitts|inlay\.nexus\.data\.)/i;
const list = (value: unknown): string[] => (Array.isArray(value) ? value : String(value ?? '').split(','))
  .map(part => String(part).trim()).filter(Boolean);

/** A key or title names this character: same name, or a title that contains it. */
function namesCharacter(entry: LoreEntry, names: ReadonlySet<string>): boolean {
  const keys = [...list(entry.key), ...list(entry.keys), ...list(entry.secondkey)].map(normalizeNameKey).filter(Boolean);
  if (keys.some(key => names.has(key))) return true;
  const title = normalizeNameKey(entry.comment);
  return !!title && [...names].some(name => name.length >= 2 && title.includes(name));
}

export function characterLoreReference(entries: readonly LoreEntry[], names: readonly string[], opts: { xnai: boolean; lore: boolean }): CharacterLoreReference {
  const keys = new Set(names.map(normalizeNameKey).filter(Boolean));
  const out: CharacterLoreReference = {};
  if (!keys.size) return out;
  if (opts.xnai) {
    const sections = entries.filter(isCharacterImageExtraLore).map(entry => trimCharacterImageTagLore(entry.content, [], names)).filter(Boolean);
    if (sections.length) out.lb_xnai = sections.join('\n\n').slice(0, CHARACTER_LORE_LIMITS.total);
  }
  if (opts.lore) {
    let room: number = CHARACTER_LORE_LIMITS.total;
    const picked: Array<{ title: string; text: string }> = [];
    for (const entry of entries) {
      if (picked.length >= CHARACTER_LORE_LIMITS.entries || room <= 0) break;
      const content = String(entry.content ?? '').trim();
      if (!content || isCharacterImageExtraLore(entry) || OWN_ENTRY.test(String(entry.comment ?? '')) || !namesCharacter(entry, keys)) continue;
      const text = content.slice(0, Math.min(CHARACTER_LORE_LIMITS.chars, room));
      picked.push({ title: String(entry.comment ?? '').trim(), text });
      room -= text.length;
    }
    if (picked.length) out.lorebook = picked;
  }
  return out;
}
