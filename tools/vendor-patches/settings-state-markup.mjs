import ts from 'typescript';

const fail = message => { throw new Error(`[settings state markup] ${message}`); };
const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const marker = /NXSTATEEXPR\d+END/g;

// Only the current preview owns settings layout. Keep the old renderer's state
// carriers intact: values, option lists, delegated actions and dynamic islands.
// Expressions are tokenized by the JS parser, never by a regex over JavaScript.
function stripLayout(html) {
  const retainedExpressions = new Set();
  const root = { children: [] };
  const stack = [root];
  const tags = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g;
  let cursor = 0;
  for (const match of html.matchAll(tags)) {
    const parent = stack.at(-1);
    parent.children.push(html.slice(cursor, match.index));
    const raw = match[0];
    cursor = match.index + raw.length;
    if (raw.startsWith('<!--')) continue;
    const tag = /^<\/?([\w-]+)/.exec(raw)[1].toLowerCase();
    if (raw.startsWith('</')) {
      if (stack.length === 1 || stack.at(-1).tag !== tag) fail(`unbalanced </${tag}>`);
      stack.pop().close = raw;
    } else {
      const node = { tag, open: raw, close: '', children: [] };
      parent.children.push(node);
      if (!voidTags.has(tag) && !raw.endsWith('/>')) stack.push(node);
    }
  }
  stack.at(-1).children.push(html.slice(cursor));
  if (stack.length !== 1) fail(`unclosed <${stack.at(-1).tag}>`);
  const serialize = node => typeof node === 'string' ? node : node.open + node.children.map(serialize).join('') + node.close;
  const project = (node, help = '') => {
    if (typeof node === 'string') return (node.match(marker) || []).join('');
    const ownHelp = /\bdata-nx-help-id="([^"]*)"/.exec(node.open)?.[1] || help;
    const carriesState = /\sid\s*=/.test(node.open)
      || /\sdata-(?!nx-help-id\b)[\w-]+/.test(node.open)
      || /\bclass="[^"]*\b(?:preset-chip-row|explorer-grid|explorer-win)\b/.test(node.open);
    if (carriesState) {
      let full = serialize(node);
      for (const token of full.match(marker) || []) retainedExpressions.add(token);
      if (ownHelp && !/\bdata-nx-help-id=/.test(node.open)) {
        full = full.replace(/^<[\w-]+/, value => `${value} data-nx-help-id="${ownHelp}"`);
      }
      return full;
    }
    // Preserve evaluation and ordering even for expressions on retired wrappers.
    return (node.open.match(marker) || []).join('') + node.children.map(child => project(child, ownHelp)).join('');
  };
  const result = root.children.map(node => project(node)).join('');
  const ids = value => [...value.matchAll(/\sid\s*=\s*("[^"]*"|'[^']*')/g)].map(m => m[1]).sort().join('\n');
  if (ids(result) !== ids(html)) fail('state carrier ids changed');
  for (const token of html.match(marker) || []) {
    if (!result.includes(token)) fail(`lost expression ${token}`);
  }
  return { html: result, retainedExpressions };
}

export function compactSettingsMarkup(source) {
  const file = ts.createSourceFile('vendor.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const paints = [];
  const findPaint = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'P') paints.push(node);
    ts.forEachChild(node, findPaint);
  };
  findPaint(file);
  if (paints.length !== 1) fail(`expected one settings renderer P, got ${paints.length}`);
  const paint = paints[0];
  const edits = [];
  let panes = 0;
  let shells = 0;
  let navigation = 0;
  const template = node => ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node);
  const compact = node => {
    const expressions = [];
    let html = ts.isTemplateExpression(node) ? node.head.text : node.text;
    if (ts.isTemplateExpression(node)) for (const span of node.templateSpans) {
      const token = `NXSTATEEXPR${expressions.length}END`;
      expressions.push(span.expression);
      html += token + span.literal.text;
    }
    // A changelog is actual content, not a redundant settings form.
    if (html.includes('Omni Nexus 업데이트 내역')) return node.getText(file);
    const projected = stripLayout(html);
    // Only nested templates outside a retained element are redundant layouts.
    // Retained subtrees must remain byte-for-byte meaningful to their handlers.
    const parts = projected.html.split(/(NXSTATEEXPR\d+END)/);
    return '`' + parts.map(part => {
      const index = /^NXSTATEEXPR(\d+)END$/.exec(part);
      if (!index) return part.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
      const expression = expressions[Number(index[1])];
      // Conditional form branches are separate complete HTML fragments.
      const rewrite = expr => {
        if (template(expr) && /^\s*</.test(ts.isTemplateExpression(expr) ? expr.head.text : expr.text)) return compact(expr);
        if (ts.isConditionalExpression(expr)) return `${expr.condition.getText(file)} ? ${rewrite(expr.whenTrue)} : ${rewrite(expr.whenFalse)}`;
        return expr.getText(file);
      };
      // The token's original position tells us whether it lived inside a state
      // carrier; recompiling inner options/previews would remove their contents.
      const inCarrier = projected.retainedExpressions.has(part);
      return '${' + (inCarrier ? expression.getText(file) : rewrite(expression)) + '}';
    }).join('') + '`';
  };
  const visit = node => {
    if (ts.isVariableDeclarationList(node)) {
      const index = node.declarations.findIndex(decl => decl.name.getText(file) === 'S'
        && decl.initializer?.getText(file).includes('dashboard:'));
      if (index >= 0) {
        const [, tabs, next] = node.declarations.slice(index);
        if (tabs?.name.getText(file) !== 'E' || next?.name.getText(file) !== 'j'
          || !tabs.initializer?.getText(file).includes('data-nx-tab')) fail('legacy navigation drift');
        const counts = { S: 0, E: 0 };
        const count = child => {
          if (ts.isIdentifier(child) && Object.hasOwn(counts, child.text)) counts[child.text]++;
          ts.forEachChild(child, count);
        };
        count(paint);
        if (counts.S !== 2 || counts.E !== 2) fail('legacy navigation has additional consumers');
        edits.push([node.declarations[index].getStart(file), next.getStart(file), '']);
        navigation++;
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && template(node.right)) {
      const left = node.left.getText(file);
      if (left === 'u') {
        edits.push([node.right.getStart(file), node.right.end, compact(node.right)]);
        panes++;
        return;
      }
      if (left === 'document.body.innerHTML' && node.right.getText(file).includes('id="nx-shell"')) {
        edits.push([node.right.getStart(file), node.right.end,
          '`<style>${ga}</style><div id="nx-shell" data-initial-tab="${h(t.uiTab)}"><div id="nx-main">${u}</div></div><div id="nx-explorer-tip" class="explorer-tip"></div>`']);
        shells++;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(paint);
  if (panes !== 9 || shells !== 1 || navigation !== 1) fail(`renderer drift: ${panes} panes, ${shells} shells, ${navigation} navigation`);
  let result = source;
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) result = result.slice(0, start) + replacement + result.slice(end);
  if (ts.createSourceFile('compact.js', result, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length) fail('invalid generated JavaScript');
  const saved = Buffer.byteLength(source) - Buffer.byteLength(result);
  if (saved < 10000) fail(`unexpectedly small layout removal: ${saved} bytes`);
  console.log(`[settings] removed ${saved.toLocaleString()} bytes of legacy layout; retained state carriers`);
  return result;
}
