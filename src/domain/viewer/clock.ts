/**
 * The story's clock line, for 옴니 뷰어's top bar: `[3월 2일 ◆ 오후 4시 ◆ 카페]`,
 * `📅 Day 3 | 08:10 | 교실`, `2020-05-04 (월) / 14:30`, `[May 4th, 2020 - Evening - Rooftop]`.
 * It is there for reference and nothing else reads it, so it is found cheaply and kept
 * off prose: a line is looked at only when it is short and holds no quote (most lines
 * stop there), and only a reply's own lines are read.
 *
 * Its fields are split at a separator, never inside a date (`2020/05/04` stays whole);
 * one of them has to be nothing but a date or a time, or a number-bearing one with a
 * word beside it (`제국력 312년`). A line of one field is a clock when it is a date or a
 * time entirely, with a number or a weekday in it: `2020-05-04`, `오후 3시` (a lone
 * `밤.` stays the story's).
 */
const MONTH = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const WEEKDAY = '(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)day';
const SHORT_DAY = String.raw`(?:[월화수목금토일月火水木金土日]|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?)`;
// A word on its own: Hangul and kana have no word boundary, so no letter may touch it.
const alone = (words: string): string => String.raw`(?<![\p{L}\p{N}])(?:${words})(?!\p{L})`;

const TOKEN = new RegExp([
  // 2020-05-04 · 2020. 5. 4. · 05/04/2020 · 20.05.04; 5/4 only beside a weekday or a time, or as a Date: (alone it is a score).
  String.raw`\d{4}\s*[-./]\s*\d{1,2}\s*[-./]\s*\d{1,2}\.?`,
  String.raw`\d{1,2}\s*[-./]\s*\d{1,2}\s*[-./]\s*\d{4}`,
  String.raw`(?<!\d)\d{2}[-./]\d{2}[-./]\d{2}(?!\d)`,
  // 09-06 · 09/06 · 09.06, no year: two digits each, never after a word or a number (HP 10/10, Lv.10/20 are scores).
  String.raw`(?<![\p{L}\p{N}/.\-]\s?)(?:0[1-9]|1[0-2])[-./](?:0[1-9]|[12]\d|3[01])(?![\d/.\-])`,
  String.raw`\d{1,2}\s*[./]\s*\d{1,2}\.?(?=\s*(?:[(（]\s*${SHORT_DAY}\s*[)）]|[월화수목금토일]요일|[月火水木金土日]曜|${WEEKDAY}|\d{1,2}:\d{2}|오전|오후|午前|午後|[ap]\.?m(?![a-z])))`,
  // 2020년 5월 4일 · 5月4日 · 4号 · 3일차 · 2주째 · 제3일 · 1日目 · 第3天 · 2020년도 · 3개월
  String.raw`\d{1,5}\s*[년年]\s*\d{1,2}\s*[월月](?:\s*\d{1,2}\s*[일日号號])?`,
  String.raw`\d{1,2}\s*[월月]\s*\d{1,2}\s*[일日号號]`,
  String.raw`\d{1,4}\s*(?:일|주|개월|달|년)\s*(?:차|째)`, String.raw`제\s*\d{1,4}\s*일`, String.raw`\d{1,4}\s*日目`, String.raw`第\s*\d{1,4}\s*[日天周週]`,
  String.raw`\d{1,5}\s*[년年]도?`, String.raw`\d{1,2}\s*[월月]`, String.raw`\d{1,2}\s*[일日号號]`, String.raw`\d{1,3}\s*개월`,
  // 월요일 · 星期一 · 周一 · 月曜日 · (월) · (Mon) · Monday, and a day's one-letter weekday after it (2일 토)
  String.raw`[월화수목금토일]요일`, String.raw`(?:星期|礼拜|禮拜)[一二三四五六日天]`, String.raw`[周週][一二三四五六日]`, String.raw`[月火水木金土日]曜日?`,
  String.raw`[(（]\s*${SHORT_DAY}\s*[)）]`, String.raw`(?<=(?:[일日]|\d\.?)\s*)[월화수목금토일](?!\p{L})`, alone(WEEKDAY),
  // May 4 · May 4th, 2020 · 4 May 2020 · the 4th of May · May 2020 · December
  String.raw`(?<!\p{L})(?:${MONTH})\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?(?!\d)`,
  String.raw`(?:(?<!\p{L})the\s+)?\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:${MONTH})(?![a-z])\.?(?:\s*,?\s*\d{4})?`,
  String.raw`(?<!\p{L})(?:${MONTH})\.?\s+\d{4}`,
  alone('january|february|april|june|july|august|september|october|november|december'),
  // 14:30 · 2:30 pm · 3pm · AM 9:00 · 4시 30분 · 4시 반 · 3点半 · 15時 · 15h30 · 1530 hours · 3 o'clock · 30분
  String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?m\.?(?![a-z]))?`,
  String.raw`\d{1,2}\s*[ap]\.?m\.?(?![a-z])`, String.raw`(?<![a-z])[ap]\.?m\.?\s*\d{1,2}(?::\d{2})?`,
  String.raw`\d{1,2}\s*[시時点點](?:\s*\d{1,2}\s*[분分])?(?:\s*\d{1,2}\s*[초秒])?(?:\s*[반半])?`,
  String.raw`\d{1,2}h\d{2}(?!\d)`, String.raw`\d{3,4}\s*hours?(?![a-z])`, String.raw`\d{1,2}\s*o['’]?\s*clock`, String.raw`\d{1,3}\s*분`,
  // The time of day, the season, the days around today
  alone(String.raw`이른\s*아침|늦은\s*(?:아침|오후|저녁|밤)|깊은\s*밤|(?:해\s*질|저녁|새벽|동틀)\s*무렵|한밤중|한밤|오밤중|밤중|대낮|한낮|오전|오후|아침|점심|초저녁|저녁|밤|낮|새벽녘|새벽|정오|자정|심야|해\s*질\s*녘|저물녘|동틀\s*녘|해\s*뜰\s*녘|황혼|일출|일몰|석양`),
  alone('早朝|明け方|午前|午後|正午|夕方|夕暮れ|深夜|真夜中|朝|昼|夜|夕|晩|上午|下午|中午|晚上|凌晨|傍晚|清晨|午夜|黄昏|黃昏|早上|夜晚'),
  alone(String.raw`early\s+morning|late\s+(?:morning|afternoon|evening|night)|morning|afternoon|evening|night|midnight|noon|midday|dawn|dusk|sunrise|sunset|twilight|daybreak|nightfall|tonight|daytime|nighttime`),
  alone('초봄|늦봄|봄|초여름|한여름|늦여름|여름|초가을|늦가을|가을|초겨울|한겨울|늦겨울|겨울|春|夏|秋|冬|spring|summer|autumn|fall|winter'),
  alone(String.raw`오늘|어제|내일|모레|글피|그저께|그제|이튿날|다음\s*날|전날|today|yesterday|tomorrow|今日|昨日|明日|翌日|今天|昨天|明天|后天|後天`),
  // D+3 · D-day · Day 3 · 3rd day · Week 2 · Year 3 · AD 1024 · 1024 BC · 서기 2020
  String.raw`(?<![\p{L}\p{N}])d\s*[+-]\s*\d{1,5}(?!\d)`, alone(String.raw`d-?day`),
  String.raw`(?<!\p{L})(?:day|week|year)\s*\d{1,5}(?!\d)`, String.raw`\d{1,5}(?:st|nd|rd|th)\s+(?:day|week|year)(?![a-z])`,
  String.raw`(?<!\p{L})(?:a\.d\.|b\.c\.|ad|bce|bc|ce)\s*\d{1,4}(?!\d)`, String.raw`\d{1,4}\s*(?:a\.d\.|b\.c\.|ad|bce|bc|ce)(?![a-z])`,
  String.raw`(?:서기|기원전)\s*\d{1,5}`,
].join('|'), 'giu');
// Weekday abbreviations only as written in a header (SAT, Sat): lower-case they are words.
const CASED = /(?<![A-Za-z])(?:MON|TUES?|WED|THU|THURS?|FRI|SAT|SUN|Mon|Tues?|Wed|Thu|Thurs?|Fri|Sat|Sun)\.?(?![A-Za-z])/gu;
const WEEKDAY_TOKEN = new RegExp(String.raw`^(?:[월화수목금토일]요일|星期|礼拜|禮拜|[周週]|[月火水木金土日]曜|[(（]|[월화수목금토일]$|${WEEKDAY}$)`, 'iu');

const QUOTED = /^['‘]|["“”„「」『』]/;
// An emoji opens a field (📅 3월 2일 ⏰ 오후 3시 📍 카페): pictographs and the old symbol blocks, by code point.
const EMOJI = '[' + [[0x1f300, 0x1faff], [0x2600, 0x27bf], [0x2b50, 0x2b55], [0x231a, 0x23ff]].map(([a, b]) => String.fromCodePoint(a) + '-' + String.fromCodePoint(b)).join('') + ']';
const WRAP: Readonly<Record<string, string>> = { '[': ']', '【': '】', '(': ')', '（': '）', '〔': '〕', '［': '］', '《': '》', '〈': '〉', '{': '}' };
const MARKS = new RegExp(String.raw`\s*[◆◇◈♦❖|｜┃│‖·•∙・⋅▪▫■□●○★☆✦✧※]\s*|\s*[\]】］]\s*[[【［]\s*|\s+[/／]\s+|(?<=[^\d\s])[/／](?=[^\d\s])|\s+(?=${EMOJI})`, 'u');
// A dash, tilde or arrow between spaces splits a bracketed line, or one it splits twice (`Day 3 - Morning - Classroom`):
// once in prose it is a pause (`오후 4시 — 그녀가 왔다`).
const DASH = /\s+[-–—~〜→»>]\s+/gu;
const LABEL = /^\p{L}[\p{L} ]{0,9}[:：]\s*/u;
const COMMA = /\s*[,，、]\s*/u;
const SLOT = /\uE000(\d+)\uE001/gu;
const FILLER = /[\s\p{P}\p{S}\p{M}\p{Cf}]+/gu;

const restore = (field: string, found: readonly string[]): string => field.replace(SLOT, (_, i: string) => found[Number(i)] ?? '');
/** A field as shown: no leading emoji or rule, no bracket the split left open, no full stop after a word. */
function tidy(field: string): string {
  let s = field.replace(/^[^\p{L}\p{N}(（[【]+/u, '').replace(/[^\p{L}\p{N})）\]】.]+$/u, '').trim();
  if (/^[(（[【]/u.test(s) && !/[)）\]】]/u.test(s)) s = s.slice(1).trim();
  if (/[)）\]】]$/u.test(s) && !/[(（[【]/u.test(s)) s = s.slice(0, -1).trim();
  return s.replace(/(?<![\d\s]|\b[ap]\.?m)[.。]$/iu, '');
}

/** One line's clock, its fields joined with ` · `; '' when the line is none. */
export function clockOf(rawLine: string): string {
  // A styled status bar's tags can be long: what counts is the text left once they are gone.
  if (rawLine.length > 4000) return '';
  const line = (rawLine.includes('<') ? rawLine.replace(/<[^>]*>/g, '') : rawLine).trim();
  // Up to a status line's length (each field is held to 40 below); a quote only inside a bracketed one (a place's
  // name): anywhere else it is a line of dialogue.
  if (!line || line.length > 400) return '';
  let inner = line.replace(/^[\s*_`>#~=─━═-]+/, '').replace(/[\s*_`~=─━═-]+$/, '');
  const close = WRAP[inner[0] ?? ''], wrapped = !!close && inner.length > 1 && inner.endsWith(close);
  if (wrapped) inner = inner.slice(1, -1).trim();
  if (wrapped ? /^['‘"“「『]/u.test(inner) : QUOTED.test(line) || line.length > 120) return '';
  // Each date or time is set aside first, so a separator inside one (2020/05/04, 오후 4시 · ) never cuts it.
  const found: string[] = [], weekdays = new Set<number>();
  const slot = (token: string, weekday: boolean): string => { if (weekday) weekdays.add(found.length); return `\uE000${found.push(token) - 1}\uE001`; };
  const masked = inner.replace(TOKEN, token => slot(token, WEEKDAY_TOKEN.test(token))).replace(CASED, token => slot(token, true));
  if (!found.length) return '';
  let fields = masked.split(MARKS);
  if (wrapped || (masked.match(DASH)?.length ?? 0) >= 2) fields = fields.flatMap(field => field.split(DASH));
  fields = fields.map(field => field.replace(LABEL, '').trim()).filter(field => field.replace(FILLER, ''));
  const tokens = (field: string): string[] => [...field.matchAll(SLOT)].map(m => found[Number(m[1])] ?? '');
  const rest = (field: string): string => field.replace(SLOT, ' ').replace(FILLER, ' ').trim();
  if (fields.length === 1) {
    // Commas part it only when two of its parts are dates or times (`3월 2일, 오후 3시, 카페`): `아침, 햇살이…` stays prose.
    const parts = fields[0]!.split(COMMA).filter(part => part.replace(FILLER, ''));
    if (parts.filter(part => !rest(part) && part.includes('\uE000')).length >= 2) fields = parts;
    // Bracketed, spaces only (`[2024-03-02 15:00 카페]`): its dates and times, then the place they lead to.
    else if (wrapped) {
      const lead = /^((?:\uE000\d+\uE001[\s,]*)+)(\S.*)$/u.exec(fields[0]!);
      if (lead && !lead[2]!.includes('\uE000')) fields = [lead[1]!.trim(), lead[2]!.trim()];
    }
  }
  if (fields.length >= 2) {
    // Prose a separator happens to cut (`오후 4시 · 그녀가 왔다.`): a sentence ends it, or no field is a clock's.
    if (/[.!?。！？…]$/u.test(masked.trim())) return '';
    const isClock = (field: string): boolean => { const left = rest(field); return !left || (!/\s/u.test(left) && left.length <= 6 && tokens(field).some(t => /\d/.test(t))); };
    if (!fields.some(isClock) || fields.some(field => restore(field, found).length > 40)) return '';
  } else {
    const only = fields[0];
    if (only === undefined || rest(only) || ![...only.matchAll(SLOT)].some(m => weekdays.has(Number(m[1])) || /\d/.test(found[Number(m[1])] ?? ''))) return '';
  }
  return fields.slice(0, 5).map(field => tidy(restore(field, found))).filter(Boolean).join(' · ').slice(0, 80);
}

// A status window's own fields, wherever they stand and however long its line (Date: … | Time: … | Site: …).
// A value runs to a bar, a bracket, or the next label (`Date: 2020-05-04, Time: 09:54`, `날짜: 3월 2일 / 장소: 학교`).
const FIELD = /(?:^|[\s[(|｜│·•,/])(date|날짜|일자|일시|when|time|시간|시각|site|location|place|장소|위치|area|region|지역)\s*[:：]\s*((?:(?!(?:[,，]|\s[/／])\s*\p{L}[\p{L} ]{0,14}[:：])[^|｜│\]\n·•]){1,80})/giu;
const DATES = ['date', '날짜', '일자', '일시', 'when'], TIMES = ['time', '시간', '시각'];
// The most particular place first: a site is in a location, an area a site's corner (too fine to name the scene).
const PLACES = ['site', 'location', 'place', '장소', '위치', 'area', 'region', '지역'];
const ONE_TOKEN = new RegExp(TOKEN.source, 'iu');
/** `9/6`, `9-6`, `9.6` as a month and a day (a Date: field's; anywhere else it may be a score). */
const monthDay = (value: string): boolean => { const m = /^(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)/u.exec(value); return !!m && +m[1]! >= 1 && +m[1]! <= 12 && +m[2]! >= 1 && +m[2]! <= 31; };
/** A status window's date, time and place, from its labeled fields; '' without a date or a time among them. */
export function labeledClock(line: string): string {
  if (!/[:：]/u.test(line)) return '';
  let date = '', time = '', place = '', placeRank = PLACES.length;
  for (const m of line.replace(/<[^>]*>/g, ' ').matchAll(FIELD)) {
    const label = m[1]!.toLowerCase(), value = m[2]!.replace(/[\s,/／]+$/u, '').trim();
    if (!value) continue;
    if (DATES.includes(label)) { if (!date && (ONE_TOKEN.test(value) || monthDay(value))) date = value; }
    else if (TIMES.includes(label)) { if (!time && ONE_TOKEN.test(value)) time = value; }
    else if (PLACES.indexOf(label) < placeRank && value.length <= 40) { placeRank = PLACES.indexOf(label); place = value; }
  }
  if (!date && !time) return '';
  return [date, time && !date.includes(time) ? time : '', place].filter(Boolean).map(tidy).filter(Boolean).join(' · ').slice(0, 80);
}

// A date of the story's own: a year, a month and its day, a day's count (time of day alone is how prose talks).
const STRONG = /^(?:0[1-9]|1[0-2])[-./]\d{2}$|\d{4}|\d\s*[월月]\s*\d|day\s*\d|^d\s*[+-]\s*\d|일\s*[차째]|日目|第|^[a-z]{3,9}\.?\s+\d|\d\s+(?:of\s+)?[a-z]{3}/iu;
const SPOKEN = /"[^"\n]*"|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』/gu;
/** A date the story's words give (`2020년 5월 4일 오후 3시, 그날은…`), outside its dialogue, with the times right by it. */
export function proseDate(line: string): string {
  const plain = line.replace(/<[^>]*>/g, tag => ' '.repeat(tag.length)).replace(SPOKEN, said => ' '.repeat(said.length));
  const hits = [...plain.matchAll(TOKEN)], first = hits.findIndex(m => STRONG.test(m[0]));
  if (first < 0) return '';
  const from = hits[first]!.index!;
  let to = from + hits[first]![0].length;
  for (const m of hits.slice(first + 1)) { if (!/^[\s,·]{0,3}$/u.test(plain.slice(to, m.index))) break; to = m.index! + m[0].length; }
  return tidy(plain.slice(from, to)).slice(0, 80);
}

/**
 * A place the story's clock is given: `line` when the whole line is the clock's (a clock line, a status window),
 * which is no scene of its own then; else a date the story's words give, and its line stays the story's.
 */
export interface ClockMark { start: number; end: number; text: string; line: boolean }
/** Each line, by offset, while `keep` wants more: no split of the whole reply (a long one is read to its end only when asked). */
function eachLine(raw: string, keep: (start: number, end: number) => boolean): void {
  for (let start = 0; start <= raw.length;) {
    const next = raw.indexOf('\n', start), end = next < 0 ? raw.length : next;
    if (!keep(start, end)) return;
    start = end + 1;
  }
}
let memo: { raw: string; marks: ClockMark[] } = { raw: '', marks: [] };
/**
 * Every clock in a reply, where each stands, read from the whole of it: a status window at its end, however long,
 * as much as a clock line at its start (the viewer and the scene builder ask for the same text in turn).
 */
export function clockLines(raw: string): ClockMark[] {
  if (memo.raw === raw) return memo.marks;
  const marks: ClockMark[] = [];
  eachLine(raw, (start, end) => {
    if (end > start && end - start <= 4000) {
      const text = raw.slice(start, end), own = clockOf(text), clock = labeledClock(text) || own || proseDate(text);
      // A line of two labeled fields or more is a status window's, as a clock line is.
      if (clock) marks.push({ start, end, text: clock, line: !!own || [...text.matchAll(FIELD)].length >= 2 });
    }
    return true;
  });
  memo = { raw, marks };
  return marks;
}
/** The reply's first clock, wherever in it (a tile's, the log's); '' when it has none. */
export const storyClock = (raw: string): string => clockLines(raw)[0]?.text ?? '';
/** Where a reply leaves the story's clock: its last. */
export const lastClock = (raw: string): string => clockLines(raw).at(-1)?.text ?? '';
