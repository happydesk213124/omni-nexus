/**
 * The one-time move of pre-2.5 data into its 2.5 shape.
 *
 * Two things happen here. Gallery pixels that still sit in legacy key/value rows
 * (`onx_nximg_*`, or 1.x's save-file `nximg_*`) move into the Risu gallery
 * module, which is where every newly generated shot already goes. And the
 * retention passes that boot has been running on every single start — they only
 * ever find pre-2.5 rows — run once here instead.
 *
 * Finishing writes a stamp (`MIGRATION_META_KEY`); `openDb` reads it and stops
 * scanning. Nothing here is required: an unmigrated install keeps working
 * through the lazy read path, just slower.
 *
 * Deleting the originals is irreversible, so it happens per image and only
 * after `putShotAssetsBatch` has read the bytes back out of the module.
 */
import {
  IMAGE_KEY,
  LEGACY_IMAGE_KEY,
  LEGACY_REF_IMAGE_KEY,
  LEGACY_SETTINGS_KEY,
  LEGACY_STORE_KEY,
  MIGRATION_VERSION,
  STORE_NAMES,
} from '../core/constants';
import { dbg } from '../core/debug';
import { sleep } from '../core/util/async';
import { importLegacyDeviceRows, psRemove, saveFileRemove } from '../storage/device-store';
import { migrateAppearanceToCharacters, migrateCharacterIdentity } from './characters';
import { putShotAssetsBatch, shotModuleAvailable } from '../storage/shot-module';
import {
  flushPersist,
  imagePng,
  legacyImageRows,
  persistStoreNow,
  runRetentionCleanup,
  setImageAssetPath,
  setPauseDiskPersist,
  stampStorageMigrated,
  storageMigratedVersion,
  type LegacyImageRow,
} from '../storage/stores';

export type MigratePhase = 'idle' | 'images' | 'cleanup' | 'purge' | 'done' | 'cancelled' | 'error';

export interface MigrateStatus {
  running: boolean;
  phase: MigratePhase;
  done: number;
  total: number;
  failed: number;
  freed_bytes: number;
  error: string;
  finished_at: number;
  migrated_version: number;
}

/**
 * One Risu DB commit per this many images. Larger means fewer commits and a
 * longer stretch during which the UI cannot repaint; 25 keeps each commit well
 * under a frame budget on a slow phone.
 */
const BATCH = 25;

let state: MigrateStatus = {
  running: false,
  phase: 'idle',
  done: 0,
  total: 0,
  failed: 0,
  freed_bytes: 0,
  error: '',
  finished_at: 0,
  migrated_version: 0,
};

let cancelRequested = false;

export function getMigrateStatus(): MigrateStatus {
  return { ...state };
}

export function cancelStorageMigration(): { ok: true; cancelling: boolean } {
  if (!state.running) return { ok: true, cancelling: false };
  cancelRequested = true;
  return { ok: true, cancelling: true };
}

/** Legacy save-file copies of whole stores. Superseded by the `onx_`-prefixed keys. */
function legacySaveFileKeys(): string[] {
  return [
    ...STORE_NAMES.map((name) => LEGACY_STORE_KEY(name)),
    LEGACY_SETTINGS_KEY,
    LEGACY_REF_IMAGE_KEY,
  ];
}

async function migrateImages(rows: LegacyImageRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    if (cancelRequested) return;
    const batch = rows.slice(i, i + BATCH);
    const entries: Array<{ id: string; bytes: ArrayBuffer; bytes_len: number; session_id: string }> = [];

    for (const row of batch) {
      const png = await imagePng(row.id);
      if (png) entries.push({ id: row.id, bytes: png, bytes_len: png.byteLength, session_id: row.session_id });
      else state.done += 1; // has_png with no bytes anywhere: nothing to move.
      // Decoding base64 is CPU work on the UI thread. Yielding between images is
      // the only thing keeping a large gallery from freezing Risu outright.
      await sleep(0);
    }

    if (!entries.length) continue;
    const saved = await putShotAssetsBatch(
      entries.map((e) => ({ id: e.id, bytes: e.bytes, session_id: e.session_id })),
    );
    const byId = new Map(saved.map((row) => [row.id, row]));

    for (const entry of entries) {
      const hit = byId.get(entry.id);
      if (!hit) {
        state.failed += 1;
        continue;
      }
      await setImageAssetPath(entry.id, hit.path, hit.name);
      // Safe now, and only now: the batch read the bytes back out of the module.
      await psRemove(IMAGE_KEY(entry.id));
      await saveFileRemove(LEGACY_IMAGE_KEY(entry.id));
      state.freed_bytes += entry.bytes_len;
      state.done += 1;
    }

    await persistStoreNow('images');
    await sleep(0);
  }
}

async function run(rows: LegacyImageRow[]): Promise<void> {
  setPauseDiskPersist(true);
  try {
    state.phase = 'images';
    if (shotModuleAvailable()) await migrateImages(rows);
    else state.failed = rows.length;

    if (!cancelRequested) {
      state.phase = 'cleanup';
      // Boot skips these once stamped, so this is the run that has to do them.
      await migrateAppearanceToCharacters();
      await migrateCharacterIdentity();
      const cleaned = await runRetentionCleanup();
      dbg('storage.migrate.cleanup', { message: JSON.stringify(cleaned) });

      state.phase = 'purge';
      for (const key of legacySaveFileKeys()) await saveFileRemove(key);
    }

    if (!cancelRequested && state.failed === 0) {
      // A failed image still has its only copy in a legacy row, and the stamp is
      // what stops the lazy read path from looking there. Leaving it unstamped
      // keeps those images reachable at the cost of one more boot scan.
      state.migrated_version = await stampStorageMigrated(MIGRATION_VERSION);
    }
    state.phase = cancelRequested ? 'cancelled' : 'done';
  } catch (err) {
    state.phase = 'error';
    state.error = String((err as Error)?.message || err);
    dbg('storage.migrate', { message: state.error }, 'error');
  } finally {
    setPauseDiskPersist(false);
    // The pause silently dropped any snapshot another writer scheduled while we
    // ran, so rewrite everything rather than leaving a store stale on disk.
    for (const name of STORE_NAMES) {
      await persistStoreNow(name).catch(() => {});
    }
    await flushPersist();
    state.running = false;
    state.finished_at = Date.now();
    cancelRequested = false;
    dbg('storage.migrate.done', {
      message: state.phase,
      done: state.done,
      total: state.total,
      failed: state.failed,
      bytes: state.freed_bytes,
    });
  }
}

export interface MigrateStart {
  ok: true;
  started: boolean;
  total: number;
  status: MigrateStatus;
}

/**
 * Starts the migration and returns immediately — the UI polls `status`.
 *
 * Re-entrant by construction: a row that already has `asset_path` is not in the
 * scan, so pressing the button again after a cancel or a crash resumes rather
 * than redoing work.
 */
export async function startStorageMigration(): Promise<MigrateStart> {
  await importLegacyDeviceRows();
  if (state.running) return { ok: true, started: false, total: state.total, status: getMigrateStatus() };
  const migratedVersion = await storageMigratedVersion();
  const rows = await legacyImageRows();
  cancelRequested = false;
  state = {
    running: true,
    phase: 'images',
    done: 0,
    total: rows.length,
    failed: 0,
    freed_bytes: 0,
    error: '',
    finished_at: 0,
    migrated_version: migratedVersion,
  };
  dbg('storage.migrate.start', { message: `${rows.length} images`, total: rows.length });
  void run(rows);
  return { ok: true, started: true, total: rows.length, status: getMigrateStatus() };
}

/** Whether the dashboard should still be offering the button. */
export async function storageMigrateInfo(): Promise<{
  ok: true;
  migrated_version: number;
  pending_images: number;
  status: MigrateStatus;
}> {
  const migratedVersion = await storageMigratedVersion();
  const pending = migratedVersion >= MIGRATION_VERSION ? [] : await legacyImageRows();
  return {
    ok: true,
    migrated_version: migratedVersion,
    pending_images: pending.length,
    status: getMigrateStatus(),
  };
}
