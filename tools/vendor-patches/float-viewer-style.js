const NX_FLOAT_CSS = `
[x-nx-float-counts]{background:rgba(255,255,255,.08);backdrop-filter:blur(22px) saturate(1.6);border:1px solid rgba(255,255,255,.25);border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.35);white-space:nowrap;transition:opacity .45s ease;}
[x-nx-float-counts] button{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.08);min-width:40px;min-height:44px;padding:6px;font:22px/1 system-ui;border-radius:12px;color:#fff;cursor:pointer;touch-action:manipulation;}
[x-nx-float-counts] button:hover{background:rgba(255,255,255,.2);}
[x-nx-float-counts] span{min-width:54px;text-align:center;font-variant-numeric:tabular-nums;}
[x-nx-float] [x-nx-float-active="true"]{background:rgba(113,50,245,.55) !important;border-color:rgba(255,255,255,.35) !important;}
[x-nx-float]{box-sizing:border-box;flex-direction:column;gap:10px;padding:10px;background:rgba(255,255,255,.08) !important;-webkit-backdrop-filter:blur(22px) saturate(1.6) !important;backdrop-filter:blur(22px) saturate(1.6) !important;border:1px solid rgba(255,255,255,.25) !important;border-radius:20px !important;box-shadow:0 20px 60px rgba(0,0,0,.55) !important;touch-action:none;user-select:none;-webkit-user-select:none;font:13px/1.45 system-ui,sans-serif;color:#e2e8f0;transition:background .45s ease,border-color .45s ease,box-shadow .45s ease;}
[x-nx-float-head]{align-items:center;justify-content:flex-end;gap:8px;padding:2px;cursor:grab;background:transparent;transition:opacity .45s ease;}
[x-nx-float-head]:active{cursor:grabbing;}
[x-nx-float-headbtns]{flex:none;display:flex;gap:4px;}
[x-nx-float-headbtns="r"]{margin-left:auto;}
[x-nx-float-head] button{border:1px solid rgba(255,255,255,.12) !important;background:rgba(255,255,255,.08) !important;min-width:40px !important;min-height:40px !important;padding:4px 6px !important;font-size:17px !important;line-height:1 !important;cursor:pointer !important;border-radius:10px !important;color:#fff !important;touch-action:manipulation !important;}
[x-nx-float-head] button:hover{background:rgba(255,255,255,.2) !important;}
[x-nx-float-head] button:active{transform:scale(.92) !important;}
[x-nx-float-bar],[x-nx-float-foldgrid],[x-nx-float-resize],[x-nx-float-foldgrip]{transition:opacity .45s ease;}
[x-nx-float-body]{position:relative;min-height:0;overflow:hidden;background:transparent;}
[x-nx-float-body] img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;border-radius:12px;pointer-events:none;}
[x-nx-float-reroll]{position:absolute;left:8px;bottom:8px;z-index:2;border:1px solid rgba(255,255,255,.2) !important;background:rgba(20,24,36,.55) !important;-webkit-backdrop-filter:blur(8px) !important;backdrop-filter:blur(8px) !important;min-width:44px !important;min-height:44px !important;padding:6px !important;font-size:22px !important;line-height:1 !important;cursor:pointer !important;border-radius:12px !important;color:#fff !important;opacity:0 !important;pointer-events:none;transition:opacity .2s ease;touch-action:manipulation;}
[x-nx-float-body]:hover [x-nx-float-reroll]{opacity:1 !important;pointer-events:auto;}
[x-nx-float-reroll]:active{transform:scale(.92) !important;}
[x-nx-float-bar]{align-items:center;justify-content:center;flex-wrap:wrap;gap:2px;padding:2px;background:transparent;flex:none;}
[x-nx-float-bar] button{border:1px solid rgba(255,255,255,.12) !important;background:rgba(255,255,255,.08) !important;min-width:44px !important;min-height:44px !important;padding:6px !important;font-size:24px !important;line-height:1 !important;cursor:pointer !important;border-radius:12px !important;color:#fff !important;touch-action:manipulation !important;}
[x-nx-float-bar] button:hover{background:rgba(255,255,255,.2) !important;}
[x-nx-float-bar] button:active{transform:scale(.92) !important;}
[x-nx-float-resize]{position:absolute;right:0;bottom:0;width:44px;height:44px;cursor:nwse-resize;touch-action:none;border-bottom-right-radius:15px;}
[x-nx-float-resize]::after{content:"";position:absolute;right:5px;bottom:5px;width:26px;height:26px;background:linear-gradient(to top-left,transparent 50%,rgba(255,255,255,.45) 50%);border-bottom-right-radius:10px;}
[x-nx-float-foldgrip]{align-items:center;justify-content:center;flex:none;height:18px;cursor:grab;color:rgba(255,255,255,.5);font-size:11px;letter-spacing:3px;}
[x-nx-float-foldgrip]:active{cursor:grabbing;}
[x-nx-float-foldgrid]{grid-template-columns:repeat(5,1fr);gap:6px;}
[x-nx-float-foldgrid] button{border:1px solid rgba(255,255,255,.12) !important;background:rgba(255,255,255,.08) !important;width:100% !important;aspect-ratio:1/1 !important;padding:0 !important;font-size:22px !important;line-height:1 !important;cursor:pointer !important;border-radius:12px !important;color:#fff !important;display:flex !important;align-items:center !important;justify-content:center !important;touch-action:manipulation !important;}
[x-nx-float-foldgrid] button:hover{background:rgba(255,255,255,.2) !important;}
[x-nx-float-foldgrid] button:active{transform:scale(.92) !important;}
[x-nx-float-icon]{font-size:26px;line-height:1;touch-action:none;}
`;
const NX_FLOAT_HEAD_L = [["stop", "🟥"], ["preset", "📚"], ["note", "✒️"]];
const NX_FLOAT_HEAD_R = [["full", "⛶"], ["fold", "▴"]];
const NX_FLOAT_BAR_BTNS = [["tag", "⚛️"], ["regen", "🔃"], ["char", "👨‍👩‍👧‍👦"], ["counts", "🔢"]];
const NX_FLOAT_GRID_BTNS = [["single", "🎲"], ["stop", "🟥"], ["preset", "📚"], ["note", "✒️"], ["unfold", "▾"], ["tag", "⚛️"], ["regen", "🔃"], ["char", "👨‍👩‍👧‍👦"], ["counts", "🔢"], ["full", "⛶"]];
function nxFloatMode() {
  const m = String(t.backendSettings?.card?.viewer_minimize_mode || "buttons");
  return m === "bubble" ? "bubble" : "buttons";
}
