/** SafeDOM hit tests may finish after release; physical pointer state owns timers. */
export function repairGestures(source) {
  let out=source;
  const once=(needle,value)=>{
    if(out.split(needle).length!==2)throw Error('[gestures] drift: '+needle.slice(0,100));
    out=out.replace(needle,()=>value);
  };
  once('    let pointerGesture = null, mobilePress = null,', '    let nxPhysical=null,nxPointerWork=Promise.resolve();\n    let pointerGesture = null, mobilePress = null,');
  once('    }, p = async (f) => {', `    }, p = f => {
      if(!nxPhysical || !nxPhysical.held.size) {
        if(nxPhysical)nxPhysical.cancelled=true;
        cancelMobilePress();
        nxPhysical={held:new Set(),starts:new Map(),cancelled:false,at:Date.now(),x:f.clientX,y:f.clientY,movement:0};
      }
      const physical=nxPhysical;physical.held.add(f.pointerId??0);physical.starts.set(f.pointerId??0,{x:f.clientX,y:f.clientY});
      nxPointerWork=nxPointerWork.catch(()=>{}).then(()=>resolvePointerDown(f,physical));
      return nxPointerWork;
    }, resolvePointerDown = async (f,physical) => {
      if(physical.cancelled || physical!==nxPhysical)return;`);
  once('    }, l = async (f) => {', `    }, l = async (f) => {
      if(nxPhysical && typeof f.clientX==='number' && typeof f.clientY==='number') {
        const origin=nxPhysical.starts.get(f.pointerId??0)||nxPhysical;
        nxPhysical.movement=Math.max(nxPhysical.movement,Math.hypot(f.clientX-origin.x,f.clientY-origin.y));
        if(nxPhysical.movement>10){nxPhysical.cancelled=true;cancelMobilePress();}
      }`);
  once('    }, onPointerUp = async (f) => {', `    }, onPointerUp = async (f) => {
      const physical=nxPhysical;
      physical?.held.delete(f.pointerId??0);
      if(mobilePress?.timer){clearTimeout(mobilePress.timer);mobilePress.timer=null;}
      await nxPointerWork.catch(()=>{});
      if(physical!==nxPhysical)return;
      if(physical?.cancelled){cancelMobilePress();return;}`);
  const a=out.indexOf('    }, onPointerCancel = (f) => {'),b=out.indexOf('    }, m = async () => {',a);
  if(a<0||b<0)throw Error('[gestures] cancel drift');
  out=out.slice(0,a)+`    }, onPointerCancel = () => {
      if(nxPhysical){nxPhysical.cancelled=true;nxPhysical.held.clear();}
      cancelMobilePress();pointerGesture=null;pinClick=null;pendingSheetHit=null;t._msgChipPress=null;
`+out.slice(b);
  once('      const onActive = () => {\n        if (t.uiOpen) return;', '      const onActive = () => {\n        if(nxPhysical){nxPhysical.cancelled=true;nxPhysical.held.clear();}cancelMobilePress();\n        if (t.uiOpen) return;');
  once('    const PRESS_MS = 420;', '    const PRESS_MS = 550;');
  once('if (!F || F.timer || F.long || !nxInspectAllowed()) return;', 'if (!F || F.timer || F.long || physical.cancelled || !physical.held.size || physical!==nxPhysical || !nxInspectAllowed()) return;');
  once('if (mobilePress !== F || !nxInspectAllowed()) return;', 'if (mobilePress !== F || physical.cancelled || !physical.held.size || physical!==nxPhysical || !nxInspectAllowed()) return;');
  once('        }, PRESS_MS);', '        }, Math.max(0,PRESS_MS-(Date.now()-physical.at)));');
  once('if (mobilePress === F) F.long = !0;', 'if (mobilePress === F && !physical.cancelled && physical.held.size && physical===nxPhysical) F.long = !0;');
  once('          if (mobilePress !== F) return;\n          F.long = !0;', '          if (mobilePress !== F || physical.cancelled || !physical.held.size || physical!==nxPhysical) return;\n          F.long = !0;');
  // The button can cease to be :active before the host responds to the query.
  once(`  const nodes=await nxUnwrapSafeNodes(await doc.querySelectorAll('[x-omni-action]:is(:active,:focus-visible)'));`, `  const footers=await nxUnwrapSafeNodes(await doc.querySelectorAll('[x-omni-footer]'));
  const nodes=[];
  for(const footer of footers)if(await hitEl(footer,x,y))nodes.push(...await nxUnwrapSafeNodes(await footer.querySelectorAll('[x-omni-action]')));`);
  for(const name of ['fs','refresh'])once(`:is([x-inray-${name}],[data-inray-${name}]):active`,`:is([x-inray-${name}],[data-inray-${name}])`);
  once('inspectGuardUntil = Date.now() + 400;', 'inspectGuardUntil = 0;');
  // Freshly generated images need not already belong to the settings gallery cache.
  const card='const card = (t.gallery || []).find((c) => String(c?.id || "") === String(cardId || ""));';
  if(out.split(card).length!==3)throw Error('[gestures] inline card drift');
  out=out.split(card).join(card.slice(0,-1)+' || (cardId && !cardId.startsWith("pending_") ? {id:cardId} : null);');
  once('            if (await nxFireTap(card, node)) return;', '            if(physical.cancelled || physical!==nxPhysical)return;\n            if (await nxFireTap(card, node)) return;');
  once('              await nxOpenAssetInspect(card, fsAsset);', '              if(physical.cancelled || physical!==nxPhysical)return;\n              await nxOpenAssetInspect(card, fsAsset);');
  return out;
}
