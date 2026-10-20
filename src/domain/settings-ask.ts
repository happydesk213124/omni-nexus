/**
 * 설정 검색 → LLM한테 물어보기: which settings answer a user's question.
 *
 * Tokens are spent on the question, not on the catalogue. Every setting goes as a
 * number and its short Korean name only, grouped by tab; the few the local search
 * ranked highest also carry a trimmed description. The instructions are English,
 * and the reply is numbers plus two short Korean sentences: the window turns the
 * numbers back into names and buttons itself.
 */

export interface SettingsAskTab { tab: string; items: Array<{ n: number; title: string }> }
export interface SettingsAskInput {
  question: string;
  tabs: SettingsAskTab[];
  details: Array<{ n: number; text: string }>;
}
export interface SettingsAnswer { answer: string; picks: number[] }

const QUESTION_MAX = 400, TITLE_MAX = 40, DETAIL_MAX = 160, DETAILS_MAX = 12, ITEMS_MAX = 400, PICKS_MAX = 5;
const clip = (value: unknown, max: number): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** What the window sent, bounded: nothing it carries can grow the prompt past its caps. */
export function normalizeSettingsAsk(body: unknown): SettingsAskInput | null {
  const row = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const question = clip(row.question, QUESTION_MAX);
  if (!question) return null;
  const seen = new Set<number>();
  let count = 0;
  const tabs = (Array.isArray(row.tabs) ? row.tabs : []).flatMap((raw): SettingsAskTab[] => {
    const tab = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const items = (Array.isArray(tab.items) ? tab.items : []).flatMap(item => {
      const it = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const n = Number(it.n), title = clip(it.title, TITLE_MAX);
      if (!Number.isInteger(n) || n < 1 || !title || seen.has(n) || count >= ITEMS_MAX) return [];
      seen.add(n); count++;
      return [{ n, title }];
    });
    const name = clip(tab.tab, 20);
    return items.length && name ? [{ tab: name, items }] : [];
  });
  if (!tabs.length) return null;
  const details = (Array.isArray(row.details) ? row.details : []).flatMap(raw => {
    const it = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const n = Number(it.n), text = clip(it.text, DETAIL_MAX);
    return seen.has(n) && text ? [{ n, text }] : [];
  }).slice(0, DETAILS_MAX);
  return { question, tabs, details };
}

export function buildSettingsAskMessages(input: SettingsAskInput): Array<{ role: 'system' | 'user'; content: string }> {
  const catalogue = input.tabs.map(tab => `[${tab.tab}] ${tab.items.map(item => `${item.n} ${item.title}`).join('; ')}`).join('\n');
  const details = input.details.map(item => `${item.n}: ${item.text}`).join('\n');
  return [
    {
      role: 'system',
      content: 'You help a user find settings in "Omni Nexus", a RisuAI plugin for chat illustrations, TTS and sound. '
        + 'Settings are listed by number under their tab. Reply with JSON only: {"n":[up to 5 numbers, most useful first],"a":"answer"}. '
        + 'Write "a" in Korean, at most two short sentences: which settings to use and how. Use only listed numbers. '
        + 'If nothing listed fits, return "n":[] and say so in "a".',
    },
    { role: 'user', content: `Settings:\n${catalogue}${details ? `\nDetails:\n${details}` : ''}\nQuestion: ${input.question}` },
  ];
}

/** Picks are kept only when they name a listed setting; the answer is plain text. */
export function parseSettingsAnswer(raw: string, listed: ReadonlySet<number>): SettingsAnswer {
  const text = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text); }
  catch { const match = /\{[\s\S]*\}/.exec(text); if (match) try { parsed = JSON.parse(match[0]); } catch { /* not JSON */ } }
  const picks = [...new Set((Array.isArray(parsed.n) ? parsed.n : []).map(Number))]
    .filter(n => Number.isInteger(n) && listed.has(n)).slice(0, PICKS_MAX);
  const answer = clip(typeof parsed.a === 'string' ? parsed.a : (Object.keys(parsed).length ? '' : text), 600);
  return { answer, picks };
}
