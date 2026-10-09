import { findStreamSignal } from './message-body';

const marker = '[[imgstart]]';
const thoughtHeads = ['<thoughts', '<think', '</thoughts', '</think'];
const imageHeads = ['[[@inray::', '[[@inrayspinner::', '{{#asset::inxbake_'];
type Signal = ReturnType<typeof findStreamSignal>;

/** Incremental prefilter; the existing projection confirms a candidate exactly. */
export function createStreamSignalScanner(collectLines = false) {
  let previous = '', keySignature = '', cursor = 0, depth = 0;
  let suffix = '', spaces = '', inLine = false, hasBody = false, hit: Signal = null;
  let scannedCharacters = 0, fullScans = 0;
  let revision = 0, partialLine = '';
  const completedLines: string[] = [];
  return {
    get scannedCharacters() { return scannedCharacters; },
    get fullScans() { return fullScans; },
    get revision() { return revision; },
    get completedLines(): readonly string[] { return completedLines; },
    get partialLine() { return partialLine.trim(); },
    scan(raw: string, keywords: readonly string[]): Signal {
      const signature = JSON.stringify(keywords);
      if (signature !== keySignature || !raw.startsWith(previous)) {
        cursor = depth = 0; suffix = spaces = ''; inLine = hasBody = false; hit = null;
        keySignature = signature;
        revision++; completedLines.length = 0; partialLine = '';
      }
      if (hit) {
        // A too-short prefix does not start a job; later token completion can hide it.
        if (raw === previous) return hit;
        fullScans++; hit = findStreamSignal(raw, keywords);
        if (hit) { previous = raw; return hit; }
      }
      previous = raw;
      const keys = [marker, ...keywords.filter(key => key.trim())].map(key => key.toLowerCase());
      const carry = Math.max(...keys.map(key => key.length)) - 1;
      let candidate = false;
      const matchesKey = (text: string) => keys.some(key => text.includes(key));
      // Match the final projection's trimmed, nonempty lines without retaining prose.
      const emit = (text: string) => {
        for (const part of text.matchAll(/\n|[^\S\n]+|\S+/g)) {
          const piece = part[0];
          if (collectLines) {
            if (piece === '\n') {
              if (partialLine.trim()) completedLines.push(partialLine.trim());
              partialLine = '';
            } else partialLine += piece;
          }
          if (piece === '\n') { spaces = ''; inLine = false; }
          else if (!piece.trim()) {
            if (inLine) spaces = (spaces + piece).slice(-carry);
          } else {
            const joined = suffix + (inLine ? spaces : hasBody ? '\n' : '') + piece.toLowerCase();
            candidate ||= matchesKey(joined);
            suffix = joined.slice(-carry); spaces = ''; inLine = hasBody = true;
          }
        }
      };
      const consume = (end: number, hidden = depth > 0) => {
        const piece = raw.slice(cursor, end);
        emit(hidden ? piece.replace(/[^\n]/g, ' ') : piece);
        scannedCharacters += end - cursor; cursor = end;
      };
      const delimiters = /[<[{]/g;
      while (cursor < raw.length) {
        delimiters.lastIndex = cursor;
        const next = delimiters.exec(raw);
        if (!next) { consume(raw.length); break; }
        if (next.index > cursor) consume(next.index);
        const head = raw.slice(cursor, cursor + 20).toLowerCase();
        if (head.startsWith('<')) {
          const thought = /^<(\/)?(?:thoughts|think)\b/i.exec(head);
          if (thought) {
            const end = raw.indexOf('>', cursor + thought[0].length);
            if (end < 0) break;
            consume(end + 1, true);
            depth = thought[1] ? Math.max(0, depth - 1) : depth + 1;
            continue;
          }
          if (thoughtHeads.some(prefix => prefix.startsWith(head))) break;
        } else if (head.startsWith(marker)) {
          consume(cursor + marker.length);
          continue;
        } else {
          const imageHead = imageHeads.find(prefix => head.startsWith(prefix));
          if (imageHead) {
            const close = imageHead.startsWith('[') ? ']' : '}';
            const end = raw.indexOf(close, cursor + imageHead.length);
            if (end < 0 || end === raw.length - 1) break;
            if (raw[end + 1] === close && end > cursor + imageHead.length) {
              consume(end + 2, true); continue;
            }
          } else if ([marker, ...imageHeads].some(prefix => prefix.startsWith(head))) break;
        }
        consume(cursor + 1);
      }
      // A partial image delimiter is still literal in the existing projection.
      // Confirm its keyword candidates too; incomplete thought tags remain hidden.
      if (cursor < raw.length && !depth) candidate ||= matchesKey(suffix + raw.slice(cursor).toLowerCase());
      if (candidate) { fullScans++; hit = findStreamSignal(raw, keywords); }
      return hit;
    },
  };
}
