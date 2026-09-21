import type { Settings } from '../core/types';
import { deepcopy } from '../core/util/object';
import { ensureInrayDisplayModule } from '../storage/inray-display-module';
import { saveSettingsToStorage } from '../storage/settings-store';
import { configLock, getConfig } from './context';

type Waiting = { resolve: () => void; reject: (error: unknown) => void };
type Pending = { snapshot: Settings; verify: boolean; waiting: Waiting[] };
let pending: Pending | null = null;
let running = false;
let displayKey: string | undefined;

function syncDisplay(snapshot: Settings): void {
  const card = snapshot.card;
  const folded = card?.persist_chat_images_folded === true;
  const scale = card?.inline_chat_scale_pct;
  const controls = { enabled: card?.inline_msg_fan === true, userchat: card?.userchat === true };
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
