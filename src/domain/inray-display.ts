/**
 * Display-only rewrite for baked Inray tokens.
 * Stored chat stays `[[@inray::cardId::inxshot_…::width::height]]`; this regex is what the
 * user sees (center, fold / refresh / fullscreen). Size follows the image —
 * a forced 2:3 box made portraits taller than the chat.
 */
export const INRAY_DISPLAY_MODULE_ID = 'inlay-inray-display';
export const INRAY_DISPLAY_MODULE_NS = 'inlay.inray_display';
export const INRAY_DISPLAY_MODULE_NAME = '⚛️Omni Nexus 디스플레이';
export const INRAY_DISPLAY_SCRIPT_COMMENT = 'inray-shot-display';

/** Capture card id, asset name and optional intrinsic width/height (legacy compatible). */
export const INRAY_DISPLAY_IN = '\\[\\[@inray::([^:\\]]+)::(inxshot_[^:\\]]+)(?:::([0-9]+)::([0-9]+))?\\]\\]';

/**
 * `$1` = card id, `$2` = gallery asset name, `$3`/`$4` = intrinsic width/height.
 * After regex, Risu CBS turns `{{raw::$2}}` into a file URL (official path form).
 * `folded` writes `checked` so the host starts collapsed (top peek, not hidden).
 */
export function chatImageSizeStyle(value: unknown = 100): string {
  const n = Math.round(Number(value));
  const scale = Math.max(25, Math.min(200, Number.isFinite(n) && n > 0 ? n : 100)) / 100;
  return `width:auto;height:auto;max-width:min(${Math.min(100, Math.round(78 * scale))}%,100%);max-height:min(${Math.round(70 * scale)}vh,${Math.round(900 * scale)}px)`;
}

/** Identical capped frame for the loading SVG and the unloaded final image. */
export function chatImageFrameStyle(width: string, height: string, scalePct: unknown = 100): string {
  const size = chatImageSizeStyle(scalePct);
  const cap = size.match(/max-height:([^;]+)/)?.[1] || 'min(70vh,900px)';
  return size.replace('width:auto;', `width:min(${width}px,calc(${cap} * ${width} / ${height}));`) + `;aspect-ratio:${width}/${height}`;
}

export function inrayDisplayOut(folded = false, scalePct: unknown = 100): string {
  const checked = folded ? ' checked' : '';
  return [
    '<style>.inray-shot[data-inlay-inline-shot]{position:relative;display:block;width:100%;max-width:100%;margin:10px auto;text-align:center;overflow-anchor:none;contain:layout}',
    `.inray-shot[data-inlay-inline-shot] img{display:block;${chatImageSizeStyle(scalePct)};margin:0 auto;object-fit:contain;border-radius:10px}`,
    '.inray-clip{position:relative;display:block;width:100%;max-width:100%;overflow:hidden;border-radius:10px;transition:max-height .42s cubic-bezier(.4,0,.2,1)}',
    '.inray-clip img{min-height:0}',
    '.inray-clip:has(img[width=""]){width:100%!important;max-width:100%!important;max-height:none!important;aspect-ratio:auto!important}',
    '.inray-shot[data-inlay-inline-shot] .inray-clip img[width]:not([width=""]){width:100%;height:auto;max-width:100%;max-height:none}',
    '.inray-fold-cb{position:absolute;width:0;height:0;opacity:0;pointer-events:none}',
    '.inray-shot .inray-fold-cb:checked~.inray-clip{max-height:4.5em!important}',
    '.inray-fold-cb:checked~.inray-clip::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1.6em;pointer-events:none;background:linear-gradient(transparent,rgba(8,10,16,.45))}',
    '.inray-bar{position:absolute;top:8px;right:8px;z-index:2;display:flex;gap:6px;opacity:0;transition:opacity .15s}',
    '.inray-shot[data-inlay-inline-shot]:hover .inray-bar,.inray-shot[data-inlay-inline-shot]:focus-within .inray-bar,.inray-fold-cb:checked~.inray-bar{opacity:1}',
    '.inray-fold,.inray-fs,.inray-refresh{width:40px;height:40px;padding:0;border:0;border-radius:12px;background:#7132f5;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:17px;line-height:1}',
    '.inray-clip>.inray-refresh{position:absolute;left:8px;bottom:8px;z-index:2;opacity:0;transition:opacity .15s}',
    '.inray-shot:hover .inray-refresh,.inray-shot:focus-within .inray-refresh{opacity:1}',
    '.inray-fold::before{content:"▲"}',
    '.inray-fold-cb:checked~.inray-bar .inray-fold::before{content:"▼"}</style>',
    '<br><div class="inray-shot" data-inray-bake="1" x-inray-bake="1" data-inlay-inline-shot="$1" x-inlay-inline-shot="$1" data-inray-asset="$2" x-inray-asset="$2">',
    `<input type="checkbox" class="inray-fold-cb" id="inray-fold-$1"${checked}>`,
    '<div class="inray-bar">',
    '<label class="inray-fold" for="inray-fold-$1" title="접기 / 펼치기" aria-label="접기 / 펼치기"></label>',
    '<button type="button" class="inray-fs" data-inray-fs="$1" x-inray-fs="$1" aria-label="전체화면" title="전체화면">',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    '</button></div>',
    `<div class="inray-clip" style="${chatImageFrameStyle('$3', '$4', scalePct)};margin:0 auto"><div class="inray-image-plane" style="position:relative;width:100%;aspect-ratio:$3/$4"><img class="inray-shot-img" width="$3" height="$4" src="{{raw::$2}}" alt=""></div><button type="button" class="inray-refresh" data-inray-refresh="$1" x-inray-refresh="$1" aria-label="리롤" title="리롤">🎲</button></div>`,
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
