import { risuHost } from '../core/host';
import type { SoundData, SoundKind } from '../core/sound-types';
import { SOUND_MODULES, soundModule } from '../domain/sound/module';
import { serializeModuleWrite } from './module-write';
import { sleep } from '../core/util/async';

type ModuleRow = RisuModule & { id?: string };

/**
 * Installs or updates `⚛️ omni bgm` / `⚛️ omni 효과음`. A kind that is switched
 * off keeps its module (and the stored files) but is not enabled, so the chat
 * shows no controls for it.
 */
export async function ensureSoundModules(data: SoundData): Promise<void> {
  return serializeModuleWrite(async () => {
    const host = risuHost();
    if (!host?.getDatabase || !host.setDatabase) throw new Error('Risu 모듈 저장 API를 사용할 수 없습니다.');
    if (host.requestPluginPermission && !await host.requestPluginPermission('db')) throw new Error('BGM·효과음 모듈 설치에 Risu 데이터 접근 허용이 필요합니다.');
    const db = await host.getDatabase(['modules', 'enabledModules']);
    if (!db) throw new Error('Risu 모듈 목록을 읽지 못했습니다.');
    const modules: ModuleRow[] = Array.isArray(db.modules) ? [...db.modules] : [];
    const previous: string[] = Array.isArray(db.enabledModules) ? [...db.enabledModules] : [];
    let enabled = [...previous];
    for (const kind of ['bgm', 'sfx'] as const) {
      const on = kind === 'bgm' ? data.settings.bgmEnabled : data.settings.sfxEnabled;
      const items = kind === 'bgm' ? data.bgm : data.sfx;
      const id = SOUND_MODULES[kind].id, index = modules.findIndex(m => m.id === id);
      // A module that never held anything is only created once it is needed.
      if (index < 0 && !on && !items.some(item => item.source === 'asset')) continue;
      const module = soundModule(kind, data.settings, items);
      if (index < 0) modules.push(module); else modules[index] = { ...modules[index], ...module };
      enabled = enabled.filter(x => x !== id);
      if (on) enabled.push(id);
    }
    const changedModules = JSON.stringify(modules) !== JSON.stringify(db.modules);
    if (!changedModules && JSON.stringify(enabled) === JSON.stringify(previous)) return;
    // Same reason as OmniTTS: Risu caches enabled module objects by id, so a
    // changed module is disabled for one frame and enabled again.
    const reenable = enabled.filter(id => previous.includes(id) && changedModules);
    if (reenable.length) {
      await host.setDatabase({ modules, enabledModules: enabled.filter(id => !reenable.includes(id)) });
      await sleep(16);
    }
    await host.setDatabase({ modules, enabledModules: enabled });
  });
}

/** Stores an audio file in Risu asset storage and proves it reads back. */
export async function storeSoundBytes(bytes: ArrayBuffer): Promise<string> {
  const host = risuHost();
  if (!host?.saveAsset || !host.readImage) throw new Error('이 Risu 환경에서는 파일을 모듈에 저장할 수 없습니다.');
  const path = String(await host.saveAsset(new Uint8Array(bytes)) || '');
  if (!path) throw new Error('파일 저장에 실패했습니다.');
  const back = await readSoundAsset(path);
  if (!back || back.byteLength !== bytes.byteLength) throw new Error('저장한 파일을 다시 읽지 못했습니다.');
  return path;
}
export async function readSoundAsset(path: string): Promise<ArrayBuffer | null> {
  const host = risuHost();
  if (!host?.readImage || !path) return null;
  const data: unknown = await host.readImage(path);
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.arrayBuffer();
  if (data instanceof ArrayBuffer) return data;
  if (data instanceof Uint8Array) return data.slice().buffer as ArrayBuffer;
  return null;
}
export const soundModuleId = (kind: SoundKind): string => SOUND_MODULES[kind].id;
