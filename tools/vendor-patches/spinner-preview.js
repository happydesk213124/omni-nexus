  const nxSpinnerPreviews=new Map();
  const nxClosedSpinnerPreviews=new Set();
  let nxSpinnerPreviewPainting=null, nxSpinnerPreviewDirty=false, nxSpinnerPreviewTimer=null;
  function nxScheduleSpinnerPreviews() {
    if(t.unloading || !nxSpinnerPreviews.size || nxSpinnerPreviewTimer)return;
    nxSpinnerPreviewTimer=setTimeout(()=>{
      nxSpinnerPreviewTimer=null;
      void nxPaintSpinnerPreviews().catch(error=>y('warn','spinner.preview',String(error)));
    },120);
  }
  function nxDisposeSpinnerPreviews() {
    clearTimeout(nxSpinnerPreviewTimer);nxSpinnerPreviewTimer=null;
    nxSpinnerPreviews.clear();nxSpinnerPreviewDirty=false;
  }
  function nxPreviewFrameSelector(key,row) {
    const message='.risu-chat[data-chat-index="'+row.messageIndex+'"] ';
    const missing=':not(:has([x-omni-preview="'+row.cardId+'"]))';
    return ['.x-risu-omni-spinner[data-shot="'+key+'"]','.omni-spinner[data-shot="'+key+'"]','[data-inray-spinner="'+key+'"]']
      .map(selector=>message+selector+missing).join(',');
  }
  async function nxPaintSpinnerPreviewPass() {
    const doc=t.hostDoc || t.overlayUi?.doc;
    if(!doc || t.unloading || !nxSpinnerPreviews.size)return;
    const rows=new Map(nxSpinnerPreviews);
    const refs=omniDomScope();
    try {
      // A job/shot token identifies the exact reserved slot across chat changes.
      // Completed frames are filtered in the host: no character/chat snapshot,
      // per-image selector calls, or base64 markup reads for unchanged images.
      const selector=[...rows].map(([key,row])=>nxPreviewFrameSelector(key,row)).join(',');
      const frames=await refs.all(await doc.querySelectorAll(selector));
      for(const frame of frames) {
        // SafeElement only allows x-* attribute reads. These are unpainted
        // frames, so their small opening tag gives us the parser-owned token.
        const opening=String(await frame.getOuterHTML()).split('>')[0];
        const key=/\bdata-(?:shot|inray-spinner)="([a-zA-Z0-9_-]+)"/.exec(opening)?.[1];
        const row=rows.get(key);
        if(!row || nxSpinnerPreviews.get(key)!==row || t.unloading)continue;
        try {
          const old=refs.own(await frame.querySelector('[x-omni-preview]'));
          const layer=refs.own(await H(doc,'div',{html:'<img alt="" src="'+row.url+'" style="display:block;width:100%;height:100%;max-width:100%;max-height:100%;margin:0;object-fit:contain;border-radius:10px">'}));
          await layer.setAttribute('x-omni-preview',row.cardId);
          await layer.setStyleAttribute('position:absolute;inset:0;overflow:hidden;border-radius:10px;pointer-events:none;background:#101620');
          if(nxSpinnerPreviews.get(key)!==row || t.unloading){await layer.remove();continue;}
          if(old)await old.remove();
          if(nxSpinnerPreviews.get(key)!==row || t.unloading){await layer.remove();continue;}
          await frame.appendChild(layer);
          row.painted=true;row.failureStage='';
        } catch {
          if(row.failureStage!=='insert')y('warn','spinner.preview','insert job='+row.jobId+' shot='+row.shot);
          row.failureStage='insert';
        }
      }
      for(const [key,row] of rows) {
        if(nxSpinnerPreviews.get(key)===row && !row.painted && !row.failureStage) {
          row.failureStage='slot';y('warn','spinner.preview','slot job='+row.jobId+' shot='+row.shot);
        }
      }
    } finally {await refs.close();}
  }
  function nxPaintSpinnerPreviews() {
    if(t.unloading || !nxSpinnerPreviews.size)return Promise.resolve();
    clearTimeout(nxSpinnerPreviewTimer);nxSpinnerPreviewTimer=null;
    nxSpinnerPreviewDirty=true;
    if(!nxSpinnerPreviewPainting) {
      nxSpinnerPreviewPainting=Promise.resolve().then(async()=>{
        while(nxSpinnerPreviewDirty && nxSpinnerPreviews.size && !t.unloading) {
          nxSpinnerPreviewDirty=false;
          await nxPaintSpinnerPreviewPass();
        }
      }).finally(()=>{nxSpinnerPreviewPainting=null;});
    }
    return nxSpinnerPreviewPainting;
  }
  globalThis.__OMNI_SPINNER_PREVIEW__=async row=>{
    if(t.unloading || nxClosedSpinnerPreviews.has(row.jobId))return;
    if(!/^[a-zA-Z0-9_-]+$/.test(row.jobId) || !/^[a-zA-Z0-9_-]+$/.test(row.cardId) || !Number.isInteger(row.shot) || row.shot<0 || !Number.isInteger(row.messageIndex) || row.messageIndex<0 || !/^data:image[/](png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(row.url)) {
      y('warn','spinner.preview','invalid payload');return;
    }
    const first=!nxSpinnerPreviews.size;
    const key=row.jobId+'_'+row.shot,old=nxSpinnerPreviews.get(key);
    if(old?.cardId===row.cardId && old.url===row.url)return;
    nxSpinnerPreviews.set(key,{...row});
    await omniMountFooters();
    if(first)await omniStreamObservers();
    await nxPaintSpinnerPreviews();
  };
  globalThis.__OMNI_CLEAR_SPINNER_PREVIEW__=async jobId=>{
    nxClosedSpinnerPreviews.add(jobId);if(nxClosedSpinnerPreviews.size>128)nxClosedSpinnerPreviews.delete(nxClosedSpinnerPreviews.values().next().value);
    for(const [key,row] of nxSpinnerPreviews)if(row.jobId===jobId)nxSpinnerPreviews.delete(key);
    if(!nxSpinnerPreviews.size){clearTimeout(nxSpinnerPreviewTimer);nxSpinnerPreviewTimer=null;}
    await omniStreamObservers();
  };
