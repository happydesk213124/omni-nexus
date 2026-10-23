import { risuHost } from '../core/host';
import { extractNaiMetadata, naiMetaHasPrompt } from '../domain/nai-meta/index';
import type { RisuNamedAsset } from '../domain/nai-meta/risu-asset-list';
import { openAssetDialog, type AssetDialogUi } from './asset-dialog';

// An asset key names its content, so what one picture holds is read once per page.
const verdicts = new Map<string, boolean>();

/** NovelAI's recipe with a prompt, from the text chunks or the alpha channel. */
async function hasNaiPrompt(blob: Blob): Promise<boolean> {
  try {
    const meta = await extractNaiMetadata(new Uint8Array(await blob.arrayBuffer()));
    return !!meta && naiMetaHasPrompt(meta);
  } catch { return false; }
}

type PresetFromImage = (file: File, assetName?: string) => Promise<boolean>;

/**
 * 스타일 프리셋 › 에셋에서·모듈에서: the open chat's character assets or an
 * enabled module's, and the one tapped becomes a preset as 이미지 프리셋 로드
 * makes one from a file. "메타데이터 있는 것만" opens every matching picture
 * to look (two at a time), which takes a while on a large module.
 */
export async function pickPresetAsset(source: 'character' | 'module'): Promise<void> {
  const host = risuHost();
  const onlyLabel = document.createElement('label');
  const only = document.createElement('input'); only.type = 'checkbox'; only.dataset.presetAssetMeta = '1';
  onlyLabel.append(only, ' 메타데이터 있는 것만 (그림을 하나씩 열어 봐서 오래 걸릴 수 있습니다)');
  let scan = 0, scanning = false;
  const count = (assets: RisuNamedAsset[]) => assets.filter(asset => verdicts.get(asset.key) === true).length;
  const look = async (ui: AssetDialogUi) => {
    const token = ++scan, matched = ui.matched(), todo = matched.filter(asset => !verdicts.has(asset.key));
    if (!todo.length) return;
    scanning = true;
    let done = matched.length - todo.length;
    const progress = () => ui.status(`메타데이터 찾는 중… ${done}/${matched.length}개 확인 · ${count(matched)}개 찾음 (오래 걸릴 수 있습니다)`);
    progress();
    const next = async (): Promise<void> => {
      for (let asset = todo.shift(); asset; asset = todo.shift()) {
        if (token !== scan || ui.closed()) return;
        const blob = await ui.read(asset).catch(() => null);
        verdicts.set(asset.key, !!blob && await hasNaiPrompt(blob));
        done++;
        if (token === scan && !ui.closed()) progress();
      }
    };
    await Promise.all([next(), next()]);
    if (token !== scan || ui.closed()) return;
    scanning = false;
    // Drawn once at the end: redrawing on every find would throw the reader's scroll back to the top.
    ui.render();
  };
  let dialogUi: AssetDialogUi | undefined;
  only.onchange = () => { scan++; scanning = false; dialogUi?.render(); };
  await openAssetDialog({
    source, label: source === 'module' ? '모듈 그림으로 스타일 프리셋' : '캐릭터 에셋으로 스타일 프리셋',
    characterIndex: Promise.resolve(host?.getCurrentCharacterIndex?.()),
    extras: [onlyLabel],
    visible: asset => !only.checked || verdicts.get(asset.key) === true,
    describe: (shown, ui) => {
      if (!only.checked) return shown ? `${shown}개 에셋 · 누르면 그 그림의 메타데이터로 프리셋을 만듭니다` : '일치하는 에셋이 없습니다.';
      const matched = ui.matched();
      return matched.every(asset => verdicts.has(asset.key))
        ? `메타데이터 있는 그림 ${shown}개 (${matched.length}개 중)` : '메타데이터 찾는 중…';
    },
    onRender: ui => {
      dialogUi = ui;
      if (only.checked && !scanning) void look(ui);
      else if (!only.checked) scan++;
    },
    pick: async (asset, blob, ui) => {
      ui.status('메타데이터 읽는 중…');
      const has = verdicts.get(asset.key) ?? await hasNaiPrompt(blob);
      verdicts.set(asset.key, has);
      if (!has) { ui.status(`「${asset.name}」에는 NovelAI 메타데이터(텍스트·알파값)가 없습니다.`); return; }
      const fromImage = Reflect.get(globalThis, '__OMNI_PRESET_FROM_IMAGE__') as PresetFromImage | undefined;
      if (typeof fromImage !== 'function') throw new Error('이미지 프리셋 연결을 찾을 수 없습니다.');
      ui.status('프리셋 만드는 중…');
      const made = await fromImage(new File([blob], asset.name, { type: blob.type || 'image/png' }), asset.name);
      // A failure is shown by the settings page itself (e.g. no artist/quality tags after the filter).
      if (made) ui.close(); else ui.status('프리셋을 만들지 못했습니다. 설정창 위의 안내를 확인하세요.');
    },
  });
}
