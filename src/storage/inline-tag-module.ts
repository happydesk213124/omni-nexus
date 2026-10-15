import { risuHost } from '../core/host';
import { sleep } from '../core/util/async';
import { asShotAssetRows } from '../domain/gallery/shot-assets';
import { inlineShotDisplayScripts, inlineShotRequestScript } from '../domain/inray-display';
import { serializeModuleWrite } from './module-write';

export const INLINE_TAG_MODULE_ID = 'omni-inline-tags';
export const INLINE_TAG_MODULE_NAME = '⚛️ omni 스트리밍태그';
type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => asShotAssetRows(value).filter((v): v is Row => !!v && typeof v === 'object');
const ours = (row: Row) => /^omni-inline-shot-/.test(String(row.comment || ''));

/**
 * The module only draws and hides blocks. The tagging rules themselves are not
 * a lorebook entry: Risu's lorebook budget (800 tokens unless raised) drops an
 * entry that large without a word, so `beforeRequest` places them instead.
 * Switched off, the module stays installed but disabled.
 */
export function ensureInlineTagModule(enabled: boolean, scalePct: unknown = 100, pending = false): Promise<boolean> {
  return serializeModuleWrite(async () => {
    const host = risuHost();
    if (!host?.getDatabase || !host.setDatabase) return false;
    if (host.requestPluginPermission && !await host.requestPluginPermission('db')) return false;
    const db = await host.getDatabase(['modules', 'enabledModules']);
    if (!db) return false;
    const modules = rows(db.modules);
    const index = modules.findIndex(m => m.id === INLINE_TAG_MODULE_ID || m.namespace === INLINE_TAG_MODULE_ID);
    if (index < 0 && !enabled) return true;
    const previous = index < 0 ? {} : modules[index]!;
    // A user's own rules in this module stay; ours are rewritten.
    const regex = [...inlineShotDisplayScripts(scalePct, pending), inlineShotRequestScript(), ...rows(previous.regex).filter(row => !ours(row))];
    const module = { ...previous, id: INLINE_TAG_MODULE_ID, namespace: INLINE_TAG_MODULE_ID, name: INLINE_TAG_MODULE_NAME,
      description: 'Risu 메인 모델이 답장 안에 쓴 [[inxN]] 샷을 스피너 칸으로 그립니다. 생성은 Omni Nexus 플러그인이 합니다.',
      hideIcon: false, lowLevelAccess: false, lorebook: rows(previous.lorebook), trigger: rows(previous.trigger), assets: rows(previous.assets), regex };
    if (index < 0) modules.push(module); else modules[index] = module;
    const current = asShotAssetRows(db.enabledModules).map(String);
    const next = current.filter(id => id !== INLINE_TAG_MODULE_ID);
    if (enabled) next.push(INLINE_TAG_MODULE_ID);
    const changed = JSON.stringify(db.modules) !== JSON.stringify(modules);
    if (!changed && JSON.stringify(current) === JSON.stringify(next)) return true;
    // Risu caches enabled modules by their id list: a changed module that stays
    // enabled is switched off for one frame so the new rules are read.
    if (changed && enabled && current.includes(INLINE_TAG_MODULE_ID)) {
      await host.setDatabase({ modules: modules as never, enabledModules: next.filter(id => id !== INLINE_TAG_MODULE_ID) });
      await sleep(16);
    }
    await host.setDatabase({ modules: modules as never, enabledModules: next });
    return true;
  });
}
