import ts from 'typescript';

/** Every frozen UI JSON download must pass the same export-only credential filter. */
export function secureJsonExports(source, expected = 6) {
  const tree = ts.createSourceFile('ui.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [];
  function visit(node) {
    if (ts.isNewExpression(node) && node.expression.getText(tree) === 'Blob') {
      const [parts, options] = node.arguments ?? [];
      if (options && ts.isObjectLiteralExpression(options) && options.properties.some(prop =>
        ts.isPropertyAssignment(prop) && prop.name.getText(tree).replace(/["']/g, '') === 'type' &&
        ts.isStringLiteral(prop.initializer) && prop.initializer.text === 'application/json')) {
        if (!parts || !ts.isArrayLiteralExpression(parts)) throw new Error('JSON export guard: unsupported Blob parts');
        if (parts.getText(tree).includes('__OMNI_EXPORT__')) throw new Error('JSON export guard: already patched');
        edits.push({ start: parts.getStart(tree), end: parts.end,
          text: `[globalThis.__OMNI_EXPORT__.jsonParts(${parts.getText(tree)})]` });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (edits.length !== expected || !edits.length) throw new Error(`JSON export guard: expected ${expected} downloads, found ${edits.length}`);
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}
