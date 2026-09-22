nxEnsureInspectSurface = async () => {
  if (nxInspectSurface) return nxInspectSurface;
  if (nxInspectSurfaceBuild) return nxInspectSurfaceBuild;
  nxInspectSurfaceBuild = (async () => {
    const root = await H(e, "div", {style: "position:fixed;inset:0;z-index:100003;display:none;"});
    const fullscreen = await H(e, "div", {style: "display:none"});
    const actionMenu = await H(e, "div", {style: "display:none"});
    await root.appendChild(fullscreen);
    await root.appendChild(actionMenu);
    await o.appendChild(root);
    // SafeElement callbacks are document-wide and have coordinates, not a target.
    await root.addEventListener("click", async event => {
      if (!inspectOpen || t.uiOpen || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
      const gen = t._inspectGen, card = actionCard;
      const openingClick = Date.now() < inspectGuardUntil;
      const live = () => inspectOpen && !t.uiOpen && gen === t._inspectGen && card === actionCard;
      try {
        const x = event.clientX, y = event.clientY;
        if (!await hitEl(root, x, y) || !live()) return;
        for (const zone of inspectZones) {
          if (await hitEl(zone.el, x, y)) {
            if (live() && (!openingClick || zone.act === "close")) await runInspectAction(zone.act, card, zone.charI ?? -1);
            return;
          }
          if (!live()) return;
        }
        if (nxInspectShell && await hitEl(nxInspectShell.sheet, x, y)) return;
        if (nxInspectMirroredImage && await hitEl(nxInspectMirroredImage, x, y)) return;
        if (live() && !openingClick) await runInspectAction("close", card, -1);
      } catch (error) { y("error", "shots.asset.inspect.action.fail", String(error?.message || error)); }
    });
    await root.addEventListener("keydown", async event => {
      if (event.key === "Escape" && inspectOpen && !t.uiOpen) {
        try { await runInspectAction("close", actionCard, -1); }
        catch (error) { y("error", "shots.asset.inspect.close.fail", String(error?.message || error)); }
      }
    });
    nxInspectSurface = {root, fullscreen, actionMenu, doc: e};
    return nxInspectSurface;
  })();
  try { return await nxInspectSurfaceBuild; } finally { nxInspectSurfaceBuild = null; }
}, nxCloneInspectImage = async (card, assetName, sourceNode) => {
  let image = null;
  const borrowed = [];
  const find = async node => {
    if (!node?.querySelector) return null;
    const img = await node.querySelector("img[src]");
    if (img) borrowed.push(img);
    return img;
  };
  try {
    image = await find(sourceNode);
    if (!image && sourceNode?.closest) {
      let shot = null;
      try { shot = await sourceNode.closest("[data-inlay-inline-shot],[x-inlay-inline-shot]"); } catch {}
      if (shot) { borrowed.push(shot); image = await find(shot); }
    }
    // Risu proxies can expose closest without implementing it. The hover
    // control lives inside a bar beside the image, so walk via SafeElement.
    let parent = sourceNode;
    for (let depth = 0; !image && parent?.getParent && depth < 4; depth++) {
      parent = await parent.getParent();
      if (!parent) break;
      borrowed.push(parent);
      image = await find(parent);
    }
    if (!image) {
      const quote = value => String(value).replace(/[^a-zA-Z0-9_.-]/g, char => "\\" + char.codePointAt(0).toString(16) + " ");
      const selectors = [];
      if (card?.id) {
        const id = quote(card.id);
        selectors.push('[data-inlay-inline-shot="' + id + '"] img[src]', '[x-inlay-inline-shot="' + id + '"] img[src]');
      }
      if (assetName) selectors.push('[data-inray-asset="' + quote(assetName) + '"] img[src]');
      if (selectors.length) {
        image = await e.querySelector(selectors.join(","));
        if (image) borrowed.push(image);
      }
    }
    if (!image) throw new Error("화면에서 이미지를 찾지 못했습니다.");
    // Preserve Risu's resolved src, including host-owned Blob URLs.
    // Never read pixels or create a plugin-owned image URL.
    const clone = await image.cloneNode(false);
    try {
      await clone.setClassName("");
      await clone.setStyleAttribute("display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;background:transparent;pointer-events:none;");
      return clone;
    } catch (error) { await nxDropInspectImage(clone); throw error; }
  } finally {
    if (typeof omniRelease === "function") for (const node of borrowed) await omniRelease(node);
  }
}, nxDropInspectImage = async image => {
  if (!image || nxInspectDroppedImages.has(image)) return;
  nxInspectDroppedImages.add(image);
  try { await image.remove(); }
  finally { if (typeof omniRelease === "function") await omniRelease(image); }
},
