import { risuHost, writeHostDatabase } from '../core/host';
import { PLACE_MODULE, placeModule } from '../domain/viewer/place';
import { serializeModuleWrite } from './module-write';
import { sleep } from '../core/util/async';

type ModuleRow = RisuModule & { id?: string };

/**
 * Installs or updates `⚛️ omni place` and switches it on or off (옴니 뷰어 설정 ·
 * 배경). Off keeps the module but not enabled: the writer is no longer asked for
 * places, and marks already written stay hidden only while it is on.
 */
export async function ensurePlaceModule(on: boolean): Promise<void> {
  return serializeModuleWrite(async () => {
    const host = risuHost();
    if (!host?.getDatabase || !host.setDatabase) throw new Error('Risu 모듈 저장 API를 사용할 수 없습니다.');
    if (host.requestPluginPermission && !await host.requestPluginPermission('db')) throw new Error('장소 모듈 설치에 Risu 데이터 접근 허용이 필요합니다.');
    const db = await host.getDatabase(['modules', 'enabledModules']);
    if (!db) throw new Error('Risu 모듈 목록을 읽지 못했습니다.');
    const modules: ModuleRow[] = Array.isArray(db.modules) ? [...db.modules] : [];
    const previous: string[] = Array.isArray(db.enabledModules) ? [...db.enabledModules] : [];
    const id = PLACE_MODULE.id, index = modules.findIndex(m => m.id === id);
    // Never installed and not wanted: nothing to write.
    if (index < 0 && !on) return;
    const module = placeModule();
    if (index < 0) modules.push(module); else modules[index] = { ...modules[index], ...module };
    const enabled = [...previous.filter(x => x !== id), ...(on ? [id] : [])];
    const changedModules = JSON.stringify(modules) !== JSON.stringify(db.modules);
    if (!changedModules && JSON.stringify(enabled) === JSON.stringify(previous)) return;
    // Risu caches enabled module objects by id: a changed module goes off for one frame, then on.
    if (changedModules && on && previous.includes(id)) {
      await writeHostDatabase({ modules, enabledModules: enabled.filter(x => x !== id) });
      await sleep(16);
    }
    await writeHostDatabase({ modules, enabledModules: enabled });
  });
}
