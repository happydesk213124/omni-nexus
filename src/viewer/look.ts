/**
 * 옴니 뷰어's look: the frame, its static style, and the two things a scene
 * rewrites (one style text, one box). Pure strings, so a scene costs Risu two
 * calls whatever happens on stage.
 */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One stable hue per name, for its nameplate and silhouette. */
export function accentOf(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return `hsl(${h} 62% 60%)`;
}

const SERIF = '"Gowun Batang","Nanum Myeongjo","Noto Serif KR","Noto Serif CJK KR",serif';
export const STATIC_CSS = `
[x-omni-vn]{position:fixed;z-index:2147482000;isolation:isolate;overflow:hidden;color:#f4f1ea;font:14px/1.5 system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;user-select:none;-webkit-user-select:none;touch-action:manipulation;
  background:radial-gradient(120% 90% at 50% 0%,#2a2340 0%,#141224 45%,#07070c 100%);--gold:#e3c27a;--line:rgba(227,194,122,.38)}
[x-omni-vn] *{box-sizing:border-box}
[x-omni-vn] [data-vn-bg]{position:absolute;inset:0}
[x-omni-vn] [data-vn-bg]::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(130% 100% at 50% 40%,transparent 50%,rgba(0,0,0,.55) 100%),linear-gradient(transparent 55%,rgba(5,5,10,.55))}
[x-omni-vn] div[x-vn-bg]{display:none;position:absolute;inset:0;animation:vn-fade .6s ease}
[x-omni-vn] div[x-vn-bg] img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:brightness(.72) saturate(1.05)}
[x-omni-vn] img[x-vn-bg]{display:none;position:absolute;inset:0;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;margin:0!important;border-radius:0!important;object-fit:cover;filter:brightness(.7) saturate(1.05)}
[x-omni-vn] [data-vn-cast]{position:absolute;inset:0;pointer-events:none}
[x-omni-vn] [x-vn-p]{display:none;position:absolute;bottom:0;height:90%;aspect-ratio:13/19;max-width:82%;translate:-50% 0;transform-origin:50% 100%;
  transition:left .45s cubic-bezier(.2,.8,.25,1),filter .3s ease,transform .3s ease,opacity .3s ease;animation:vn-enter .55s cubic-bezier(.2,.8,.25,1)}
[x-omni-vn] [x-vn-p] [data-vn-sil]{position:absolute;inset:0;transition:opacity .3s}
[x-omni-vn] [x-vn-p] [data-vn-sil]::before{content:"";position:absolute;left:31%;right:31%;top:6%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 45% 40%,var(--c) 0%,rgba(20,18,32,.95) 70%);opacity:.55;box-shadow:0 0 22px -6px var(--c)}
[x-omni-vn] [x-vn-p] [data-vn-sil]::after{content:"";position:absolute;left:12%;right:12%;top:31%;bottom:0;border-radius:46% 46% 8% 8%/30% 30% 8% 8%;background:linear-gradient(180deg,var(--c) -60%,rgba(18,16,30,.96) 55%);opacity:.5;box-shadow:0 -6px 26px -12px var(--c)}
[x-omni-vn] [x-vn-sp]{position:absolute;inset:0;opacity:0;transition:opacity .28s ease}
[x-omni-vn] [x-vn-sp] img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:50% 100%;filter:drop-shadow(0 6px 18px rgba(0,0,0,.45))}
[x-omni-vn] [data-vn-cg]{position:absolute;inset:0;pointer-events:none}
[x-omni-vn] [data-vn-cgbar]{position:absolute;left:50%;top:calc(9% + min(52%, 84vw * 2 / 3) + 10px);translate:-50% 0;display:flex;gap:8px;z-index:9}
[x-omni-vn] [data-vn-cgbar] button{display:none}
[x-omni-vn] img[x-vn-cg]{display:none;position:absolute;left:50%;top:9%;width:84%!important;height:auto!important;max-width:none!important;max-height:52%!important;object-fit:contain;translate:-50% 0;rotate:-1.2deg;margin:0!important;border:4px solid #f3efe6!important;border-radius:4px!important;box-shadow:0 18px 50px rgba(0,0,0,.6);animation:vn-photo .6s cubic-bezier(.2,.8,.25,1)}
[x-omni-vn] [data-vn-hud]{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:6px;padding:10px 10px 18px;background:linear-gradient(rgba(5,5,10,.7),transparent);z-index:4}
[x-omni-vn] [data-vn-clock]{flex:1;min-width:0;display:flex;align-items:center;gap:6px;font-size:12px;letter-spacing:.02em;color:#ece6d6}
[x-omni-vn] [data-vn-clock]:not(:empty)::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--gold);box-shadow:0 0 8px var(--gold)}
[x-omni-vn] [data-vn-clock] span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[x-omni-vn] button{all:unset;box-sizing:border-box;white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;height:32px;min-width:32px;padding:0 10px;border-radius:999px;font-size:12px;letter-spacing:.04em;color:#efe9da;background:rgba(14,12,22,.55);border:1px solid rgba(255,255,255,.14);transition:background .15s,opacity .15s,color .15s}
/* Full screen when Omni's own 크게보기 cannot open: the same bottom sheet of big emoji buttons. */
[x-omni-vn] [data-vn-dock]{display:none;position:absolute;left:50%;bottom:12px;translate:-50% 0;width:min(440px,calc(100% - 24px));grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:10px;z-index:9;border-radius:14px;background:rgba(18,22,32,.9);border:1px solid rgba(255,255,255,.14)}
[x-omni-vn] [data-vn-dock] button{width:100%;height:44px;padding:0;border:0;border-radius:10px;font-size:22px;background:rgba(255,255,255,.08)}
[x-omni-vn] [data-vn-dock] [data-vn-act="cgback"]{font-size:14px}
[x-omni-vn] [data-vn-box]{position:absolute;left:12px;right:12px;bottom:12px;height:clamp(136px,26%,200px);padding:22px 18px 46px;border-radius:16px;z-index:3;
  background:linear-gradient(180deg,rgba(22,19,34,.88),rgba(10,9,17,.95));border:1px solid var(--line);box-shadow:0 10px 40px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.06);transition:opacity .25s}
[x-omni-vn] [data-vn-box]::before{content:"";position:absolute;left:14px;right:14px;top:8px;height:1px;background:linear-gradient(90deg,transparent,var(--line),transparent)}
/* "3 / 12" rides the box's top edge; the scene's style text writes it, costing no call of its own. */
[x-omni-vn] [data-vn-box]::after{content:none;position:absolute;top:-10px;right:14px;padding:0 9px;border-radius:9px;font:10px/18px system-ui,sans-serif;letter-spacing:.08em;color:#bdb3c9;background:#0d0b16;border:1px solid var(--line);pointer-events:none}
[x-omni-vn] [data-vn-name]{position:absolute;left:16px;top:-15px;max-width:62%;padding:4px 16px 5px;border-radius:10px 10px 10px 2px;font:700 15px/1.3 ${SERIF};color:#fff;letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  background:linear-gradient(135deg,var(--c,#7c5cf5),color-mix(in srgb,var(--c,#7c5cf5) 55%,#100c1c));box-shadow:0 4px 14px -4px var(--c,#7c5cf5)}
[x-omni-vn] [data-vn-name]:empty{display:none}
[x-omni-vn] [data-vn-text]{height:100%;overflow:auto;font:16.5px/1.78 ${SERIF};word-break:keep-all;overflow-wrap:anywhere;white-space:pre-wrap;scrollbar-width:none}
[x-omni-vn] [data-vn-text][data-narr]{color:#cfc8dc;font-style:italic}
[x-omni-vn] [data-vn-text] span{opacity:0;animation:vn-ch .1s ease forwards}
[x-omni-vn] [data-vn-next]{position:absolute;right:18px;bottom:50px;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid var(--gold);opacity:0;animation:vn-next 1s ease-in-out infinite}
/* The story so far has ended: Risu's input below is where it goes on. */
[x-omni-vn] [data-vn-end]{position:absolute;left:50%;top:-46px;translate:-50% 0;padding:5px 14px;border-radius:999px;font-size:12.5px;letter-spacing:.04em;white-space:nowrap;color:var(--gold);background:rgba(10,9,17,.9);border:1px solid var(--line);box-shadow:0 0 16px -4px var(--gold);opacity:0;animation:vn-blink 1.2s ease-in-out infinite;pointer-events:none}
[x-omni-vn] [data-vn-menu]{position:absolute;left:18px;right:18px;bottom:16px;display:flex;align-items:center;gap:2px;z-index:4}
[x-omni-vn] [data-vn-menu] button{height:30px;min-width:30px;padding:0 9px;font-size:11.5px;border-radius:8px;background:transparent;border-color:transparent;color:#d8cfb4}
[x-omni-vn] [data-vn-act="bgm"]{width:64px;margin-right:auto}
[x-omni-vn] [data-vn-act="bgm"]::after{content:"▶";margin-left:5px;font-size:9px}
[x-omni-vn] [data-vn-menu] [data-vn-act="next"],[x-omni-vn] [data-vn-menu] [data-vn-act="prev"]{color:var(--gold);font-size:13px}
/* Tabs on the stage's edges: 메시지 on the left, 삽화 and 요소 on the right. */
[x-omni-vn] [data-vn-act="strip"],[x-omni-vn] [data-vn-act="msgs"],[x-omni-vn] [data-vn-act="elems"]{position:absolute;top:38%;z-index:4;height:auto;min-width:0;padding:12px 7px;writing-mode:vertical-rl;letter-spacing:.2em;font-size:11px;color:var(--gold);background:rgba(10,9,17,.72);border:1px solid var(--line)}
[x-omni-vn] [data-vn-act="strip"]{right:0;border-radius:12px 0 0 12px;border-right:0}
[x-omni-vn] [data-vn-act="msgs"]{left:0;border-radius:0 12px 12px 0;border-left:0}
[x-omni-vn] [data-vn-act="elems"]{right:0;top:calc(38% + 84px);border-radius:12px 0 0 12px;border-right:0}
/* 요소: a bot's own elements as stickers (inert: their buttons are the chat's, not the stage's), 편집, the end's choices. */
[x-omni-vn] [data-vn-stickers]{position:absolute;inset:0;z-index:2;pointer-events:none}
[x-omni-vn] [x-vn-st]{display:none;position:absolute;max-width:min(92%,460px);margin:0;padding:0;transform-origin:0 0}
[x-omni-vn] [x-vn-st] [data-omnitts-tail],[x-omni-vn] [x-vn-st] [data-omnitts-play]{display:none!important}
[x-omni-vn] [data-vn-act="eledit"]{position:absolute;right:12px;top:58px;z-index:7;visibility:hidden}
[x-omni-vn] [data-vn-edit]{position:absolute;top:104px;right:0;width:min(84%,330px);max-height:calc(100% - 104px - clamp(136px,26%,200px) - 24px);overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:12px;z-index:7;display:flex;flex-direction:column;gap:8px;
  background:rgba(10,9,17,.96);border:1px solid var(--line);border-right:0;border-radius:14px 0 0 14px;translate:105% 0;transition:translate .32s cubic-bezier(.2,.8,.25,1)}
[x-omni-vn] [data-vn-edit] h4{margin:0;font-size:13px;color:var(--gold)}
[x-omni-vn] [data-vn-edit] [data-vn-hint]{font-size:11px;line-height:1.5;color:#a59cb6}
[x-omni-vn] [data-vn-el]{flex:none;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1)}
[x-omni-vn] [data-vn-el] b{font-size:12px;color:#efe9da;margin-right:6px}
[x-omni-vn] [data-vn-el] small{font-size:10.5px;color:#a59cb6}
[x-omni-vn] [data-vn-el] span{display:block;margin:3px 0 7px;font-size:11.5px;color:#cfc6b2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[x-omni-vn] [data-vn-el] p{margin:0;display:flex;flex-wrap:wrap;gap:5px}
[x-omni-vn] [data-vn-el] i{font-style:normal;font-size:11.5px;padding:5px 10px;border-radius:999px;cursor:pointer;color:#e9e3d3;border:1px solid rgba(255,255,255,.2);transition:background .15s}
[x-omni-vn] [data-vn-el] i[data-on]{color:#1a1408;background:var(--gold);border-color:var(--gold)}
[x-omni-vn] [data-vn-choices]{display:none;position:absolute;left:50%;bottom:calc(12px + clamp(136px,26%,200px) + 16px);translate:-50% 0;width:min(76%,460px);flex-direction:column;gap:8px;z-index:4}
[x-omni-vn] [data-vn-ch]{padding:11px 16px;border-radius:12px;cursor:pointer;text-align:center;font:15px/1.5 ${SERIF};color:#f4f1ea;background:rgba(10,9,17,.9);border:1px solid var(--line);box-shadow:0 6px 20px rgba(0,0,0,.4);transition:background .15s,border-color .15s}
[x-omni-vn] [data-vn-ch][data-sel]{border-color:var(--gold);background:rgba(227,194,122,.2)}
[x-omni-vn] [data-vn-ch][data-sel]::after{content:"한 번 더 누르면 보내요";display:block;margin-top:2px;font:11px/1.4 system-ui,sans-serif;color:var(--gold)}
[x-omni-vn] [data-vn-strip]{position:absolute;top:56px;right:0;width:min(42%,210px);max-height:calc(100% - 56px - clamp(136px,26%,200px) - 24px);overflow:hidden;padding:10px;z-index:5;display:flex;flex-direction:column;gap:8px;
  background:rgba(10,9,17,.94);border:1px solid var(--line);border-right:0;border-radius:14px 0 0 14px;translate:105% 0;transition:translate .32s cubic-bezier(.2,.8,.25,1)}
[x-omni-vn] [data-vn-strip] [x-vn-thumb]{flex:none;display:block;width:100%!important;height:auto!important;max-width:none!important;max-height:none!important;aspect-ratio:3/2;object-fit:cover;margin:0!important;border-radius:8px!important;border:1px solid rgba(255,255,255,.18)!important}
[x-omni-vn] [data-vn-strip] div[x-vn-thumb]{display:flex;align-items:center;justify-content:center;font-size:11px;color:#bdb4cf;background:rgba(255,255,255,.05)}
[x-omni-vn] [data-vn-msgs]{position:absolute;top:56px;left:0;width:min(56%,250px);max-height:calc(100% - 56px - clamp(136px,26%,200px) - 24px);overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:thin;padding:10px;z-index:5;display:flex;flex-direction:column;gap:6px;
  background:rgba(10,9,17,.94);border:1px solid var(--line);border-left:0;border-radius:0 14px 14px 0;translate:-105% 0;transition:translate .32s cubic-bezier(.2,.8,.25,1)}
[x-omni-vn] [data-vn-msg]{flex:none;padding:7px 10px;border-radius:9px;cursor:pointer;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);transition:background .15s,border-color .15s}
[x-omni-vn] [data-vn-msg][data-now]{background:rgba(227,194,122,.1);border-color:var(--gold)}
[x-omni-vn] [data-vn-msg] b{margin-right:6px;font-size:11px;color:var(--gold)}
[x-omni-vn] [data-vn-msg] small{font-size:10.5px;color:#cfc6b2}
[x-omni-vn] [data-vn-msg] span{display:block;margin-top:3px;font-size:12px;line-height:1.45;color:#e9e3d3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[x-omni-vn] [data-vn-log]{display:none;position:absolute;inset:56px 12px 54px;overflow:auto;padding:16px 16px 24px;border-radius:16px;z-index:5;background:rgba(10,9,17,.96);border:1px solid var(--line);font:14px/1.7 ${SERIF}}
[x-omni-vn] [data-vn-log] p{margin:0 0 6px;padding:6px 8px;border-radius:8px;cursor:pointer;transition:background .15s}
[x-omni-vn] [data-vn-log]{overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
[x-omni-vn] [data-vn-log] b{color:var(--gold);margin-right:6px}
[x-omni-vn] [data-vn-log] [data-now]{color:#fff;border-left:2px solid var(--gold);padding-left:8px}
/* Every row and tile is a way somewhere: it lights under the pointer (or the finger), so it reads as one. */
[x-omni-vn] [data-vn-log] p:active,[x-omni-vn] [data-vn-msg]:active,[x-omni-vn] [data-vn-hud] button:active,[x-omni-vn] [data-vn-menu] button:active,[x-omni-vn] [data-vn-dock] button:active,[x-omni-vn] [data-vn-cgbar] button:active{background:rgba(227,194,122,.16)}
@media (hover:hover){[x-omni-vn] button:hover{background:rgba(48,41,70,.85)}[x-omni-vn] [data-vn-menu] button:hover{background:rgba(255,255,255,.09)}[x-omni-vn] [data-vn-dock] button:hover{background:rgba(255,255,255,.16)}
  [x-omni-vn] [data-vn-log] p:hover,[x-omni-vn] [data-vn-msg]:hover,[x-omni-vn] [data-vn-ch]:hover,[x-omni-vn] [data-vn-el] i:not([data-on]):hover{background:rgba(227,194,122,.12)}[x-omni-vn] [data-vn-msg]:hover{border-color:var(--line)}}
/* Fingers: bigger targets. */
@media (hover:none),(pointer:coarse){[x-omni-vn] button{height:40px;min-width:40px;padding:0 12px;font-size:13px}[x-omni-vn] [data-vn-box]{padding-bottom:58px}
  [x-omni-vn] [data-vn-menu]{left:16px;right:16px;bottom:15px;gap:1px}[x-omni-vn] [data-vn-menu] button{height:40px;min-width:40px;padding:0 8px;font-size:12.5px}[x-omni-vn] [data-vn-act="bgm"]{width:68px}
  [x-omni-vn] [data-vn-menu] [data-vn-act="next"],[x-omni-vn] [data-vn-menu] [data-vn-act="prev"]{min-width:46px;font-size:16px}[x-omni-vn] [data-vn-next]{bottom:62px}
  [x-omni-vn] [data-vn-act="strip"],[x-omni-vn] [data-vn-act="msgs"],[x-omni-vn] [data-vn-act="elems"]{padding:16px 10px;font-size:12.5px}[x-omni-vn] [data-vn-act="elems"]{top:calc(38% + 96px)}[x-omni-vn] [data-vn-el] i{padding:8px 12px;font-size:12.5px}[x-omni-vn] [data-vn-msg]{padding:10px 11px}[x-omni-vn] [data-vn-dock] button{height:50px}[x-omni-vn] [data-vn-log]{bottom:62px}}
@keyframes vn-enter{from{opacity:0;translate:-50% 7%}to{opacity:1;translate:-50% 0}}
@keyframes vn-photo{from{opacity:0;translate:-30% 4%;rotate:3deg}to{opacity:1;translate:-50% 0;rotate:-1.2deg}}
@keyframes vn-ch{to{opacity:1}}
@keyframes vn-fade{from{opacity:0}to{opacity:1}}
@keyframes vn-next{0%,100%{opacity:.25;translate:0 0}50%{opacity:1;translate:0 3px}}
@keyframes vn-blink{0%,100%{opacity:.3}50%{opacity:1}}
@media (min-width:700px){[x-omni-vn] [data-vn-box]{left:50%;right:auto;width:min(980px,92%);height:clamp(150px,24%,200px);translate:-50% 0}[x-omni-vn] [data-vn-menu]{left:calc(50% - min(490px,46%) + 10px);right:calc(50% - min(490px,46%) + 10px)}[x-omni-vn] [x-vn-p]{height:94%;max-width:40%}}
`;

// VOICE and AUTO sit up top: the bottom row keeps 최신 · 기록 · 나레이션 · BGM and the arrows, big enough for a finger on a phone.
export const FRAME = `<div data-vn-bg></div><div data-vn-cast></div><div data-vn-cg></div><div data-vn-stickers></div>
<div data-vn-hud><div data-vn-clock></div><button data-vn-act="voice" type="button">VOICE</button><button data-vn-act="auto" type="button">AUTO</button><button data-vn-act="close" type="button" aria-label="닫기">✕</button></div>
<div data-vn-box></div><div data-vn-log></div>
<button data-vn-act="msgs" type="button">메시지</button><div data-vn-msgs></div>
<button data-vn-act="strip" type="button">삽화</button><div data-vn-strip></div>
<button data-vn-act="elems" type="button">요소</button><button data-vn-act="eledit" type="button">✎ 편집</button><div data-vn-edit></div><div data-vn-choices></div>
<div data-vn-cgbar><button data-vn-act="cgfull" type="button">⛶ 전체화면</button><button data-vn-act="cgclose" type="button">▲ 접기</button></div>
<div data-vn-dock><button data-vn-act="cgprev" type="button" aria-label="이전 삽화">◀</button><button data-vn-act="cgfit" type="button" aria-label="맞춤 / 채움">🔍</button><button data-vn-act="cgnext" type="button" aria-label="다음 삽화">▶</button><button data-vn-act="cgback" type="button">닫기</button></div>
<div data-vn-menu><button data-vn-act="newest" type="button">최신</button><button data-vn-act="log" type="button">기록</button><button data-vn-act="narr" type="button">나레이션</button><button data-vn-act="bgm" type="button">BGM</button><button data-vn-act="prev" type="button" aria-label="이전">◀</button><button data-vn-act="next" type="button" aria-label="다음">▶</button></div>`;

/** A person's place on stage: a silhouette until their picture comes. */
export const personHtml = (name: string): string => `<div data-vn-sil style="--c:${accentOf(name)}"></div>`;

export interface StageState {
  /** Present, left to right: person key, its face key ('' while none), and whether they speak now. */
  cast: Array<{ key: string; face: string; speaking: boolean }>;
  narration: boolean;
  bg: string;
  cg: string;
  /** The box shows its whole text at once (a tap during the reveal). */
  revealed: boolean;
  log: boolean;
  /** The right-hand strip of illustrations is open. */
  strip?: boolean;
  /** The left-hand list of the chat's replies is open. */
  msgs?: boolean;
  /** "3 / 12": drawn by the style text itself, so it costs no call of its own. */
  count?: string;
  /** The reply's last CG: coming in, folded at the top, shown again, or full screen. */
  cgView?: 'open' | 'fold' | 'show' | 'full';
  /** Full screen fills the frame (cover) rather than fitting in it. */
  cgFill?: boolean;
  /** Whether the reply has an illustration before / after the full-screen one. */
  cgNav?: { prev: boolean; next: boolean };
  /** Omni's own 크게보기 is open: the viewer steps down under it. */
  away?: boolean;
  /** The story so far ends on this CG: its end cue shows with it. */
  endCg?: boolean;
  auto: boolean;
  voice: boolean;
  /** Narration is voiced (TTS 나레이션); off, it is still shown. */
  narrVoice?: boolean;
  /** BGM is playing (the button then pauses it). */
  bgm?: boolean;
}
// Phones are narrow: people overlap, the speaker in front, as a portrait VN stages them.
const SPOTS: Record<number, number[]> = { 1: [50], 2: [33, 67], 3: [24, 50, 76] };
/** The one style text a scene sets: who stands where, who is lit, which picture, which background. */
export function stageCss(s: StageState): string {
  const spots = SPOTS[Math.min(3, s.cast.length)] ?? [];
  const rules = s.cast.slice(0, 3).map((p, i) => {
    // A CG on show dims the stage; folded at the top it does not.
    const lit = s.cg && s.cgView !== 'fold' ? 'filter:brightness(.28) blur(2px)' : p.speaking ? 'filter:none;transform:scale(1.035);z-index:3' : s.narration ? 'filter:brightness(.62) saturate(.85);z-index:1' : 'filter:brightness(.4) saturate(.6) blur(1.2px);transform:scale(.96);z-index:1';
    return `[x-omni-vn] [x-vn-p="${p.key}"]{display:block;left:${spots[i]}%;${lit}}`
      + (p.face ? `[x-omni-vn] [x-vn-p="${p.key}"] [x-vn-sp="${p.face}"]{opacity:1}[x-omni-vn] [x-vn-p="${p.key}"] [data-vn-sil]{opacity:0}` : '');
  });
  const dim = (act: string, on: boolean | undefined) => on ? '' : `[x-omni-vn] [data-vn-act="${act}"]{opacity:.3}`;
  return [
    ...rules,
    s.bg ? `[x-omni-vn] [x-vn-bg="${s.bg}"]{display:block}` : '',
    s.cg && s.cgView === 'fold' ? `[x-omni-vn] img[x-vn-cg="${s.cg}"]{display:block;left:auto!important;right:12px;top:60px;width:84px!important;max-height:84px!important;translate:0 0;rotate:0deg;border-width:2px!important;animation:none;opacity:.92}`
    : s.cg && s.cgView === 'full' ? `[x-omni-vn] img[x-vn-cg="${s.cg}"]{display:block;left:0!important;top:0;width:100%!important;height:100%!important;max-height:none!important;translate:0 0;rotate:0deg;border:0!important;border-radius:0!important;background:#000;z-index:8;animation:none;object-fit:${s.cgFill ? 'cover' : 'contain'}}[x-omni-vn] [data-vn-dock]{display:grid}${dim('cgprev', s.cgNav?.prev)}${dim('cgnext', s.cgNav?.next)}`
    // A reply ending on its picture: the box steps back to its bare end cue instead of hiding.
    : s.cg ? `[x-omni-vn] img[x-vn-cg="${s.cg}"]{display:block}${s.endCg ? '[x-omni-vn] [data-vn-box]{background:transparent;border-color:transparent;box-shadow:none}[x-omni-vn] [data-vn-box]::before{display:none}' : '[x-omni-vn] [data-vn-box]{opacity:0}'}[x-omni-vn] [x-vn-bg]{filter:brightness(.45) blur(3px)}${s.cgView === 'show' ? '[x-omni-vn] [data-vn-cgbar] [data-vn-act]{display:inline-flex}' : ''}` : '',
    s.revealed ? '[x-omni-vn] [data-vn-text] span{animation:none!important;opacity:1!important}[x-omni-vn] [data-vn-next],[x-omni-vn] [data-vn-end]{animation-delay:0s!important}' : '',
    // The menu's own colour rule is [data-vn-menu] button: these outrank it, or they never show.
    s.log ? '[x-omni-vn] [data-vn-log]{display:block}[x-omni-vn] [data-vn-menu] [data-vn-act="log"]{color:var(--gold)}' : '',
    s.strip ? '[x-omni-vn] [data-vn-strip]{translate:0 0}[x-omni-vn] [data-vn-act="strip"]{opacity:0}' : '',
    s.msgs ? '[x-omni-vn] [data-vn-msgs]{translate:0 0}[x-omni-vn] [data-vn-act="msgs"]{opacity:0}' : '',
    s.count ? `[x-omni-vn] [data-vn-box]::after{content:"${s.count.replace(/["\\]/g, '')}"}` : '',
    `[x-omni-vn] [data-vn-act="auto"]{color:${s.auto ? 'var(--gold)' : '#efe9da'}${s.auto ? ';text-shadow:0 0 8px var(--gold)' : ''}}[x-omni-vn] [data-vn-act="voice"]{opacity:${s.voice ? 1 : .4}}[x-omni-vn] [data-vn-act="narr"]{opacity:${s.narrVoice === false ? .4 : 1}}`,
    s.bgm ? '[x-omni-vn] [data-vn-menu] [data-vn-act="bgm"]{color:var(--gold)}[x-omni-vn] [data-vn-act="bgm"]::after{content:"❚❚"}' : '',
    // Under Omni's overlay root (z-index 99970), whose 크게보기 is then the top of the page.
    s.away ? '[x-omni-vn]{z-index:99960!important}' : '',
  ].filter(Boolean).join('\n');
}

/**
 * Letters appear one by one (CSS only); the arrow shows once they all have. At the
 * end of the story so far (`end`) the arrow is a blinking cue to write the next
 * message instead. Returns the reveal time.
 */
export function boxHtml(input: { speaker: string; text: string; narration: boolean; end?: boolean }): { html: string; revealMs: number } {
  const chars = [...input.text];
  const step = Math.max(6, Math.min(20, Math.floor(1800 / Math.max(1, chars.length))));
  const shown = input.narration || !input.speaker ? chars : ['“', ...chars, '”'];
  const letters = shown.map((ch, i) => ch === '\n' ? '\n' : `<span style="animation-delay:${i * step}ms">${esc(ch)}</span>`).join('');
  const revealMs = shown.length * step;
  const name = input.narration ? '' : esc(input.speaker);
  const tail = input.end ? `<div data-vn-end style="animation-delay:${revealMs}ms">메시지를 입력해 주세요 ▼</div>` : `<div data-vn-next style="animation-delay:${revealMs}ms"></div>`;
  return {
    html: `<div data-vn-name style="--c:${accentOf(input.speaker || '?')}">${name}</div><div data-vn-text${input.narration ? ' data-narr' : ''}>${letters}</div>${tail}`,
    revealMs,
  };
}
