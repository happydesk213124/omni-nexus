import { dbg } from '../core/debug';
import type { RisuHost } from '../core/host';
import { viewerPrefs, type ViewerPrefs } from '../storage/viewer-prefs';

/**
 * 바로가기: 옴니 뷰어's two ways in, where the reader left this chat (📽️) or at the message in the middle of the chat
 * screen (🎯), as Risu's floating buttons and in the chat's ☰ menu beside ⚛️Omni Nexus. Each has its own switch in 뷰어
 * settings. Never in the side bar's menu: the reader asked for them out of it.
 */
export type ViewerFrom = 'resume' | 'center';
type ShortcutPref = keyof Pick<ViewerPrefs, 'floatResume' | 'floatCenter' | 'menuResume' | 'menuCenter'>;
export const VIEWER_SHORTCUTS: ReadonlyArray<{ pref: ShortcutPref; id: string; location: 'action' | 'chat'; from: ViewerFrom }> = [
  // The menu's ids are the ones these entries always had.
  { pref: 'menuResume', id: 'omni-viewer-chat', location: 'chat', from: 'resume' },
  { pref: 'menuCenter', id: 'omni-viewer-chat-center', location: 'chat', from: 'center' },
  { pref: 'floatResume', id: 'omni-viewer-action', location: 'action', from: 'resume' },
  { pref: 'floatCenter', id: 'omni-viewer-action-center', location: 'action', from: 'center' },
];
export const SHORTCUT_LOOK: Record<ViewerFrom, { label: string; emoji: string }> = { resume: { label: '보던 곳', emoji: '📽️' }, center: { label: '화면 중앙', emoji: '🎯' } };

const shown = new Set<string>();
let pass: Promise<void> = Promise.resolve();
/** Every button as its switch says: put up when on, taken down when off. One pass at a time, so a quick on-off-on ends on. */
export function syncViewerShortcuts(host: RisuHost, open: (from: ViewerFrom) => void): Promise<void> {
  pass = pass.then(async () => {
    const prefs = viewerPrefs();
    for (const { pref, id, location, from } of VIEWER_SHORTCUTS) {
      if (prefs[pref] === shown.has(id)) continue;
      try {
        if (prefs[pref]) {
          if (typeof host.registerButton !== 'function') continue;
          const { label, emoji } = SHORTCUT_LOOK[from];
          // The menu draws an icon at its text's size: the emoji kept as large as ⚛️Omni Nexus's beside it.
          await host.registerButton({ name: `⚛️Omni 뷰어 · ${label}`, icon: location === 'chat' ? `<span style="font-size:16px">${emoji}</span>` : emoji, iconType: 'html', location, id }, () => open(from));
          shown.add(id);
        } else if (typeof host.unregisterUIPart === 'function') {
          await host.unregisterUIPart(id);
          shown.delete(id);
        }
      } catch (error) {
        dbg('viewer.shortcut', { id, message: String(error) }, 'warn');
      }
    }
  });
  return pass;
}
