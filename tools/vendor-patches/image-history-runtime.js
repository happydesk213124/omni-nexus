const omniHistoryCache = new Map();
let omniHistoryHoverBusy = false, omniHistoryHoverAt = 0;
const omniTouchMedia=globalThis.matchMedia?.('(hover: none)');
let omniTouchImage = null, omniTouchWork = Promise.resolve();
function omniHistoryTouch(event) {
  if (!omniTouchMedia?.matches) return Promise.resolve(false);
  // SafeDOM callbacks omit pointerType/target. Touch-only capability and
  // coordinates own the hit; one retained image handle owns the hide timer.
  const task = omniTouchWork.catch(()=>{}).then(async()=>{
    const doc=t.hostDoc || await ue();if(!doc || t.unloading)return false;
    let nodes=[];
    try {
      nodes=await nxUnwrapSafeNodes(await doc.querySelectorAll('[data-inray-history-host]'));
      for(const el of nodes) {
        if(!await hitEl(el,event.clientX,event.clientY))continue;
        const shown=await el.getAttribute('x-inray-touch')==='1';
        await omniHistoryTouchHide();
        await el.setAttribute('x-inray-touch','1');
        const row=omniTouchImage={el,timer:null};
        nodes=nodes.filter(node=>node!==el);
        row.timer=setTimeout(()=>{
          omniTouchWork=omniTouchWork.catch(()=>{}).then(()=>omniHistoryTouchHide(row));
          void omniTouchWork.catch(error=>y('warn','image.touch.hide',String(error)));
        },2000);
        const parent=await el.getParent();
        try {
          const id=await omniHistoryAttr(parent,'inlay-inline-shot');
          if(id)void omniHistoryRows(id).then(rows=>{
            omniTouchWork=omniTouchWork.catch(()=>{}).then(()=>omniTouchImage===row?omniHistoryPaint(el,id,rows):null);
            return omniTouchWork;
          }).catch(error=>y('warn','image.touch.history',String(error)));
        } finally {await omniRelease(parent);}
        // Consume hidden control hits, but keep image taps in the existing
        // double/triple-tap fullscreen gesture rather than dropping its first tap.
        if(!shown) {
          const controls=await nxUnwrapSafeNodes(await el.querySelectorAll('[data-inray-toolbar],[data-inray-history-layer] button'));
          try {return (await Promise.all(controls.map(control=>hitEl(control,event.clientX,event.clientY)))).some(Boolean);}
          finally {for(const control of controls)await omniRelease(control);}
        }
        return false;
      }
      await omniHistoryTouchHide();return false;
    } finally {for(const el of nodes)await omniRelease(el);}
  });
  omniTouchWork=task;return task;
}
async function omniHistoryTouchHide(expected=omniTouchImage) {
  if(!expected || omniTouchImage!==expected)return;
  omniTouchImage=null;clearTimeout(expected.timer);
  try {await expected.el.setAttribute('x-inray-touch','0');}
  finally {await omniRelease(expected.el);}
}
function omniHistoryCore() { return globalThis.__INLAY_VIEWER_CORE__; }
async function omniHistoryAttr(el, name) {
  return await el.getAttribute('x-' + name) || nxFloatHtmlAttr(await el.getOuterHTML(), 'data-' + name);
}
async function omniHistoryRows(id) {
  const root = String(id).replace(/_[rs]\d+$/, '');
  const cached = omniHistoryCache.get(root);
  if (cached?.rows?.some(row => row.id === id)) return cached.rows;
  if (cached?.pending) return cached.pending;
  const entry = {};
  entry.pending = K('/v1/cards/' + encodeURIComponent(id) + '/history').then(result => {
    if (result?.ok === false) throw new Error(result.error?.message || '기록을 읽지 못했습니다.');
    entry.rows = (result?.cards || []).slice().reverse();
    return entry.rows;
  }).finally(() => { entry.pending = null; });
  omniHistoryCache.set(root, entry);
  if (omniHistoryCache.size > 40) omniHistoryCache.delete(omniHistoryCache.keys().next().value);
  return entry.pending;
}
async function omniHistoryPaint(wrap, id, rows, inline = false) {
  const index = Math.max(0, rows.findIndex(row => row.id === id));
  const dots = await wrap.querySelector('[data-inray-history-dots],[x-inray-history-dots]');
  try { if (dots) await dots.setInnerHTML(omniHistoryCore().imageHistoryIndicators(rows.length, index, rows.filter(row=>/_r\d+$/.test(row.id)).length, inline)); }
  finally { await omniRelease(dots); }
  const arrows = await nxUnwrapSafeNodes(await wrap.querySelectorAll('[data-inray-history="prev"],[data-inray-history="next"],[x-inray-history="prev"],[x-inray-history="next"]'));
  try { for (const arrow of arrows) {
    const prev = await omniHistoryAttr(arrow,'inray-history') === 'prev';
    await arrow.setAttribute('x-inray-history-edge', (prev ? index <= 0 : index >= rows.length - 1) ? '1' : '0');
    if (inline) await arrow.setStyle('color', (prev ? index <= 0 : index >= rows.length - 1) ? 'rgba(255,255,255,.3)' : 'white');
  } } finally { for (const arrow of arrows) await omniRelease(arrow); }
  await wrap.setAttribute('x-inray-history-ready', '1');
}
async function omniHistoryHover() {
  if (omniTouchMedia?.matches || omniHistoryHoverBusy || t._nxHostInspectOpen || Date.now() - omniHistoryHoverAt < 150) return;
  omniHistoryHoverBusy = true; omniHistoryHoverAt = Date.now();
  let nodes = [];
  try {
    const doc = t.hostDoc || await ue(); if (!doc) return;
    nodes = await nxUnwrapSafeNodes(await doc.querySelectorAll('[data-inray-bake]:hover:not([x-inray-history-ready]),[x-inray-bake]:hover:not([x-inray-history-ready])'));
    for (const node of nodes || []) {
    const id = await omniHistoryAttr(node,'inlay-inline-shot');
    if (id) {
      const rows = await omniHistoryRows(id);
      if (await omniHistoryAttr(node,'inlay-inline-shot') === id) await omniHistoryPaint(node, id, rows);
    }
    }
  } finally { for (const node of nodes || []) await omniRelease(node); omniHistoryHoverBusy = false; }
}

// :active can disappear before a SafeDOM query returns; coordinates own the hit.
async function omniHistoryHit(root, event, focused = false) {
  if (!root || t._nxHostInspectOpen) return false;
  let nodes = [];
  if (!focused) {
    const bars = await nxUnwrapSafeNodes(await root.querySelectorAll('[data-inray-toolbar]'));
    try { for (const bar of bars) if (await hitEl(bar,event.clientX,event.clientY)) {
      nodes = await nxUnwrapSafeNodes(await bar.querySelectorAll('[data-inray-history],[x-inray-history]'));
      if (!nodes.length || !await hitEl(nodes[0],event.clientX,event.clientY)) {
        for (const node of nodes) await omniRelease(node);
        return false;
      }
      break;
    } } finally { for (const bar of bars) await omniRelease(bar); }
  }
  if (!focused && !nodes.length) {
    const hovered = await nxUnwrapSafeNodes(await root.querySelectorAll('[data-inray-bake]:hover,[x-inray-bake]:hover'));
    try { for (const wrap of hovered) if (await hitEl(wrap, event.clientX, event.clientY)) {
      nodes = await nxUnwrapSafeNodes(await wrap.querySelectorAll('[data-inray-history],[x-inray-history]'));
      break;
    } } finally { for (const wrap of hovered) await omniRelease(wrap); }
  }
  if (!nodes.length) nodes = await nxUnwrapSafeNodes(await root.querySelectorAll(focused
    ? '[x-inray-history]:focus,[data-inray-history]:focus' : '[x-inray-history],[data-inray-history]'));
  try {
    for (const button of nodes) {
      if (!focused && !await hitEl(button, event.clientX, event.clientY)) continue;
      const action = await omniHistoryAttr(button,'inray-history');
      let wrap = await button.getParent();
      const parents = [];
      try {
        for (let depth = 0; wrap && depth < 5; depth++) {
          parents.push(wrap);
          const id = await omniHistoryAttr(wrap,'inlay-inline-shot');
          if (!id) { wrap = await wrap.getParent(); continue; }
          const current = await wrap.getAttribute('x-inray-history-current') || id;
          if (action === 'pin') {
            const result = await K('/v1/cards/' + encodeURIComponent(current) + '/pin', { method: 'POST', body: {} });
            if (result?.ok === false) throw new Error(result.error?.message || '고정 실패');
          } else {
            const cards = await omniHistoryRows(current);
            const index = cards.findIndex(row => row.id === current);
            const next = cards[Math.max(0, Math.min(cards.length - 1, index + (action === 'prev' ? -1 : 1)))];
            if (next && next.id !== current) {
              const src = await globalThis.__INLAY_NATIVE__.ensureImageUrl(next.id);
              if (!src) throw new Error('이미지를 읽지 못했습니다.');
              const img = await wrap.querySelector('img');
              try {
                if (img) {
                  const safeSrc = src.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
                  await img.setOuterHTML((await img.getOuterHTML()).replace(/\bsrc\s*=\s*["'][^"']*["']/i, 'src="' + safeSrc + '"'));
                }
              } finally { await omniRelease(img); }
              await wrap.setAttribute('x-inray-history-current', next.id);
              await wrap.setAttribute('x-inlay-inline-shot', next.id);
              await wrap.setAttribute('x-inray-asset', next.asset_name);
              // Actions follow the preview; the wrapper identity continues to own the slot.
              for (const attr of ['fs', 'refresh']) {
                const controls = await nxUnwrapSafeNodes(await wrap.querySelectorAll('[x-inray-' + attr + '],[data-inray-' + attr + ']'));
                try { for (const control of controls) await control.setAttribute('x-inray-' + attr, next.id); }
                finally { for (const control of controls) await omniRelease(control); }
              }
              await omniHistoryPaint(wrap, next.id, cards);
            }
          }
          return true;
        }
      } finally { for (const parent of parents) await omniRelease(parent); }
    }
    return false;
  } catch (error) { Pe('이미지 기록', error); return true; }
  finally { for (const node of nodes) await omniRelease(node); }
}

async function omniInspectHistoryPaint(card, fullscreen, live) {
  const shell = nxInspectShell;
  if (!shell || !card.id || !live()) return;
  if (!shell.historyLayer) {
    shell.historyBuild ||= (async () => {
      const layer = await H(nxInspectSurface.doc, 'div');
      await layer.setInnerHTML(omniHistoryCore().imageHistoryControls(true,false));
      await layer.setStyleAttribute('position:absolute;inset:12px;pointer-events:none;');
      const buttons = await nxUnwrapSafeNodes(await layer.querySelectorAll('[data-inray-history],[x-inray-history]'));
      const dots = await layer.querySelector('[data-inray-history-dots]');
      shell.historyChrome = [...buttons, dots].filter(Boolean);
      shell.historyZones = await Promise.all(buttons.map(async el => ({ el, act:'history-' + await omniHistoryAttr(el,'inray-history'), charI:-1 })));
      shell.historyLayer = layer;
    })().finally(() => {shell.historyBuild = null;});
    await shell.historyBuild;
  }
  if (!live()) return;
  await fullscreen.appendChild(shell.historyLayer);
  await omniInspectHistoryLayout(shell,fullscreen);
  shell.historyHover = !!shell.historyHover;
  for (const el of shell.historyChrome) await el.setStyle('opacity',shell.historyHover ? '1' : '0');
  inspectZones = [...shell.zones, ...shell.charZones, ...shell.historyZones];
  const rows = await omniHistoryRows(card.id);
  if (live()) await omniHistoryPaint(shell.historyLayer, card.id, rows, true);
}
async function omniInspectHistoryLayout(shell, fullscreen) {
  const gen = t._inspectGen;
  const image = await fullscreen.querySelector('img');
  try {
    if (!image) return null;
    const [rect, parent] = await Promise.all([image.getBoundingClientRect(),fullscreen.getBoundingClientRect()]);
    if (!inspectOpen || gen !== t._inspectGen || !rect.width || !rect.height) return null;
    const style = `position:absolute;left:${rect.left-parent.left}px;top:${rect.top-parent.top}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;`;
    if (style !== shell.historyGeometry) { await shell.historyLayer.setStyleAttribute(style); shell.historyGeometry = style; }
    return rect;
  } finally { await omniRelease(image); }
}
async function omniInspectHistoryHover(event) {
  if(omniTouchMedia?.matches)return;
  const shell = nxInspectShell;
  if (!inspectOpen || t.uiOpen || !shell?.historyZones || !Number.isFinite(event.clientX)) return;
  // Keep the final pointer position when events arrive faster than the bridge.
  shell.historyPointer = event;
  if (shell.historyHoverTimer || shell.historyHoverBusy) return;
  shell.historyHoverTimer = setTimeout(() => {
    shell.historyHoverTimer = null;
    void omniInspectHistoryHoverPaint(shell).catch(error=>y('warn','inspect.history.hover',String(error)));
  },60);
}
async function omniInspectHistoryHoverPaint(shell) {
  const event = shell.historyPointer;
  shell.historyPointer = null;
  if (!inspectOpen || t.uiOpen || !event) return;
  shell.historyHoverBusy = true;
  const gen = t._inspectGen;
  try {
    let action = null;
    if (await hitEl(shell.sheet,event.clientX,event.clientY)) {
      for (const zone of shell.zones) if (await hitEl(zone.el,event.clientX,event.clientY)) { action = zone.el; break; }
    }
    if (!inspectOpen || gen !== t._inspectGen) return;
    if (action !== shell.hoverAction) {
      if (shell.hoverAction) await shell.hoverAction.setStyle('background','rgba(255,255,255,.08)');
      if (action) await action.setStyle('background','rgba(65,55,90,.85)');
      shell.hoverAction = action;
    }
    const rect = await omniInspectHistoryLayout(shell,nxInspectSurface.fullscreen);
    const hovered = !!rect && event.clientX>=rect.left && event.clientX<=rect.right && event.clientY>=rect.top && event.clientY<=rect.bottom;
    if (!inspectOpen || gen !== t._inspectGen || hovered === shell.historyHover) return;
    shell.historyHover = hovered;
    for (const el of shell.historyChrome) await el.setStyle('opacity',hovered?'1':'0');
  } finally {
    shell.historyHoverBusy = false;
    if (shell.historyPointer) void omniInspectHistoryHover(shell.historyPointer);
  }
}
async function omniInspectHistoryTouch(event) {
  if(!omniTouchMedia?.matches || !nxInspectShell?.historyLayer)return false;
  const shell=nxInspectShell,gen=t._inspectGen;
  const rect=await omniInspectHistoryLayout(shell,nxInspectSurface.fullscreen);
  if(!inspectOpen || gen!==t._inspectGen || !rect || event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom)return false;
  // Join fullscreen's existing paint queue so an old touch timeout cannot
  // overwrite a newly opened image while SafeDOM writes are still in flight.
  const paint=nxInspectPaint.then(async()=>{
    if(!inspectOpen || gen!==t._inspectGen)return false;
    clearTimeout(shell.historyTouchTimer);shell.historyHover=true;
    await nxInspectSurface.fullscreen.setAttribute('x-inray-touch','1');
    await Promise.all(shell.historyChrome.map(el=>el.setStyle('opacity','1')));
    shell.historyTouchTimer=setTimeout(()=>{
      shell.historyTouchTimer=null;
      nxInspectPaint=nxInspectPaint.then(async()=>{
        if(!inspectOpen || gen!==t._inspectGen)return;
        shell.historyHover=false;
        await nxInspectSurface.fullscreen.setAttribute('x-inray-touch','0');
        await Promise.all(shell.historyChrome.map(el=>el.setStyle('opacity','0')));
      }).catch(error=>y('warn','inspect.touch.hide',String(error)));
    },2000);
    return true;
  });
  nxInspectPaint=paint.catch(()=>{});return paint;
}
async function omniInspectHistoryAction(action, card) {
  if (!card || actionCard !== card || !inspectOpen) return;
  if (action === 'pin') {
    const result = await K('/v1/cards/' + encodeURIComponent(card.id) + '/pin', {method:'POST',body:{}});
    if (result?.ok === false) throw new Error(result.error?.message || '고정 실패');
    return;
  }
  const rows = await omniHistoryRows(card.id), index = rows.findIndex(row => row.id === card.id);
  const next = rows[Math.max(0, Math.min(rows.length - 1, index + (action === 'prev' ? -1 : 1)))];
  if (!next || next.id === card.id || actionCard !== card || !inspectOpen) return;
  const src = await globalThis.__INLAY_NATIVE__.ensureImageUrl(next.id);
  if (!src || actionCard !== card || !inspectOpen) return;
  // The open image mirror is independent of the message; only pin writes chat.
  await t._nxInspectOpener({...card, id:next.id, _nxHistorySrc:src}, next.asset_name, null);
}

let omniChatScaleApplied, omniChatScaleRequested, omniChatScalePainting;
async function omniApplyChatScale() {
  omniChatScaleRequested = Math.max(25, Math.min(200, Number(t.backendSettings?.card?.inline_chat_scale_pct) || 100));
  if (omniChatScalePainting) return omniChatScalePainting;
  omniChatScalePainting = (async () => {
    while (omniChatScaleApplied !== omniChatScaleRequested) {
      const scale = omniChatScaleRequested;
      if (!await omniPaintChatScale(scale)) return;
      omniChatScaleApplied = scale;
    }
  })().finally(() => { omniChatScalePainting = null; });
  return omniChatScalePainting;
}
async function omniPaintChatScale(scale) {
  const doc = t.hostDoc || await ue(); if (!doc) return false;
  const nodes = await nxUnwrapSafeNodes(await doc.querySelectorAll('[data-inray-bake],[x-inray-bake],.omni-spinner,[data-inray-spinner],[data-inlay-inline-stack]'));
  try {
    for (const node of nodes) {
      const clip = await node.querySelector('[data-inray-history-host],.inray-clip,.x-risu-inray-clip');
      try {
        // SafeElement rejects ordinary attributes and does not wrap SVG nodes.
        const html = await node.getOuterHTML();
        const image = html.match(/<img\b[^>]*>/i)?.[0] || html.match(/<svg\b[^>]*x-inray-spinner-wheel[^>]*>/i)?.[0] || '';
        const width = Number(nxFloatHtmlAttr(image, 'width'));
        const height = Number(nxFloatHtmlAttr(image, 'height'));
        if (!width || !height) continue;
        const frame = clip || node;
        // SafeElement.setStyle assigns style[property], which cannot set CSS variables.
        const style = (await frame.getStyleAttribute()).replace(/(?:^|;)\s*(?:width|max-width|max-height|--inray-native-width)\s*:[^;]*/g,'');
        await frame.setStyleAttribute(`${style};width:min(${Math.min(100,scale)}%,var(--inray-desktop-width,100%));--inray-native-width:${Math.min(width,640,780*width/height)*scale/100}px;max-width:100%;max-height:none`);
      } finally { await omniRelease(clip); }
    }
    return true;
  } finally { for (const node of nodes) await omniRelease(node); }
}
