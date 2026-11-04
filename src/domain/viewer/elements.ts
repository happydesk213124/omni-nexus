/**
 * 옴니 뷰어's 요소: the parts of a reply that are neither prose nor ours — a bot's
 * status panel, its choice list — found in the reply's chat HTML (parsed once, off
 * the bridge). A kind is known by its signature (tag, id, classes), so registering
 * one panel registers every reply's panel of that kind.
 */
export interface ElementKind {
  sig: string;
  /**
   * The selector that finds the kind in the live chat. Not a child-index path: the HTML
   * read through the bridge is sanitized (a <style> may be gone), so indexes could drift.
   */
  selector: string;
  /** A short name for the edit list: its first class, else its tag. */
  label: string;
  /** How many the reply holds. */
  count: number;
  /** The first one's text, for the edit list. */
  text: string;
  /** As choices: each element's options (its children's texts when it holds several, else its own). */
  options: string[];
}

// Ours: illustrations, their slots and bars, the TTS controls. Risu may prefix classes (x-risu-).
const OMNI_ATTR = /^(?:data|x)-(?:inray|inlay|inx|omni)/;
const OMNI_CLASS = /(?:^|\s)(?:x-risu-)?(?:inray|inlay|omnitts|omni)-/;
const IMAGE_INSIDE = '[data-inray-asset],[data-inlay-inline-shot],[data-inx-slot],[data-inray-bake],[x-inray-asset],[x-inlay-inline-shot]';
const SKIP = new Set(['STYLE', 'SCRIPT', 'BR', 'HR', 'IMG', 'SVG', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'TEMPLATE', 'NOSCRIPT']);
const BLOCKS = new Set(['DETAILS', 'TABLE', 'BLOCKQUOTE', 'ASIDE', 'SECTION', 'FIELDSET', 'BUTTON']);
const MAX_KINDS = 40, MAX_DEPTH = 8, MAX_OPTIONS = 8;

function isOmni(el: Element): boolean {
  if (OMNI_CLASS.test(el.getAttribute('class') || '')) return true;
  for (const name of el.getAttributeNames()) if (OMNI_ATTR.test(name)) return true;
  return false;
}
const ownClasses = (el: Element): string[] => (el.getAttribute('class') || '').split(/\s+/).filter(c => c && c.length <= 60 && !OMNI_CLASS.test(` ${c}`)).sort().slice(0, 4);
const ident = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, ch => `\\${ch.codePointAt(0)!.toString(16)} `).replace(/^(\d)/, d => `\\3${d} `);
export function elementSignature(el: Element): string {
  const id = el.getAttribute('id') || '';
  return `${el.tagName.toLowerCase()}${id && id.length <= 60 ? `#${id}` : ''}${ownClasses(el).map(c => `.${c}`).join('')}`;
}
/**
 * The name findElementKinds gives a kind (its first class, else its id, else its tag), from its signature alone: for
 * one registered and absent from the message read. An id holding a dot reads as cut there.
 */
export function kindLabel(sig: string): string {
  const m = /^([^#.]+)(?:#([^.]*))?((?:\.[^.]+)*)$/.exec(sig);
  return (m?.[3]?.split('.').find(Boolean) || m?.[2] || m?.[1] || sig).replace(/^x-risu-/, '');
}
export function elementSelector(el: Element): string {
  const id = el.getAttribute('id') || '';
  return `${el.tagName.toLowerCase()}${id && id.length <= 60 ? `#${ident(id)}` : ''}${ownClasses(el).map(c => `.${ident(c)}`).join('')}`;
}
/** The text a reader sees of it, without our controls' (a TTS ▶ is no part of a panel). */
export function readableText(el: Element): string {
  let out = '';
  const walk = (node: Node): void => {
    let afterElement = false;
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) { out += child.textContent || ''; afterElement = false; }
      else if (child.nodeType === 1) {
        const e = child as Element;
        if (SKIP.has(e.tagName) || isOmni(e)) continue;
        // Blocks are lines; two cells side by side (<span>HP 3</span><span>MP 2</span>) are two words,
        // but <b>창가</b>에 stays one.
        if (/^(?:P|DIV|LI|TR|H\d)$/.test(e.tagName)) out += '\n'; else if (afterElement) out += ' ';
        walk(e);
        afterElement = true;
      }
    }
  };
  walk(el);
  return out.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
function optionsOf(el: Element): string[] {
  const parts = Array.from(el.children).filter(c => !SKIP.has(c.tagName) && !isOmni(c)).map(c => readableText(c).replace(/\s+/g, ' ')).filter(Boolean);
  return (parts.length >= 2 ? parts : [readableText(el).replace(/\s+/g, ' ')]).filter(Boolean);
}

/**
 * Every kind of foreign element in a message body, in reading order. A candidate has
 * a class or an id (or is a panel-like block), shows text, and is not ours nor holds
 * one of our illustrations (a wrapper around the whole reply is no panel).
 */
export function findElementKinds(body: Element): ElementKind[] {
  const kinds = new Map<string, ElementKind>();
  const walk = (el: Element, depth: number): void => {
    for (const child of Array.from(el.children)) {
      if (SKIP.has(child.tagName) || isOmni(child) || depth > MAX_DEPTH) continue;
      const marked = !!child.getAttribute('class')?.trim() || !!child.getAttribute('id') || BLOCKS.has(child.tagName);
      if (marked && !child.querySelector(IMAGE_INSIDE)) {
        const text = readableText(child);
        if (text) {
          const sig = elementSignature(child), known = kinds.get(sig);
          if (known) known.count++;
          else if (kinds.size < MAX_KINDS) {
            const classes = ownClasses(child);
            kinds.set(sig, { sig, selector: elementSelector(child), label: (classes[0] || child.getAttribute('id') || child.tagName.toLowerCase()).replace(/^x-risu-/, ''), count: 1, text: text.replace(/\s+/g, ' ').slice(0, 60), options: [] });
          }
          const kind = kinds.get(sig);
          if (kind && kind.options.length < MAX_OPTIONS) kind.options.push(...optionsOf(child).slice(0, MAX_OPTIONS - kind.options.length));
        }
      }
      walk(child, depth + 1);
    }
  };
  walk(body, 0);
  return [...kinds.values()];
}
