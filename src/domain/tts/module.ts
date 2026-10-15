import type { TtsSettings } from '../../core/tts-types';
import { ttsExcludeTerms } from './filter';

export const OMNI_TTS_MODULE = 'omni-tts';
export const TTS_CUE_PROMPT = `@@depth 0
<OmniTTS>
For spoken dialogue, write one complete cue per line: Name (delivery): "Dialogue"
A character's inner thoughts use the same cue with single quotes: Name (delivery): 'Thought'
Use the established full speaker name consistently. Do not invent identity or gender.
This also applies to the viewpoint character's own speech in a first-person story: even when the prose calls the speaker I, me, 나 or 저, label their spoken dialogue with their established actual name and delivery. Never omit the cue just because that character is narrating the scene.
Example: I said hello -> Harin (happy): "Hello."; I thought it was late -> Harin (calm): 'It is late.' Only speech and inner thoughts receive that cue; first-person actions and descriptions remain plain prose. If the speaker's identity is not established, do not invent a name or label them I/나 as a character.
Write delivery in short English Fish Audio cues, e.g. happy, sad, angry, calm, curious, soft tone, whispering. Use calm for neutral delivery.
Keep both quotation marks on the same line. Narration remains plain prose without a speaker or delivery prefix.
Never label code, hidden reasoning blocks, images or status panels as dialogue or thoughts. Preserve the story language.
</OmniTTS>`;

// Every rule below runs after all other display rules (lowest order wins last).
// Other modules therefore see the reply exactly as written: no token, no moved
// line break, no rewritten name. We only append a zero-width control to lines
// that are still plain prose once every other module has finished.
export const TTS_DISPLAY_ORDER = { guard: -10200, dialogue: -10210, narration: -10211, release: -10215, hideTone: -10220, hideName: -10221, unguard: -10230 } as const;
const GUARD_OPEN = '\uf8f0', GUARD_CLOSE = '\uf8f1';
const TAGS = 'a|abbr|b|big|blockquote|br|center|cite|del|dfn|div|em|font|i|ins|label|li|mark|p|q|rp|rt|ruby|s|small|span|strike|strong|sub|sup|u';
const OPEN = `<(?:${TAGS})(?:\\s[^<>\\n]*)?/?>`;
const CLOSE = `</(?:${TAGS})\\s*>`;
const TAG = `(?:${OPEN}|${CLOSE})`;
// A guarded block is consumed whole by the same scan, keeping every rule linear.
// Its copy of the control lands right after the closing marker and is released.
const GUARDED = '(\\uF8F0[^\\uF8F1]*\\uF8F1)';
// Markdown would turn indented lines into code and #/| lines into headings or tables.
const PROSE_START = '(?=[ \\t]{0,3}[^\\s#|>`~!])';
// Digits and symbols alone ([00:10… 00:09…]) are never read aloud.
const HAS_WORD = '(?=(?:[^\\n<>]|<[^<>\\n]*>)*?\\p{L})';
// A BGM marker line is never read (segment.ts). The BGM module turns a finished
// one into ♪ first; one still streaming in (`[[bgm:calm, ca`) would otherwise get
// a control nobody can bind, which the plugin then hides: a flash on every chunk.
const NO_BGM_CUE = '(?![^\\n]*\\[\\[[Bb][Gg][Mm]:)';
const LINE_END = `((?:${CLOSE}[ \\t]*)*)([ \\t\\r]*)(?=\\n|$)`;
const HEADER_PREFIX = `([ \\t]*(?:${OPEN}[ \\t]*)*)((?:[\\p{Extended_Pictographic}\\uFE0F\\u200D*][ \\t]*)*)`;
const SPEAKER = '([^\\n<>:："“”‘’「」『』(){}\\[\\]|#!*]{1,80}?)\\**';
const BEFORE_ANCHORED_QUOTE = `[ \\t]*[:：][ \\t]*(?:\\r?\\n[ \\t]*)*(?=(?:${OPEN}[ \\t]*)*["“‘'「『][^\\n]*data-omnitts-kind=)`;

function regexLiteral(value: string): string { return value.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&'); }
function anchor(kind: 'dialogue' | 'narration'): string {
  // The glyph is CSS-only, so the copied text and the host's line text stay prose.
  return `<span data-omnitts-tail="1"><button type="button" data-omnitts-play="1" x-omnitts-play="1" data-omnitts-kind="${kind}" title="재생" aria-label="재생"></button></span>`;
}
function exclusion(text: string): string {
  const terms = ttsExcludeTerms(text).map(regexLiteral);
  return terms.length ? `(?![^\\n]*?(?:${terms.join('|')}))` : '';
}

/** Placed outside the chat by the plugin while narration is OFF; never part of the module. */
export const TTS_NARRATION_OFF_CSS = '[data-omnitts-play][data-omnitts-kind="narration"]{display:none!important}';

export const TTS_MODULE_CSS = [
  // A zero-size inline anchor: wrapping, line height and spacing are exactly
  // what the message would have without TTS. The control floats beside it.
  '[data-omnitts-tail]{display:inline-block;position:relative;width:0;height:0;margin:0;padding:0;border:0;vertical-align:middle;line-height:0;white-space:nowrap;overflow:visible}',
  '[data-omnitts-tail]>[data-omnitts-play]{position:absolute;left:.3em;top:0;transform:translateY(-50%);z-index:1;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;min-width:0;min-height:0;margin:0;padding:0;border:1px solid #8262bb77;border-radius:50%;background:#22192fd9;color:#c6afff;font-size:0;line-height:0;cursor:pointer;box-shadow:none}',
  '[data-omnitts-play][data-omnitts-kind]::before{content:"";display:block;box-sizing:border-box;width:0;height:0;margin-left:2px;border-style:solid;border-width:5px 0 5px 8px;border-color:transparent transparent transparent currentColor}',
  '[data-omnitts-tail]>[data-omnitts-play]:hover{background:#7132f5aa;border-color:#a483fb}[data-omnitts-tail]>[data-omnitts-play]:active{background:#7132f5}',
  '[data-omnitts-tail]>[data-omnitts-play][data-omnitts-kind="narration"]{background:#142b46d9;border-color:#60a5fa77;color:#93c5fd}[data-omnitts-tail]>[data-omnitts-play][data-omnitts-kind="narration"]:hover{background:#2563ebaa;border-color:#93c5fd}',
  // The line being read keeps moving, so the button visibly reads as live.
  '[data-omnitts-play][x-omnitts-state="loading"],[data-omnitts-play][x-omnitts-state="playing"],[data-omnitts-play][x-omnitts-state="paused"]{background:#7132f5;border-color:#d8c8ff;color:#fff}',
  '[data-omnitts-play][data-omnitts-kind="narration"][x-omnitts-state]:not([x-omnitts-state=""]){background:#2563eb;border-color:#bfdbfe;color:#fff}',
  '[data-omnitts-play][x-omnitts-state="playing"]{animation:omnitts-pulse 1.3s ease-out infinite}',
  '[data-omnitts-play][data-omnitts-kind][x-omnitts-state="loading"]::before{width:12px;height:12px;margin:0;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:omnitts-spin .8s linear infinite}',
  '[data-omnitts-play][data-omnitts-kind][x-omnitts-state="playing"]::before{width:12px;height:12px;margin:0;border:0;background:linear-gradient(currentColor,currentColor) 0 100%/3px 40% no-repeat,linear-gradient(currentColor,currentColor) 4.5px 100%/3px 90% no-repeat,linear-gradient(currentColor,currentColor) 9px 100%/3px 60% no-repeat;animation:omnitts-eq .9s ease-in-out infinite}',
  '[data-omnitts-play][data-omnitts-kind][x-omnitts-state="paused"]::before{width:9px;height:10px;margin:0;border-width:0 3px;border-color:currentColor;border-style:solid}',
  '@keyframes omnitts-spin{to{transform:rotate(360deg)}}',
  '@keyframes omnitts-pulse{0%{box-shadow:0 0 0 0 #b69cffcc}100%{box-shadow:0 0 0 9px #b69cff00}}',
  '@keyframes omnitts-eq{0%,100%{background-size:3px 40%,3px 90%,3px 60%}33%{background-size:3px 100%,3px 35%,3px 80%}66%{background-size:3px 55%,3px 70%,3px 25%}}',
  '@media (prefers-reduced-motion:reduce){[data-omnitts-play][x-omnitts-state]{animation:none!important}[data-omnitts-play][x-omnitts-state]::before{animation-duration:2s!important}}',
].join('');

export function ttsModule(settings: Pick<TtsSettings, 'hideName' | 'hideTone' | 'narration' | 'illustration' | 'passageLine'> & Partial<Pick<TtsSettings, 'excludeText' | 'skipChars' | 'skipSymbolOnly'>>) {
  const excluded = exclusion(settings.excludeText || '');
  const head = `${GUARDED}|(^|\\n)${PROSE_START}${NO_BGM_CUE}${settings.skipSymbolOnly === false ? '' : HAS_WORD}${excluded}`;
  const imageCss = `[data-omnitts-image]{display:${settings.illustration ? 'flex' : 'none'};align-items:center;gap:6px;max-width:100%;overflow-x:auto}[data-omnitts-image] [data-omnitts-cast]{display:flex;gap:6px}[data-inlay-inline-shot]:has(>[data-omnitts-image]){display:flex!important;flex-direction:column}[data-omnitts-image]{order:10;justify-content:flex-start;margin-top:8px;min-height:40px}[data-omnitts-image] [data-omnitts-play]{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-width:36px;height:36px;padding:0 4px;margin-left:0;border:1px solid #5ad49b88;border-radius:8px;background:#137448;color:#e3fff0;cursor:pointer}[data-omnitts-image] [data-omnitts-play]:hover{background:#219c63;border-color:#9effcc}`;
  const hide = (flags: string, order: number, tone: boolean, out: string) => ({
    comment: tone ? 'omnitts-hide-cue-tone' : 'omnitts-hide-cue-name', type: 'editdisplay', ableFlag: true, flag: `${flags}<order ${order}>`,
    in: `(^|\\n)${HEADER_PREFIX}${SPEAKER}${tone ? '[ \\t]*\\(([A-Za-z][A-Za-z ,\\-]{0,99})\\)' : ''}${BEFORE_ANCHORED_QUOTE}`, out });
  const hideRules = [
    ...(settings.hideName || settings.hideTone ? [hide('gu', TTS_DISPLAY_ORDER.hideTone, true, settings.hideName && settings.hideTone ? '$1$2' : settings.hideName ? '$1$2($5) ' : '$1$2$3$4: ')] : []),
    ...(settings.hideName ? [hide('gu', TTS_DISPLAY_ORDER.hideName, false, '$1$2')] : []),
  ];
  return {
    id: OMNI_TTS_MODULE, namespace: OMNI_TTS_MODULE, name: '⚛️ omni tts',
    description: '이름·영문 억양 규칙과 채팅 재생 버튼. 음성 처리는 Omni Nexus 플러그인이 담당합니다.',
    hideIcon: false, lowLevelAccess: false, assets: [], backgroundEmbedding: `<style>${TTS_MODULE_CSS}${imageCss}</style>`,
    lorebook: [{ key: '', secondkey: '', comment: 'omnitts-cues', content: TTS_CUE_PROMPT, mode: 'normal', insertorder: 999, alwaysActive: true, selective: false, useRegex: false, bookVersion: 2 }],
    trigger: [],
    regex: [
      { comment: 'omnitts-image-controls', type: 'editdisplay', ableFlag: true, flag: 'g<order -10110>',
        in: '(<div class="inray-shot"[^>]{1,3000}>)',
        out: '$1<div data-omnitts-image="1" x-omnitts-image="1"><button type="button" data-omnitts-play="1" x-omnitts-play="1" title="삽화 대사 재생" aria-label="삽화 대사 재생">▶</button><span data-omnitts-cast="1" x-omnitts-cast="1"></span></div>' },
      // Code, CSS, form fields and similar raw blocks never receive a control.
      { comment: 'omnitts-guard', type: 'editdisplay', ableFlag: true, flag: `gi<order ${TTS_DISPLAY_ORDER.guard}>`,
        in: '(```[\\s\\S]*?(?:```|$)|~~~[\\s\\S]*?(?:~~~|$)|<!--[\\s\\S]*?(?:-->|$)|<(style|script|textarea|title|pre|code|svg|math|select|template|xmp|noscript|table|iframe|object|button)\\b[\\s\\S]*?(?:<\\/\\2\\s*>|$))',
        out: `${GUARD_OPEN}$1${GUARD_CLOSE}` },
      { comment: 'omnitts-dialogue', type: 'editdisplay', ableFlag: true, flag: `gu<order ${TTS_DISPLAY_ORDER.dialogue}>`,
        in: `${head}(?=(?:[^\\n<>\\uF8F0\\uF8F1]|${TAG})*(?:\\n|$))([^\\n]*?["“‘'「『][^\\n]*?["”’'」』])${LINE_END}`,
        out: `$1$2$3${anchor('dialogue')}$4$5` },
      { comment: 'omnitts-narration', type: 'editdisplay', ableFlag: true, flag: `gu<order ${TTS_DISPLAY_ORDER.narration}>`,
        in: `${head}(?=(?:[^\\n<>"“”‘’「」『』()\\uF8F0\\uF8F1]|${TAG})*(?:\\n|$))([^\\n]*?[^\\s<>:：])${LINE_END}`,
        out: `$1$2$3${anchor('narration')}$4$5` },
      { comment: 'omnitts-release-guard', type: 'editdisplay', ableFlag: true, flag: `g<order ${TTS_DISPLAY_ORDER.release}>`,
        in: '\\uF8F1(?:<span data-omnitts-tail="1"><button [^<>]*></button></span>)+', out: GUARD_CLOSE },
      ...hideRules,
      { comment: 'omnitts-unguard', type: 'editdisplay', ableFlag: true, flag: `g<order ${TTS_DISPLAY_ORDER.unguard}>`, in: '[\\uF8F0\\uF8F1]', out: '' },
    ],
  };
}
