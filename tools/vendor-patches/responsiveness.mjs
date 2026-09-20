import { readFileSync } from 'node:fs';
export function repairResponsiveness(source) {
  let out=source;
  const once=(needle,replacement)=>{
    if(out.split(needle).length!==2)throw Error('[responsiveness] drift: '+needle.slice(0,100));
    out=out.replace(needle,()=>replacement);
  };
  const region=(start,end,replacement)=>{
    const a=out.indexOf(start),b=out.indexOf(end,a);
    if(a<0||b<0||out.indexOf(start,a+1)>=0)throw Error('[responsiveness] region drift: '+start);
    out=out.slice(0,a)+replacement+out.slice(b);
  };
  // The preview moved tiles out of the vendor's chip row.
  region('    }), (() => {\n      const row = document.querySelector(".preset-chip-row");',
    '    })(), document.getElementById("nx-preset-second")',
    '    }), (() => {\n'+readFileSync(new URL('./preset-order.js',import.meta.url),'utf8')+'\n');
  // One prompt writer owns drafts and persistence; the old one PUT every prompt.
  region('    }), document.querySelectorAll("textarea[id^=\'nx-prompt-\']").forEach((box) => {',
    '    }), document.getElementById("nx-nai-ref-pick")', '    }), [null].forEach(() => {');
  once('  function oe(e) {\n    return [...document.querySelectorAll(`[data-char-scope="${e}"]`)].map',
    '  function oe(e, only) {\n    return (only ? [only] : [...document.querySelectorAll(`[data-char-scope="${e}"]`)]).map');
  once('characters: oe("session"), global: oe("global") }, scope);\n        const merge=',
    'characters: t.charactersSession, global: t.charactersGlobal }, scope);\n        const node=field.closest(".char-card[data-char-id]"), kind=node.dataset.charScope;\n        const changed=oe(kind,node)[0];\n        if(changed){const key=kind==="global"?"global":"characters";body[key]=(body[key]||[]).map(row=>row.id===changed.id?{...row,...changed}:row);}\n        const merge=');
  once('const key = field.id.slice("nx-prompt-".length), text = field.value || "";',
    'const key = field.id.slice("nx-prompt-".length), text = field.value || "";\n        t.promptDrafts[key]=text;');
  once('shell.addEventListener("input", event => {\n      const field = event.target;',
    'shell.addEventListener("input", event => {\n      if(event.isComposing)return;\n      const field = event.target;');
  once('      }, 300));\n    };\n    shell.addEventListener', '      }, 1000));\n    };\n    shell.addEventListener');
  once('      const tasks = [...pending.values()]; pending.clear();\n      for (const task of tasks) live.writes = live.writes.catch(()=>{}).then(task);\n      await live.writes;', `      const tasks=[...pending.entries()];pending.clear();const failures=[];
      for(const [key,task] of tasks)live.writes=live.writes.catch(()=>{}).then(async()=>{
        try{await task();}catch(error){if(!pending.has(key))pending.set(key,task);failures.push(error);}
      });
      await live.writes;if(failures.length)throw failures[0];`);
  // Failed writes stay retryable; a later edit of the same key wins.
  once('live.writes = live.writes.catch(() => {}).then(work).then(() => $e("저장됨"), err => $e("저장 실패: " + z(err?.message || err), !1));',
    'live.writes = live.writes.catch(() => {}).then(work).then(() => $e("저장됨"), err => {if(!pending.has(key))pending.set(key,work);$e("저장 실패: " + z(err?.message || err), !1);});');
  once('    const saveHabitCard = () => {', `    shell.addEventListener("compositionend",event=>event.target.dispatchEvent(new Event("input",{bubbles:true})));
    shell.addEventListener("focusout",()=>{void flush().catch(err=>$e(String(err),!1));});
    const saveHabitCard = () => {`);
  // Generic settings collection is deferred as well; searching never saves settings.
  once('      const o = (a) => {\n        if (t._uiRendering || !t.uiOpen) return;',
    '      const collect = (a) => {\n        if (t._uiRendering || !t.uiOpen) return;');
  once('        const i = {}, s = Mt(), c = Ct(), l = ba();',
    '        if(/^nx-prompt-|search/i.test(r.id)||r.closest?.(".char-card,#nx-char-edit-body")||/검색/.test(r.placeholder||""))return;\n        const i = {}, s = Mt(), c = Ct(), l = ba();');
  once('      n.addEventListener("input", o), n.addEventListener("click", (a) => {', `      let last=null,timer=0;
      const flush=()=>{clearTimeout(timer);timer=0;if(last){const event=last;last=null;collect(event);}};
      t._flushSettingsFields=flush;
      const o=event=>{if(event.isComposing)return;last={target:event.target};clearTimeout(timer);timer=setTimeout(flush,1000);};
      n.addEventListener("focusout",flush);
      n.addEventListener("compositionend",o);
      n.addEventListener("input", o), n.addEventListener("click", (a) => {`);
  once('o.preventDefault(), o.stopPropagation(), t.uiTab = r;',
    'o.preventDefault(), o.stopPropagation(); t._flushSettingsFields?.(); void globalThis.__OMNI_FLUSH_CHARACTERS__?.().catch(err=>$e(String(err),!1)); t.uiTab = r;');
  // A tab shell never waits for image previews. Only the still-active tab repaints.
  once('    if(await globalThis.__INLAY_NATIVE__?.hydrateSettingsPreviews?.(t.uiTab))await le();','');
  once('    if(t.uiOpen && await globalThis.__INLAY_NATIVE__?.hydrateSettingsPreviews?.(t.uiTab))await le();', `    const previewTab=t.uiTab;
    const loading=t._previewHydrating||(t._previewHydrating=new Set());
    if(t.uiOpen && !loading.has(previewTab)){loading.add(previewTab);
      void Promise.resolve(globalThis.__INLAY_NATIVE__?.hydrateSettingsPreviews?.(previewTab)).then(async changed=>{
        if(!changed)return;
        const settings=(await K("/v1/settings",{method:"GET"}))?.settings;
        for(const row of t.backendSettings?.card?.presets||[]){
          const fresh=settings?.card?.presets?.find(p=>p.id===row.id);if(!fresh)continue;
          if(fresh.look_hash===row.look_hash && fresh.look_preview_url)row.look_preview_url=fresh.look_preview_url;
          if(fresh.vibe_configured===row.vibe_configured && fresh.vibe_preview_url)row.vibe_preview_url=fresh.vibe_preview_url;
        }
        if(!t.uiOpen||t.uiTab!==previewTab)return;
        const paint=(slot,url)=>{if(!slot||!url)return;let img=slot.querySelector('img');if(!img){img=document.createElement('img');img.alt='';slot.prepend(img);}if(img.src!==url)img.src=url;};
        for(const tile of document.querySelectorAll('[data-preset-select]'))paint(tile,t.backendSettings?.card?.presets?.find(p=>p.id===tile.getAttribute('data-preset-select'))?.look_preview_url);
        const active=t.backendSettings?.card?.presets?.find(p=>presetIdEq(p.id,resolveActivePresetId(t.backendSettings.card)));
        paint(document.getElementById('nx-preset-look-thumb'),active?.look_preview_url);
        paint(document.getElementById('nx-preset-vibe-preview'),active?.vibe_preview_url);
        paint(document.getElementById('nx-nai-ref-preview'),globalThis.__INLAY_NATIVE__?.refPreviewUrl?.());
        paint(document.getElementById('nx-nai-vibe-preview'),globalThis.__INLAY_NATIVE__?.vibePreviewUrl?.());
      }).catch(err=>y("warn","preview.load",String(err))).finally(()=>{loading.delete(previewTab);});}`);
  // Preserve the filename cast identity, not just the display name.
  once('body: { ids } }, 1.5e4) : {};', 'body: { ids, details:true } }, 1.5e4) : {};');
  once('view.characters = ids.map(id => ({ name: String(names[id] || ""), cast_id: id }));',
    'view.characters = ids.map(id => names.characters?.find(row=>row.cast_id===id) || {name:"",cast_id:id});');
  for(const slot of ['idx','charI']) {const pad=slot==='idx'?'        ':'            ';once(pad+'roster: Dt(name),\n'+pad+'index: '+slot,pad+'roster: raw?.id ? raw : Dt(name),\n'+pad+'id:raw?.id, scope:raw?.scope,\n'+pad+'index: '+slot);}
  once('  async function xa(opts) {', '  async function xa(opts) {\n    t._flushSettingsFields?.();await globalThis.__OMNI_FLUSH_CHARACTERS__?.();');
  once('    if (!Array.isArray(t.charCatalog) || !t.charCatalog.length) {\n      await Promise.race([catalogP, new Promise((ok) => setTimeout(ok, 600))]);\n    }', '');
  once('        const me = Dt(J);', '        const me = B?.id ? B : Dt(J);');
  once('        entry.roster = Dt(entry.name) || entry.roster;', '        entry.roster = entry.roster?.id ? entry.roster : Dt(entry.name);');
  once('      void ensureViewerRosterLoaded().catch(() => null);\n      const idx =', '      const idx =');
  once('          void ensureViewerRosterLoaded().catch(() => null);\n          const raw =', '          const raw =');
  once('    const opened = globalThis.__INLAY_SETTINGS_UX__?.openCharacterEditor?.(e || {});\n    if (!opened) $e("캐릭터 목록에서 수정할 대상을 선택하세요.");', `    let opened = globalThis.__INLAY_SETTINGS_UX__?.openCharacterEditor?.(e || {});
    if(!opened){
      const scope=t.lastScope?.sessionId,revision=t._omniRosterRevision||0,token=(t._castEditorOpen||0)+1;t._castEditorOpen=token;
      const rows=await K('/v1/characters?session_id='+encodeURIComponent(scope||e?.scope||e?.roster?.scope||''));
      if(!t.uiOpen||t.uiTab!=='characters'||t.lastScope?.sessionId!==scope||t._castEditorOpen!==token||(t._omniRosterRevision||0)!==revision)return;
      if(Array.isArray(rows?.characters))t.charactersSession=rows.characters;
      if(Array.isArray(rows?.global))t.charactersGlobal=rows.global;
      await P();opened=globalThis.__INLAY_SETTINGS_UX__?.openCharacterEditor?.(e||{});
    }
    if (!opened) $e("캐릭터 목록에서 수정할 대상을 선택하세요.");`);
  once('enqueue("prompt:" + key, () => K("/v1/prompts/" + encodeURIComponent(key), { method: "PUT", body: { text } }));',
    'enqueue("prompt:" + key, async () => {await K("/v1/prompts/" + encodeURIComponent(key), { method: "PUT", body: { text } });const row=t.prompts?.find(p=>p.key===key);if(row)row.text=text;});');
  once('          if (r) t.promptDrafts[key] = i;\n          await K(', '          if (r) t.promptDrafts[key] = i;\n          if(i===String(a.text||""))continue;\n          await K(');
  once('  async function flushSettingsSave() {', '  async function flushSettingsSave() {\n    t._flushSettingsFields?.();');
  return out;
}
