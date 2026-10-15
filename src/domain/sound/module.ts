import type { SfxRule, SoundItem, SoundKind, SoundSettings } from '../../core/sound-types';
import { bgmPromptText } from './tags';
import { sfxMarksProblem, sfxRuleSource } from './audio';

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

// Like the OmniTTS control: the glyph is CSS only, so the line's text (which
// TTS reads and matches against the source) carries no ♪ or ▶ of its own.
const BUTTON = (selector: string, glyph: string, size: number) => `${selector}{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;box-sizing:border-box;width:22px;height:22px;min-width:0;min-height:0;margin:0 0 0 .3em;padding:0;`
  + `border-radius:50%;border:1px solid #9aa3b5;background:#3b4150;color:#e7eaf0;font-size:${size}px;line-height:1;cursor:pointer;box-shadow:none}${selector}::before{content:"${glyph}"}${selector}:hover{background:#525a6c}`;
export const SOUND_MODULE_CSS: Record<SoundKind, string> = { bgm: BUTTON('[data-omni-bgm]', '♪', 12), sfx: BUTTON('[data-omni-sfx]', '▶', 9) };
const bgmButton = '<span data-omni-bgm-tail="1"><button type="button" data-omni-bgm="1" x-omni-bgm="1" title="BGM 재생" aria-label="BGM 재생"></button></span>';
const sfxButton = '<span data-omni-sfx-tail="1"><button type="button" data-omni-sfx="1" x-omni-sfx="1" title="효과음 재생" aria-label="효과음 재생"></button></span>';
/** The built-in rule: § 효과음 §. */
export const SFX_SECTION_RULE = 'section-sign';
/** The effect instruction, in the marks of the rule the chat will show. */
export function sfxCuePrompt(rule: Pick<SfxRule, 'open' | 'close'>): string {
  return `@@depth 0
<OmniSFX>
Sound effects: when a distinct sound happens in the scene (a door slams, thunder, footsteps, a gunshot), write a short sound word between ${rule.open} and ${rule.close} right where it happens, e.g. 문이 ${rule.open}쾅${rule.close} 닫혔다.
Keep each one short (one to four words, in the story language), at most five per reply, and never inside dialogue quotes, names or code. Never explain the marks.
</OmniSFX>`;
}
export const SFX_CUE_PROMPT = sfxCuePrompt({ open: '§', close: '§' });

/** Module assets for files stored in this kind's module: [name, path, name]. */
function assets(items: readonly SoundItem[]): [string, string, string][] {
  return items.filter(item => item.source === 'asset' && item.assetName && item.assetPath).map(item => [item.assetName!, item.assetPath!, item.assetName!]);
}

export function soundModule(kind: SoundKind, settings: SoundSettings, items: readonly SoundItem[]): RisuModule {
  const meta = SOUND_MODULES[kind];
  const rules = settings.sfxRules.filter(rule => rule.enabled && !sfxMarksProblem(rule.open, rule.close));
  const regex = kind === 'bgm'
    // The whole marker line becomes a quiet ♪ control; the text itself is untouched in the chat log.
    // no_end_nl: Risu otherwise adds a line break after an output that ends in `>`.
    ? [{ comment: 'omni-bgm-marker', type: 'editdisplay', ableFlag: true, flag: `gi<order ${SOUND_DISPLAY_ORDER.bgm},no_end_nl>`, in: '\\[\\[bgm:[^\\]\\n]{1,200}\\]\\][ \\t]*', out: bgmButton }]
    : rules.map(rule => ({
      comment: `omni-sfx-${rule.id}`, type: 'editdisplay', ableFlag: true,
      flag: `gu<order ${SOUND_DISPLAY_ORDER.sfx},no_end_nl>`, in: `(${sfxRuleSource(rule)})`, out: `$1${sfxButton}`,
    }));
  const book = (comment: string, content: string, insertorder: number) => ({ key: '', secondkey: '', comment, content, mode: 'normal', insertorder, alwaysActive: true, selective: false, useRegex: false, bookVersion: 2 });
  const lorebook = kind === 'bgm'
    ? settings.bgmPrompt ? [book('omni-bgm-cues', `@@depth 0\n<OmniBGM>\n${bgmPromptText(settings.bgmTags)}\n</OmniBGM>`, 998)] : []
    : settings.sfxCue && rules[0] ? [book('omni-sfx-cues', sfxCuePrompt(rules[0]), 997)] : [];
  return { id: meta.id, namespace: meta.id, name: meta.name, description: meta.description, hideIcon: false, lowLevelAccess: false, backgroundEmbedding: `<style>${SOUND_MODULE_CSS[kind]}</style>`, trigger: [], lorebook, regex, assets: assets(items) };
}
