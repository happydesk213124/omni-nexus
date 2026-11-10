/** Display-only controls: rules draw the row, the plugin acts on its buttons. Nothing here dispatches jobs or writes settings. */
import { QUIET_ACTION } from './inray-display';
/** The retired Lua trigger's name in the module: taken out wherever it is still found. */
export const MESSAGE_CONTROLS_COMMENT = 'omni-message-controls';
// A row's place in a message until the display rule draws it: private-use marks no other rule matches.
const MARK_OPEN = '\uE004OMNI', MARK_CLOSE = '\uE005';
/** A message's controls in their order: kind, icon, label. 옴니 뷰어's 태그 tab is the same row, for the reply on stage. */
export const MESSAGE_CONTROL_KINDS = [['tag','⚛️','태그 생성'],['regen','🔃','전체 이미지 리롤'],['char','👨‍👩‍👧‍👦','캐릭터'],['stop','🟥','중지'],['preset','📚','프리셋'],['note','✒️','작가 노트'],['counts','🔢','생성 장수']] as const;
/** The row as the settings ask for it: 채팅안에 바로가기툴 추가, also on the reader's messages, and folded to 🟪. */
export function messageControlsOf(card: { inline_msg_fan?: unknown; userchat?: unknown; inline_msg_fan_folded?: unknown } | null | undefined) {
  return { enabled: card?.inline_msg_fan === true, userchat: card?.userchat === true, folded: card?.inline_msg_fan_folded === true };
}
// 바로가기툴 접어두기: only 🟪 shows until it is pressed. The press is the browser's own (a checkbox in its label), so the
// row opens at once and asks the plugin nothing; Risu drawing the message again folds it again. The 🔢 panel the
// plugin appends folds with it (its display is inline, so it takes !important to hide). Folded, the row keeps its box,
// so a fold never changes its height. Its buttons are 34 px, 3 px apart: at 38 px the seven and the 🔢 panel just
// filled a phone's chat about 520 px wide, and 🟪's one more pushed the panel down to a second line.
const FOLD_CSS = '[data-omni-folded]{gap:3px}[data-omni-folded] button,[data-omni-fold]{width:34px;height:34px;flex:0 0 34px}[data-omni-fold]{display:inline-grid;place-items:center;border-radius:12px;cursor:pointer;font:18px/1 system-ui;user-select:none;-webkit-user-select:none}[data-omni-fold] input{display:none}[data-omni-fold]:has(> input:checked){background:#7132f533}[data-omni-folded]:not(:has(> [data-omni-fold] > input:checked)) > :not([data-omni-fold]){display:none!important}';
/** The row's stylesheet: once in the module and once in the page, not in front of every row (see chatDisplayCss). */
export function messageControlsCss(folded = false): string {
  return '[data-omni-footer]{position:relative;display:flex;align-items:center;flex-wrap:wrap;gap:4px;width:max-content;max-width:100%;min-height:40px;margin:.75rem auto .1rem 0;padding:4px;box-sizing:border-box;border:1px solid #344052;border-radius:12px;background:#161e2c;color:#eee;overflow-anchor:none}[data-omni-edge="top"]{margin:.1rem auto .75rem 0}[data-omni-footer] button{display:inline-grid;place-items:center;width:38px;height:38px;flex:0 0 38px;padding:0;border:1px solid transparent;border-radius:12px;background:transparent;color:inherit;box-shadow:none;cursor:pointer;font:18px/1 system-ui}[data-omni-footer] button:hover,[data-omni-footer] button:focus-visible{background:#7132f533;border-color:#7132f5;outline:none}[data-omni-footer] button:active{background:#7132f566}' + (folded ? FOLD_CSS : '');
}
export function messageControlsDisplayScript(folded = false) {
  const buttons = MESSAGE_CONTROL_KINDS.map(([kind, icon, label]) => `<button type="button" data-omni-action="${kind}" title="${label}" aria-label="${label}">${icon}</button>`).join('');
  const css = messageControlsCss(folded);
  const fold = folded ? '<label data-omni-fold title="바로가기 펼치기" aria-label="바로가기 펼치기"><input type="checkbox">🟪</label>' : '';
  return { comment: 'omni-message-controls-display', type: 'editdisplay', ableFlag: true, flag: 'g<order -10090>',
    in: `${MARK_OPEN}([0-9]{1,7})(top|bottom)${MARK_CLOSE}`,
    out: `<style>${css}</style><div data-omni-footer="$1" data-omni-edge="$2"${folded ? ' data-omni-folded' : ''}>${fold}${buttons}</div>` };
}
/**
 * Where a message's two rows go, as rules.
 *
 * A Lua trigger used to put the marks in (`listenEdit("editDisplay")`). Risu runs a module's Lua for every message
 * it draws and for every chunk of a reply as it streams, the row switched on or not, through a Lua engine it
 * rebuilds whenever a bot's own Lua ran in between (2 ms a time on a PC: a bot with Lua and this row cost 3.6 ms a
 * message where either alone cost 0.2). Four rules do the same for a scan each; switched off there are none.
 *
 * They run before every other rule, as the Lua did, on a reply of the bot's (or the reader's, with 유저 채팅에도) that
 * has a place in the chat:
 *   1. the bottom mark after the last line, unless the text already carries a mark or a drawn row;
 *   2. the top mark after the first `# Response` heading (응답, 応答, 响应, OOC): external CoT rules hide everything
 *      before that heading, so the row stays inside the visible reply and brings no hidden reasoning back;
 *   3. failing that, after the first `</Thoughts>`;
 *   4. failing that, before the first line.
 * Only the first asks Risu whose message it is (`<cbs>`: Risu reads {{role}} and {{chat_index}} into its pattern,
 * which then matches nothing for anyone else, the greeting, or a text that is no message). The others go by the
 * bottom mark it left at the very end, and take the message's number from it.
 */
export const MESSAGE_CONTROL_RULE_ORDER = { bottom: 10303, heading: 10302, thoughts: 10301, start: 10300 } as const;
export function messageControlsRules(enabled: boolean, userchat: boolean) {
  if (!enabled) return [];
  // Parsed by Risu before the pattern is used: a condition that holds leaves `(?!)`, which nothing matches.
  const never = (when: string) => `{{#if ${when}}}(?!){{/if}}`;
  const someoneElse = userchat ? '{{and::{{notequal::{{role}}::char}}::{{notequal::{{role}}::user}}}}' : '{{notequal::{{role}}::char}}';
  // This pass's bottom mark closes the text (its number is $1), and no top mark is in yet.
  const bottom = `${MARK_OPEN}\\d{1,7}bottom${MARK_CLOSE}$`;
  const marked = `^(?=[\\s\\S]*${MARK_OPEN}(\\d{1,7})bottom${MARK_CLOSE}$)(?![\\s\\S]*${MARK_OPEN}\\d{1,7}top${MARK_CLOSE})`;
  const top = `${MARK_OPEN}$1top${MARK_CLOSE}$n$n`;
  // A line is what stands between two \n, as the Lua read it: \r and the rest are blanks inside it.
  const blank = ' \\t\\r\\f\\v';
  // The heading's own line break stays with the heading (the Lua cut after it); a heading that ended the reply has
  // none, only the two the bottom mark came with.
  const lineEnd = `(?:(?=\\n\\n${bottom})|\\n)`;
  // No `g`: one mark each. `s` only so that Risu, given no flag at all, does not fall back to `u`.
  const rule = (name: keyof typeof MESSAGE_CONTROL_RULE_ORDER, action: string, input: string, out: string) => ({
    comment: `omni-message-controls-${name}`, type: 'editdisplay' as const, ableFlag: true, flag: `s<order ${MESSAGE_CONTROL_RULE_ORDER[name]}><${action}>`, in: input, out });
  return [
    rule('bottom', 'cbs', `^${never('{{less::{{chat_index}}::0}}')}${never(someoneElse)}(?![\\s\\S]*(?:${MARK_OPEN}|data-omni-footer=))([\\s\\S]+)$`,
      `$1$n$n${MARK_OPEN}{{chat_index}}bottom${MARK_CLOSE}`),
    rule('heading', QUIET_ACTION, `${marked}((?:[^\\n]*\\n)*?[${blank}]*#[#*${blank}]*(?:Response|응답|応答|响应|OOC)[*${blank}]*${lineEnd})`, `$2$n$n${top}`),
    rule('thoughts', QUIET_ACTION, `${marked}([\\s\\S]*?</Thoughts>)`, `$2$n$n${top}`),
    rule('start', QUIET_ACTION, marked, top),
  ];
}
