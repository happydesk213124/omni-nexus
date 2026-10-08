/** Shared chat/fullscreen chrome; no blur, shadows, or JavaScript animation. */
export function imageHistoryCss(): string {
  // Risu prefixes classes and removes x-* during HTML sanitizing. Data markers
  // survive both chat rendering and SafeElement.setInnerHTML in fullscreen.
  const host=':is([data-inray-history-host],[x-inray-history-host])';
  const nav='[data-inray-history-layer] button';
  const chrome=`:is(${nav},[data-inray-history-dots])`;
  return `${host}{position:relative}` +
    'button:has([data-inray-inspect-action]):hover{background:rgba(65,55,90,.85)!important}' +
    '[data-inray-history-layer]{position:absolute;inset:0;pointer-events:none;z-index:2}' +
    `${host}:hover ${chrome},${host}:focus-within ${chrome}{opacity:1}` +
    `${nav}{position:absolute;top:0;bottom:0;width:18%;min-width:44px;max-width:72px;border:0;padding:0;color:white;font:36px/1 sans-serif;cursor:pointer;pointer-events:auto;opacity:0;transition:opacity .16s;background:linear-gradient(90deg,rgba(0,0,0,.5),transparent)}` +
    `${nav}[data-inray-history="prev"]{left:0}${nav}[data-inray-history="next"]{right:0;background:linear-gradient(270deg,rgba(0,0,0,.5),transparent)}` +
    `${nav}:hover{color:#ddd6ff}${nav}[x-inray-history-edge="1"]{color:rgba(255,255,255,.3);cursor:default}` +
    '[data-inray-history-dots]{position:absolute;top:8px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:5px;padding:6px 9px;border-radius:16px;background:rgba(0,0,0,.38);color:white;font:11px/1 sans-serif;white-space:nowrap;opacity:0;transition:opacity .16s}' +
    '[data-inray-history-dots] i{display:block;width:6px;height:6px;border:1px solid rgba(255,255,255,.65);border-radius:50%;box-sizing:border-box}[data-inray-history-dots] i[data-inray-active="1"]{background:white;border-color:white}' +
    '[data-inray-history-dots] span{margin-left:3px;font-variant-numeric:tabular-nums}[data-inray-history-dots] small{font:inherit;color:#d5cfe3}' +
    `@media(hover:none){${host} ${chrome}{opacity:0!important;pointer-events:none}${host}[x-inray-touch="1"] ${chrome}{opacity:1!important}${host}[x-inray-touch="1"] ${nav}{pointer-events:auto}}@media(prefers-reduced-motion:reduce){${chrome}{transition:none}}`;
}

export function imageHistoryControls(inline = false, navigation = true): string {
  const nav = 'position:absolute;top:0;bottom:0;width:18%;min-width:44px;max-width:72px;border:0;padding:0;color:white;font:36px/1 sans-serif;cursor:pointer;pointer-events:auto;opacity:0;transition:opacity .16s;';
  const style = (value: string) => inline ? ` style="${value}"` : '';
  const prev = navigation ? `<button type="button" class="inray-nav inray-prev" data-inray-history="prev" title="이전 이미지" aria-label="이전 이미지"${style(nav+'left:0;background:linear-gradient(90deg,rgba(0,0,0,.5),transparent)')}>‹</button>` : '';
  const next = navigation ? `<button type="button" class="inray-nav inray-next" data-inray-history="next" title="다음 이미지" aria-label="다음 이미지"${style(nav+'right:0;background:linear-gradient(270deg,rgba(0,0,0,.5),transparent)')}>›</button>` : '';
  return `<div class="inray-history" data-inray-history-layer="1"${style('position:absolute;inset:0;pointer-events:none;z-index:2')}>${prev}<div class="inray-dots" data-inray-history-dots="1"${style('position:absolute;top:8px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:5px;padding:6px 9px;border-radius:16px;background:rgba(0,0,0,.38);color:white;font:11px/1 sans-serif;white-space:nowrap;opacity:0;transition:opacity .16s')}></div>${next}</div>`;
}

export function imageHistoryIndicators(count: number, index: number, rerolls = Math.max(0,count-1), inline = false): string {
  if (!count) return '';
  const start = Math.max(0, Math.min(index - 4, count - 9));
  return Array.from({ length: Math.min(count, 9) }, (_, i) => `<i${start + i === index ? ' data-inray-active="1"' : ''}${inline ? ` style="display:block;width:6px;height:6px;border:1px solid rgba(255,255,255,.65);border-radius:50%;box-sizing:border-box;${start+i===index?'background:white;':''}"` : ''}></i>`).join('') + `<span>${index + 1}/${count}</span><small title="리롤 횟수"${inline?' style="font:inherit;color:#d5cfe3"':''}>↻${rerolls}</small>`;
}
