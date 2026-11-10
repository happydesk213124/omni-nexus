/**
 * Risu's regex-script step, as far as our modules use it (kwaroran/RisuAI src/ts/process/scripts.ts,
 * `processScriptFull`): rules sorted by `<order N>`, a rule with any other `<...>` mark (an action) tried against the
 * text first and left alone when it finds nothing, `<cbs>` parsing the pattern, `$n` a line break, a line break
 * after an output that ends in `>`, and the text parsed for CBS after every rule that ran.
 *
 * Not Risu's parser: of CBS only what our rules write is read here ({{chat_index}}, {{role}}, {{less}},
 * {{notequal}}, {{equal}}, {{and}}, {{or}}, {{not}}, {{#if}}). Anything else is left as written.
 */

/** `{ index, role }`: the message's place in the chat (-1: none) and who wrote it. */
export function cbs(text, { index = -1, role = 'null' } = {}) {
  const call = { chatindex: () => String(index), role: () => role, less: (a, b) => Number(a) < Number(b) ? '1' : '0', equal: (a, b) => a === b ? '1' : '0',
    notequal: (a, b) => a !== b ? '1' : '0', and: (a, b) => a === '1' && b === '1' ? '1' : '0', or: (a, b) => a === '1' || b === '1' ? '1' : '0', not: a => a === '1' ? '0' : '1' };
  const kept = [];
  for (let pass = 0; pass < 64; pass++) {
    // Innermost first, as Risu's parser closes them: a call with no call inside it.
    let next = text.replace(/\{\{([^{}#/][^{}]*)\}\}/g, (whole, body) => {
      const [name, ...args] = body.split('::'), fn = call[name.toLowerCase().replace(/[\s_-]/g, '')];
      if (fn) return fn(...args);
      kept.push(whole); return `\u0000${kept.length - 1}\u0000`;
    });
    // A block whose condition is settled: kept (trimmed, as Risu trims an #if) or dropped.
    next = next.replace(/\{\{#if ([^{}]*)\}\}((?:(?!\{\{#if )[\s\S])*?)\{\{\/if\}\}/g, (_, state, body) => state === '1' || state === 'true' ? body.trim() : '');
    if (next === text) break;
    text = next;
  }
  return text.replace(/\u0000(\d+)\u0000/g, (_, n) => kept[Number(n)]);
}

/** The rules of `mode` run over `text` as Risu runs them. `ran` (optional) collects the comments of those that ran. */
export function runRules(text, rules, { mode = 'editdisplay', index = -1, role = 'null', ran } = {}) {
  const ctx = { index, role };
  let data = cbs(text, ctx);
  const parsed = rules.map(rule => {
    let order = 0; const actions = [];
    let flag = rule.ableFlag ? rule.flag || 'g' : 'g';
    if (rule.ableFlag && rule.flag?.includes('<')) flag = flag.replace(/<(.+?)>/g, (_, body) => { for (const part of body.split(',').map(v => v.trim())) { if (part.startsWith('order ')) order = parseInt(part.slice(6)); else actions.push(part); } return ''; });
    return { rule, order, actions, flag };
  });
  if (parsed.some(p => p.order)) parsed.sort((a, b) => b.order - a.order);
  for (const { rule, actions, flag: given } of parsed) {
    if (rule.in === '' || rule.type !== mode) continue;
    let out = rule.out.replaceAll('$n', '\n').replace(/{{data}}/g, '$&');
    if (out.endsWith('>') && !actions.includes('no_end_nl')) out += '\n';
    let flag = [...new Set(given.trim().replace(/[^dgimsuvy]/g, ''))].join('');
    if (!flag) flag = 'u';
    const reg = new RegExp(actions.includes('cbs') ? cbs(rule.in, ctx) : rule.in, flag);
    // An action (or @@): the rule is tried first, and a text it finds nothing in is not parsed again.
    if ((out.startsWith('@@') || actions.length) && !reg.test(data)) continue;
    ran?.push(rule.comment);
    data = cbs(data.replace(reg, out), ctx);
  }
  return data;
}
