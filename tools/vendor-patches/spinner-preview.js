  // Generated images show in their slot before the reply is saved. They are CSS,
  // not inserted nodes: Risu rebuilds a streaming message on every chunk, which
  // removed an inserted <img> until it was put back (a flicker, and bridge calls
  // per chunk). One <style> per image lives outside the chat, so a rebuilt,
  // scrolled-back or remounted slot shows its image the moment it exists.
  // Kept empty: nothing has to be repainted when the chat changes.
  const nxSpinnerPreviews=new Map();
  const nxPreviewRules=new Map();
  const nxClosedSpinnerPreviews=new Set();
  const NX_PREVIEW_SWEEP_MS=2000, NX_PREVIEW_KEEP_MS=5*60*1000;
  let nxPreviewTail=Promise.resolve(), nxPreviewSweep=null;
  function nxScheduleSpinnerPreviews() {}
  function nxPaintSpinnerPreviews() { return Promise.resolve(); }
  function nxPreviewQueue(work) {
    const next=nxPreviewTail.catch(()=>{}).then(work);
    nxPreviewTail=next.catch(()=>{});
    return next;
  }
  function nxPreviewSelectors(key,row) {
    // Scoped to the message: a job/shot token, or a streaming-tag block not saved yet.
    const message='.risu-chat[data-chat-index="'+row.messageIndex+'"] ';
    // A pink slot drawn by a tap or a long press shows its image before it is written.
    // A tag job's own slots are pink from the start, named by the same key.
    return ['[data-inray-spinner="'+key+'"]','[data-shot="'+key+'"]','[data-inray-wait="'+key+'"]',...(Number.isInteger(row.inlineSlot)?['[data-inx-slot="'+row.inlineSlot+'"]']:[]),...(row.waitSlot?['[data-inray-wait="'+row.waitSlot+'"]']:[])].map(selector=>message+selector);
  }
  function nxPreviewCss(key,row) {
    const slots=nxPreviewSelectors(key,row);
    // The frame keeps its size; the image fits inside it and the wheel hides.
    return slots.join(',')+'{background:#101620 url("'+row.url+'") center/contain no-repeat!important}'+slots.map(s=>s+' svg').join(',')+'{opacity:0!important}';
  }
  async function nxDropPreview(key) {
    const rule=nxPreviewRules.get(key);if(!rule)return;
    nxPreviewRules.delete(key);
    try {await rule.style.remove();} catch {}
    await omniRelease(rule.style);
  }
  function nxDisposeSpinnerPreviews() {
    clearInterval(nxPreviewSweep);nxPreviewSweep=null;
    const keys=[...nxPreviewRules.keys()];
    void nxPreviewQueue(async()=>{for(const key of keys)await nxDropPreview(key);});
  }
  // A finished job's rule stays until its slot is gone (baked, or the message
  // left): line batches save all their images in one later write, and dropping
  // the rule before that would show the wheel again in between.
  function nxSweepPreviews() {
    if(nxPreviewSweep)return;
    nxPreviewSweep=setInterval(()=>{void nxPreviewQueue(async()=>{
      const doc=t.hostDoc || t.overlayUi?.doc;
      const closing=[...nxPreviewRules].filter(([,rule])=>rule.closedAt);
      if(!closing.length || t.unloading){clearInterval(nxPreviewSweep);nxPreviewSweep=null;return;}
      for(const [key,rule] of closing) {
        const slot=doc ? await doc.querySelector(nxPreviewSelectors(key,rule.row).join(',')) : null;
        if(!slot || Date.now()-rule.closedAt>NX_PREVIEW_KEEP_MS)await nxDropPreview(key);
        await omniRelease(slot);
      }
    });},NX_PREVIEW_SWEEP_MS);
  }
  globalThis.__OMNI_SPINNER_PREVIEW__=async row=>{
    if(t.unloading || nxClosedSpinnerPreviews.has(row.jobId))return;
    if(!/^[a-zA-Z0-9_-]+$/.test(row.jobId) || !/^[a-zA-Z0-9_-]+$/.test(row.cardId) || !Number.isInteger(row.shot) || row.shot<0 || !Number.isInteger(row.messageIndex) || row.messageIndex<0 || !/^data:image[/](png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(row.url) || (row.inlineSlot!==undefined && !(Number.isInteger(row.inlineSlot) && row.inlineSlot>0)) || (row.waitSlot!==undefined && !/^[a-zA-Z0-9_-]{1,64}$/.test(row.waitSlot))) {
      y('warn','spinner.preview','invalid payload');return;
    }
    const key=row.jobId+'_'+row.shot;
    await nxPreviewQueue(async()=>{
      const old=nxPreviewRules.get(key);
      if(old?.row.cardId===row.cardId && old.row.url===row.url)return;
      let doc=t.hostDoc || t.overlayUi?.doc;
      if(!doc){await omniMountFooters();doc=t.hostDoc || t.overlayUi?.doc;}
      if(!doc || t.unloading || nxClosedSpinnerPreviews.has(row.jobId))return;
      // Each image crosses the bridge once, in its own rule; a slot that is not
      // drawn yet (a line batch before its slots are written) matches nothing until it is.
      const style=old?.style || await doc.createElement('style');
      await style.setTextContent(nxPreviewCss(key,row));
      if(!old) {
        const body=await doc.querySelector('body');
        try {if(!body)return;await body.appendChild(style);}
        finally {await omniRelease(body);}
      }
      nxPreviewRules.set(key,{row:{jobId:row.jobId,shot:row.shot,cardId:row.cardId,messageIndex:row.messageIndex,inlineSlot:row.inlineSlot,waitSlot:row.waitSlot,url:row.url},style,closedAt:0});
    });
  };
  globalThis.__OMNI_CLEAR_SPINNER_PREVIEW__=async jobId=>{
    nxClosedSpinnerPreviews.add(jobId);if(nxClosedSpinnerPreviews.size>128)nxClosedSpinnerPreviews.delete(nxClosedSpinnerPreviews.values().next().value);
    await nxPreviewQueue(async()=>{for(const rule of nxPreviewRules.values())if(rule.row.jobId===jobId && !rule.closedAt)rule.closedAt=Date.now();});
    nxSweepPreviews();
  };
  // A rule needs no repaint when slots appear; kept for callers.
  globalThis.__OMNI_REPAINT_SPINNER_PREVIEWS__=async()=>{};
