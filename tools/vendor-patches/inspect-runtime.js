showFullscreen = async (f) => {
  const src = typeof f?.image_url === "string" && f.image_url.startsWith("data:image/")
    ? f.image_url : f._nxAssetLoading || f._nxInspectError ? "" : Ie(f);
  const html = src
    ? `<img src="${h(src)}" style="display:block;max-width:calc(100vw - 32px);max-height:calc(100dvh - 140px);width:auto;height:auto;object-fit:contain;background:transparent" alt="전체 화면 이미지">`
    : `<div role="status" style="color:#e8eef8;font:14px Segoe UI,sans-serif">${h(f._nxInspectError || "이미지 불러오는 중…")}</div>`;
  if (nxInspectImageHtml !== html) {
    await fullscreen.setInnerHTML(html);
    nxInspectImageHtml = html;
  }
}, nxHideInspectQueued = () => {
  // Hide writes join the same serialized queue as paints: a rapid close→open
  // lands hide-then-show and always ends in the last tapped state. Host
  // writes only, never network reads; the display:none writes always land.
  // hideActionMenu clears the card unconditionally (frozen), so when a newer
  // open already claimed the sheet synchronously before this task runs, the
  // card is restored — otherwise the newer paint's live() check would fail
  // and the sheet would stick hidden while open.
  const hideGen = t._inspectGen;
  const task = nxInspectPaint.then(async () => {
    const latest = actionCard;
    try { await hideFullscreen(); } catch {}
    try { await hideActionMenu(); } catch {}
    if (t._inspectGen !== hideGen && latest) actionCard = latest;
  });
  nxInspectPaint = task.catch(() => {});
  return task;
}, nxEnsureInspectSheet = async () => {
  if (nxInspectShell) return nxInspectShell;
  if (nxInspectBuild) return nxInspectBuild;
  nxInspectBuild = (async () => {
    // One-time spin keyframes for the cast-loading indicator. A <style> node
    // through SafeDOM, not a CSS runtime import (which would leak a top-level
    // const into the shared module scope). Same pattern as nxPressRing.
    if (!t._nxInspectSpinCss) {
      try {
        const spinCss = await H(e, "style", { text: "@keyframes nxInspectSpin{to{transform:rotate(360deg)}}" });
        await o.appendChild(spinCss);
        t._nxInspectSpinCss = !0;
      } catch {}
    }
    // Build the frozen sheet once. Independent SafeDOM hops run together.
    const rowStyle = "display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;pointer-events:auto;";
    const [sheet, chipRow, castRow, actRow, closeRow, status] = await Promise.all([
      H(e, "div", { style: "width:min(440px,100%);background:linear-gradient(165deg,#1a1f2e,#0c1018);border:1px solid rgba(255,255,255,.14);border-radius:18px;padding:12px;box-shadow:0 24px 60px rgba(0,0,0,.55);display:grid;gap:10px;pointer-events:auto;" }),
      H(e, "div", { style: rowStyle }), H(e, "div", { style: rowStyle }),
      H(e, "div", { style: rowStyle }), H(e, "div", { style: rowStyle }),
      H(e, "div", { style: "color:#cbd5e1;text-align:center;font:12px Segoe UI,sans-serif;" })
    ]);
    const chipStyle = "border:0;border-radius:999px;padding:7px 11px;font:700 11px Segoe UI,sans-serif;white-space:nowrap;touch-action:manipulation;pointer-events:auto";
    const actStyle = "border:0;border-radius:12px;padding:9px 14px;font:700 12px Segoe UI,sans-serif;white-space:nowrap;touch-action:manipulation;pointer-events:auto";
    const spinShow = "width:14px;height:14px;flex:none;border-radius:50%;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;animation:nxInspectSpin .8s linear infinite;pointer-events:none";
    const spinHide = "display:none";
    // Cast-loading indicator lives left of 닫기: a small spinner with no
    // layout shift, instead of a full-width status row.
    const spinner = await H(e, "div", { style: spinHide });
    await closeRow.appendChild(spinner);
    const specs = [
      [actRow, "태그", "retag", `${actStyle};background:rgba(15,118,110,.92);color:#fff`],
      [actRow, "재생성", "regen", `${actStyle};background:#7132f5;color:#fff`],
      [actRow, "리롤", "reroll", `${actStyle};background:rgba(51,65,85,.95);color:#e8eef8;border:1px solid rgba(255,255,255,.14)`],
      [actRow, "수정", "base", `${actStyle};background:rgba(124,108,255,.22);color:#ddd6fe;border:1px solid rgba(124,108,255,.45)`],
      [closeRow, "닫기", "close", `${actStyle};background:rgba(255,255,255,.06);color:#cbd5e1;border:1px solid rgba(255,255,255,.1);min-width:88px`]
    ];
    const buttons = await Promise.all(specs.map(([, text, , style]) => H(e, "button", { text, style })));
    // Coordinate dispatch already keeps act/charI beside each node. No data-*
    // writes or post-render queries are needed across the SafeDOM boundary.
    await Promise.all(buttons.map((button, i) => specs[i][0].appendChild(button)));
    await chipRow.appendChild(castRow);
    await Promise.all([chipRow, status, actRow, closeRow].map(row => sheet.appendChild(row)));
    await actionMenu.appendChild(sheet);
    nxInspectShell = { sheet, castRow, status, chipStyle, charKey: "", statusText: "", charZones: [],
      spinner, spinShow, spinHide, spinOn: false,
      zones: buttons.map((el, i) => ({ el, act: specs[i][2], charI: -1 })) };
    return nxInspectShell;
  })();
  try { return await nxInspectBuild; } finally { nxInspectBuild = null; }
}, nxPaintInspect = (f, gen, opening) => {
  const snapshot = { ...f, characters: (f.characters || []).map(row => ({ ...row })) };
  const live = () => inspectOpen && actionCard === f && t._inspectGen === gen && !t.uiOpen;
  const task = nxInspectPaint.then(async () => {
    if (!live()) return;
    const building = nxEnsureInspectSheet();
    // Attach a handler immediately; image paint can still be in flight if the
    // host rejects sheet creation. The awaited promise below reports the error.
    building.catch(() => {});
    // Show the empty overlay before its content: the backdrop lands one host
    // round-trip sooner and never waits on image or character I/O.
    if (opening) await fullscreen.setStyleAttribute("position:fixed;inset:0;display:flex;z-index:100001;pointer-events:none;background:rgba(0,0,0,.92);align-items:center;justify-content:center;padding:16px 16px 120px;box-sizing:border-box;");
    if (!live()) return;
    await showFullscreen(snapshot);
    if (!live()) return;
    const shell = await building;
    if (!live()) return;
    inspectSheetEl = shell.sheet;
    inspectZones = shell.zones;
    // Make close/actions usable before slower character-button updates finish.
    if (opening) await actionMenu.setStyleAttribute("position:fixed;inset:0;display:flex;z-index:100002;pointer-events:auto;background:transparent;align-items:flex-end;justify-content:center;padding:max(12px,env(safe-area-inset-bottom)) 12px 18px;box-sizing:border-box;");
    if (!live()) return;
    const chars = snapshot.characters;
    const key = JSON.stringify(chars.map(row => [row.cast_id || "", row.name || ""]));
    if (key !== shell.charKey) {
      await shell.castRow.setInnerHTML("");
      shell.charKey = ""; shell.charZones = [];
      if (!live()) return;
      const buttons = await Promise.all(chars.map((row, i) => H(e, "button", {
        text: `c${i + 1}${row.name ? `·${w(row.name, 40)}` : ""}`,
        style: `${shell.chipStyle};background:rgba(255,255,255,.06);color:#e8eef8;border:1px solid rgba(255,255,255,.14)`
      })));
      if (!live()) return;
      await Promise.all(buttons.map(button => shell.castRow.appendChild(button)));
      shell.charZones = buttons.map((el, charI) => ({ el, act: "char", charI }));
      shell.charKey = key;
    }
    if (!live()) return;
    inspectZones = [...shell.zones, ...shell.charZones];
    // Cast names load behind the open sheet: a spinner left of 닫기, never a
    // full-width "불러오는 중" row. Only hard errors keep the status line.
    const spin = !!snapshot._nxCastLoading && !snapshot._nxCastError;
    if (spin !== shell.spinOn) { await shell.spinner.setStyleAttribute(spin ? shell.spinShow : shell.spinHide); shell.spinOn = spin; }
    const text = snapshot._nxCastError || "";
    if (text !== shell.statusText) { await shell.status.setTextContent(text); shell.statusText = text; }
  });
  // Serialize host writes only, never network reads; obsolete paints cannot
  // replace a newer image or make a closed sheet visible again.
  nxInspectPaint = task.catch(() => {});
  return task;
}, updateStickyInspect = async (f) => {
  if (!inspectOpen || actionCard !== f || t.uiOpen) return;
  return nxPaintInspect(f, t._inspectGen, false);
}, showStickyInspect = async (f) => {
  if (!f || t.uiOpen) return;
  const gen = t._inspectGen = (t._inspectGen || 0) + 1;
  actionCard = f; inspectOpen = true; pendingSheetHit = null;
  inspectGuardUntil = Date.now() + 400; inspectZones = []; inspectSheetEl = null;
  hidePressFill().catch(() => {});
  return nxPaintInspect(f, gen, true);
},
