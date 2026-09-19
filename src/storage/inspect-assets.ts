/** Exact-name reads for inspect, including gallery files saved before character ownership. */
import { risuHost } from '../core/host';
import { listShotAssets } from './shot-character';
import { idFromShotAssetName, isShotAssetName, parseShotModuleAssets, SHOT_MODULE_ID, SHOT_MODULE_NS } from '../domain/gallery/shot-assets';

export async function findInspectAsset(name: string, cardId = ''): Promise<{ name: string; path: string } | undefined> {
  const matches = (asset: { name: string }) => name ? asset.name === name : idFromShotAssetName(asset.name) === cardId;
  const live = (await listShotAssets()).find(matches);
  if (live) return live;
  // Read-only fallback: never activate modules or rewrite the legacy tuple list.
  const db = await risuHost()?.getDatabase?.(['modules']);
  for (const module of Array.isArray(db?.modules) ? db.modules : []) {
    if (module.id !== SHOT_MODULE_ID && module.namespace !== SHOT_MODULE_NS) continue;
    for (const [assetName, path] of parseShotModuleAssets(module.assets)) {
      if (isShotAssetName(assetName) && matches({ name: assetName })) return { name: assetName, path };
    }
  }
  return undefined;
}
