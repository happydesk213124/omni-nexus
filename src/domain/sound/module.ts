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
 *
 * Effects run first of all by default (`sfxFirst`): other modules often restyle
 * `§쾅§` into their own box and drop the marks, and a rule running after them
 * found nothing to put ▶ on. Run first, ▶ follows the marks, and their rule still
 * matches the marks themselves. Off: the old place, after every other module.
 */
export const SOUND_DISPLAY_ORDER = { bgm: -10120, sfx: -10130, sfxFirst: 10130 } as const;

// Like the OmniTTS control: the glyph is CSS only, so the line's text (which
// TTS reads and matches against the source) carries no ♪ or ▶ of its own.
const BUTTON = (selector: string, glyph: string, size: number) => `${selector}{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;box-sizing:border-box;width:22px;height:22px;min-width:0;min-height:0;margin:0 0 0 .3em;padding:0;`
  + `border-radius:50%;border:1px solid #9aa3b5;background:#3b4150;color:#e7eaf0;font-size:${size}px;line-height:1;cursor:pointer;box-shadow:none}${selector}::before{content:"${glyph}"}${selector}:hover{background:#525a6c}`;
// An effect plays through the voice player like a line, so its ▶ shows the same
// states as a TTS control (the plugin sets x-omnitts-state on both).
const EQ = 'linear-gradient(currentColor,currentColor) 0 100%/3px 40% no-repeat,linear-gradient(currentColor,currentColor) 4.5px 100%/3px 90% no-repeat,linear-gradient(currentColor,currentColor) 9px 100%/3px 60% no-repeat';
const SFX_STATE_CSS = [
  '[data-omni-sfx][x-omnitts-state="loading"],[data-omni-sfx][x-omnitts-state="playing"],[data-omni-sfx][x-omnitts-state="paused"]{background:#7132f5;border-color:#d8c8ff;color:#fff}',
  '[data-omni-sfx][x-omnitts-state="playing"]{animation:omni-sfx-pulse 1.3s ease-out infinite}',
  '[data-omni-sfx][x-omnitts-state]:not([x-omnitts-state=""])::before{content:"";display:block;box-sizing:border-box}',
  '[data-omni-sfx][x-omnitts-state="loading"]::before{width:11px;height:11px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:omni-sfx-spin .8s linear infinite}',
  `[data-omni-sfx][x-omnitts-state="playing"]::before{width:12px;height:12px;background:${EQ};animation:omni-sfx-eq .9s ease-in-out infinite}`,
  '[data-omni-sfx][x-omnitts-state="paused"]::before{width:9px;height:10px;border-width:0 3px;border-color:currentColor;border-style:solid}',
  '@keyframes omni-sfx-spin{to{transform:rotate(360deg)}}',
  '@keyframes omni-sfx-pulse{0%{box-shadow:0 0 0 0 #b69cffcc}100%{box-shadow:0 0 0 8px #b69cff00}}',
  '@keyframes omni-sfx-eq{0%,100%{background-size:3px 40%,3px 90%,3px 60%}33%{background-size:3px 100%,3px 35%,3px 80%}66%{background-size:3px 55%,3px 70%,3px 25%}}',
  '@media (prefers-reduced-motion:reduce){[data-omni-sfx][x-omnitts-state]{animation:none!important}[data-omni-sfx][x-omnitts-state]::before{animation-duration:2s!important}}',
].join('');
export const SOUND_MODULE_CSS: Record<SoundKind, string> = { bgm: BUTTON('[data-omni-bgm]', '♪', 12), sfx: BUTTON('[data-omni-sfx]', '▶', 9) + SFX_STATE_CSS };
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
      flag: `gu<order ${settings.sfxFirst ? SOUND_DISPLAY_ORDER.sfxFirst : SOUND_DISPLAY_ORDER.sfx},no_end_nl>`, in: `(${sfxRuleSource(rule)})`, out: `$1${sfxButton}`,
    }));
  const book = (comment: string, content: string, insertorder: number) => ({ key: '', secondkey: '', comment, content, mode: 'normal', insertorder, alwaysActive: true, selective: false, useRegex: false, bookVersion: 2 });
  const lorebook = kind === 'bgm'
    ? settings.bgmPrompt ? [book('omni-bgm-cues', `@@depth 0\n<OmniBGM>\n${bgmPromptText(settings.bgmTags)}\n</OmniBGM>`, 998)] : []
    : settings.sfxCue && rules[0] ? [book('omni-sfx-cues', sfxCuePrompt(rules[0]), 997)] : [];
  return { id: meta.id, namespace: meta.id, name: meta.name, description: meta.description, hideIcon: false, lowLevelAccess: false, backgroundEmbedding: `<style>${SOUND_MODULE_CSS[kind]}</style>`, trigger: [], lorebook, regex, assets: assets(items) };
}
