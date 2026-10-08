  async function At() {
    if(t.overlayUi)t.overlayUi._stickyEditorOpen=true;
    t._inspectGen=(t._inspectGen || 0)+1;
    if(!t.uiOpen){ensureExplorerState().folderKey='__all__';t._explorerWindow=null;}
    t.uiOpen=true;
    try {
      const card=t.backendSettings?.card,id=card && resolveActivePresetId(card);
      if(id)pinActivePreset(card,id);
      Va();
      clearTimeout(t._overlayPlaceTimer);t._overlayPlaceTimer=null;
      if(t._overlayRaf && typeof cancelAnimationFrame==='function')cancelAnimationFrame(t._overlayRaf);
      t._overlayRaf=0;
      clearTimeout(t.galleryUi?._softTimer);
      t._viewerPaintJob=null;t._viewerPaintScheduled=false;
      clearInterval(t._hostReaper);t._hostReaper=null;
      t.charEditUi?.root?.remove();
      t.charEditUi=null;
      if(t.autotagFocus?.scope==='modal')t.autotagFocus=null;
    } catch {}
    // Paint cached controls before any bridge cleanup or character-catalog read.
    const hidden=Promise.all([blockHostChrome(true),hideFloatingViewerForModal(),Ht(),t.hideStickyInspect?.()].map(job=>Promise.resolve(job).catch(()=>{})));
    const hide='position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;visibility:hidden;';
    for(const node of [t.overlayUi?.fullscreen,t.overlayUi?.actionMenu])void node?.setStyleAttribute(hide).catch(()=>{});
    document.body.innerHTML='';
    const shown=Promise.resolve(k.showContainer?.('fullscreen'));
    for(let attempt=0;attempt<3 && t.uiOpen;attempt++) {
      await P();
      if(document.getElementById('nx-shell'))break;
      if(attempt<2)await new Promise(resolve=>setTimeout(resolve,80+attempt*80));
    }
    if(!t.uiOpen)return;
    if(!document.getElementById('nx-shell')) {
      t.uiOpen=false;
      await shown.catch(()=>{});await hidden;
      if(t.overlayUi)t.overlayUi._stickyEditorOpen=false;
      await blockHostChrome(false).catch(()=>{});
      await k.hideContainer?.();return;
    }
    armSettingsCloseWatch();
    const generation=t.uiRenderGen,override=JSON.stringify(t.scopeOverride);
    t._settingsCatalogLoad ||= ia().finally(()=>{t._settingsCatalogLoad=null;});
    void t._settingsCatalogLoad.then(()=>{
      if(!t.uiOpen || t.uiRenderGen!==generation || JSON.stringify(t.scopeOverride)!==override)return;
      // Only update the scope choices; a full rerender would discard live edits.
      const choices=document.createElement('div');choices.innerHTML=sa(t.lastScope);
      for(const id of ['nx-scope-char','nx-scope-chat']) {
        const select=document.getElementById(id),fresh=choices.querySelector('#'+id);
        if(select && fresh)select.innerHTML=fresh.innerHTML;
      }
    }).catch(()=>{});
    try {window.focus?.();document.body?.focus?.();}catch{}
    clearInterval(t._debugTabTimer);t._debugTabTimer=null;
    await Promise.all([shown,hidden]);
  }
