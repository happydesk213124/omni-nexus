import type { SoundItem, SoundKind, SoundSettings } from '../../core/sound-types';
import { bgmPromptText } from './tags';

export const SOUND_MODULES: Record<SoundKind, { id: string; name: string; description: string }> = {
  bgm: { id: 'omni-bgm', name: '⚛️ omni bgm', description: 'BGM 파일과 [[bgm:…]] 표시. 재생은 Omni Nexus 플러그인이 담당합니다.' },
  sfx: { id: 'omni-sfx', name: '⚛️ omni 효과음', description: '효과음 파일과 효과음 버튼. 재생은 Omni Nexus 플러그인이 담당합니다.' },
};
/**
 * Display order: before the OmniTTS rules (-10200…), so the BGM marker is a
 * button by the time TTS looks for lines to read, and after every module that
 * keeps the default order (higher runs first).
 */
export const SOUND_DISPLAY_ORDER = { bgm: -10120, sfx: -10130 } as const;

const BUTTON = 'display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;width:22px;height:22px;margin:0 0 0 .3em;padding:0;'
  + 'border-radius:50%;border:1px solid #9aa3b5;background:#3b4150;color:#e7eaf0;font-size:12px;line-height:1;cursor:pointer';
const bgmButton = `<span data-omni-bgm-tail="1"><button type="button" data-omni-bgm="1" x-omni-bgm="1" title="BGM 재생" aria-label="BGM 재생" style="${BUTTON}">♪</button></span>`;
const sfxButton = `<span data-omni-sfx-tail="1"><button type="button" data-omni-sfx="1" x-omni-sfx="1" title="효과음 재생" aria-label="효과음 재생" style="${BUTTON}">▶</button></span>`;

/** Module assets for files stored in this kind's module: [name, path, name]. */
function assets(items: readonly SoundItem[]): [string, string, string][] {
  return items.filter(item => item.source === 'asset' && item.assetName && item.assetPath).map(item => [item.assetName!, item.assetPath!, item.assetName!]);
}

export function soundModule(kind: SoundKind, settings: SoundSettings, items: readonly SoundItem[]): RisuModule {
  const meta = SOUND_MODULES[kind];
  const regex = kind === 'bgm'
    // The whole marker line becomes a quiet ♪ control; the text itself is untouched in the chat log.
    ? [{ comment: 'omni-bgm-marker', type: 'editdisplay', ableFlag: true, flag: `gi<order ${SOUND_DISPLAY_ORDER.bgm}>`, in: '\\[\\[bgm:[^\\]\\n]{1,200}\\]\\][ \\t]*', out: bgmButton }]
    : settings.sfxRules.filter(rule => rule.enabled && rule.pattern).map(rule => ({
      comment: `omni-sfx-${rule.id}`, type: 'editdisplay', ableFlag: true,
      flag: `g${rule.flags.replace(/[^imsu]/g, '')}<order ${SOUND_DISPLAY_ORDER.sfx}>`, in: `(${rule.pattern})`, out: `$1${sfxButton}`,
    }));
  const lorebook = kind === 'bgm' && settings.bgmPrompt
    ? [{ key: '', secondkey: '', comment: 'omni-bgm-cues', content: `@@depth 0\n<OmniBGM>\n${bgmPromptText(settings.bgmTags)}\n</OmniBGM>`, mode: 'normal', insertorder: 998, alwaysActive: true, selective: false, useRegex: false, bookVersion: 2 }]
    : [];
  return { id: meta.id, namespace: meta.id, name: meta.name, description: meta.description, hideIcon: false, lowLevelAccess: false, trigger: [], lorebook, regex, assets: assets(items) };
}
