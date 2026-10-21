const NX_FLOAT_CSS = `
[x-nx-float-counts]{background:rgba(24,28,40,.78);backdrop-filter:none;border:1px solid rgba(255,255,255,.25);border-radius:16px;box-shadow:none;white-space:nowrap;transition:opacity .45s ease;}
[x-nx-float-counts] button{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.08);min-width:40px;min-height:44px;padding:6px;font:22px/1 system-ui;border-radius:12px;color:#fff;cursor:pointer;touch-action:manipulation;}
[x-nx-float-counts] button:hover{background:rgba(255,255,255,.2);}
[x-nx-float-counts] span{min-width:54px;text-align:center;font-variant-numeric:tabular-nums;}
[x-nx-float] [x-nx-float-active="true"]{background:rgba(113,50,245,.55) !important;border-color:rgba(255,255,255,.35) !important;}
[x-nx-float]{box-sizing:border-box;flex-direction:column;gap:10px;padding:10px;background:rgba(24,28,40,.78) !important;will-change:transform;contain:layout style;-webkit-backdrop-filter:none !important;backdrop-filter:none !important;border:1px solid rgba(255,255,255,.25) !important;border-radius:20px !important;box-shadow:none !important;touch-action:none;user-select:none;-webkit-user-select:none;font:13px/1.45 system-ui,sans-serif;color:#e2e8f0;transition:background .45s ease,border-color .45s ease;}
[x-nx-float-head]{align-items:center;justify-content:flex-end;gap:8px;padding:2px;min-height:44px;touch-action:none;cursor:grab;background:transparent;transition:opacity .45s ease;}
[x-nx-float-head]:active{cursor:grabbing;}
[x-nx-float-headbtns]{flex:none;display:flex;gap:4px;}
[x-nx-float-headbtns="r"]{margin-left:auto;}
[x-nx-float-head] button{border:1px solid rgba(255,255,255,.12) !important;background:rgba(255,255,255,.08) !important;min-width:40px !important;min-height:40px !important;padding:4px 6px !important;font-size:17px !important;line-height:1 !important;cursor:pointer !important;border-radius:10px !important;color:#fff !important;touch-action:manipulation !important;}
[x-nx-float-head] button:hover{background:rgba(255,255,255,.2) !important;}
[x-nx-float-head] button:active{transform:scale(.92) !important;}
[x-nx-float-bar],[x-nx-float-foldgrid],[x-nx-float-resize],[x-nx-float-foldgrip]{transition:opacity .45s ease;}
[x-nx-float-body]{position:relative;min-height:0;overflow:hidden;background:transparent;}
[x-nx-float-body] img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;border-radius:12px;pointer-events:none;}
[x-nx-float-reroll]{border:1px solid rgba(255,255,255,.2) !important;background:rgba(20,24,36,.55) !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important;min-width:44px !important;min-height:44px !important;padding:6px !important;font-size:22px !important;line-height:1 !important;cursor:pointer !important;border-radius:12px !important;color:#fff !important;touch-action:manipulation;}
[x-nx-float-reroll]:active{transform:scale(.92) !important;}
[x-nx-float-bar]{align-items:center;justify-content:center;flex-wrap:wrap;gap:2px;padding:2px;background:transparent;flex:none;}
[x-nx-float-bar] button{border:1px solid rgba(255,255,255,.12) !important;background:rgba(255,255,255,.08) !important;min-width:44px !important;min-height:44px !important;padding:6px !important;font-size:24px !important;line-height:1 !important;cursor:pointer !important;border-radius:12px !important;color:#fff !important;touch-action:manipulation !important;}
[x-nx-float-bar] button:hover{background:rgba(255,255,255,.2) !important;}
[x-nx-float-bar] button:active{transform:scale(.92) !important;}
[x-nx-float-resize]{position:absolute;right:0;bottom:0;width:44px;height:44px;cursor:nwse-resize;touch-action:none;border-bottom-right-radius:15px;}
[x-nx-float-resize]::after{content:"";position:absolute;right:5px;bottom:5px;width:26px;height:26px;background:linear-gradient(to top-left,transparent 50%,rgba(255,255,255,.45) 50%);border-bottom-right-radius:10px;}
[x-nx-float-foldgrip]{position:relative;align-items:center;justify-content:center;flex:none;min-height:44px;touch-action:none;cursor:grab;color:rgba(255,255,255,.5);font-size:11px;letter-spacing:3px;}
[x-nx-float-foldgrip] button{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.08);padding:0;font:22px/1 system-ui;letter-spacing:0;border-radius:12px;color:#fff;cursor:pointer;touch-action:manipulation;}
[x-nx-float-foldgrip] button:hover{background:rgba(255,255,255,.2);}
[x-nx-float-foldgrip]:active{cursor:grabbing;}
[x-nx-float-foldgrid]{grid-template-columns:repeat(5,1fr);gap:6px;}
[x-nx-float-foldgrid] button{border:1px solid rgba(255,255,255,.12) !important;background:rgba(255,255,255,.08) !important;width:100% !important;aspect-ratio:1/1 !important;padding:0 !important;font-size:22px !important;line-height:1 !important;cursor:pointer !important;border-radius:12px !important;color:#fff !important;display:flex !important;align-items:center !important;justify-content:center !important;touch-action:manipulation !important;}
[x-nx-float-foldgrid] button:hover{background:rgba(255,255,255,.2) !important;}
[x-nx-float-foldgrid] button:active{transform:scale(.92) !important;}
[x-nx-float-icon]{font-size:26px;line-height:1;touch-action:none;}
[x-nx-float-nav]{transition:opacity .45s ease;}
[x-nx-float-nav] button{border:1px solid rgba(255,255,255,.12) !important;background:rgba(20,24,36,.72) !important;padding:0 !important;font:700 24px/1 system-ui !important;cursor:pointer !important;border-radius:12px !important;color:#fff !important;touch-action:manipulation !important;}
[x-nx-float-nav] button:hover{background:rgba(255,255,255,.2) !important;}
[x-nx-float-nav] button:active{transform:scale(.92) !important;}
[x-nx-float-prev-off="true"] [x-nx-float-btn="prev"],[x-nx-float-next-off="true"] [x-nx-float-btn="next"]{opacity:.35;}
[x-nx-float-nav="main"]{flex-direction:column;align-items:center;gap:4px;}
[x-nx-float-navinfo]{align-items:center;gap:6px;padding:2px 8px;border-radius:10px;background:rgba(20,24,36,.72);font:600 12px/18px system-ui;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap;}
[x-nx-float-dots]{letter-spacing:2px;font-size:10px;}
[x-nx-float-navbtns]{display:flex;gap:2px;}
[x-nx-float-nav="main"] button{width:var(--nx-float-button,40px) !important;min-width:var(--nx-float-button,40px) !important;height:40px !important;min-height:40px !important;}
[x-nx-float-nav="fold"]{position:absolute;left:0;top:0;align-items:center;gap:2px;height:44px;}
[x-nx-float-nav="fold"] button{width:40px !important;min-height:44px !important;height:44px !important;}
[x-nx-float-nav="fold"] [x-nx-float-count]{order:1;min-width:30px;text-align:center;font:600 12px/1 system-ui;letter-spacing:0;color:#fff;font-variant-numeric:tabular-nums;}
[x-nx-float-nav="fold"] [x-nx-float-btn="next"]{order:2;}
[x-nx-float-overlay="true"] [x-nx-float-head]{position:absolute;inset:0;min-height:0;padding:0;z-index:2;pointer-events:none;}
[x-nx-float-overlay="true"] [x-nx-float-headbtns="l"]{position:absolute;left:8px;top:8px;}
[x-nx-float-overlay="true"] [x-nx-float-headbtns="r"]{position:absolute;right:8px;top:8px;}
[x-nx-float-overlay="true"] [x-nx-float-headbtns]{gap:2px;}
[x-nx-float-overlay="true"] [x-nx-float-head] button{border-radius:12px!important;background:rgba(20,24,36,.72)!important;}
[x-nx-float-overlay="true"] [x-nx-float-bar]{position:absolute;left:8px;bottom:8px;gap:2px;padding:0;z-index:2;}
/* Bottom right, left of the resize corner. */
[x-nx-float-overlay="true"] [x-nx-float-nav="main"]{position:absolute;right:46px;bottom:8px;z-index:2;}
/* Both top rows stay on one line, including the smallest 240px frame. */
[x-nx-float-overlay="true"] [x-nx-float-head] button,
[x-nx-float-overlay="true"] [x-nx-float-bar] button{width:var(--nx-float-button,40px)!important;min-width:var(--nx-float-button,40px)!important;height:40px!important;min-height:40px!important;padding:2px!important;font-size:var(--nx-float-glyph,20px)!important;background:rgba(20,24,36,.72)!important;}
[x-nx-float-overlay="true"] [x-nx-float-head],
[x-nx-float-overlay="true"] [x-nx-float-headbtns],
[x-nx-float-overlay="true"] [x-nx-float-bar],
[x-nx-float-overlay="true"] [x-nx-float-nav="main"]{opacity:0!important;pointer-events:none;transition:opacity .2s ease;}
@media(hover:hover){
  [x-nx-float-overlay="true"]:is(:hover,:focus-within) [x-nx-float-head],
  [x-nx-float-overlay="true"]:is(:hover,:focus-within) [x-nx-float-headbtns],
  [x-nx-float-overlay="true"]:is(:hover,:focus-within) [x-nx-float-bar],
  [x-nx-float-overlay="true"]:is(:hover,:focus-within) [x-nx-float-nav="main"]{opacity:1!important;}
  [x-nx-float-overlay="true"]:is(:hover,:focus-within) [x-nx-float-headbtns],
  [x-nx-float-overlay="true"]:is(:hover,:focus-within) [x-nx-float-bar],
  [x-nx-float-overlay="true"]:is(:hover,:focus-within) [x-nx-float-nav="main"]{pointer-events:auto;}
}
@media(hover:none){
  [x-nx-float-overlay="true"] [x-nx-float-head],
  [x-nx-float-overlay="true"] [x-nx-float-headbtns],
  [x-nx-float-overlay="true"] [x-nx-float-bar],
  [x-nx-float-overlay="true"] [x-nx-float-nav="main"]{opacity:var(--nx-float-touch-opacity,0)!important;}
  [x-nx-float-overlay="true"] [x-nx-float-headbtns],
  [x-nx-float-overlay="true"] [x-nx-float-bar],
  [x-nx-float-overlay="true"] [x-nx-float-nav="main"]{pointer-events:var(--nx-float-touch-events,none);}
}
`;
const NX_FLOAT_HEAD_L = [["tag", "⚛️"], ["regen", "🔃"], ["stop", "🟥"]];
const NX_FLOAT_HEAD_R = [["compact", "−"], ["fold", "▴"], ["full", "⛶"]];
const NX_FLOAT_BAR_BTNS = [["note", "✒️"], ["preset", "📚"], ["char", "👨‍👩‍👧‍👦"], ["counts", "🔢"]];
const NX_FLOAT_NAV_BTNS = [["prev", "‹"], ["next", "›"]];
const NX_FLOAT_GRID_BTNS = [["single", "🎲"], ["stop", "🟥"], ["preset", "📚"], ["note", "✒️"], ["unfold", "▾"], ["tag", "⚛️"], ["regen", "🔃"], ["char", "👨‍👩‍👧‍👦"], ["counts", "🔢"], ["full", "⛶"]];
function nxFloatMode() {
  const m = String(t.backendSettings?.card?.viewer_minimize_mode || "buttons");
  return m === "bubble" ? "bubble" : "buttons";
}
