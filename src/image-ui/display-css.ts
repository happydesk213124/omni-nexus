import { dbg } from '../core/debug';
import { risuHost } from '../core/host';
import { scopeChatCss } from '../domain/css-scope';
import { chatDisplayCss } from '../domain/inray-display';
import { messageControlsCss, messageControlsOf } from '../domain/message-controls';
import { getConfig } from '../services/context';
import { quiet, release, unwrap } from '../viewer/safe-dom';

/**
 * The pictures' and the message row's stylesheet, in Risu's page itself.
 *
 * The rules that draw a picture no longer carry the sheet with them (`chatDisplayCss` says why). The display module
 * holds it once, and Risu puts a module's sheet behind the chat; that copy is there from Risu's first frame and
 * when the plugin is not. This copy is the one that never leaves while the plugin runs: Risu takes the module's
 * away for a moment each time it draws that layer again (a picture saved to the bot is enough), and a rule of
 * some other module that rewrites any text it is given can spoil it.
 *
 * Scoped as Risu scopes a chat stylesheet (`scopeChatCss`), so both copies say the same. First in the body: the
 * module's copy, and anything a chat styles on purpose, come later in the page and still have the last word.
 */
const MARK = 'x-omni-display-css';
let installed = false, node: SafeElement | null = null, shown: string | null = null, tail: Promise<void> = Promise.resolve();

/** The sheet for these settings, as the page takes it. */
export function displayPageCss(card: Parameters<typeof messageControlsOf>[0] & { inline_chat_scale_pct?: unknown }): string {
  return scopeChatCss(chatDisplayCss(card?.inline_chat_scale_pct) + messageControlsCss(messageControlsOf(card).folded));
}

async function mount(doc: SafeDocument, css: string): Promise<SafeElement | null> {
  const body = await doc.querySelector('body');
  if (!body) return null;
  try {
    // One left by a build that was reloaded without being unloaded.
    for (const old of await unwrap(await doc.querySelectorAll(`[${MARK}]`))) { await quiet(old.remove()); await release(old); }
    const style = await doc.createElement('style');
    await style.setAttribute(MARK, '1');
    await style.setTextContent(css);
    // A host whose SafeElement has no prepend still gets the sheet, last in the body.
    try { await body.prepend(style); } catch { await body.appendChild(style); }
    return style;
  } finally { await release(body); }
}

/** Puts the sheet in the page, or brings it up to the settings as they are now. One at a time, the latest last. */
export function syncDisplayCss(): Promise<void> {
  return tail = tail.catch(() => {}).then(async () => {
    const host = risuHost();
    if (!installed || !host?.getRootDocument) return;
    const css = displayPageCss(getConfig().card);
    if (css === shown) return;
    if (node) await node.setTextContent(css);
    else {
      const doc = await host.getRootDocument();
      if (!doc) return;
      node = await mount(doc, css);
      if (!node) return;
    }
    shown = css;
  });
}

export async function installDisplayCss(opts: { ready: () => Promise<unknown> }): Promise<void> {
  if (installed) return;
  installed = true;
  // Saved settings call this (settings-persistence): the picture size and the folded row are in the sheet.
  Reflect.set(globalThis, '__OMNI_DISPLAY_CSS__', { sync: () => { void syncDisplayCss().catch(error => dbg('display-css.sync', { message: String(error) }, 'warn')); } });
  const host = risuHost();
  if (!host?.getRootDocument) return;
  // The size is a setting: the sheet waits for the settings rather than go in at 100% and change.
  await opts.ready();
  await syncDisplayCss();
  if (typeof host.onUnload === 'function') await host.onUnload(async () => {
    installed = false;
    await tail.catch(() => {});
    const style = node; node = null; shown = null;
    if (style) { await quiet(style.remove()); await release(style); }
  });
}
