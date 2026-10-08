/**
 * Display-only rewrite for baked Inray tokens.
 * Stored chat stays `[[@inray::cardId::inxshot_…::width::height]]`; this regex is what the
 * user sees (center, fold / refresh / fullscreen). Size follows the image —
 * a forced 2:3 box made portraits taller than the chat.
 */
import { imageHistoryControls, imageHistoryCss } from './gallery/history-overlay';
export const INRAY_DISPLAY_MODULE_ID = 'inlay-inray-display';
export const INRAY_DISPLAY_MODULE_NS = 'inlay.inray_display';
export const INRAY_DISPLAY_MODULE_NAME = '⚛️Omni Nexus 디스플레이';
export const INRAY_DISPLAY_SCRIPT_COMMENT = 'inray-shot-display';

/** Capture card id, asset name and optional intrinsic width/height (legacy compatible). */
export const INRAY_DISPLAY_IN = '\\[\\[@inray::([^:\\]]+)::(inxshot_[^:\\]]+)(?:::([0-9]+)::([0-9]+))?(?:_[rs][0-9]+)?(?:_pin)?\\]\\]';

/**
 * `$1` = card id, `$2` = gallery asset name, `$3`/`$4` = intrinsic width/height.
 * After regex, Risu CBS turns `{{raw::$2}}` into a file URL (official path form).
 * `folded` writes `checked` so the host starts collapsed (top peek, not hidden).
 */
export function chatImageSizeStyle(value: unknown = 100): string {
  const n = Math.round(Number(value));
  const scale = Math.max(25, Math.min(200, Number.isFinite(n) && n > 0 ? n : 100));
  return `width:min(${Math.min(100, scale)}%,var(--inray-desktop-width,100%));height:auto;max-width:100%;max-height:none`;
}

export function chatImageResponsiveCss(): string {
  return '@media(min-width:601px){[data-inray-history-host],[data-inray-spinner],[data-inlay-inline-stack]{--inray-desktop-width:var(--inray-native-width,100%)}}';
}

/** Identical capped frame for the loading SVG and the unloaded final image. */
export function chatImageFrameStyle(width: string, height: string, scalePct: unknown = 100): string {
  const scale = Math.max(25,Math.min(200,Number(scalePct)||100))/100;
  return chatImageSizeStyle(scalePct) + `;--inray-native-width:calc(min(${width}px,640px,calc(780px * ${width} / ${height})) * ${scale});aspect-ratio:${width}/${height}`;
}

export function inrayDisplayOut(folded = false, scalePct: unknown = 100): string {
  const checked = folded ? ' checked' : '';
  return [
    '<style>.inray-shot[data-inlay-inline-shot]{position:relative;display:block;width:100%;max-width:100%;margin:10px auto;box-sizing:border-box;text-align:center;overflow-anchor:none;contain:layout}',
    `.inray-shot[data-inlay-inline-shot] img{display:block;${chatImageSizeStyle(scalePct)};margin:0 auto;object-fit:contain;border-radius:10px}`,
    '.inray-clip{position:relative;display:block;width:100%;max-width:100%;overflow:hidden;border-radius:10px;transition:max-height .42s cubic-bezier(.4,0,.2,1)}',
    '.inray-clip img{min-height:0}',
    '.inray-clip:has(img[width=""]){width:100%!important;max-width:100%!important;max-height:none!important;aspect-ratio:auto!important}',
    '.inray-shot[data-inlay-inline-shot] .inray-clip img[width]:not([width=""]){width:100%;height:auto;max-width:100%;max-height:none}',
    '.inray-fold-cb{position:absolute;width:0;height:0;opacity:0;pointer-events:none}',
    '.inray-shot .inray-fold-cb:checked~.inray-clip{max-height:4.5em!important}',
    '.inray-fold-cb:checked~.inray-clip::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1.6em;pointer-events:none;background:linear-gradient(transparent,rgba(8,10,16,.45))}',
    '.inray-bar{position:absolute;top:8px;right:8px;z-index:3;display:flex;flex-wrap:wrap;max-width:calc(100% - 16px);gap:4px;opacity:0;transition:opacity .15s}',
    '.inray-shot[data-inlay-inline-shot]:hover .inray-bar,.inray-shot[data-inlay-inline-shot]:focus-within .inray-bar,.inray-fold-cb:checked~.inray-clip .inray-bar{opacity:1}',
    '.inray-fold,.inray-fs,.inray-refresh{width:40px;height:40px;padding:0;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:rgba(15,20,30,.65);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1;box-shadow:none}',
    '.inray-fold:hover,.inray-fs:hover,.inray-refresh:hover{background:rgba(65,55,90,.85)}',
    '[data-inray-toolbar]~[data-inray-history-layer] [data-inray-history-dots]{left:8px;transform:none}@media(hover:none){.inray-shot[data-inlay-inline-shot] .inray-bar{opacity:0!important;pointer-events:none}[data-inray-history-host][x-inray-touch="1"] .inray-bar{opacity:1!important;pointer-events:auto}}',
    '.inray-fold::before{content:"▲"}',
    '.inray-fold-cb:checked~.inray-clip .inray-fold::before{content:"▼"}', imageHistoryCss(), chatImageResponsiveCss(), '</style>',
    '<br><div class="inray-shot" data-inray-bake="1" x-inray-bake="1" data-inlay-inline-shot="$1" x-inlay-inline-shot="$1" data-inray-asset="$2" x-inray-asset="$2">',
    `<input type="checkbox" class="inray-fold-cb" id="inray-fold-$1"${checked}>`,
    `<div class="inray-clip" data-inray-history-host="1" x-inray-history-host="1" style="${chatImageFrameStyle('$3', '$4', scalePct)};margin:0 auto"><div class="inray-image-plane" style="position:relative;width:100%;aspect-ratio:$3/$4"><img class="inray-shot-img" width="$3" height="$4" src="{{raw::$2}}" alt=""></div>`,
    '<div class="inray-bar" data-inray-toolbar="1">',
    '<button type="button" class="inray-refresh" data-inray-refresh="$1" x-inray-refresh="$1" aria-label="리롤" title="리롤">🎲</button>',
    '<button type="button" class="inray-fs" data-inray-history="pin" x-inray-history="pin" title="이 이미지 고정" aria-label="이 이미지 고정">📌</button>',
    '<label class="inray-fold" for="inray-fold-$1" title="접기 / 펼치기" aria-label="접기 / 펼치기" style="margin-left:8px"></label>',
    '<button type="button" class="inray-fs" data-inray-fs="$1" x-inray-fs="$1" aria-label="전체화면" title="전체화면">⛶</button></div>',
    imageHistoryControls(), '</div>',
    '</div><br>',
  ].join('');
}

export const INRAY_DISPLAY_OUT = inrayDisplayOut(false);

export function inrayDisplayRegexScript(folded = false, scalePct: unknown = 100): {
  comment: string;
  in: string;
  out: string;
  type: 'editdisplay';
  ableFlag: boolean;
  flag: string;
} {
  return {
    comment: INRAY_DISPLAY_SCRIPT_COMMENT,
    in: '(?<!\\[\\[@inrayspinner::[^\\]]+\\]\\]\\s*)' + INRAY_DISPLAY_IN,
    out: inrayDisplayOut(folded, scalePct),
    type: 'editdisplay',
    ableFlag: true,
    flag: 'g',
  };
}


export function spinnerDisplayRegexScript(scalePct:unknown=100) {
  const frame=chatImageFrameStyle('$2','$3',scalePct);
  const css=inrayDisplayOut(false,scalePct).split('</style>')[0]+'</style>';
  return {comment:'omni-spinner-display',in:'\\[\\[@inrayspinner::([a-zA-Z0-9_-]+)::([0-9]+)::([0-9]+)\\]\\](?!\\s*\\[\\[@inray::)',out:css+
    '<br><div class="omni-spinner" data-inlay-inline-shot="pending_$1" data-shot="$1" data-inray-spinner="$1" data-inray-preview-slot="$1" style="position:relative;display:block;text-align:center;margin:10px auto;overflow:hidden;overflow-anchor:none;border-radius:10px;'+frame+'">'+
    '<svg x-inray-spinner-wheel="$1" viewBox="0 0 $2 $3" width="$2" height="$3" style="display:block;width:100%;height:auto;border-radius:10px;background:#101620" role="img" aria-label="이미지 슬롯 · 다시 생성 가능"><circle cx="50%" cy="50%" r="54" fill="none" stroke="#7132f5" stroke-width="10" stroke-dasharray="180 160"></circle></svg>'+
    '</div><br>',type:'editdisplay' as const,ableFlag:true,flag:'g'};
}

/** Pair first: the reserved spinner owns geometry after reload, too. */
export function framedAssetDisplayRegexScript(folded = false, scalePct: unknown = 100) {
  const captureMap: Record<string,string> = {'1':'4','2':'5','3':'2','4':'3'};
  let out = inrayDisplayOut(folded,scalePct).replace(/\$([1-4])/g, (_,n:string) => '$'+captureMap[n]);
  out = out.replace('data-inray-bake="1"', 'data-inray-bake="1" data-inray-frame="$1"');
  // The full-height inner plane survives clipping; 100% image height must not
  // resolve against the collapsed outer viewport.
  out = out.replace('class="inray-shot-img"', 'class="inray-shot-img" style="position:absolute;inset:0;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain"');
  return {
    comment:'omni-framed-asset-display',
    in: spinnerDisplayRegexScript(scalePct).in.replace(/\(\?!.*$/, '') + '\\s*' + INRAY_DISPLAY_IN,
    out, type:'editdisplay' as const, ableFlag:true, flag:'g',
  };
}

/** Consume one family's adjacent revisions and render its final selection once. */
export function historyDisplayRegexScript(folded = false, scalePct: unknown = 100) {
  const frame = '\\[\\[@inrayspinner::([a-zA-Z0-9_-]+)::([0-9]+)::([0-9]+)\\]\\]\\s*';
  const head = '(?=\\[\\[@inray::([^:\\]]+?)(?:_[rs][0-9]+)?::)';
  const earlier = '(?:\\[\\[@inray::\\4(?:_[rs][0-9]+)?::[^\\]]+\\]\\]\\s*)+';
  const map: Record<string, string> = { '1':'5', '2':'6', '3':'7', '4':'8' };
  return { comment: 'omni-image-history-display', in: '(?:' + frame + ')?' + head + earlier + '(?=\\[\\[@inray::\\4(?:_[rs][0-9]+)?::)' + INRAY_DISPLAY_IN,
    out: inrayDisplayOut(folded, scalePct).replace(/\$([1-4])/g, (_, key: string) => '$' + map[key]),
    type: 'editdisplay' as const, ableFlag: true, flag: 'g' };
}
