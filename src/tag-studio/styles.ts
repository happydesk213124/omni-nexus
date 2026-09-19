/** Scoped overlay CSS. Injected as a <style> inside #nx-tag-studio — never imported as a CSS file. */
export function tagStudioCss(): string {
  return `
#nx-tag-studio {
  --bg: #0a0b0f;
  --stage: #15161c;
  --panel: #171922;
  --panel-2: #1c1f2b;
  --head: #222634;
  --line: #2b2f3d;
  --line-2: #3b4157;
  --ink: #ecebf3;
  --muted: #8b8fa3;
  --accent: #b7a4ff;
  --accent-2: #6d5cc6;
  --pink: #e85a8c;
  --pink-2: #bf3a68;
  --ok: #6ee7b7;
  --shadow: 0 20px 60px rgba(0,0,0,.5);
  position: fixed;
  inset: 0;
  z-index: 100000;
  background: var(--bg);
  color: var(--ink);
  font: 13px/1.45 "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  overflow: hidden;
  -webkit-text-size-adjust: 100%;
  display: flex;
  flex-direction: column;
  height: 100%;
}
#nx-tag-studio * { box-sizing: border-box; }
#nx-tag-studio button, #nx-tag-studio select, #nx-tag-studio textarea, #nx-tag-studio input { font: inherit; color: inherit; }
#nx-tag-studio button { cursor: pointer; }
#nx-tag-studio textarea { resize: vertical; }
#nx-tag-studio select, #nx-tag-studio textarea, #nx-tag-studio input[type="text"], #nx-tag-studio input[type="number"] {
  width: 100%;
  background: #0e1017;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 8px 9px;
}
#nx-tag-studio select, #nx-tag-studio input[type="text"], #nx-tag-studio input[type="number"] { height: 36px; }
#nx-tag-studio select:focus, #nx-tag-studio textarea:focus, #nx-tag-studio input:focus {
  outline: 2px solid rgba(183,164,255,.3);
  border-color: var(--accent-2);
}

#nx-tag-studio > .stage { flex: 1; min-height: 0; }
#nx-tag-studio > .top, #nx-tag-studio > .floor { flex: 0 0 auto; }

#nx-tag-studio .top {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  background: #12141b;
}
#nx-tag-studio .title { display: flex; flex-direction: column; min-width: 0; flex: 1; }
#nx-tag-studio .title b { font-size: 14px; }
#nx-tag-studio .title span { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#nx-tag-studio .tag {
  font-size: 11px; color: var(--accent);
  border: 1px solid #4a4177; background: #221d38;
  border-radius: 999px; padding: 3px 8px; white-space: nowrap;
}
#nx-tag-studio .btn {
  height: 32px; padding: 0 10px;
  border: 1px solid var(--line); background: var(--panel);
  border-radius: 8px; white-space: nowrap;
}
#nx-tag-studio .btn:hover { background: var(--panel-2); border-color: var(--line-2); }
#nx-tag-studio .btn.on { background: #2b2350; border-color: #57499a; color: #ddd3ff; }
#nx-tag-studio .btn.ok { background: #14241d; border-color: #2d5a48; color: var(--ok); }
#nx-tag-studio .btn.sm { height: 27px; padding: 0 8px; font-size: 12px; }
#nx-tag-studio .btn.warn { color: #ff9db1; }

#nx-tag-studio .stage { min-height: 0; display: flex; position: relative; overflow: hidden; }

#nx-tag-studio .side {
  width: 340px; flex: 0 0 340px;
  background: var(--panel);
  border-right: 1px solid var(--line);
  display: flex; flex-direction: column; min-height: 0;
  transition: margin-left .22s ease, height .22s ease;
}
#nx-tag-studio .side:not(.right).collapsed { margin-left: -340px; }
#nx-tag-studio .right {
  width: 216px; flex: 0 0 216px;
  border-right: 0; border-left: 1px solid var(--line);
  position: relative;
  overflow: visible;
  transition: margin-right .22s ease, transform .22s ease;
  z-index: 12;
}
#nx-tag-studio .right.collapsed { margin-right: -216px; }

#nx-tag-studio .handle {
  position: absolute; top: 58px;
  width: 22px; height: 44px;
  border: 1px solid var(--line); background: var(--panel-2);
  color: var(--muted);
  font-size: 16px; line-height: 1;
  display: grid; place-items: center;
  z-index: 6;
}
#nx-tag-studio .handle:hover { color: var(--ink); background: var(--head); }
#nx-tag-studio .handle.l { left: 0; border-left: 0; border-radius: 0 8px 8px 0; }
#nx-tag-studio .handle.r {
  left: -22px; right: auto;
  border-right: 0; border-radius: 8px 0 0 8px;
  z-index: 13;
}

#nx-tag-studio .tabs {
  border-bottom: 1px solid var(--line);
  background: var(--panel-2);
}
#nx-tag-studio .tabrow { display: flex; flex-wrap: wrap; align-items: stretch; min-height: 32px; }
#nx-tag-studio .tabscroll { display: contents; }
#nx-tag-studio .tab {
  height: 32px; padding: 0 8px;
  max-width: 11em;
  border: 0; border-right: 1px solid var(--line);
  background: transparent; color: var(--muted);
  display: flex; align-items: center; gap: 4px;
  flex: 0 0 auto;
}
#nx-tag-studio .tab .lab {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#nx-tag-studio .tab.on { background: var(--panel); color: var(--ink); box-shadow: inset 0 -2px 0 var(--accent); }
#nx-tag-studio .tab .x { color: #7c8095; font-size: 14px; line-height: 1; padding: 0 1px; flex: 0 0 auto; }
#nx-tag-studio .tab .x:hover { color: #ff9db1; }
#nx-tag-studio .tabrow .pick { flex: 0 0 86px; min-width: 86px; padding: 3px 6px; }
#nx-tag-studio .tabrow .pick select { height: 26px; padding: 0 6px; font-size: 12px; }
#nx-tag-studio .tabadd {
  width: 34px; border: 0; border-left: 1px solid var(--line);
  background: transparent; color: var(--accent); font-size: 16px;
}

#nx-tag-studio .body { flex: 1; min-height: 0; overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
#nx-tag-studio .body > * { flex: 0 0 auto; }

#nx-tag-studio .sec { border: 1px solid var(--line); border-radius: 11px; overflow: hidden; background: var(--panel-2); }
#nx-tag-studio .sec > .h {
  display: flex; align-items: center; gap: 6px;
  min-height: 36px;
  padding: 0 9px; background: var(--head);
  cursor: pointer; user-select: none;
}
#nx-tag-studio .sec > .h.static { cursor: default; }
#nx-tag-studio .sec > .h .name { font-weight: 650; font-size: 12px; white-space: nowrap; }
#nx-tag-studio .sec > .h .grow { flex: 1; min-width: 0; }
#nx-tag-studio .sec > .h .grow select { height: 26px; padding: 0 6px; font-size: 12px; }
#nx-tag-studio .sec > .h .arrow { color: var(--muted); font-size: 10px; transition: transform .18s ease; }
#nx-tag-studio .sec.fold > .h .arrow { transform: rotate(-90deg); }
#nx-tag-studio .sec > .c { padding: 9px; display: grid; gap: 8px; }
#nx-tag-studio .sec.fold > .c { display: none; }

#nx-tag-studio .k { display: grid; gap: 4px; font-size: 11px; color: var(--muted); }
#nx-tag-studio .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#nx-tag-studio .g3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
#nx-tag-studio .inline { display: flex; align-items: center; gap: 6px; }
#nx-tag-studio .hint { color: var(--muted); font-size: 11px; }
#nx-tag-studio .quota {
  display: block; width: 100%; text-align: left;
  padding: 8px 10px; border-radius: 9px;
  border: 1px solid var(--line); background: #0e1017;
  color: #c8c6d6; font-size: 11.5px; line-height: 1.45; white-space: pre-wrap;
}
#nx-tag-studio .quota:hover { border-color: var(--line-2); color: var(--ink); }
#nx-tag-studio .quota .qbar {
  display: block; margin-top: 7px; height: 7px; border-radius: 999px;
  background: rgba(255,255,255,.08); overflow: hidden;
}
#nx-tag-studio .quota .qbar i {
  display: block; height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, #7c6cff, #c4b5fd);
}
#nx-tag-studio .seg { display: flex; gap: 6px; }
#nx-tag-studio .seg button { flex: 1; height: 32px; border: 1px solid var(--line); background: #0e1017; border-radius: 8px; color: var(--muted); }
#nx-tag-studio .seg button.on { background: #2b2350; border-color: #57499a; color: #ddd3ff; }
#nx-tag-studio .chk { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); user-select: none; }
#nx-tag-studio .chk input { width: auto; height: auto; }
#nx-tag-studio textarea.t { min-height: 74px; font-size: 12px; }
#nx-tag-studio textarea.t.big { min-height: 108px; }

#nx-tag-studio .chips { display: flex; flex-wrap: wrap; gap: 5px; }
#nx-tag-studio .chip {
  font-size: 10.5px; padding: 3px 7px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--muted); background: #12141c;
}
#nx-tag-studio .chip.on { color: var(--ok); border-color: #2d5a48; background: #14241d; }

#nx-tag-studio .center { flex: 1; min-width: 0; position: relative; background: var(--stage); overflow: hidden; }
#nx-tag-studio .cbar {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 6px; padding: 5px;
  background: rgba(20,22,29,.86); border: 1px solid var(--line);
  border-radius: 999px; backdrop-filter: blur(10px); z-index: 5;
  max-width: calc(100% - 20px); overflow: auto; scrollbar-width: none;
}
#nx-tag-studio .cbar::-webkit-scrollbar { display: none; }
#nx-tag-studio .viewport { position: absolute; inset: 0; overflow: hidden; touch-action: none; cursor: grab; }
#nx-tag-studio .viewport.grabbing { cursor: grabbing; }
#nx-tag-studio .viewport.dropok { outline: 2px dashed #7c6cff; outline-offset: -8px; }
#nx-tag-studio .frame { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
#nx-tag-studio .frame canvas { display: block; border-radius: 4px; box-shadow: var(--shadow); }
#nx-tag-studio .dots {
  position: absolute; left: 0; top: 0;
  pointer-events: none;
}
#nx-tag-studio .dots.grid {
  background-image:
    linear-gradient(rgba(255,255,255,.14) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.14) 1px, transparent 1px);
  background-size: 20% 20%;
}
#nx-tag-studio .dot {
  position: absolute; transform: translate(-50%, -50%);
  min-width: 96px; height: 64px; padding: 0 16px;
  display: grid; place-items: center;
  font-size: 22px; font-weight: 800; color: #12101c;
  background: var(--accent); border-radius: 999px;
  box-shadow: 0 0 0 4px rgba(183,164,255,.28);
  cursor: grab; touch-action: none; white-space: nowrap;
  pointer-events: auto;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -webkit-user-drag: none;
  z-index: 4;
}
#nx-tag-studio .dot::after {
  content: attr(data-label);
  pointer-events: none;
  user-select: none;
}
#nx-tag-studio .dot:active { cursor: grabbing; }
#nx-tag-studio.is-dragging, #nx-tag-studio.is-dragging * {
  user-select: none !important;
  -webkit-user-select: none !important;
  cursor: grabbing !important;
}
#nx-tag-studio .dots.hide { display: none; }
#nx-tag-studio .foldbar {
  display: none;
  height: 36px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--muted);
  font-size: 18px;
  line-height: 1;
}
#nx-tag-studio .rhead .hclose {
  display: none;
  width: 32px; height: 28px; padding: 0;
  font-size: 16px;
}
#nx-tag-studio .dot.auto { background: #4a4f66; color: #cfd2e0; box-shadow: none; }
#nx-tag-studio .dot.sel { background: var(--pink); color: #fff; box-shadow: 0 0 0 3px rgba(232,90,140,.25); }
#nx-tag-studio .readout {
  position: absolute; left: 10px; bottom: 10px; z-index: 5;
  display: flex; gap: 10px; font-size: 11px; color: #cfd2e0;
  background: rgba(8,9,13,.6); border: 1px solid var(--line);
  padding: 5px 9px; border-radius: 8px; backdrop-filter: blur(6px);
  pointer-events: none;
}
#nx-tag-studio .peek {
  position: absolute; right: 28px; top: 48px; z-index: 10;
  width: min(360px, calc(100% - 48px)); max-height: calc(100% - 64px);
  overflow: auto;
  background: rgba(20,22,29,.52); border: 1px solid rgba(255,255,255,.12);
  border-radius: 12px; padding: 10px; box-shadow: var(--shadow);
  backdrop-filter: blur(8px);
  display: none;
}
#nx-tag-studio .peek.on { display: block; }
#nx-tag-studio .peek h4 { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
#nx-tag-studio .peek pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 11.5px; color: #c8c6d6; }

#nx-tag-studio .rhead {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-bottom: 1px solid var(--line);
  background: var(--panel-2); font-size: 12px; font-weight: 650;
}
#nx-tag-studio .count { background: #2b2350; border: 1px solid #57499a; color: #ddd3ff; border-radius: 999px; font-size: 10px; padding: 1px 7px; }
#nx-tag-studio .hgrid { flex: 1; min-height: 0; overflow: auto; padding: 8px; display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: max-content; gap: 8px; align-content: start; }
#nx-tag-studio .hitem { position: relative; aspect-ratio: 1; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; background: #0e1017; cursor: pointer; }
#nx-tag-studio .hitem img { width: 100%; height: 100%; object-fit: cover; display: block; }
#nx-tag-studio .hitem.on { border-color: var(--accent-2); box-shadow: 0 0 0 2px rgba(183,164,255,.25); }
#nx-tag-studio .hitem b { position: absolute; left: 5px; bottom: 4px; font-size: 10px; padding: 1px 5px; border-radius: 999px; background: rgba(8,9,13,.7); color: #dcd8ee; font-weight: 600; }
#nx-tag-studio .rfoot { padding: 8px; border-top: 1px solid var(--line); flex: 0 0 auto; background: var(--panel); }

#nx-tag-studio .floor { display: flex; flex-direction: column; background: #12141b; }
#nx-tag-studio .floor .tools {
  display: none;
  gap: 5px;
  padding: 6px 8px 0;
  overflow-x: auto;
  scrollbar-width: none;
}
#nx-tag-studio .floor .tools::-webkit-scrollbar { display: none; }
#nx-tag-studio .foot {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 10px calc(7px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--line); background: #12141b;
}
#nx-tag-studio .gen {
  flex: 1; height: 40px; border: 0; border-radius: 10px;
  background: linear-gradient(180deg, #ef6d9c, var(--pink-2));
  color: #fff; font-weight: 800; letter-spacing: .04em;
}
#nx-tag-studio .gen:active { transform: translateY(1px); }
#nx-tag-studio .foot .btn, #nx-tag-studio .gen {
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  padding-top: 0;
  padding-bottom: 0;
}
#nx-tag-studio .foot .mobset { flex: 0 0 auto; }
#nx-tag-studio .loop {
  height: 40px; padding: 0 10px; font-size: 11px;
  flex-direction: column; line-height: 1.15; gap: 1px;
}
#nx-tag-studio .loop b { display: block; font-size: 12px; }

#nx-tag-studio .toast {
  position: fixed; left: 50%; bottom: 74px; transform: translateX(-50%);
  z-index: 60; max-width: min(92vw, 460px); text-align: center;
  background: #29213d; border: 1px solid #574a86; color: var(--ink);
  padding: 9px 14px; border-radius: 11px; font-size: 12.5px; box-shadow: var(--shadow);
}

#nx-tag-studio .foot .mobset { display: none; }

#nx-tag-studio .optstack { display: flex; flex-direction: column; gap: 6px; }
#nx-tag-studio .optbar { display: flex; align-items: stretch; gap: 6px; }
#nx-tag-studio .optcombo { display: flex; align-items: stretch; flex: 1; min-width: 0; }
#nx-tag-studio .optstack .optnote { width: 100%; height: 36px; }
#nx-tag-studio .optcombo input {
  flex: 1; min-width: 0; height: 36px;
  border-radius: 9px 0 0 9px; border-right: 0;
}
#nx-tag-studio .optcaret { position: relative; width: 36px; flex: 0 0 36px; }
#nx-tag-studio .optcaret span {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  border: 1px solid var(--line); border-left: 0;
  border-radius: 0 9px 9px 0; background: #0e1017; color: var(--ink);
  pointer-events: none; font-weight: 700;
}
#nx-tag-studio .optcaret select {
  position: absolute; inset: 0; opacity: 0; cursor: pointer;
  width: 100%; height: 100%; margin: 0; padding: 0; border: 0;
}
#nx-tag-studio .optbar .btn { height: 36px; }

#nx-tag-studio .spinveil {
  position: absolute; inset: 0; z-index: 9;
  display: none; place-items: center;
  background: rgba(8,9,13,.38);
  pointer-events: none;
}
#nx-tag-studio .spinveil.on { display: grid; }
#nx-tag-studio .spin {
  width: 54px; height: 54px;
  border: 4px solid rgba(183,164,255,.22);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: nx-tag-studio-spin .7s linear infinite;
}
@keyframes nx-tag-studio-spin { to { transform: rotate(360deg); } }

#nx-tag-studio .ask {
  position: fixed; inset: 0; z-index: 70;
  display: grid; place-items: center;
  background: rgba(8,9,13,.55);
}
#nx-tag-studio .ask[hidden] { display: none; }
#nx-tag-studio .askbox {
  width: min(360px, calc(100vw - 28px));
  background: var(--panel); border: 1px solid var(--line-2);
  border-radius: 14px; padding: 16px; box-shadow: var(--shadow);
}
#nx-tag-studio .askbox p { margin: 0 0 14px; font-size: 14px; }
#nx-tag-studio .askbox .inline { justify-content: flex-end; }
#nx-tag-studio .askbox .btn { height: 36px; min-width: 72px; }

@media (max-width: 1023px) {
  #nx-tag-studio .cbar { display: none; }
  #nx-tag-studio .top { display: none; }
  #nx-tag-studio .handle.l { display: none; }
  #nx-tag-studio .stage { flex-direction: column; }
  #nx-tag-studio .center { order: 1; flex: 1 1 auto; min-height: 0; }
  #nx-tag-studio .side:not(.right) {
    order: 2;
    width: 100%;
    flex: 0 0 auto;
    height: 62vh;
    border-right: 0;
    border-top: 1px solid var(--line);
    margin-left: 0;
  }
  #nx-tag-studio .side:not(.right).collapsed {
    margin-left: 0;
    height: 36px;
  }
  #nx-tag-studio .side:not(.right).collapsed .tabs,
  #nx-tag-studio .side:not(.right).collapsed .body { display: none; }
  #nx-tag-studio .foldbar { display: block; }
  #nx-tag-studio .right {
    position: absolute;
    top: 0; right: 0; bottom: 0;
    z-index: 12;
    width: 200px;
    height: auto;
    margin: 0;
    box-shadow: var(--shadow);
  }
  #nx-tag-studio .right.collapsed {
    transform: translateX(100%);
    margin-right: 0;
    pointer-events: none;
  }
  #nx-tag-studio .handle.r {
    display: grid;
    top: 8px;
    width: 28px;
    height: 40px;
    left: -28px;
    font-size: 18px;
  }
  #nx-tag-studio .right.collapsed .handle.r { display: none; }
  #nx-tag-studio .rhead .hclose { display: inline-grid; place-items: center; }
  #nx-tag-studio .floor .tools { display: flex; }
  #nx-tag-studio .floor .tools .btn { height: 36px; display: inline-flex; align-items: center; justify-content: center; }
  #nx-tag-studio .floor .tools .loop { height: 36px; }
  #nx-tag-studio .peek { top: 8px; }
  #nx-tag-studio .foot { z-index: 8; border-top: 0; padding-top: 4px; }
  #nx-tag-studio .foot .btn.deskonly { display: none; }
  #nx-tag-studio .foot .mobset { display: inline-flex; align-items: center; justify-content: center; }
  #nx-tag-studio textarea.t { min-height: 160px; }
  #nx-tag-studio textarea.t.big { min-height: 220px; }
}
`;
}
