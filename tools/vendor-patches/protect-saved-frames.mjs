// Token-owned frames belong to the display module, never the legacy gallery painter.
export const savedFrameGuard = `  async function nxIsSavedDisplayFrame(node) {
    if (!node) return false;
    const html = String(await node.getOuterHTML() || '');
    const opening = html.slice(0, html.indexOf('>') + 1);
    return /(?:data|x)-inray-(?:spinner|preview-slot|frame|bake)=/.test(opening)
      || /class="[^"]*\\b(?:x-risu-)?omni-spinner\\b/.test(opening);
  }
`;

export function protectSavedFrames(source) {
  let out = source;
  const once = (needle, replacement) => {
    if (out.split(needle).length !== 2) throw new Error('[saved frames] patch drift: ' + needle.slice(0, 90));
    out = out.replace(needle, () => replacement);
  };
  once('  async function nxQueryInlineFrames(root, unwrapSafe) {',
    savedFrameGuard + '  async function nxQueryInlineFrames(root, unwrapSafe) {');
  once('if (!(await nxIsInrayBakeWrap(node))) kept.push(node);',
    'if (!(await nxIsSavedDisplayFrame(node)) && !(await nxIsInrayBakeWrap(node))) kept.push(node);');
  once('  async function nxAbandonInlineFrame(wrap) {\n    if (!wrap) return;',
    '  async function nxAbandonInlineFrame(wrap) {\n    if (!wrap || await nxIsSavedDisplayFrame(wrap)) return;');
  once('  async function refreshSelectedInlineImages(force, opts) {',
    '  async function refreshSelectedInlineImages(force, opts) {\n    if (t.backendSettings?.card?.persist_chat_images !== !1) return;');
  once('          // New shot only. Re-patching every linked card reloads 1/2 while 3 generates.\n          if (t.backendSettings?.card?.inline_chat_images === !0) {',
    '          // Saved-token previews are delivered directly, without legacy restamping.\n          if (t.backendSettings?.card?.persist_chat_images === !1 && t.backendSettings?.card?.inline_chat_images === !0) {');
  once('if (pendingKeyNow && pendingKeyNow !== String(t._inlineKeepPendingKey || "") && t.backendSettings?.card?.inline_chat_images === !0) {',
    'if (t.backendSettings?.card?.persist_chat_images === !1 && pendingKeyNow && pendingKeyNow !== String(t._inlineKeepPendingKey || "") && t.backendSettings?.card?.inline_chat_images === !0) {');
  return out;
}
