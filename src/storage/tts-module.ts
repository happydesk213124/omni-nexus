import { risuHost } from '../core/host';
import { OMNI_TTS_MODULE, ttsModule } from '../domain/tts/module';
import type { TtsSettings } from '../core/tts-types';
import { serializeModuleWrite } from './module-write';

export async function ensureTtsModule(settings: TtsSettings): Promise<void> {
  return serializeModuleWrite(async () => {
    const host = risuHost();
    if (!host?.getDatabase || !host.setDatabase) throw new Error('Risu 모듈 저장 API를 사용할 수 없습니다.');
    if (host.requestPluginPermission && !await host.requestPluginPermission('db')) throw new Error('OmniTTS 모듈 설치에 Risu 데이터 접근 허용이 필요합니다.');
    const db = await host.getDatabase(['modules', 'enabledModules']);
    if (!db) throw new Error('Risu 모듈 목록을 읽지 못했습니다.');
    const modules = Array.isArray(db.modules) ? [...db.modules] : [];
    const index = modules.findIndex(m => m.id === OMNI_TTS_MODULE);
    const module = ttsModule(settings);
    if (index < 0) modules.push(module); else modules[index] = { ...modules[index], ...module };
    const enabled: string[] = (Array.isArray(db.enabledModules) ? db.enabledModules : []).filter(id => id !== OMNI_TTS_MODULE);
    if (settings.enabled) enabled.push(OMNI_TTS_MODULE);
    if (JSON.stringify(modules) !== JSON.stringify(db.modules) || JSON.stringify(enabled) !== JSON.stringify(db.enabledModules)) {
      await host.setDatabase({ modules, enabledModules: enabled });
    }
  });
}
