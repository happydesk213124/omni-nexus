/**
 * 옴니 뷰어's look: the frame, its static style, and the two things a scene
 * rewrites (one style text, one box). Pure strings, so a scene costs Risu two
 * calls whatever happens on stage.
 */
import { MESSAGE_CONTROL_KINDS } from '../domain/message-controls';

const esc =(s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One stable hue per name, for its nameplate and silhouette. */
export function accentOf(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return `hsl(${h} 62% 60%)`;
}

// Letters given their own delay; any after these come with the last of them.
const LETTERS = 320;
const SERIF = '"Gowun Batang","Nanum Myeongjo","Noto Serif KR","Noto Serif CJK KR",serif';
export const STATIC_CSS = `
[x-omni-vn]{position:fixed;z-index:45;isolation:isolate;overflow:hidden;color:#f4f1ea;font:14px/1.5 system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;user-select:none;-webkit-user-select:none;touch-action:manipulation;
  background:radial-gradient(120% 90% at 50% 0%,#2a2340 0%,#141224 45%,#07070c 100%);--gold:#e3c27a;--line:rgba(227,194,122,.38)}
[x-omni-vn] *{box-sizing:border-box}
/* Its own stacking: a background's order over the one it replaces (z-index, see stageCss) stays inside it, never over the picture. */
[x-omni-vn] [data-vn-bg]{position:absolute;inset:0;pointer-events:none;isolation:isolate}
[x-omni-vn] [data-vn-bg]::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(130% 100% at 50% 40%,transparent 50%,rgba(0,0,0,.55) 100%),linear-gradient(transparent 55%,rgba(5,5,10,.55))}
[x-omni-vn] div[x-vn-bg]{display:none;position:absolute;inset:0;animation:vn-fade .6s ease}
[x-omni-vn] div[x-vn-bg] img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(3px) brightness(.7) saturate(1.05);transform:scale(1.06)}
[x-omni-vn] img[x-vn-bg]{display:none;position:absolute;inset:0;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;margin:0!important;border-radius:0!important;object-fit:cover;filter:brightness(.7) saturate(1.05)}
[x-omni-vn] [data-vn-cast]{position:absolute;inset:0;pointer-events:none}
[x-omni-vn] [x-vn-p]{display:none;position:absolute;bottom:0;height:90%;aspect-ratio:13/19;max-width:82%;translate:-50% 0;transform-origin:50% 100%;
  transition:left .45s cubic-bezier(.2,.8,.25,1),filter .3s ease,transform .3s ease,opacity .3s ease;animation:vn-enter .55s cubic-bezier(.2,.8,.25,1)}
[x-omni-vn] [x-vn-p] [data-vn-sil]{position:absolute;left:16%;right:16%;top:30%;aspect-ratio:1/1.15;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:10%;text-align:center;transition:opacity .3s;
  background:radial-gradient(circle at 50% 36%,color-mix(in srgb,var(--c) 30%,#1b1828) 0%,rgba(16,14,26,.93) 74%);border:2px solid color-mix(in srgb,var(--c) 75%,transparent);box-shadow:0 0 30px -8px var(--c),inset 0 0 26px -12px var(--c)}
[x-omni-vn] [x-vn-p] [data-vn-sil] b{font:700 clamp(13px,3.8vw,19px)/1.25 ${SERIF};color:#fff;letter-spacing:.02em;word-break:keep-all;overflow-wrap:anywhere}
[x-omni-vn] [x-vn-p] [data-vn-sil]::after{content:"";white-space:pre;font-size:clamp(11px,3vw,14px);line-height:1.4;color:#eadfca}
[x-omni-vn] [x-vn-sp]{position:absolute;inset:0;opacity:0;transition:opacity .28s ease;transform-origin:50% 100%}
[x-omni-vn] [x-vn-sp] img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:50% 100%;filter:drop-shadow(0 6px 18px rgba(0,0,0,.45));transform-origin:50% 100%}
/* A person comes in, changes face or steps forward: a spring, squash and stretch from the feet. Two names alike,
   so turning from one to the other plays it again (a rule written again with the same one does not). */
@keyframes vn-jelly-a{0%{scale:.9 1.08;translate:0 2%}32%{scale:1.08 .93;translate:0 0}52%{scale:.96 1.05}72%{scale:1.02 .985}88%{scale:.995 1.005}100%{scale:1 1;translate:0 0}}
@keyframes vn-jelly-b{0%{scale:.9 1.08;translate:0 2%}32%{scale:1.08 .93;translate:0 0}52%{scale:.96 1.05}72%{scale:1.02 .985}88%{scale:.995 1.005}100%{scale:1 1;translate:0 0}}
/* Breathing: the chest rises a hair, from the feet. */
@keyframes vn-breathe{0%,100%{scale:1 1}50%{scale:1.005 1.014}}
@media (prefers-reduced-motion:reduce){[x-omni-vn] [x-vn-sp],[x-omni-vn] [x-vn-sp] img,[x-omni-vn] [data-vn-sil]{animation:none!important}}
[x-omni-vn] [data-vn-cg]{position:absolute;inset:0;pointer-events:none}
[x-omni-vn] div[x-vn-cg]{display:none;position:absolute;left:50%;top:calc(50% - 40px);height:min(calc(100% - 190px),520px);max-width:94%;aspect-ratio:832/1216;translate:-50% -50%;rotate:-.8deg;border:4px solid #f3efe6;border-radius:4px;box-shadow:0 18px 50px rgba(0,0,0,.6);background:linear-gradient(135deg,#2a2440,#141224)}
[x-omni-vn] div[x-vn-cg] span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;letter-spacing:.06em;color:#e6dcc6;animation:vn-pulse 1.6s ease-in-out infinite}
[x-omni-vn] [data-vn-cgbar]{position:absolute;left:50%;bottom:72px;translate:-50% 0;display:flex;gap:8px;z-index:9}
[x-omni-vn] [data-vn-note]{display:none;position:absolute;left:50%;top:58px;translate:-50% 0;z-index:10;width:max-content;max-width:min(340px,88%);padding:7px 12px;border-radius:10px;background:rgba(14,12,20,.88);border:1px solid rgba(227,194,122,.35);color:#efe9da;font-size:12.5px;line-height:1.45;text-align:center;pointer-events:none}
[x-omni-vn] [data-vn-cgbar] button{display:none}
/* The picture's cast (c1·하쿠키 …, read from its file name) over its bar, as 크게보기 has them: each opens that person's tags. */
[x-omni-vn] [data-vn-cgchips]{position:absolute;left:50%;bottom:112px;translate:-50% 0;display:flex;flex-wrap:wrap;justify-content:center;gap:6px;width:max-content;max-width:94%;z-index:9}
[x-omni-vn] [data-vn-cgchips] button{display:none;height:28px;min-width:0;padding:0 11px;font-size:11.5px;letter-spacing:0;background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.18)}
/* The folded picture's + stands inside it, at its bottom-left corner (stageCss puts it there from the picture's rectangle);
   with a mouse it shows only while the pointer is over the picture, or over itself. Two rules: a browser that cannot
   read :has() drops the whole rule it is in, and over itself the + still shows there. */
[x-omni-vn] [data-vn-act="zoom"]{display:none;position:absolute;z-index:5;width:26px;height:26px;min-width:0;padding:0;translate:4px calc(-100% - 4px);font-size:17px;line-height:1;color:var(--gold);background:rgba(10,9,17,.78);border:1px solid var(--line)}
@media (hover:hover){[x-omni-vn] [data-vn-act="zoom"]{opacity:0;transition:opacity .15s}[x-omni-vn] [data-vn-act="zoom"]:hover{opacity:1}[x-omni-vn] [data-vn-cg]:has([x-vn-cg]:hover)~[data-vn-act="zoom"]{opacity:1}}
[x-omni-vn] img[x-vn-cg]{display:none;position:absolute;left:50%;top:calc(50% - 40px);width:auto!important;height:auto!important;max-width:94%!important;max-height:calc(100% - 190px)!important;object-fit:contain;translate:-50% -50%;rotate:-.8deg;margin:0!important;border:3px solid #f3efe6!important;border-radius:4px!important;box-shadow:0 18px 50px rgba(0,0,0,.6);animation:vn-photo .5s cubic-bezier(.2,.8,.25,1)}
[x-omni-vn] [data-vn-hud]{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:6px;padding:10px 10px 18px;background:linear-gradient(rgba(5,5,10,.7),transparent);z-index:4}
/* A narrow phone: closer together, so 전체 생성 and the spinner both fit before ✕ (the clock gives way first). */
@media (max-width:400px){[x-omni-vn] [data-vn-hud]{gap:4px;padding:10px 8px 18px}}
[x-omni-vn] [data-vn-clock]{flex:1;min-width:0;display:flex;align-items:center;gap:6px;font-size:12px;letter-spacing:.02em;color:#ece6d6}
[x-omni-vn] [data-vn-clock]:not(:empty)::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--gold);box-shadow:0 0 8px var(--gold)}
[x-omni-vn] [data-vn-clock] span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[x-omni-vn] [data-vn-clock]::after{flex:none;max-width:55%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:#bdb4c8;opacity:.85}
/* Something the reader waits on (another reply read in, more rows): it turns while they wait. */
[x-omni-vn] [data-vn-busy]{display:none;flex:none;width:16px;height:16px;border-radius:50%;border:2px solid rgba(227,194,122,.25);border-top-color:var(--gold);animation:vn-spin .8s linear infinite}
/* 전체 생성: the reply on stage has pink slots (and is not streaming), all made as a press held on one makes them in the
   chat. A pink slot's look is its mark; on a phone's top bar there is room for that alone. */
[x-omni-vn] [data-vn-act="pink"]{display:none;gap:6px;color:#fde7f3;background:rgba(60,18,44,.72);border-color:rgba(236,72,153,.55)}
[x-omni-vn] [data-vn-act="pink"]::before{content:"";flex:none;box-sizing:border-box;width:13px;height:13px;border-radius:50%;border:3px solid #7132f5;background:#ec4899}
@media (max-width:520px){[x-omni-vn] [data-vn-act="pink"]{font-size:0;gap:0;padding:0}}
[x-omni-vn] button{all:unset;box-sizing:border-box;white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;height:32px;min-width:32px;padding:0 10px;border-radius:999px;font-size:12px;letter-spacing:.04em;color:#efe9da;background:rgba(14,12,22,.55);border:1px solid rgba(255,255,255,.14);transition:background .15s,opacity .15s,color .15s}
/* Full screen when Omni's own 크게보기 cannot open: the same bottom sheet of big emoji buttons. */
[x-omni-vn] [data-vn-dock]{display:none;position:absolute;left:50%;bottom:12px;translate:-50% 0;width:min(440px,calc(100% - 24px));grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:10px;z-index:9;border-radius:14px;background:rgba(18,22,32,.9);border:1px solid rgba(255,255,255,.14)}
[x-omni-vn] [data-vn-dock] button{width:100%;height:44px;padding:0;border:0;border-radius:10px;font-size:22px;background:rgba(255,255,255,.08)}
[x-omni-vn] [data-vn-dock] [data-vn-act="cgback"]{font-size:14px}
/* The box grows up with a long line (its text was cut off below, out of reach), on its own and to the height fit.ts
   reckons for it (the scene's style text; its least and most here are fit.ts's too): past most of the stage the line scrolls. */
[x-omni-vn] [data-vn-box]{position:absolute;left:12px;right:12px;bottom:12px;min-height:clamp(136px,26%,200px);max-height:58%;display:flex;flex-direction:column;padding:22px 18px 46px;border-radius:16px;z-index:3;
  background:linear-gradient(180deg,rgba(22,19,34,.88),rgba(10,9,17,.95));border:1px solid var(--line);box-shadow:0 10px 40px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.06);transition:opacity .25s}
[x-omni-vn] [data-vn-box]::before{content:"";position:absolute;left:14px;right:14px;top:8px;height:1px;background:linear-gradient(90deg,transparent,var(--line),transparent)}
/* "3 / 12" rides the box's top edge; the scene's style text writes it, costing no call of its own. */
[x-omni-vn] [data-vn-box]::after{content:none;position:absolute;top:-10px;right:14px;padding:0 9px;border-radius:9px;font:10px/18px system-ui,sans-serif;letter-spacing:.08em;color:#bdb3c9;background:#0d0b16;border:1px solid var(--line);pointer-events:none}
[x-omni-vn] [data-vn-name]{position:absolute;left:16px;top:-15px;max-width:62%;padding:4px 16px 5px;border-radius:10px 10px 10px 2px;font:700 15px/1.3 ${SERIF};color:#fff;letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  background:linear-gradient(135deg,var(--c,#7c5cf5),color-mix(in srgb,var(--c,#7c5cf5) 55%,#100c1c));box-shadow:0 4px 14px -4px var(--c,#7c5cf5)}
[x-omni-vn] [data-vn-name]:empty{display:none}
[x-omni-vn] [data-vn-costume]{font-size:.82em;font-weight:400;opacity:.85}
[x-omni-vn] [data-vn-text]{flex:1 1 auto;min-height:0;overflow:auto;font:16.5px/1.78 ${SERIF};word-break:keep-all;overflow-wrap:anywhere;white-space:pre-wrap;scrollbar-width:thin;scrollbar-color:rgba(227,194,122,.3) transparent}
[x-omni-vn] [data-vn-text][data-narr]{color:#cfc8dc;font-style:italic}
/* The line and 기록's lines can be selected, to copy: a drag on the line selects (a phone: a long press); a tap still goes on. */
[x-omni-vn] [data-vn-text],[x-omni-vn] [data-vn-log] p{user-select:text!important;-webkit-user-select:text!important;-webkit-touch-callout:default}
[x-omni-vn] [data-vn-text] ::selection,[x-omni-vn] [data-vn-log] ::selection{background:rgba(227,194,122,.42);color:#fff}
/* Each letter shows at its turn, at once: a fade made every letter its own layer to blend, the reveal
   cost the phone a frame every frame. Hidden letters keep their room, so the line never moves. */
[x-omni-vn] [data-vn-text] i{font-style:normal;visibility:hidden;animation:vn-ch 1ms steps(1,end) forwards}
${Array.from({ length: LETTERS }, (_, i) => `[x-omni-vn] [data-vn-text] i:nth-child(${i + 1}){animation-delay:calc(${i} * var(--vs))}`).join('')}[x-omni-vn] [data-vn-text] i:nth-child(n+${LETTERS + 1}){animation-delay:calc(${LETTERS} * var(--vs))}
/* The line's voice is being made: a spinner at the box's corner, by the arrow. */
[x-omni-vn] [data-vn-voicewait]{display:none;position:absolute;right:36px;bottom:46px;width:14px;height:14px;border-radius:50%;border:2px solid rgba(227,194,122,.25);border-top-color:var(--gold);animation:vn-spin .8s linear infinite;pointer-events:none}
[x-omni-vn] [data-vn-next]{position:absolute;right:18px;bottom:50px;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid var(--gold);opacity:0;animation:vn-next 1s ease-in-out infinite}
/* The story so far has ended: Risu's input below is where it goes on. */
[x-omni-vn] [data-vn-end]{position:absolute;left:50%;top:-46px;translate:-50% 0;padding:5px 14px;border-radius:999px;font-size:12.5px;letter-spacing:.04em;white-space:nowrap;color:var(--gold);background:rgba(10,9,17,.9);border:1px solid var(--line);box-shadow:0 0 16px -4px var(--gold);opacity:0;animation:vn-blink 1.2s ease-in-out infinite;pointer-events:none}
[x-omni-vn] [data-vn-menu]{position:absolute;left:18px;right:18px;bottom:16px;display:flex;align-items:center;gap:2px;z-index:4}
[x-omni-vn] [data-vn-menu] button{height:30px;min-width:30px;padding:0 9px;font-size:11.5px;border-radius:8px;background:transparent;border-color:transparent;color:#d8cfb4}
[x-omni-vn] [data-vn-act="bgm"]{width:64px}
[x-omni-vn] [data-vn-act="rate"]{margin-right:auto}
/* 배속: the voice's speeds (TTS 설정's list, as the floating TTS viewer's 1× opens them), over the menu while open. */
[x-omni-vn] [data-vn-rates]{display:none;position:absolute;left:50%;bottom:58px;translate:-50% 0;z-index:6;width:max-content;max-width:calc(100% - 24px);flex-wrap:wrap;justify-content:center;gap:4px;padding:8px;border-radius:12px;background:rgba(10,9,17,.95);border:1px solid var(--line);box-shadow:0 8px 26px rgba(0,0,0,.5)}
[x-omni-vn] [data-vn-rates] button{height:30px;min-width:46px;padding:0 9px;font-size:12px}
[x-omni-vn] [data-vn-rates] [data-on]{color:#1a1408;background:var(--gold);border-color:var(--gold)}
[x-omni-vn] [data-vn-act="bgm"]::after{content:"▶";margin-left:5px;font-size:9px}
[x-omni-vn] [data-vn-menu] [data-vn-act="first"],[x-omni-vn] [data-vn-menu] [data-vn-act="prev"],[x-omni-vn] [data-vn-menu] [data-vn-act="next"],[x-omni-vn] [data-vn-menu] [data-vn-act="last"]{color:var(--gold);font-size:13px}
/* |◀ and ▶|: the reply's first and last line, a bar drawn at the arrow's end (no glyph a phone turns into an emoji),
   stood off from ◀ ▶ so a step is never a jump by a slip of the finger. */
[x-omni-vn] [data-vn-act="first"]::before,[x-omni-vn] [data-vn-act="last"]::after{content:"";width:2px;height:.8em;background:currentColor;border-radius:1px}
[x-omni-vn] [data-vn-act="first"]::before{margin-right:1px}[x-omni-vn] [data-vn-act="last"]::after{margin-left:1px}
[x-omni-vn] [data-vn-menu] [data-vn-act="first"]{margin-right:14px}[x-omni-vn] [data-vn-menu] [data-vn-act="last"]{margin-left:14px}
/* Tabs on the stage's edges: 메시지 and 태그 on the left, 삽화 and 요소 on the right. */
[x-omni-vn] [data-vn-act="strip"],[x-omni-vn] [data-vn-act="msgs"],[x-omni-vn] [data-vn-act="elems"],[x-omni-vn] [data-vn-act="tags"]{position:absolute;top:38%;z-index:4;height:auto;min-width:0;padding:12px 7px;writing-mode:vertical-rl;letter-spacing:.2em;font-size:11px;color:var(--gold);background:rgba(10,9,17,.72);border:1px solid var(--line)}
[x-omni-vn] [data-vn-act="strip"]{right:0;border-radius:12px 0 0 12px;border-right:0}
[x-omni-vn] [data-vn-act="msgs"]{left:0;border-radius:0 12px 12px 0;border-left:0}
[x-omni-vn] [data-vn-act="elems"]{right:0;top:calc(38% + 84px);border-radius:12px 0 0 12px;border-right:0}
[x-omni-vn] [data-vn-act="tags"]{left:0;top:calc(38% + 84px);border-radius:0 12px 12px 0;border-left:0}
/* 태그: the chat's own message controls (⚛️ 태그 생성 … 🔢 생성 장수) for the reply on stage, a row slid out over its tab. */
[x-omni-vn] [data-vn-tagbar]{position:absolute;left:0;top:calc(38% + 84px);z-index:5;display:flex;flex-wrap:wrap;gap:4px;max-width:calc(100% - 16px);padding:6px;background:rgba(10,9,17,.94);border:1px solid var(--line);border-left:0;border-radius:0 14px 14px 0;translate:-105% 0;transition:translate .32s cubic-bezier(.2,.8,.25,1)}
[x-omni-vn] [data-vn-tagbar] button{width:40px;height:40px;min-width:0;padding:0;border:0;border-radius:10px;font-size:20px;letter-spacing:0;background:rgba(255,255,255,.08)}
/* Its 🔢: − + 1~3 − + as the floating viewer's (the left pair the least, the right the most), a drawer of its own hung
   under the row, as the floating 태그's is: the row keeps its size (a line inside made it a box twice as tall, all of
   it gap), and the drawer, the row's child, slides with it. */
[x-omni-vn] [data-vn-counts]{display:none;position:absolute;left:0;top:calc(100% + 6px);align-items:center;gap:6px;width:max-content;padding:6px;background:rgba(10,9,17,.94);border:1px solid var(--line);border-left:0;border-radius:0 14px 14px 0;animation:vn-counts-in .18s ease-out}
[x-omni-vn] [data-vn-counts] button{font-size:22px}
[x-omni-vn] [data-vn-range]{min-width:54px;text-align:center;font:600 15px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;color:#efe9da}
/* 요소: a bot's own elements as stickers (inert: their buttons are the chat's, not the stage's), 편집, the end's choices.
   Over the people (the one speaking stands at 3 too, painted before; at 2 a sticker went under them), under the box. */
[x-omni-vn] [data-vn-stickers]{position:absolute;inset:0;z-index:3;pointer-events:none}
[x-omni-vn] [x-vn-st]{display:none;position:absolute;max-width:min(92%,460px);margin:0;padding:0;transform-origin:0 0}
[x-omni-vn] [x-vn-st] summary{pointer-events:auto;cursor:pointer}
/* 접기: a title bar over the sticker (26px: BAR_H in elements.ts), its name and ▾ (▸ folded); a tap folds, a drag (in 편집) moves. */
[x-omni-vn] [x-vn-st-bar]{display:flex;align-items:center;gap:8px;min-width:120px;height:26px;padding:0 10px;box-sizing:border-box;border:1px solid var(--line);border-bottom-width:0;border-radius:8px 8px 0 0;background:rgba(10,9,17,.9);color:var(--gold);font:600 12px/24px system-ui,sans-serif;cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none}
[x-omni-vn] [x-vn-st-bar]::after{content:"▾";margin-left:auto;color:#efe9da}
/* 작동: a tile, dragged anywhere in 편집 like a floating icon; a tap opens its element through the viewer. */
[x-omni-vn] [data-vn-tile]{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;width:56px;height:56px;padding:4px;box-sizing:border-box;border:1px solid var(--line);border-radius:14px;background:rgba(10,9,17,.9);color:var(--gold);font:600 10px/1.2 system-ui,sans-serif;text-align:center;overflow:hidden;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.45);user-select:none;-webkit-user-select:none}
[x-omni-vn] [data-vn-tile] b{font-size:22px;line-height:1;font-weight:400}
[x-omni-vn] [data-vn-tile] span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* A tile's corner: its group's letter (on a member in 편집, and on the group's own tile). */
[x-omni-vn] [data-vn-tile]{position:relative}
[x-omni-vn] [data-vn-tile] i{position:absolute;right:3px;top:3px;min-width:16px;height:16px;padding:0 3px;box-sizing:border-box;border-radius:8px;background:rgba(227,194,122,.92);color:#1a1408;font:700 9px/16px system-ui,sans-serif;font-style:normal;text-align:center}
/* The floating 이전 tile (뷰어 설정): a step back, as the menu's ◀; dragged anywhere (back-tile.ts), placed by the
   scene's style text. Over the stage and the box, under the panels. */
[x-omni-vn] [data-vn-act="back"]{display:none;position:absolute;z-index:5;flex-direction:column;gap:2px;width:56px;height:56px;min-width:0;padding:0;border-radius:14px;border:1px solid var(--line);background:rgba(10,9,17,.88);color:var(--gold);font:600 11px/1.2 system-ui,sans-serif;letter-spacing:0;box-shadow:0 4px 14px rgba(0,0,0,.45);touch-action:none;user-select:none;-webkit-user-select:none}
[x-omni-vn] [data-vn-act="back"] b{font-size:20px;line-height:1;font-weight:400}
/* 편집's buttons at the top, between the bar and the panel: 선택 (pick tiles and stickers), 그룹화, 분리, 없는것 숨김
   (told by where the tap falls, as every tap of the viewer's). */
[x-omni-vn] [data-vn-groupbar]{display:none;position:absolute;left:12px;top:52px;z-index:6;gap:8px;pointer-events:none}
[x-omni-vn] [data-vn-gb]{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:60px;height:46px;box-sizing:border-box;border:1px solid var(--line);border-radius:12px;background:rgba(10,9,17,.88);color:var(--gold);font:600 10px/1.2 system-ui,sans-serif;cursor:pointer}
[x-omni-vn] [data-vn-gb] b{font-size:16px;line-height:1;font-weight:400}
/* In 편집 a tile shows its tab (the same panel may come from each), a grouped sticker its letter by its left corner
   (the panel covers the right of the stage on a phone), and a kind absent from its message, with 없는것 숨김 off, is a
   grey tile (no filter on the tile: a pick's ring stays blue). */
[x-omni-vn] [data-vn-tile] em{font:500 8px/1 system-ui,sans-serif;font-style:normal;color:#a59cb6}
[x-omni-vn] [x-vn-st-group]{position:absolute;left:-9px;top:-9px;z-index:1;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9px;background:rgba(227,194,122,.92);color:#1a1408;font:700 10px/18px system-ui,sans-serif;text-align:center}
[x-omni-vn] [x-vn-st][x-vn-ghost]{outline-color:rgba(255,255,255,.3)}
[x-omni-vn] [x-vn-st][x-vn-ghost] [data-vn-tile]{border-style:dashed;border-color:rgba(255,255,255,.28);background:rgba(36,36,40,.88);color:#9b98a3}
[x-omni-vn] [x-vn-st][x-vn-ghost] [data-vn-tile] b{filter:grayscale(1);opacity:.75}
[x-omni-vn] [x-vn-st][x-vn-ghost] [data-vn-tile] i{background:#9b98a3}
/* A finger must land on what it drags, and must not pan: the layer lets presses through, so a bar or a tile takes
   them itself, or a phone takes the move under it for a scroll and the drag stops after a few pixels. */
[x-omni-vn] [x-vn-st-bar],[x-omni-vn] [data-vn-tile]{pointer-events:auto;touch-action:none}
/* 작동's popup frame: the stage dimmed around it and a spinner until the element stands there. The element is seen
   through a hole in the viewer, which cuts the frame away with it: its outline and the dim around are left. An older
   reply's comes as a copy in it (inert: its buttons are not Risu's there). */
[x-omni-vn] [data-vn-pop]{display:none;position:absolute;left:50%;top:50%;width:64px;height:64px;transform:translate(-50%,-50%);z-index:6;box-sizing:border-box;border-radius:10px;outline:2px solid var(--gold);box-shadow:0 0 0 200vmax rgba(0,0,0,.38);pointer-events:none}
/* 닫기: a bar across the window's foot, 44px (POPX_H in elements-pop.ts): the sheet keeps the viewer there. */
[x-omni-vn] [data-vn-pop] [data-vn-popx]{display:none;position:absolute;left:0;right:0;bottom:0;height:44px;box-sizing:border-box;border-top:1px solid var(--gold);background:#0a0911;color:var(--gold);font:700 15px/43px system-ui,sans-serif;font-style:normal;text-align:center;letter-spacing:.3em;pointer-events:auto;cursor:pointer;user-select:none;-webkit-user-select:none}
[x-omni-vn] [data-vn-pop][x-vn-pop="live"] [data-vn-popx]{display:block}
[x-omni-vn] [data-vn-pop] [data-vn-spin]{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-13px 0 0 -13px;border-radius:50%;border:2px solid rgba(227,194,122,.25);border-top-color:var(--gold);animation:vn-spin .8s linear infinite}
[x-omni-vn] [data-vn-pop][x-vn-pop="copy"]{width:auto;height:auto;max-width:calc(100% - 24px);max-height:80%;overflow:auto;overscroll-behavior:contain;padding:10px;background:rgba(10,9,17,.95);pointer-events:auto;touch-action:pan-y}
[x-omni-vn] [data-vn-pop][x-vn-pop="copy"] *{pointer-events:none}
[x-omni-vn] [data-vn-pop] [x-vn-pop-note]{margin-top:8px;font-size:11px;line-height:1.5;color:#a59cb6}
[x-omni-vn] [data-vn-pop] [data-omnitts-tail],[x-omni-vn] [data-vn-pop] [data-omnitts-play]{display:none!important}
[x-omni-vn] [data-vn-edit] [data-vn-wait]::before{content:"";display:inline-block;width:10px;height:10px;margin-right:7px;vertical-align:-1px;border-radius:50%;border:2px solid rgba(227,194,122,.25);border-top-color:var(--gold);animation:vn-spin .8s linear infinite}
/* 편집's tabs: the reply, the bot's next message, the one after; one row, equal shares (a tap is told by its x). */
[x-omni-vn] [data-vn-tabs]{display:flex;gap:4px;margin:8px 0 6px}
[x-omni-vn] [data-vn-tabs] i{flex:1 1 0;min-width:0;display:flex;align-items:center;justify-content:center;text-align:center;font-style:normal;font-size:10.5px;line-height:1.25;padding:5px 2px;border-radius:8px;cursor:pointer;color:#e9e3d3;border:1px solid rgba(255,255,255,.2);word-break:keep-all;overflow:hidden}
[x-omni-vn] [data-vn-tabs] i[data-on]{color:#1a1408;background:var(--gold);border-color:var(--gold)}
[x-omni-vn] [x-vn-st] [data-omnitts-tail],[x-omni-vn] [x-vn-st] [data-omnitts-play]{display:none!important}
/* 요소 편집 in the top bar, left of ⚙ (the reader's place for it): there while 요소 is on or 편집 open, lit while open. */
[x-omni-vn] [data-vn-act="eledit"]{display:none;flex:none;white-space:nowrap;font-size:12px}
/* 편집's own 닫기, at the panel's top right by its title. */
[x-omni-vn] [data-vn-edit] [data-vn-edx]{position:absolute;top:8px;right:10px;padding:4px 12px;border-radius:999px;border:1px solid var(--line);color:#efe9da;font:600 12px/1.4 system-ui,sans-serif;font-style:normal;cursor:pointer}
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
[x-omni-vn] [data-vn-ch][data-sel]::after{content:"한 번 더 누르면 보내요 · 입력창에 쓰면 같이 가요 · 빈 곳을 누르면 풀려요";display:block;margin-top:2px;font:11px/1.4 system-ui,sans-serif;color:var(--gold)}
[x-omni-vn] [data-vn-strip]{position:absolute;top:56px;right:0;width:min(42%,210px);max-height:calc(100% - 56px - clamp(136px,26%,200px) - 24px);overflow:hidden;padding:10px;z-index:5;display:flex;flex-direction:column;gap:8px;
  background:rgba(10,9,17,.94);border:1px solid var(--line);border-right:0;border-radius:14px 0 0 14px;translate:105% 0;transition:translate .32s cubic-bezier(.2,.8,.25,1)}
[x-omni-vn] [data-vn-strip] [x-vn-thumb]{flex:none;display:block;width:100%!important;height:auto!important;max-width:none!important;max-height:none!important;aspect-ratio:3/2;object-fit:cover;margin:0!important;border-radius:8px!important;border:1px solid rgba(255,255,255,.18)!important}
[x-omni-vn] [data-vn-strip] div[x-vn-thumb]{display:flex;align-items:center;justify-content:center;font-size:11px;color:#bdb4cf;background:rgba(255,255,255,.05)}
[x-omni-vn] [data-vn-strip]:empty::before{content:"";align-self:center;width:18px;height:18px;margin:10px;border-radius:50%;border:2px solid rgba(227,194,122,.25);border-top-color:var(--gold);animation:vn-spin .8s linear infinite}
[x-omni-vn] [data-vn-msgs]{position:absolute;top:56px;left:0;width:min(56%,250px);max-height:calc(100% - 56px - clamp(136px,26%,200px) - 24px);overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:thin;padding:10px;z-index:5;display:flex;flex-direction:column;gap:6px;
  background:rgba(10,9,17,.94);border:1px solid var(--line);border-left:0;border-radius:0 14px 14px 0;translate:-105% 0;transition:translate .32s cubic-bezier(.2,.8,.25,1)}
[x-omni-vn] [data-vn-msg]{flex:none;padding:7px 10px;border-radius:9px;cursor:pointer;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);transition:background .15s,border-color .15s}
[x-omni-vn] [data-vn-msg][data-now]{background:rgba(227,194,122,.1);border-color:var(--gold)}
[x-omni-vn] [data-vn-msg] b{margin-right:6px;font-size:11px;color:var(--gold)}
[x-omni-vn] [data-vn-msg] small{font-size:10.5px;color:#cfc6b2}
[x-omni-vn] [data-vn-msg] span{display:block;margin-top:3px;font-size:12px;line-height:1.45;color:#e9e3d3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Only the replies around the one on stage are listed: the rest come by these, a few at a time. */
[x-omni-vn] [data-vn-msg][data-more]{text-align:center;font-size:12px;color:var(--gold);border-style:dashed;background:transparent}
[x-omni-vn] [data-vn-msgs]:empty::before{content:"";align-self:center;width:18px;height:18px;margin:10px;border-radius:50%;border:2px solid rgba(227,194,122,.25);border-top-color:var(--gold);animation:vn-spin .8s linear infinite}
[x-omni-vn] [data-vn-log]{display:none;position:absolute;inset:56px 12px 54px;overflow:auto;padding:16px 16px 24px;border-radius:16px;z-index:5;background:rgba(10,9,17,.96);border:1px solid var(--line);font:14px/1.7 ${SERIF}}
[x-omni-vn] [data-vn-log] p{margin:0 0 6px;padding:6px 8px;border-radius:8px;cursor:pointer;transition:background .15s}
[x-omni-vn] [data-vn-log]{overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
[x-omni-vn] [data-vn-log] b{color:var(--gold);margin-right:6px}
[x-omni-vn] [data-vn-log] h5{margin:0 0 10px;font:600 12px/1.4 system-ui,sans-serif;letter-spacing:.05em;color:var(--gold)}
[x-omni-vn] [data-vn-log] p{color:#cbc3d6}
[x-omni-vn] [data-vn-log] [data-now]{color:#fff;background:rgba(227,194,122,.16);border-left:3px solid var(--gold);padding-left:8px}
/* Every row and tile is a way somewhere: it lights under the pointer (or the finger), so it reads as one. */
[x-omni-vn] [data-vn-log] p:active,[x-omni-vn] [data-vn-msg]:active,[x-omni-vn] [data-vn-hud] button:active,[x-omni-vn] [data-vn-menu] button:active,[x-omni-vn] [data-vn-dock] button:active,[x-omni-vn] [data-vn-cgbar] button:active,[x-omni-vn] [data-vn-cgchips] button:active,[x-omni-vn] [data-vn-tagbar] button:active,[x-omni-vn] [data-vn-rates] button:active{background:rgba(227,194,122,.16)}
@media (hover:hover){[x-omni-vn] button:hover{background:rgba(48,41,70,.85)}[x-omni-vn] [data-vn-menu] button:hover{background:rgba(255,255,255,.09)}[x-omni-vn] [data-vn-dock] button:hover,[x-omni-vn] [data-vn-tagbar] button:hover{background:rgba(255,255,255,.16)}
  [x-omni-vn] [data-vn-log] p:hover,[x-omni-vn] [data-vn-msg]:hover,[x-omni-vn] [data-vn-ch]:hover,[x-omni-vn] [data-vn-el] i:not([data-on]):hover{background:rgba(227,194,122,.12)}[x-omni-vn] [data-vn-msg]:hover{border-color:var(--line)}}
/* Fingers: bigger targets. */
@media (hover:none),(pointer:coarse){[x-omni-vn] button{height:40px;min-width:40px;padding:0 12px;font-size:13px}[x-omni-vn] [data-vn-box]{padding-bottom:58px}
  [x-omni-vn] [data-vn-menu]{left:16px;right:16px;bottom:15px;gap:1px}[x-omni-vn] [data-vn-menu] button{height:40px;min-width:40px;padding:0 8px;font-size:12.5px}[x-omni-vn] [data-vn-act="bgm"]{width:68px}
  [x-omni-vn] [data-vn-menu] [data-vn-act="first"],[x-omni-vn] [data-vn-menu] [data-vn-act="prev"],[x-omni-vn] [data-vn-menu] [data-vn-act="next"],[x-omni-vn] [data-vn-menu] [data-vn-act="last"]{min-width:40px;font-size:16px}[x-omni-vn] [data-vn-next]{bottom:62px}[x-omni-vn] [data-vn-voicewait]{bottom:58px}
  [x-omni-vn] [data-vn-act="strip"],[x-omni-vn] [data-vn-act="msgs"],[x-omni-vn] [data-vn-act="elems"],[x-omni-vn] [data-vn-act="tags"]{padding:16px 10px;font-size:12.5px}[x-omni-vn] [data-vn-act="elems"]{top:calc(38% + 96px)}[x-omni-vn] [data-vn-act="eledit"]{right:42px;top:calc(38% + 96px)}[x-omni-vn] [data-vn-el] i{padding:8px 12px;font-size:12.5px}[x-omni-vn] [data-vn-msg]{padding:10px 11px}[x-omni-vn] [data-vn-dock] button{height:50px}[x-omni-vn] [data-vn-log]{bottom:62px}
  [x-omni-vn] [data-vn-act="tags"],[x-omni-vn] [data-vn-tagbar]{top:calc(38% + 96px)}[x-omni-vn] [data-vn-tagbar] button{width:44px;height:44px}
  /* Seven 44px buttons in one line on a 360px phone (at 4px apart the last, 🔢, went down alone). */
  [x-omni-vn] [data-vn-tagbar]{gap:3px}[x-omni-vn] [data-vn-act="zoom"]{width:30px;height:30px}
  [x-omni-vn] [data-vn-cgchips]{bottom:120px}[x-omni-vn] [data-vn-cgchips] button{height:34px;padding:0 12px;font-size:12.5px}[x-omni-vn] [data-vn-rates]{bottom:66px}[x-omni-vn] [data-vn-rates] button{height:40px;min-width:52px}}
@keyframes vn-enter{from{opacity:0;translate:-50% 7%}to{opacity:1;translate:-50% 0}}
@keyframes vn-counts-in{from{opacity:0}to{opacity:1}}
@keyframes vn-photo{from{opacity:0;translate:-50% -46%;scale:.96}to{opacity:1;translate:-50% -50%;scale:1}}
/* Visible at both ends, not only at the end: a 1ms step past a second's delay is held at a rounding
   short of its end (Chromium), the "from" value, and every letter after that stayed hidden for good:
   a long line stopped mid-word (at 20ms a letter, after the 50th). Before its turn a letter has no
   animation applied yet (fill forwards only), so it still waits hidden. */
@keyframes vn-ch{from,to{visibility:visible}}
@keyframes vn-fade{from{opacity:0}to{opacity:1}}
@keyframes vn-next{0%,100%{opacity:.25;translate:0 0}50%{opacity:1;translate:0 3px}}
@keyframes vn-pulse{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes vn-blink{0%,100%{opacity:.3}50%{opacity:1}}
@keyframes vn-spin{to{rotate:360deg}}
/* A phone: ten buttons in one row (배속 the tenth, its speed in smaller figures), the words drawn in to make room, each at its
   own width: a row out of room squeezes its buttons over their words. */
@media (max-width:540px){[x-omni-vn] [data-vn-menu] button{padding:0 3px;min-width:30px;font-size:11.5px;letter-spacing:0}[x-omni-vn] [data-vn-menu] [data-vn-act="rate"]{min-width:0;padding:0 2px;font-size:10.5px}[x-omni-vn] [data-vn-act="bgm"]{width:auto}[x-omni-vn] [data-vn-act="bgm"]::after{margin-left:3px}[x-omni-vn] [data-vn-menu] [data-vn-act="prev"],[x-omni-vn] [data-vn-menu] [data-vn-act="next"]{min-width:30px}[x-omni-vn] [data-vn-menu] [data-vn-act="first"],[x-omni-vn] [data-vn-menu] [data-vn-act="last"]{min-width:28px}[x-omni-vn] [data-vn-menu] [data-vn-act="first"]{margin-right:8px}[x-omni-vn] [data-vn-menu] [data-vn-act="last"]{margin-left:8px}}
@media (max-width:420px){[x-omni-vn] [data-vn-menu]{left:12px;right:12px;gap:0}[x-omni-vn] [data-vn-menu] button{padding:0 2px;min-width:26px;font-size:11px}[x-omni-vn] [data-vn-menu] [data-vn-act="prev"],[x-omni-vn] [data-vn-menu] [data-vn-act="next"]{min-width:26px}[x-omni-vn] [data-vn-menu] [data-vn-act="first"],[x-omni-vn] [data-vn-menu] [data-vn-act="last"]{min-width:24px}}
@media (max-width:380px){[x-omni-vn] [data-vn-menu] [data-vn-act="rate"]{font-size:10px}}
/* Narrower still there is no room for them: ◀ ▶ alone, as before. */
@media (max-width:359px){[x-omni-vn] [data-vn-menu] [data-vn-act="first"],[x-omni-vn] [data-vn-menu] [data-vn-act="last"]{display:none}[x-omni-vn] [data-vn-menu] [data-vn-act="prev"],[x-omni-vn] [data-vn-menu] [data-vn-act="next"]{min-width:32px}}
@media (min-width:700px){[x-omni-vn] [data-vn-box]{left:50%;right:auto;width:min(980px,92%);min-height:clamp(150px,24%,200px);translate:-50% 0}[x-omni-vn] [data-vn-menu]{left:calc(50% - min(490px,46%) + 10px);right:calc(50% - min(490px,46%) + 10px)}[x-omni-vn] [x-vn-p]{height:94%;max-width:40%}}
`;

/** A picture's cast chips (c1 …), as many as NovelAI draws people in one picture. */
export const CAST_CHIPS = 6;
// 태그's row: the message controls' own kinds, each `m` + its kind (mtag, mregen …).
const TAG_BAR = MESSAGE_CONTROL_KINDS.map(([kind, icon, label]) => `<button data-vn-act="m${kind}" type="button" title="${label}" aria-label="${label}">${icon}</button>`).join('');
// Its 🔢 row: each step `c` + its name without the dash (cmindown …), the range between the pairs.
export const COUNT_STEPS = [['cmindown', '−', '최소 줄이기'], ['cminup', '+', '최소 늘리기'], ['cmaxdown', '−', '최대 줄이기'], ['cmaxup', '+', '최대 늘리기']] as const;
const countButton = ([act, glyph, label]: typeof COUNT_STEPS[number]) => `<button data-vn-act="${act}" type="button" title="${label}" aria-label="${label}">${glyph}</button>`;
const COUNT_BAR = `${countButton(COUNT_STEPS[0])}${countButton(COUNT_STEPS[1])}<span data-vn-range></span>${countButton(COUNT_STEPS[2])}${countButton(COUNT_STEPS[3])}`;
const CHIPS = Array.from({ length: CAST_CHIPS }, (_, i) => `<button data-vn-act="cgc${i + 1}" type="button"></button>`).join('');
// VOICE and AUTO sit up top: the bottom row keeps 최신 · 기록 · 나레이션 · BGM and the arrows, big enough for a finger on a phone.
export const FRAME = `<div data-vn-bg></div><div data-vn-cast></div><div data-vn-cg></div><button data-vn-act="zoom" type="button" aria-label="접힌 삽화 크기"></button><button data-vn-act="back" type="button" aria-label="이전"><b>◀</b><span>이전</span></button><div data-vn-stickers></div><div data-vn-pop><b data-vn-spin></b><i data-vn-popx>닫기</i></div><div data-vn-groupbar><div data-vn-gb="select"><b>☑️</b><span>선택</span></div><div data-vn-gb="group"><b>🔗</b><span>그룹화</span></div><div data-vn-gb="split"><b>✂️</b><span>분리</span></div><div data-vn-gb="absent"><b>🙈</b><span>없는것 숨김</span></div></div>
<div data-vn-hud><div data-vn-clock></div><div data-vn-busy></div><button data-vn-act="pink" type="button" title="이 답장의 분홍 칸 전체 생성" aria-label="이 답장의 분홍 칸 전체 생성">전체 생성</button><button data-vn-act="eledit" type="button">요소 편집</button><button data-vn-act="set" type="button" aria-label="뷰어 설정">⚙</button><button data-vn-act="cast" type="button" aria-label="이 답장의 TTS 캐릭터 설정">👨‍👩‍👧‍👦</button><button data-vn-act="voice" type="button">VOICE</button><button data-vn-act="auto" type="button">AUTO</button><button data-vn-act="close" type="button" aria-label="닫기">✕</button></div>
<div data-vn-box></div><div data-vn-log></div>
<button data-vn-act="msgs" type="button">메시지</button><div data-vn-msgs></div>
<button data-vn-act="tags" type="button">태그</button><div data-vn-tagbar>${TAG_BAR}<div data-vn-counts>${COUNT_BAR}</div></div>
<button data-vn-act="strip" type="button">삽화</button><div data-vn-strip></div>
<button data-vn-act="elems" type="button">요소</button><div data-vn-edit></div><div data-vn-choices></div>
<div data-vn-note></div><div data-vn-cgchips>${CHIPS}</div><div data-vn-cgbar><button data-vn-act="cgfull" type="button">⛶ 전체화면</button><button data-vn-act="cgroll" type="button" aria-label="이 삽화 리롤">🎲 리롤</button><button data-vn-act="cgtags" type="button" aria-label="샷 태그 수정">🔮 샷 태그</button><button data-vn-act="cgclose" type="button">▲ 접기</button></div>
<div data-vn-dock><button data-vn-act="cgprev" type="button" aria-label="이전 삽화">◀</button><button data-vn-act="cgfit" type="button" aria-label="맞춤 / 채움">🔍</button><button data-vn-act="cgnext" type="button" aria-label="다음 삽화">▶</button><button data-vn-act="cgback" type="button">닫기</button></div>
<div data-vn-menu><button data-vn-act="newest" type="button">최신</button><button data-vn-act="log" type="button">기록</button><button data-vn-act="narr" type="button">나레이션</button><button data-vn-act="bgm" type="button">BGM</button><button data-vn-act="sfx" type="button">효과음</button><button data-vn-act="rate" type="button" aria-label="음성 배속"></button><button data-vn-act="first" type="button" aria-label="이 답장의 처음">◀</button><button data-vn-act="prev" type="button" aria-label="이전">◀</button><button data-vn-act="next" type="button" aria-label="다음">▶</button><button data-vn-act="last" type="button" aria-label="이 답장의 끝">▶</button></div><div data-vn-rates></div>`;

/** A person's place on stage: an oval with their name until their picture comes. */
export const personHtml = (name: string): string => `<div data-vn-sil style="--c:${accentOf(name)}"><b>${esc(name)}</b></div>`;

export interface StageState {
  /**
   * Present, left to right: person key, its face key ('' while none), whether they speak
   * now, and what their oval says under their name while there is no picture: the face,
   * and whether its picture is being drawn or why it could not be; bounce, the spring's
   * name for this person (it turns when they come in, change face or step forward); front,
   * who stands before whom where they overlap (0 spoke last).
   */
  cast: Array<{ key: string; face: string; speaking: boolean; label?: string; bounce?: 'a' | 'b'; front?: number }>;
  narration: boolean;
  bg: string;
  /** The background just left, kept under the new one while that fades in (no dark gap between them). */
  bgPrev?: string;
  cg: string;
  /** The box shows its whole text at once (a tap during the reveal). */
  revealed: boolean;
  log: boolean;
  /** The 기록 line the keys picked (its place among the lines), -1 for none. */
  logSel?: number;
  /** The right-hand strip of illustrations is open. */
  strip?: boolean;
  /** The left-hand list of the chat's replies is open. */
  msgs?: boolean;
  /** "3 / 12": drawn by the style text itself, so it costs no call of its own. */
  count?: string;
  /** The reply's last CG: coming in, folded at the top, shown again, or full screen. */
  cgView?: 'open' | 'fold' | 'show' | 'full';
  /** Folded, how big it stays at the top (its + button): 1 the small thumb, 2 and 3 bigger. */
  cgSize?: number;
  /** The folded picture's bottom-left corner in the frame, px, where its + stands: absent until the picture is measured. */
  zoomAt?: { left: number; top: number };
  /** The cast of the picture on show, c1 first ('' a name unknown): chips over its bar while it is big. */
  chips?: string[];
  /** Full screen fills the frame (cover) rather than fitting in it. */
  cgFill?: boolean;
  /** Whether the reply has an illustration before / after the full-screen one. */
  cgNav?: { prev: boolean; next: boolean };
  /** The CG shown is a frame for an image still being drawn: there is nothing to see full screen. */
  cgPending?: boolean;
  /** The CG on show cannot be redrawn now (🎲 🔮 dimmed): the reply still streams, or the picture is not one saved. Its bar is up while it is big (open or shown again). */
  cgLocked?: boolean;
  /** 🎲 is drawing the picture again: its spinner turns, 🔮 waits. */
  cgRolling?: boolean;
  /** What 🎲 or 🔮 says: the redraw under way, or why nothing happened. Over the bar while it shows, else under the top bar. */
  cgNote?: string;
  /** The line's voice is being made or fetched: its spinner turns. */
  voiceWait?: boolean;
  /** The box's height for a long line (fit.ts), px; absent, the box's own. */
  boxHeight?: number;
  /** 뷰어 설정: the people breathe; a spring when one comes in, changes face or steps forward. */
  motion?: { breathe: boolean; bounce: boolean };
  /** 글자 크기: the box's letters and name against their usual size (1 = as designed). */
  textScale?: number;
  /** Why the stage has no background (being drawn, failed, no place said): shown after the clock. */
  bgNote?: string;
  /** The story so far ends on this CG: its end cue shows with it. */
  endCg?: boolean;
  auto: boolean;
  voice: boolean;
  /** Narration is voiced (TTS 나레이션); off, it is still shown. */
  narrVoice?: boolean;
  /** BGM is playing (the button then pauses it). */
  bgm?: boolean;
  /** Effects play (the viewer's 효과음 and the sound settings' both on). */
  sfx?: boolean;
  /** The reader waits on something (another reply, the chat read again): the spinner turns. */
  busy?: boolean;
  /** 메시지's "more" row being filled: it turns too. */
  msgsLoading?: 'before' | 'after' | '';
  /** The voice's speed (TTS 설정), on 배속; `rates`: its list is open. */
  rate?: number;
  rates?: boolean;
  /** 태그's row of message controls is out. */
  tags?: boolean;
  /** Its 🔢 row is out under it, showing these counts ("1~3"). */
  counts?: string;
  /** The reply on stage has pink slots and is not streaming: 전체 생성 shows. `pinkBusy`: they are being made. */
  pink?: boolean;
  /** The floating 이전 tile (뷰어 설정): where it stands, in percent of the frame. */
  back?: { x: number; y: number };
  pinkBusy?: boolean;
}
// Each breathes at their own pace, so two lit at once never move as one.
const BREATH = [[4.6, 0], [5.2, -1.7], [4.2, -3.1]] as const;
/**
 * Breathing, for the lit only (the speaker; everyone in narration): the others stand dimmed
 * and blurred, and anything moving inside a blur has it drawn again every frame, on a phone
 * the dearest thing on the stage. A CG on show dims everyone: nobody breathes.
 */
function breathing(s: StageState): string {
  if (!s.motion?.breathe || (s.cg && s.cgView !== 'fold')) return '';
  const lit = s.narration ? s.cast.slice(0, 3) : s.cast.slice(0, 3).filter(p => p.speaking);
  return lit.map((p, i) => `[x-omni-vn] [x-vn-p="${p.key}"] [x-vn-sp] img{animation:vn-breathe ${BREATH[i]![0]}s ease-in-out ${BREATH[i]![1]}s infinite}`).join('');
}
// Phones are narrow: people overlap, the speaker in front, as a portrait VN stages them.
const SPOTS: Record<number, number[]> = { 1: [50], 2: [33, 67], 3: [24, 50, 76] };
/**
 * A folded picture's height at each of its + button's sizes, 60px down from the top: the small thumb, then a
 * share of the stage that stays clear of the line's box at the bottom (a wide picture is fitted inside it).
 */
const foldHeight = (size: number | undefined): string => size === 3 ? '45%' : size === 2 ? '30%' : '84px';
/**
 * The + inside the folded picture at its bottom-left corner (its own translate keeps it 4px in): its width is the
 * picture's, so the corner is known only from the picture as measured, and until then the + is not shown.
 */
const foldZoom = (size: number | undefined, at: StageState['zoomAt']): string => !at ? ''
  : `[x-omni-vn] [data-vn-act="zoom"]{display:inline-flex;left:${Math.round(at.left)}px;top:${Math.round(at.top)}px}`
  + `[x-omni-vn] [data-vn-act="zoom"]::after{content:"${size === 3 ? '−' : '+'}"}`;
/** The chips shown over a big picture's bar: c1·하쿠키 (a long name cut short), or c1 alone for a name unknown. */
const chipLabel = (name: string): string => { const chars = [...name.replace(/[\u0000-\u001f]/g, '').trim()]; return chars.length > 12 ? `${chars.slice(0, 11).join('')}…` : chars.join(''); };
const castChips = (chips: readonly string[] | undefined): string => (chips ?? []).slice(0, CAST_CHIPS).map((name, i) =>
  `[x-omni-vn] [data-vn-cgchips] [data-vn-act="cgc${i + 1}"]{display:inline-flex}[x-omni-vn] [data-vn-act="cgc${i + 1}"]::after{content:${JSON.stringify(`c${i + 1}${chipLabel(name) ? `·${chipLabel(name)}` : ''}`)}}`).join('');
type Box = { left: number; top: number; width: number; height: number };
/**
 * Where the oval of the person at `index` of `count` on stage is, worked out from the numbers STATIC_CSS lays it
 * out by ([x-vn-p]: 90% high, 13:19, at most 82% wide, centred on its spot; [data-vn-sil]: 16% in from each side,
 * 30% down, 1:1.15), so a tap on it is read with no call. Change those rules and this goes with them.
 */
export function ovalBox(stage: Box, index: number, count: number): Box {
  const spot = SPOTS[Math.min(3, count)]?.[index] ?? 50;
  const height = stage.height * 0.9, width = Math.min(height * 13 / 19, stage.width * 0.82);
  const left = stage.left + stage.width * spot / 100 - width / 2, top = stage.top + stage.height - height;
  return { left: left + width * 0.16, top: top + height * 0.3, width: width * 0.68, height: width * 0.68 * 1.15 };
}
/** The one style text a scene sets: who stands where, who is lit, which picture, which background. */
export function stageCss(s: StageState): string {
  const spots = SPOTS[Math.min(3, s.cast.length)] ?? [];
  // The spring's name turns (a/b) when the person's face or place changes: the same name again plays nothing.
  const spring = (p: { bounce?: 'a' | 'b' }) => s.motion?.bounce && p.bounce ? `;animation:vn-jelly-${p.bounce} .62s cubic-bezier(.28,1.5,.55,1) both` : '';
  const rules = s.cast.slice(0, 3).map((p, i) => {
    // Overlapping, the last to speak stands in front (the speaker always), then whoever spoke before them.
    const z = `z-index:${3 - Math.min(2, p.front ?? (p.speaking ? 0 : 2))}`;
    // A CG on show dims the stage; folded at the top it does not. Dimmed, nobody takes a z-index: the picture
    // has none and is over the people only by coming after them, and a person given one stood over the picture.
    const lit = s.cg && s.cgView !== 'fold' ? 'filter:brightness(.28) blur(2px)' : p.speaking ? `filter:none;transform:scale(1.035);${z}` : s.narration ? `filter:brightness(.62) saturate(.85);${z}` : `filter:brightness(.4) saturate(.6) blur(1.2px);transform:scale(.96);${z}`;
    return `[x-omni-vn] [x-vn-p="${p.key}"]{display:block;left:${spots[i]}%;${lit}}`
      + (p.face ? `[x-omni-vn] [x-vn-p="${p.key}"] [x-vn-sp="${p.face}"]{opacity:1${spring(p)}}[x-omni-vn] [x-vn-p="${p.key}"] [data-vn-sil]{opacity:0}` : spring(p) ? `[x-omni-vn] [x-vn-p="${p.key}"] [data-vn-sil]{${spring(p).slice(1)}}` : '')
      + (!p.face && p.label ? `[x-omni-vn] [x-vn-p="${p.key}"] [data-vn-sil]::after{content:"${p.label.replace(/["\\]/g, '').replace(/\n/g, '\\A ')}"}` : '');
  });
  const dim = (act: string, on: boolean | undefined) => on ? '' : `[x-omni-vn] [data-vn-act="${act}"]{opacity:.3}`;
  // Big (coming in, or shown again): its bar, and its cast over the bar.
  const big = !!s.cg && (s.cgView === 'show' || s.cgView === 'open'), chipped = big && !!s.chips?.length;
  return [
    ...rules,
    // As specific as the rule that hides every background (`div[x-vn-bg]`), and after it: without the element
    // it lost, and a background drawn and sent stayed hidden.
    s.bg ? `[x-omni-vn] :is(img,div)[x-vn-bg="${s.bg}"]{display:block;z-index:1}` : '',
    // A new background fades in over the old one, which stays as it is until then: shown alone, the new one
    // came up out of the dark (a blink each time the stage was given another, the same place's too).
    s.bgPrev && s.bgPrev !== s.bg ? `[x-omni-vn] :is(img,div)[x-vn-bg="${s.bgPrev}"]{display:block;z-index:0;animation:none}` : '',
    // Folded, the picture is a thumb above the people (their z-index is at most 3): a head in front of it hid it.
    // Every place is !important, here and below: the picture is the chat's <img> cloned with its inline style, and a
    // picture drawn in a spinner's slot carries inset:0 and object-fit there (it put the big one's middle on the frame's corner).
    s.cg && s.cgView === 'fold' ? `[x-omni-vn] :is(img,div)[x-vn-cg="${s.cg}"]{display:block;left:auto!important;right:12px!important;top:60px!important;bottom:auto!important;height:${foldHeight(s.cgSize)}!important;width:auto!important;max-width:${s.cgSize === 2 || s.cgSize === 3 ? '60%' : '120px'}!important;max-height:${foldHeight(s.cgSize)}!important;translate:0 0;rotate:0deg;border-width:2px!important;animation:none;opacity:.92;z-index:4}${foldZoom(s.cgSize, s.zoomAt)}`
      // With a mouse the folded picture takes the pointer, so its + shows while it is over it (a tap is still read by
      // where it is). Not on a phone: a press held on a picture that takes the pointer brings up its save sheet.
      + `@media (hover:hover){[x-omni-vn] :is(img,div)[x-vn-cg="${s.cg}"]{pointer-events:auto;-webkit-user-drag:none}}`
    : s.cg && s.cgView === 'full' ? `[x-omni-vn] :is(img,div)[x-vn-cg="${s.cg}"]{display:block;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;translate:0 0;rotate:0deg;border:0!important;border-radius:0!important;background:#000;z-index:8;animation:none;object-fit:${s.cgFill ? 'cover' : 'contain'}!important}[x-omni-vn] [data-vn-dock]{display:grid}${dim('cgprev', s.cgNav?.prev)}${dim('cgnext', s.cgNav?.next)}`
    // A reply ending on its picture: the box steps back to its bare end cue instead of hiding.
    : s.cg ? `[x-omni-vn] :is(img,div)[x-vn-cg="${s.cg}"]{display:block;left:50%!important;top:calc(50% - 40px)!important;right:auto!important;bottom:auto!important}${s.endCg ? '[x-omni-vn] [data-vn-box]{background:transparent;border-color:transparent;box-shadow:none}[x-omni-vn] [data-vn-box]::before{display:none}' : '[x-omni-vn] [data-vn-box]{opacity:0}'}[x-omni-vn] [x-vn-bg]{filter:brightness(.45) blur(3px)}${big ? `[x-omni-vn] [data-vn-cgbar] [data-vn-act]{display:inline-flex}${castChips(s.chips)}${s.cgPending ? '[x-omni-vn] [data-vn-cgbar] [data-vn-act="cgfull"]{display:none}' : ''}${s.cgLocked ? '[x-omni-vn] [data-vn-cgbar] [data-vn-act="cgroll"],[x-omni-vn] [data-vn-cgbar] [data-vn-act="cgtags"]{opacity:.35}' : ''}${s.cgRolling ? '[x-omni-vn] [data-vn-cgbar] [data-vn-act="cgroll"]::after{content:"";display:inline-block;width:10px;height:10px;margin-left:6px;border-radius:50%;border:2px solid rgba(227,194,122,.3);border-top-color:var(--gold);animation:vn-spin .8s linear infinite}[x-omni-vn] [data-vn-cgbar] [data-vn-act="cgtags"]{opacity:.35}' : ''}` : ''}` : '',
    // Over a big picture's bar (and its chips, when it has some).
    s.cgNote ? `[x-omni-vn] [data-vn-note]{display:block${big ? `;top:auto;bottom:${chipped ? 150 : 124}px` : ''}}${chipped ? '@media (hover:none),(pointer:coarse){[x-omni-vn] [data-vn-note]{bottom:164px}}' : ''}[x-omni-vn] [data-vn-note]::after{content:${JSON.stringify(s.cgNote)}}` : '',
    s.revealed ? '[x-omni-vn] [data-vn-text] i{animation:none!important;visibility:visible!important}[x-omni-vn] [data-vn-next],[x-omni-vn] [data-vn-end]{animation-delay:0s!important}' : '',
    // The menu's own colour rule is [data-vn-menu] button: these outrank it, or they never show.
    s.log ? `[x-omni-vn] [data-vn-log]{display:block}[x-omni-vn] [data-vn-menu] [data-vn-act="log"]{color:var(--gold)}${(s.logSel ?? -1) >= 0 ? `[x-omni-vn] [data-vn-log] p:nth-of-type(${s.logSel! + 1}){outline:2px solid var(--gold);outline-offset:-2px}` : ''}` : '',
    s.strip ? '[x-omni-vn] [data-vn-strip]{translate:0 0}[x-omni-vn] [data-vn-act="strip"]{opacity:0}' : '',
    s.msgs ? '[x-omni-vn] [data-vn-msgs]{translate:0 0}[x-omni-vn] [data-vn-act="msgs"]{opacity:0}' : '',
    s.count ? `[x-omni-vn] [data-vn-box]::after{content:"${s.count.replace(/["\\]/g, '')}"}` : '',
    breathing(s),
    s.busy ? '[x-omni-vn] [data-vn-busy]{display:block}' : '',
    s.voiceWait ? '[x-omni-vn] [data-vn-voicewait]{display:block}' : '',
    // A least height, not a height: a line that needs more than reckoned still grows the box itself.
    s.boxHeight ? `[x-omni-vn] [data-vn-box]{min-height:${Math.round(s.boxHeight)}px}` : '',
    s.msgs && s.msgsLoading ? `[x-omni-vn] [data-vn-msg][data-more="${s.msgsLoading}"]::after{content:"";display:inline-block;width:10px;height:10px;margin-left:7px;vertical-align:-1px;border-radius:50%;border:2px solid rgba(227,194,122,.3);border-top-color:var(--gold);animation:vn-spin .8s linear infinite}` : '',
    s.textScale && s.textScale !== 1 ? `[x-omni-vn] [data-vn-text]{font-size:${(16.5 * s.textScale).toFixed(1)}px}[x-omni-vn] [data-vn-name]{font-size:${(15 * s.textScale).toFixed(1)}px}` : '',
    s.bgNote ? `[x-omni-vn] [data-vn-clock]::after{content:${JSON.stringify(s.bgNote)}}[x-omni-vn] [data-vn-clock]:empty::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:#8a8496}` : '',
    `[x-omni-vn] [data-vn-act="auto"]{color:${s.auto ? 'var(--gold)' : '#efe9da'}${s.auto ? ';text-shadow:0 0 8px var(--gold)' : ''}}[x-omni-vn] [data-vn-act="voice"]{opacity:${s.voice ? 1 : .4}}[x-omni-vn] [data-vn-act="narr"]{opacity:${s.narrVoice === false ? .4 : 1}}[x-omni-vn] [data-vn-act="sfx"]{opacity:${s.sfx === false ? .4 : 1}}`,
    s.bgm ? '[x-omni-vn] [data-vn-menu] [data-vn-act="bgm"]{color:var(--gold)}[x-omni-vn] [data-vn-act="bgm"]::after{content:"❚❚"}' : '',
    // A narrow phone's row has no room for the × (the list it opens says what the figure is).
    s.rate !== undefined ? `[x-omni-vn] [data-vn-act="rate"]::after{content:"${Number(s.rate)}×"}@media (max-width:380px){[x-omni-vn] [data-vn-act="rate"]::after{content:"${Number(s.rate)}"}}` : '',
    s.rates ? '[x-omni-vn] [data-vn-rates]{display:flex}[x-omni-vn] [data-vn-menu] [data-vn-act="rate"]{color:var(--gold)}' : '',
    s.tags ? '[x-omni-vn] [data-vn-tagbar]{translate:0 0}[x-omni-vn] [data-vn-act="tags"]{opacity:0}' : '',
    s.tags && s.counts ? `[x-omni-vn] [data-vn-counts]{display:flex}[x-omni-vn] [data-vn-tagbar] [data-vn-act="mcounts"]{background:rgba(227,194,122,.28)}[x-omni-vn] [data-vn-range]::after{content:${JSON.stringify(s.counts)}}` : '',
    s.back ? `[x-omni-vn] [data-vn-act="back"]{display:inline-flex;left:${s.back.x}%;top:${s.back.y}%}` : '',
    s.pink ? `[x-omni-vn] [data-vn-act="pink"]{display:inline-flex}${s.pinkBusy ? '[x-omni-vn] [data-vn-act="pink"]{opacity:.7}[x-omni-vn] [data-vn-act="pink"]::before{border-color:rgba(236,72,153,.3);border-top-color:#ec4899;background:transparent;animation:vn-spin .8s linear infinite}' : ''}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Letters appear one by one (CSS only); the arrow shows once they all have. At the
 * end of the story so far (`end`) the arrow is a blinking cue to write the next
 * message instead. Returns the reveal time.
 */
/** `costume`: the costume a line is in, by its name (none in the default one): after the name, the plate keeping the person's colour. */
export function boxHtml(input: { speaker: string; text: string; narration: boolean; end?: boolean; pace?: number; costume?: string }): { html: string; revealMs: number } {
  const chars = [...input.text], pace = input.pace ?? 1;
  const step = Math.max(6, Math.min(20, Math.floor(1800 / Math.max(1, chars.length)))) * pace;
  const shown = input.narration || !input.speaker ? chars : ['“', ...chars, '”'];
  const letters = pace <= 0 ? esc(shown.join('')) : shown.map(ch => ch === '\n' ? '\n' : `<i>${esc(ch)}</i>`).join('');
  // Letters past LETTERS come with the last of them: the line is whole by then.
  const vs = Math.round(step), revealMs = Math.min(shown.length, LETTERS + 1) * vs;
  const name = input.narration || !input.speaker ? '' : esc(input.speaker) + (input.costume ? `<span data-vn-costume> · ${esc(input.costume)}</span>` : '');
  const tail = input.end ? `<div data-vn-end style="animation-delay:${revealMs}ms">메시지를 입력해 주세요 ▼</div>` : `<div data-vn-next style="animation-delay:${revealMs}ms"></div>`;
  return {
    html: `<div data-vn-name style="--c:${accentOf(input.speaker || '?')}">${name}</div><div data-vn-text${input.narration ? ' data-narr' : ''} style="--vs:${vs}ms">${letters}</div>${tail}<div data-vn-voicewait></div>`,
    revealMs,
  };
}
