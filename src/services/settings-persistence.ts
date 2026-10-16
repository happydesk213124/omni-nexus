import type { Settings } from '../core/types';
import { deepcopy } from '../core/util/object';
import { ensureInrayDisplayModule } from '../storage/inray-display-module';
import { ensureOmniHelperModule } from '../storage/omni-helper-module';
import { ensureInlineTagModule } from '../storage/inline-tag-module';
import { saveSettingsToStorage } from '../storage/settings-store';
import { configLock, getConfig } from './context';

type Waiting = { resolve: () => void; reject: (error: unknown) => void };
type Pending = { snapshot: Settings; verify: boolean; waiting: Waiting[] };
let pending: Pending | null = null;
let running = false;
let displayKey: string | undefined;
let helperEnabled: boolean | undefined;
let inlineKey: string | undefined;

function syncDisplay(snapshot: Settings): void {
  const card = snapshot.card;
  const folded = card?.persist_chat_images_folded === true;
  const scale = card?.inline_chat_scale_pct;
  const controls = { enabled: card?.inline_msg_fan === true, userchat: card?.userchat === true };
  const helper = card.omni_helper_prompt === true;
  if (helper !== helperEnabled) {
    helperEnabled = helper;
    void ensureOmniHelperModule(helper).then(ok => {
      if (!ok && helperEnabled === helper) helperEnabled = undefined;
    }, () => { if (helperEnabled === helper) helperEnabled = undefined; });
  }
  const inline = card.stream_inline_tags === true;
  // The scale only shapes the module's slots while it is on.
  const pending = card.stream_inline_autogen === false;
  const nextInline = inline ? JSON.stringify([true, scale, pending]) : 'off';
  // Never used and still off: nothing to write, and no module read on the first save.
  if (inlineKey === undefined && !inline) inlineKey = nextInline;
  if (nextInline !== inlineKey) {
    inlineKey = nextInline;
    // Taps on waiting slots follow the switch.
    (Reflect.get(globalThis, '__OMNI_WAIT_TAPS__') as { sync?: () => void } | undefined)?.sync?.();
    void ensureInlineTagModule(inline, scale, pending).then(ok => {
      if (!ok && inlineKey === nextInline) inlineKey = undefined;
    }, () => { if (inlineKey === nextInline) inlineKey = undefined; });
  }
  const key = JSON.stringify([folded, scale, controls]);
  if (key === displayKey) return;
  displayKey = key;
  void ensureInrayDisplayModule(folded, scale, controls).then(ok => {
    if (!ok && displayKey === key) displayKey = undefined;
  }, () => { if (displayKey === key) displayKey = undefined; });
}

/** At most one write and one latest snapshot wait behind the storage lock. */
export function persistSettingsSnapshot(verify: boolean): Promise<void> {
  const snapshot = deepcopy(getConfig());
  const result = new Promise<void>((resolve, reject) => {
    if (pending) {
      pending.snapshot = snapshot;
      pending.verify ||= verify;
      pending.waiting.push({ resolve, reject });
    } else pending = { snapshot, verify, waiting: [{ resolve, reject }] };
  });
  if (!running) {
    running = true;
    void drain();
  }
  return result;
}

async function drain(): Promise<void> {
  try {
    while (pending) {
      // Claim only after acquiring the lock, so edits during another write
      // replace a queued snapshot instead of building an unbounded backlog.
      await configLock.run(async () => {
        const batch = pending!;
        pending = null;
        try {
          await saveSettingsToStorage(batch.snapshot, { verify: batch.verify });
          syncDisplay(batch.snapshot);
          batch.waiting.forEach(waiter => waiter.resolve());
        } catch (error) {
          batch.waiting.forEach(waiter => waiter.reject(error));
        }
      });
    }
  } finally { running = false; }
}
