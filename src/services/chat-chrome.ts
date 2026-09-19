/**
 * PocketRisu Standard keeps avatar + name on the same card as the message.
 * Reused Chat instances keep a smashed header until the mount hash changes.
 * largePortrait is in that hash; flip then restore remounts without keeping the flip.
 *
 * setChar is sync. Flip+restore in one tick is batched — hash never changes.
 * Yield so Chats $effect remounts on the flipped hash before we restore.
 *
 * A remount is not enough on its own: an enabled module carrying `hideIcon`
 * makes the host skip the header entirely, which is why the header used to stay
 * gone across reloads and even after uninstalling the plugin.
 */
import { hostHas, risuHost } from '../core/host';
import { sleep } from '../core/util/async';
import { clearCharRefHideIcon } from './char-ref-module';

/** Longer than a Svelte flush / one frame so mount() finishes before the next write. */
const REMOUNT_FLUSH_MS = 50;

async function ensureDbAccess(): Promise<void> {
  const host = risuHost();
  if (typeof host?.requestPluginPermission === 'function') {
    try {
      await host.requestPluginPermission('db');
    } catch {
      // Already granted or older host.
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

async function remountCharacterCards(): Promise<boolean> {
  const host = risuHost();
  const getChar = hostHas('getCharacter') ? host?.getCharacter : hostHas('getChar') ? host?.getChar : null;
  const setChar = hostHas('setCharacter') ? host?.setCharacter : hostHas('setChar') ? host?.setChar : null;
  if (!getChar || !setChar) return false;
  const char = asRecord(await getChar());
  if (!char) return false;
  const prev = Boolean(char.largePortrait);
  await setChar({ ...char, largePortrait: !prev });
  await sleep(REMOUNT_FLUSH_MS);
  const live = asRecord(await getChar()) || char;
  await setChar({ ...live, largePortrait: prev });
  await sleep(REMOUNT_FLUSH_MS);
  return true;
}

async function remountPersonaCards(): Promise<boolean> {
  if (!hostHas('getDatabase') || !hostHas('setDatabase')) return false;
  await ensureDbAccess();
  const host = risuHost()!;
  const db = asRecord(await host.getDatabase!(['personas', 'selectedPersona']));
  const personas = (Array.isArray(db?.personas) ? db.personas : [])
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => Boolean(row));
  if (!personas.length) return false;
  const selected = Number(db?.selectedPersona);
  const idx = Number.isInteger(selected) && selected >= 0 && selected < personas.length ? selected : 0;
  const persona = personas[idx];
  if (!persona) return false;
  const prev = Boolean(persona.largePortrait);
  const flip = personas.map((row, i) => (i === idx ? { ...row, largePortrait: !prev } : row));
  await host.setDatabase!({ personas: flip as never });
  await sleep(REMOUNT_FLUSH_MS);
  const after = asRecord(await host.getDatabase!(['personas', 'selectedPersona']));
  const live = (Array.isArray(after?.personas) ? after.personas : [])
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => Boolean(row));
  const rows = live.length === personas.length ? live : personas;
  const restore = rows.map((row, i) => (i === idx ? { ...row, largePortrait: prev } : row));
  await host.setDatabase!({ personas: restore as never });
  await sleep(REMOUNT_FLUSH_MS);
  return true;
}

export async function remountChatCardChrome(): Promise<{ ok: true; remounted: boolean }> {
  // A remount cannot bring the header back while the host is told to hide it,
  // so drop that flag first — otherwise the card re-renders headerless.
  await clearCharRefHideIcon().catch(() => ({ cleared: false, blockedBy: [] }));
  const charOk = await remountCharacterCards().catch(() => false);
  const personaOk = await remountPersonaCards().catch(() => false);
  return { ok: true, remounted: Boolean(charOk || personaOk) };
}
