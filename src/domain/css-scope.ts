/**
 * A chat stylesheet the way Risu scopes one (`decodeStyleRule` in its parser): every selector under `.chattext`,
 * every class renamed `x-risu-…` (its sanitizer renames the classes in a message the same way).
 *
 * Risu does this to each `<style>` of each message, every time it draws the message: it parses the CSS, runs a
 * selector parser over every selector, and writes the sheet out again. Our pictures each carried the same 4.8 KB
 * sheet, so a reply with four pictures paid for that four times per draw. The sheet now rides once in the module
 * (`backgroundEmbedding`, which Risu scopes once per chat screen), and the plugin also puts this ready-scoped copy
 * in the page itself, where it stays while Risu redraws the screen around it.
 *
 * Our own sheets only: plain rules, `@media` and the like (their rules are scoped), `@keyframes` (left as written).
 * Checked against Risu's own output for every sheet we ship (tests/css-scope.test.mjs holds the cases).
 */

/** Splits on `sep` outside brackets, parentheses and quotes. */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0, quote = '', start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === sep && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

/** `.name` → `.x-risu-name`, outside attribute brackets and quotes. */
function prefixClasses(selector: string): string {
  let out = '', square = 0, quote = '';
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]!;
    if (quote) { out += c; if (c === '\\') out += selector[++i] ?? ''; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; out += c; continue; }
    if (c === '[') square++; else if (c === ']') square--;
    if (c === '.' && square === 0 && /[A-Za-z_-]/.test(selector[i + 1] || '') && !selector.startsWith('x-risu-', i + 1)) { out += '.x-risu-'; continue; }
    out += c;
  }
  return out;
}

/** The body of the block whose `{` is at `open`, and the index after its `}`. */
function block(text: string, open: number): [string, number] {
  let depth = 0, quote = '';
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return [text.slice(open + 1, i), i + 1];
  }
  return [text.slice(open + 1), text.length];
}

export function scopeChatCss(text: string): string {
  let out = '', i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    const [body, next] = block(text, open);
    i = next;
    if (/^@(?:media|supports|container|document|host)\b/i.test(head)) out += `${head}{${scopeChatCss(body)}}`;
    else if (head.startsWith('@')) out += `${head}{${body}}`;
    else out += `${splitTop(head, ',').map(selector => '.chattext ' + prefixClasses(selector.trim())).join(',')}{${body}}`;
  }
  return out;
}
