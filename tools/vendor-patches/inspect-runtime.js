showFullscreen = async (f) => {
  const { fullscreen } = await nxEnsureInspectSurface();
  if (f._nxImage) {
    if (nxInspectMirroredImage === f._nxImage) return;
    const previous = nxInspectMirroredImage;
    await fullscreen.setInnerHTML("");
    nxInspectMirroredImage = null;
    await nxDropInspectImage(previous);
    await fullscreen.appendChild(f._nxImage);
    nxInspectMirroredImage = f._nxImage;
    nxInspectImageHtml = "";
    return;
  }
  const src = typeof f?.image_url === "string" && /^(data:image\/|blob:|https?:\/\/)/.test(f.image_url)
    ? f.image_url : f._nxAssetLoading || f._nxInspectError ? "" : Ie(f);
  const html = src
    ? `<img src="${h(src)}" style="display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;background:transparent" alt="전체 화면 이미지">`
    : `<div role="status" style="color:#e8eef8;font:14px Segoe UI,sans-serif">${h(f._nxInspectError || "이미지 불러오는 중…")}</div>`;
  if (nxInspectImageHtml !== html) {
    await fullscreen.setInnerHTML(html);
    nxInspectImageHtml = html;
    const previous = nxInspectMirroredImage;
    nxInspectMirroredImage = null;
    await nxDropInspectImage(previous);
  }
}, nxHideInspectQueued = () => {
  // Hide writes join the same serialized queue as paints: a rapid close→open
  // lands hide-then-show. A newer open can claim its card before this task
  // runs, so restore that card after hiding or its live() check would fail.
  const hideGen = t._inspectGen;
  const task = nxInspectPaint.then(async () => {
    if(nxInspectShell){clearTimeout(nxInspectShell.historyTouchTimer);nxInspectShell.historyTouchTimer=null;nxInspectShell.historyHover=false;}
    const latest = actionCard;
    const { root, fullscreen, actionMenu } = await nxEnsureInspectSurface();
    await fullscreen.setAttribute('x-inray-touch','0');
    await root.setStyleAttribute("display:none");
    if (t._inspectGen === hideGen) t._nxHostInspectOpen = false;
    await fullscreen.setStyleAttribute("display:none");
    await fullscreen.setInnerHTML("");
    nxInspectImageHtml = "";
    const previous = nxInspectMirroredImage;
    nxInspectMirroredImage = null;
    await nxDropInspectImage(previous);
    await actionMenu.setStyleAttribute("display:none");
    actionCard = null; inspectZones = []; inspectSheetEl = null;
    if (t._inspectGen !== hideGen && latest) actionCard = latest;
  });
  nxInspectPaint = task.catch(() => {});
  return task;
}, nxEnsureInspectSheet = async () => {
  const { root: o, doc: e, actionMenu } = await nxEnsureInspectSurface();
  if (nxInspectShell) return nxInspectShell;
  if (nxInspectBuild) return nxInspectBuild;
  nxInspectBuild = (async () => {
    // A local style node avoids a CSS runtime import emitting top-level names
    // into the module scope shared with the frozen UI.
    if (!t._nxInspectSpinCss) {
      try {
        const spinCss = await H(e, "style", { text: "@keyframes nxInspectSpin{to{transform:rotate(360deg)}}" + (globalThis.__INLAY_VIEWER_CORE__?.imageHistoryCss?.() || '') });
        await o.appendChild(spinCss);
        t._nxInspectSpinCss = !0;
      } catch {}
    }
    // Two fixed chip rows prevent roster completion from resizing the image.
    const rowStyle = "display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;pointer-events:auto;";
    const [sheet, chipRow, castRow, actRow, closeRow, status] = await Promise.all([
      H(e, "div", { style: "position:relative;width:min(440px,100%);box-sizing:border-box;flex-shrink:0;background:rgba(18,22,32,.9);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:10px;display:grid;gap:8px;pointer-events:auto;" }),
      H(e, "div", { style: rowStyle + "height:72px;min-height:72px;" }), H(e, "div", { style: rowStyle + "width:100%;height:72px;min-height:72px;overflow:auto;align-content:flex-start;" }),
      H(e, "div", { style: "display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:3px;" }), H(e, "div", { style: "position:relative;display:flex;min-width:0;" }),
      H(e, "div", { style: "position:absolute;inset:10px 10px auto;pointer-events:none;color:#cbd5e1;text-align:center;font:12px Segoe UI,sans-serif;" })
    ]);
    const chipStyle = "border:0;border-radius:999px;padding:7px 11px;font:700 11px/18px Segoe UI,sans-serif;height:32px;box-sizing:border-box;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;touch-action:manipulation;pointer-events:auto";
    const actStyle = "width:100%;min-width:0;height:44px;box-sizing:border-box;border:0;border-radius:10px;padding:0 4px;font:22px Segoe UI,sans-serif;white-space:nowrap;touch-action:manipulation;pointer-events:auto;transition:background .15s";
    const spinShow = "position:absolute;top:-19px;right:4px;width:10px;height:10px;box-sizing:border-box;border-radius:50%;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;animation:nxInspectSpin .8s linear infinite;pointer-events:none";
    const spinHide = spinShow + ";visibility:hidden";
    // Cast-loading indicator sits above 닫기: a small spinner with no
    // layout shift, instead of a full-width status row.
    const spinner = await H(e, "div", { style: spinHide });
    await closeRow.appendChild(spinner);
    const specs = [
      [actRow, "⚛️", "retag", `${actStyle};background:rgba(255,255,255,.08);color:#fff`],
      [actRow, "🔃", "regen", `${actStyle};background:rgba(255,255,255,.08);color:#fff`],
      [actRow, "🎲", "reroll", `${actStyle};background:rgba(255,255,255,.08);color:#fff`],
      [actRow, "🔮", "base", `${actStyle};background:rgba(255,255,255,.08);color:#fff`],
      [closeRow, "닫기", "close", `${actStyle};font-size:14px;background:rgba(255,255,255,.08);color:#fff`]
    ];
    const buttons = await Promise.all(specs.map(([, text, , style]) => H(e, "button", { text, style })));
    const names = ['태그 생성','메시지 이미지 재생성','이 이미지 리롤','샷 태그 수정','닫기'];
    await Promise.all(buttons.map((button, i) => button.setInnerHTML(`<span data-inray-inspect-action="1" role="img" aria-label="${names[i]}">${specs[i][1]}</span>`)));
    // Keep action identity beside its node for coordinate hit testing.
    await Promise.all(buttons.map((button, i) => specs[i][0].appendChild(button)));
    await chipRow.appendChild(castRow);
    // Close keeps its loading indicator beside the generation actions.
    await actRow.appendChild(closeRow);
    await Promise.all([chipRow, status, actRow].map(row => sheet.appendChild(row)));
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
    const { root, fullscreen, actionMenu, doc: e } = await nxEnsureInspectSurface();
    const building = nxEnsureInspectSheet();
    // Attach a handler immediately while the image paint is still pending.
    building.catch(() => {});
    const shell = await building;
    if (!live()) return;
    // Mount the complete reserved layout before showing any image.
    if (opening) {
      await root.setStyleAttribute("position:fixed;inset:0;z-index:100003;display:grid;grid-template-rows:minmax(0,1fr) auto;background:rgba(0,0,0,.92);");
      await fullscreen.setStyleAttribute("position:relative;display:flex;min-width:0;min-height:0;pointer-events:auto;align-items:center;justify-content:center;padding:12px 12px 4px;box-sizing:border-box;");
      if (typeof fullscreen.setAttribute === 'function') await fullscreen.setAttribute('x-inray-history-host','1');
      await actionMenu.setStyleAttribute("display:flex;max-height:65dvh;overflow:auto;pointer-events:auto;background:transparent;align-items:flex-start;justify-content:center;padding:4px 10px max(10px,env(safe-area-inset-bottom));box-sizing:border-box;");
    }
    if (!live()) return;
    await showFullscreen(snapshot);
    if (!live()) return;
    inspectSheetEl = shell.sheet;
    inspectZones = shell.zones;
    // Make close/actions usable before slower character-button updates finish.
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
    if (typeof omniInspectHistoryPaint === 'function') void omniInspectHistoryPaint(snapshot, fullscreen, live).catch(error=>y('warn','inspect.history',String(error)));
    // Cast names load behind the open sheet: a spinner above 닫기, never a
    // full-width "불러오는 중" row. Only hard errors keep the status line.
    const spin = !!snapshot._nxCastLoading && !snapshot._nxCastError;
    if (spin !== shell.spinOn) { await shell.spinner.setStyleAttribute(spin ? shell.spinShow : shell.spinHide); shell.spinOn = spin; }
    const text = snapshot._nxCastError || "";
    if (text !== shell.statusText) { await shell.status.setTextContent(text); shell.statusText = text; }
  });
  // Serialize display writes only, never network reads; obsolete paints cannot
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
  t._nxHostInspectOpen = true;
  inspectGuardUntil = Date.now() + 400; inspectZones = []; inspectSheetEl = null;
  hidePressFill().catch(() => {});
  return nxPaintInspect(f, gen, true);
},
