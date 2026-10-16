import { risuHost } from '../core/host';
import { OMNI_TTS_MODULE, ttsModule, type TtsSfxMarks } from '../domain/tts/module';
import type { TtsSettings } from '../core/tts-types';
import { serializeModuleWrite } from './module-write';
import { sleep } from '../core/util/async';

export async function ensureTtsModule(settings: TtsSettings, sfxMarks: TtsSfxMarks = []): Promise<void> {
  return serializeModuleWrite(async () => {
    const host = risuHost();
    if (!host?.getDatabase || !host.setDatabase) throw new Error('Risu 모듈 저장 API를 사용할 수 없습니다.');
    if (host.requestPluginPermission && !await host.requestPluginPermission('db')) throw new Error('OmniTTS 모듈 설치에 Risu 데이터 접근 허용이 필요합니다.');
    const db = await host.getDatabase(['modules', 'enabledModules']);
    if (!db) throw new Error('Risu 모듈 목록을 읽지 못했습니다.');
    const modules = Array.isArray(db.modules) ? [...db.modules] : [];
    const index = modules.findIndex(m => m.id === OMNI_TTS_MODULE);
    const module = ttsModule(settings, sfxMarks);
    if (index < 0) modules.push(module); else modules[index] = { ...modules[index], ...module };
    const previous: string[] = Array.isArray(db.enabledModules) ? [...db.enabledModules] : [];
    const enabled = previous.filter(id => id !== OMNI_TTS_MODULE);
    if (settings.enabled) enabled.splice(previous.includes(OMNI_TTS_MODULE) ? previous.indexOf(OMNI_TTS_MODULE) : enabled.length,0,OMNI_TTS_MODULE);
    if (JSON.stringify(modules) !== JSON.stringify(db.modules) || JSON.stringify(enabled) !== JSON.stringify(db.enabledModules)) {
      // Risu caches module objects by active IDs. Replacing the object with
      // unchanged IDs leaves both editDisplay and the rendered chat stale.
      if (settings.enabled && previous.includes(OMNI_TTS_MODULE) && JSON.stringify(modules) !== JSON.stringify(db.modules)) {
        await host.setDatabase({ modules, enabledModules: previous.filter(id => id !== OMNI_TTS_MODULE) });
        try { await sleep(16); }
        finally {
          const current = await host.getDatabase(['enabledModules']);
          const active = (Array.isArray(current?.enabledModules) ? current.enabledModules : enabled).filter(id => id !== OMNI_TTS_MODULE);
          active.splice(Math.min(previous.indexOf(OMNI_TTS_MODULE),active.length),0,OMNI_TTS_MODULE);
          await host.setDatabase({ enabledModules: active });
          await sleep(16);
        }
      } else await host.setDatabase({ modules, enabledModules: enabled });
    }
  });
}
