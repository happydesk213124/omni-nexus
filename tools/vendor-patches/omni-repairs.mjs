import { repairGestures } from './gesture-repairs.mjs';
import { repairResponsiveness } from './responsiveness.mjs';
import { rebuildMessageRuntime } from './runtime-rebuild.mjs';
import { readFileSync } from 'node:fs';
import { repairInspectFullscreen, repairAsyncInspect, repairInspectCloseNow, repairInspectGuardClose, repairInspectGuardCloseUp } from './inspect.mjs';
/** Final asserted compatibility repairs: preview owns markup, legacy functions own behavior. */
export function repairOmniUi(source) {
  let out = source;
  const replace = (needle, patch, count = 1) => {
    const found = out.split(needle).length - 1;
    if (found !== count) throw new Error(`[omni repair] expected ${count}, got ${found}: ${needle.slice(0,100)}`);
    out = out.split(needle).join(patch);
  };
  replace('        R && (R.innerHTML = u);', '        if (R) globalThis.__INLAY_SETTINGS_UX__.replaceMain(R, u, t.uiTab);');
  const loreRuntime = ['character-lore-render.js', 'character-lore.js'].map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
  replace('  async function P() {', loreRuntime + '\n  async function P() {');
  replace('], t._charsDirty = !0, await P();', `], t._charsDirty = !0;
      await P();
      // Optimistic add: the row is already painted above. Persist in the
      // background so the click feels instant; the buttons show busy meanwhile.
      void (async () => {
        const spin=[document.getElementById("nx-char-add-session"),document.getElementById("nx-char-add-global")].filter(b=>b);
        const orig=spin.map(b=>b.textContent);
        for(const b of spin){b.disabled=true;b.textContent="추가 중…";}
        try {
          await globalThis.__OMNI_FLUSH_CHARACTERS__?.();
          const scope = await Z();
          const saved = await K("/v1/characters", { method:"POST", body:withRootSessions({session_id:scope.sessionId, character_id:scope.characterId, characters:t.charactersSession, global:t.charactersGlobal},scope) });
          t.charactersSession = saved?.characters || t.charactersSession;
          t.charactersGlobal = saved?.global || t.charactersGlobal;
          t._charsDirty = !1;
          await P();
        } catch(err) {
          t.uiMessage = { type: "error", text: String(err?.message || err) };
          await P();
        } finally {
          spin.forEach((b,i)=>{if(b.isConnected){b.disabled=false;b.textContent=orig[i];}});
        }
      })();`, 2);
  // Vendor oe() never learned our bottoms slot: our editor renders
  // data-char-bottoms but the collector only forwarded attire/accessories,
  // so 하의 edits died on save. Backend upsert already accepts bottoms.
  replace('        attire: String(l).trim(),\n        accessories: String(acc).trim(),', `        attire: String(l).trim(),
        bottoms: String(n.querySelector("[data-char-bottoms]")?.value || "").trim(),
        accessories: String(acc).trim(),`);
  replace('통합 챗에 모인 캐릭터가 없습니다. 채팅을 고른 뒤 다시 통합 챗을 선택하세요.', '아직 로스터가 없습니다.');
  // A body-mounted lightbox outlived the shell and duplicated its IDs on repaint.
  replace('  async function P() {', `  async function P() {
    closeExplorerLightbox();
    const existingLightboxes = [...document.querySelectorAll("#nx-explorer-lightbox")];
    if (existingLightboxes[0]) document.body.appendChild(existingLightboxes[0]);
    existingLightboxes.slice(1).forEach(node => node.remove());`);
  replace('  function closeExplorerLightbox() {', `  function closeExplorerLightbox() {
    t._explorerLbGen = (t._explorerLbGen || 0) + 1;
    t._explorerLbItems = null;
    document.querySelectorAll("#nx-explorer-lightbox").forEach(node => {
      node.classList.remove("show"); node.querySelector("img")?.removeAttribute("src");
    });`);
  const lbStart=out.indexOf('    const lb = document.getElementById("nx-explorer-lightbox");\n    if (lb && !lb.dataset.nxBound)');
  const lbEnd=out.indexOf('    if (!t._explorerKeysBound)',lbStart);
  if(lbStart<0 || lbEnd<0)throw new Error('[omni repair] lightbox binding drift');
  let lbBlock=out.slice(lbStart,lbEnd);
  lbBlock=lbBlock.replaceAll('document.getElementById("nx-lb-', 'lb.querySelector("#nx-lb-');
  lbBlock=lbBlock.replaceAll('Ze().items','explorerLightboxItems()').replaceAll('typeof Ze == "function" ? Ze().items : []','explorerLightboxItems()');
  out=out.slice(0,lbStart)+lbBlock+out.slice(lbEnd);
  replace('  async function flushDirtyCharacters(sessionId = "") {', '  async function flushDirtyCharacters(sessionId = "") {\n    await globalThis.__OMNI_FLUSH_CHARACTERS__?.();');
  const deleteStart = out.indexOf('document.querySelectorAll("[data-char-delete]").forEach');
  const deleteBody = out.indexOf('        r(i);', deleteStart);
  if (deleteStart < 0 || deleteBody < 0) throw new Error('[omni repair] character delete handler drift');
  out = out.slice(0,deleteBody) + '        await globalThis.__OMNI_FLUSH_CHARACTERS__?.();\n' + out.slice(deleteBody);

  replace('    globalThis.__OMNI_FLUSH_CHARACTERS__ = flush;', `    globalThis.__OMNI_FLUSH_CHARACTERS__ = flush;
    globalThis.__OMNI_CHARACTER_SCOPE__ = () => t.lastScope?.sessionId || "";
    const scopeCache = t._omniRosterCache || (t._omniRosterCache = new Map());
    const deletedByScope = t._omniDeletedIds || (t._omniDeletedIds = new Map());
    const visibleRows = (scope, rows) => (rows || []).filter(row=>!deletedByScope.get(scope)?.has(String(row.id)));
    globalThis.__OMNI_REFRESH_CHARACTER_SCOPE__ = async target => {if(target==="__global__" || t.lastScope?.sessionId===target)await P();};
    globalThis.__OMNI_PATCH_CHARACTER__ = (scope, id, patch) => {
      const apply = rows => { const row = rows?.find(c => String(c.id) === id); if(row) Object.assign(row, patch); };
      if(scope === "__global__") {
        apply(t.charactersGlobal);
        for(const entry of scopeCache.values())apply(entry.global);
      } else {
        if(t.lastScope?.sessionId === scope)apply(t.charactersSession);
        apply(scopeCache.get(scope)?.characters);
      }
    };
    globalThis.__OMNI_FINISH_CHARACTER_DELETE__ = (target, ids) => {
      for(const id of ids)deletedByScope.get(target)?.delete(String(id));
      t._omniRosterRevision=(t._omniRosterRevision||0)+1;
    };
    globalThis.__OMNI_RESTORE_CHARACTER_CACHE__ = (scope, rows, target) => {
      t._omniRosterRevision=(t._omniRosterRevision||0)+1;
      for(const row of rows)deletedByScope.get(target)?.delete(String(row.id));
      const key = scope === "global" ? "charactersGlobal" : "charactersSession";
      const merge = list => [...(list || []), ...rows.filter(row => !(list || []).some(c=>c.id===row.id))];
      if(scope === "global" || t.lastScope?.sessionId === target)t[key] = merge(t[key]);
      const cached = scopeCache.get(target);
      if(scope === "global")for(const entry of scopeCache.values())entry.global=merge(entry.global);
      else if(cached)cached.characters=merge(cached.characters);
    };
    globalThis.__OMNI_SELECT_CHARACTER_SCOPE__ = async value => {
      const token = (t._omniScopeSwitchGen || 0) + 1;
      t._omniScopeSwitchGen = token;
      const old = {scope:t.lastScope, override:t.scopeOverride, characters:t.charactersSession, global:t.charactersGlobal, appearance:t.appearance};
      const draftScope = t.lastScope?.sessionId;
      if(document.querySelector(".char-card[data-char-id]")) {
        const merge = (rows, previous) => rows.map(row=>({...previous?.find(c=>c.id===row.id),...row}));
        old.characters = t.charactersSession = merge(oe("session"), t.charactersSession);
        old.global = t.charactersGlobal = merge(oe("global"), t.charactersGlobal);
      }
      if(draftScope)scopeCache.set(draftScope,{...scopeCache.get(draftScope),characters:old.characters,global:old.global,appearance:old.appearance,dirty:!!t._charsDirty || !!scopeCache.get(draftScope)?.dirty});
      // Flush starts now, but a different bot's read does not wait for host writes.
      const saving = flush();
      saving.catch(err=>$e("저장 실패: "+z(err?.message||err),!1));
      if(value === "__global__") {
        document.getElementById("nx-roster-loading")?.remove();
        document.getElementById("nx-char-session-list")?.removeAttribute("aria-busy");
        document.getElementById("nx-char-edit-body")?.removeAttribute("inert");
        return {ok:!0};
      }
      const target = value === "live" ? Number(await k.getCurrentCharacterIndex()) : Number(value);
      if(!Number.isInteger(target) || target < 0)throw new Error("invalid character scope");
      const pickOpen = !!document.getElementById("nx-risu-pick")?.classList.contains("open");
      const sheetOpen = !!document.getElementById("nx-char-sheet")?.classList.contains("open");
      const render = async () => {
        await P();
        if(token!==t._omniScopeSwitchGen)return;
        if(pickOpen && !document.getElementById("nx-risu-pick")?.classList.contains("open"))document.getElementById("nx-char-risu-open")?.click();
        if(sheetOpen && !document.getElementById("nx-char-sheet")?.classList.contains("open"))document.getElementById("nx-char-edit-btn")?.click();
      };
      try {
        let row = t.charCatalog?.find(c=>c.index===target);
        if(!row?.chaId){ const character=await k.getCharacterFromIndex(target); if(!character)throw new Error("캐릭터를 찾지 못했습니다"); row={index:target,chaId:character.chaId||character.id,name:character.name,character}; }
        const cid=String(row.chaId||""); if(!cid)throw new Error("캐릭터 ID가 없습니다");
        const sid="risu_"+ye(cid+"|__unified__");
        const scope={charIndex:target,chatIndex:"unified",characterId:cid,chatId:"__unified__",sessionId:sid,unifiedSessionId:sid,character:row.character||null,chat:null,characterName:row.name,chatName:"통합 챗",liveChar:!1,liveChat:!1,unified:!0};
        const commit = data => {
          t.scopeOverride={charIndex:target,chatIndex:"unified"}; t.lastScope=scope;
          t.pendingSessionId=""; t.pendingSessionCount=0;
          data={...data,characters:visibleRows(sid,data.characters),global:visibleRows("__global__",data.global)};
          t.charactersSession=data.characters; t.charactersGlobal=data.global; t.appearance=data.appearance||{};
          t._charsDirty=!!data.dirty; scopeCache.set(sid,data);
        };
        const cached=scopeCache.get(sid);
        if(token!==t._omniScopeSwitchGen)return {ok:!0,stale:!0};
        // Repaints with identical data are the selection flicker: skip both.
        // Scope identity is part of the key: two bots with equally empty
        // rosters must still repaint, or the lorebook loader (which rides on
        // the tab render) never notices the switch.
        const shownKey=()=>JSON.stringify([t.lastScope?.sessionId,t.charactersSession,t.charactersGlobal,t.appearance]);
        if(cached){const before=shownKey();commit(cached);if(shownKey()!==before)await render();}
        else {
          const list=document.getElementById("nx-char-session-list");
          list?.setAttribute("aria-busy","true");
          if(list){const wait=document.createElement("div");wait.id="nx-roster-loading";wait.textContent="캐릭터 불러오는 중…";wait.style.cssText="position:absolute;inset:0;z-index:5;display:grid;place-items:center;background:#101620";list.style.position="relative";list.append(wait);}
          document.getElementById("nx-char-edit-body")?.setAttribute("inert","");
        }
        if(sid===draftScope || cached?.dirty)await saving;
        const readRevision=t._omniRosterRevision||0;
        const result=await K("/v1/characters?session_id="+encodeURIComponent(sid)+"&character_id="+encodeURIComponent(cid),{method:"GET"});
        if(token!==t._omniScopeSwitchGen)return {ok:!0,stale:!0};
        if(!Array.isArray(result?.characters) || !Array.isArray(result?.global))throw new Error("캐릭터 목록 응답 오류");
        // A cached form may already contain newer local edits.
        if(!cached || ((t._omniRosterRevision||0)===readRevision && !scopeCache.get(sid)?.dirty)){
          // Same data re-render is the scope-switch flicker: paint only on change.
          const before=shownKey();
          commit(result);
          if(shownKey()!==before || !cached)await render();
        }
        return {ok:!0};
      } catch(error) {
        if(token!==t._omniScopeSwitchGen)return {ok:!1,stale:!0};
        t.lastScope=old.scope; t.scopeOverride=old.override; t.charactersSession=old.characters; t.charactersGlobal=old.global; t.appearance=old.appearance;
        await render(); throw error;
      } finally {
        if(token===t._omniScopeSwitchGen){document.getElementById("nx-roster-loading")?.remove();document.getElementById("nx-char-session-list")?.removeAttribute("aria-busy");document.getElementById("nx-char-edit-body")?.removeAttribute("inert");}
      }
    };
    globalThis.__OMNI_REMOVE_CHARACTER_CACHE__ = (scope, ids, target) => {
      const key = scope === "global" ? "charactersGlobal" : "charactersSession";
      const removed = new Set(ids);
      const blocked=deletedByScope.get(target)||new Set(); ids.forEach(id=>blocked.add(String(id)));deletedByScope.set(target,blocked);
      t._omniRosterRevision=(t._omniRosterRevision||0)+1;
      const snapshot = (scope === "global" || t.lastScope?.sessionId === target ? t[key] : scopeCache.get(target)?.characters) || [];
      if(scope === "global" || t.lastScope?.sessionId === target)t[key] = snapshot.filter(row => !removed.has(String(row.id)));
      const cached=scopeCache.get(target);
      if(cached)cached[scope === "global" ? "global" : "characters"] = snapshot.filter(row=>!removed.has(String(row.id)));
      return snapshot.filter(row => removed.has(String(row.id)));
    };`);

  replace('t.uiTab === "characters" && !t._charsBgRefresh) {', 'false && t.uiTab === "characters" && !t._charsBgRefresh) {');
  replace(`        name: "Inlay Nexus",
        icon: "🖼️",`, `        name: "⚛️Omni Nexus",
        icon: '<span aria-hidden="true" style="display:inline-grid;width:100%;height:100%;min-width:30px;min-height:30px;place-items:center;border-radius:10px;background:#7132f5;color:#fff">⚛️</span>',`);

  replace('        o.preventDefault(), o.stopPropagation(), t.uiTab = r;', `        o.preventDefault(), o.stopPropagation(), t.uiTab = r;
        if (r === "explorer") {
          ensureExplorerState().folderKey = "__all__";
          t._explorerWindow = null;
        }`);

  replace('${i.character_name || ""} ${i.chat_name || ""} ${i.assistant_preview || ""} ${i.main_prompt || ""}', '${i.character_name || ""} ${i.chat_name || ""} ${i.asset_name || ""} ${i.assistant_preview || ""} ${i.main_prompt || ""}');
  replace('msg #${Number(n.message_index) >= 0 ? n.message_index + 1 : "?"} · shot ${Number(n.shot_index) + 1}', '${h(n.asset_name || ("msg #" + (Number(n.message_index) >= 0 ? n.message_index + 1 : "?")))}');

  replace('    return n;\n  }\n  async function syncQuickSettingsButton', `    if (e?.card && ("image_min" in e.card || "image_max" in e.card)) {
      const values = t.backendSettings?.card || {};
      for (const [id,key] of [["nx-min","image_min"],["nx-max","image_max"]]) {
        const input = typeof document === "undefined" ? null : document.getElementById(id);
        if (input) input.value = String(values[key]);
      }
      try {
        const doc = t.hostDoc || t.overlayUi?.doc;
        if (doc) for (const input of await nxUnwrapSafeNodes(await doc.querySelectorAll("[x-omni-counts] input"))) {
          await input.setProperty("value",String(values[await input.getAttribute("x-count")]));
        }
      } catch {}
    }
    return n;
  }
  async function syncQuickSettingsButton`);
  // UI scope is unified; explicit live requests still retain the actual message chat.
  replace('const n = e.useOverride !== !1 ? t.scopeOverride : null;', 'const n = e.useOverride !== !1 ? { ...(t.scopeOverride || {}), chatIndex:"unified" } : null;');
  replace('    shell.dataset.nxLiveSave = "1";', `    shell.dataset.nxLiveSave = "1";
    globalThis.__OMNI_SETTINGS_ACTIONS__ = {
      config: () => t.backendSettings,
      save: async patch => { await flushSettingsSave(); await pe(patch); },
      saveModels: async () => { await flushSettingsSave(); await pe(Oe()); }
    };`);
  replace('"[data-nx-help-id], .toggle-row, .model-form label, #nx-reset-windows, #nx-reset-settings, #nx-save-dash, #nx-run-now, #nx-open-viewer"', '"[data-nx-help-id], .row, .block, .field, .toggle-row, .model-form label, #nx-reset-windows, #nx-reset-settings, #nx-save-dash, #nx-run-now, #nx-open-viewer"');
  // This was a src reset, never a provider reroll.
  const from = out.indexOf('                const stampKey = typeof nxInlineStampKey == "function" ? nxInlineStampKey(t.selectedMessage) : "";');
  const to = out.indexOf('                y("info", "bake.refresh", cardId);', from);
  if (from < 0 || to < 0) throw new Error('[omni repair] baked reroll bounds drift');
  out = out.slice(0,from) + `                await nxAroundScrollHold(async () => {
                  await withImageRerollToast("이미지 리롤 중…", async () => {
                    const result=await K("/v1/cards/" + encodeURIComponent(cardId) + "/reroll", {method:"POST",body:{}});
                    if(!result?.ok || !result?.card)throw new Error(result?.error?.message || "이미지 리롤 실패");
                    await ce((await Z({useOverride:!1})).sessionId);
                  });
                }, {force:!0,allowLarge:!0});
` + out.slice(to);
  replace('await openMsgCharPicker(A);', 'await openSettingsTab("characters");');
  replace('      const live = linkedCards(A);', '      const live = await omniBakedMessageCards(A, els[idx]);');
  replace('let targets = messageCardsByY(msg);', 'let targets = await omniBakedMessageCards(msg);');
  replace('      targets = messageCardsByY(msg);', '      // Keep the original batch identity; each slot is rerolled exactly once.');
  replace('          await Be(await Z({ useOverride: !1 }), A.text, !1);\n          y("info", "overlay.generate", "msg-actions");', '          y("info", "reroll.empty", "이 메시지에 리롤할 이미지가 없습니다.");');
  replace('  async function runMsgChipAction(kind, msgIndex) {', `  async function omniBakedMessageCards(msg, bubble) {
    const doc=t.hostDoc || t.overlayUi?.doc;
    if(!bubble) {t._msgElsCache=null;const els=await getCachedMsgEls(doc);bubble=els[msg?.domIndex];}
    if(!bubble)return [];
    const wraps=await nxUnwrapSafeNodes(await bubble.querySelectorAll("[data-inray-bake],[x-inray-bake]"));
    const cards=[];const seen=new Set();
    for(const wrap of wraps) {
      const id=String(await wrap.getAttribute("data-inlay-inline-shot") || await wrap.getAttribute("x-inlay-inline-shot") || "");
      if(!id || seen.has(id))continue;seen.add(id);
      const meta=await globalThis.__OMNI_IMAGE_META__?.(id);
      cards.push({...meta,id});
    }
    return cards;
  }
  async function runMsgChipAction(kind, msgIndex) {`);
  // Bubble toolbar count editing is inline, not a modal or a generation action.
  replace('    if (kind0 === "stop") {', `    if (kind0 === "counts") {
      try { await openSettingsTab("gen_options"); y("info", "settings.tab", "gen_options.min"); } catch (err) { y("error", "settings.tab.fail", err?.message || err); }
      return;
    }
    if (kind0 === "stop") {`);
  replace('      const cur = ba();', '      await flushSettingsSave(); await pe(Oe());\n      const cur = ba();');
  replace('      if (hidden) hidden.value = next;\n      await P();', '      if (hidden) hidden.value = next;\n      await pe({nai:{backend:next}});\n      await P();');
  replace('  async function Ua(e) {', `  async function Ua(e) {
    await closeCardTagEdit();
    await openSettingsTab("characters");
    const opened = globalThis.__INLAY_SETTINGS_UX__?.openCharacterEditor?.(e || {});
    if (!opened) $e("캐릭터 목록에서 수정할 대상을 선택하세요.");
  }
  async function legacyCharacterEditor(e) {`);
  replace('      if (!id || d.minimized || t.uiOpen) return !1;', '      if (!id || t.uiOpen) return !1;');
  replace('      if (!id || t.uiOpen) return !1;\n      const items = Array.isArray(d.items) && d.items.length ? d.items : U();', `      if (!id || t.uiOpen) return !1;
      t._bakeFocusId = id;
      const items = U();
      d.items = items;`);
  replace('      const A = galleryFocusOf(), all = Array.isArray(t.gallery) ? t.gallery : [], order = globalThis.__INLAY_VIEWER_CORE__?.galleryForMessage;', `      const all = Array.isArray(t.gallery) ? t.gallery : [];
      const anchor = all.find(card=>String(card.id)===String(t._bakeFocusId || ""));
      if (anchor) {
        const ordered = all.filter(card=>card.character_id===anchor.character_id && card.chat_id===anchor.chat_id).sort((a,b)=>Number(a.message_index)-Number(b.message_index)||Number(a.shot_index)-Number(b.shot_index));
        const index=ordered.findIndex(card=>card.id===anchor.id);
        return ordered.slice(Math.max(0,index-4),index+5);
      }
      const A = galleryFocusOf(), order = globalThis.__INLAY_VIEWER_CORE__?.galleryForMessage;`);
  replace('    return o && HEAD_HELP[o] ? { id: o, tip: HEAD_HELP[o], host: n } : null;', `    const tip = globalThis.__INLAY_SETTINGS_UX__?.previewHelp?.(o) || HEAD_HELP[o];
    return o && tip ? {id:o,tip,host:n} : null;`);
  replace('  async function runMsgChipAction(', `  async function openOmniNote(msg) {
    const scope=await Z({useOverride:false}); const sid=scope.sessionId;
    if(!sid)throw new Error("현재 대화를 찾을 수 없습니다.");
    const value=await K("/v1/session-author-note?session_id="+encodeURIComponent(sid));
    const owned=!t.uiOpen;
    if(owned && typeof k.showContainer==="function")await k.showContainer("fullscreen");
    const root=document.createElement("div");
    root.style.cssText="position:fixed;inset:0;z-index:100000;background:#0009;display:grid;place-items:center;padding:16px";
    const panel=document.createElement("div");panel.style.cssText="box-sizing:border-box;width:min(700px,100%);height:min(960px,95vh);min-height:0;display:flex;flex-direction:column;overflow:hidden;background:#101620;color:#eee;border:1px solid #394358;border-radius:12px;color-scheme:dark";
    panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");panel.setAttribute("aria-label","세션 작가의 노트");
    const title=document.createElement("h3");title.textContent="세션 작가의 노트";title.style.cssText="flex:none;margin:0;padding:20px;border-bottom:1px solid #394358";panel.append(title);
    const content=document.createElement("div");content.style.cssText="flex:1;min-height:0;overflow-y:auto;padding:20px;overscroll-behavior:contain";panel.append(content);
    const footer=document.createElement("div");footer.style.cssText="flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;padding:12px 20px;border-top:1px solid #394358;background:#101620";
    const fields={},saved={};let pending=Promise.resolve();let timer;let closing=false;
    const WEAR_STATES=["clothed","torn","topless","bottomless","nude","completely"];
    const wearEdit={map:{},baseline:""},costumeEdit={map:Object.fromEntries((value.costumes||[]).map(c=>[c.id,{name:c.name,scope:c.scope,costume:c.costume}])),baseline:""};
    const costumeSnapshot=()=>JSON.stringify(Object.keys(costumeEdit.map).sort().map(k=>[k,costumeEdit.map[k]]));costumeEdit.baseline=costumeSnapshot();
    const wearSnapshot=()=>JSON.stringify(Object.keys(wearEdit.map).sort().map(k=>[k,wearEdit.map[k]]));
    const wearDirty=()=>wearSnapshot()!==wearEdit.baseline;
    const status=document.createElement("span");status.setAttribute("role","status");status.style.cssText="font-size:13px;overflow-wrap:anywhere";status.textContent="변경 시 자동 저장";
    const dirty=()=>Object.keys(fields).filter(key=>fields[key].value!==saved[key]).concat(wearDirty()?["wear"]:[],costumeSnapshot()!==costumeEdit.baseline?["costumes"]:[]);
    const save=()=> {
      clearTimeout(timer);
      pending=pending.catch(()=>false).then(async()=>{
        const keys=dirty();if(!keys.length)return true;
        const wearSent=wearSnapshot(),costumeSent=costumeSnapshot();
        const body={session_id:sid};for(const key of keys)body[key]=key==="wear"?JSON.parse(JSON.stringify(wearEdit.map)):key==="costumes"?JSON.parse(JSON.stringify(costumeEdit.map)):fields[key].value;
        status.textContent="저장 중…";
        try {
          const result=await K("/v1/session-author-note",{method:"PUT",body});
          if(result?.ok===false)throw new Error(result.error?.message || "저장 요청 실패");
          // Omitted fields, especially the generated location, belong to the latest backend state.
          for(const key of keys){if(key==="wear"){wearEdit.baseline=wearSent;}else if(key==="costumes"){costumeEdit.baseline=costumeSent;}else{saved[key]=body[key];}}
          status.textContent=dirty().length?"저장 대기 중…":"저장됨";return true;
        } catch(error) {status.textContent="저장 실패 · "+String(error?.message || error)+" · 닫기를 누르면 다시 시도합니다.";return false;}
      });
      return pending;
    };
    const schedule=()=>{clearTimeout(timer);status.textContent=dirty().length?"저장 대기 중…":"변경 없음";timer=setTimeout(save,1000);};
    let presets=[];let presetBusy=false;
    const group=document.createElement("div");group.style.cssText="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px";
    const select=document.createElement("select");select.setAttribute("aria-label","노트 프리셋");select.style.cssText="width:100%;min-height:36px";
    const name=document.createElement("input");name.placeholder="프리셋 이름";name.maxLength=80;name.setAttribute("aria-label","프리셋 이름");name.style.cssText="flex:1;min-width:120px";
    const presetSave=document.createElement("button");presetSave.textContent="프리셋 저장";
    const presetDelete=document.createElement("button");presetDelete.textContent="프리셋 삭제";
    fields.preset_id=select;saved.preset_id=value.preset_id||"";
    const renderPresets=id=>{
      select.replaceChildren();select.add(new Option("프리셋 선택",""));
      for(const p of presets)select.add(new Option(p.name,p.id));
      if(id&&!presets.some(p=>p.id===id))select.add(new Option("사용할 수 없는 프리셋",id));
      select.value=id;name.value=presets.find(p=>p.id===id)?.name||"";
      presetDelete.disabled=!presets.some(p=>p.id===id);
    };
    renderPresets(saved.preset_id);
    select.onchange=()=>{
      const p=presets.find(p=>p.id===select.value);name.value=p?.name||"";
      if(p){fields.prefix.value=p.prefix||"";fields.suffix.value=p.suffix||"";}
      presetDelete.disabled=!p;schedule();
    };
    const mutatePresets=async remove=>{
      if(presetBusy||closing)return;
      const label=name.value.trim();if(!remove&&!label){status.textContent="프리셋 이름을 입력하세요.";name.focus();return;}
      const selected=select.value;
      const note={prefix:fields.prefix.value,suffix:fields.suffix.value};
      presetBusy=true;select.disabled=name.disabled=presetSave.disabled=presetDelete.disabled=close.disabled=true;
      try {
        const latest=await K("/v1/session-author-note-presets");
        if(latest?.ok===false)throw new Error("load failed");
        const items=(latest.items||[]).map(p=>({id:p.id,name:p.name,prefix:p.prefix||"",suffix:p.suffix||""}));
        const existing=items.find(p=>p.id===selected);
        const id=remove?selected:(existing?.id||globalThis.crypto?.randomUUID?.()||("note-"+Date.now()+"-"+Math.random().toString(36).slice(2)));
        const next=items.filter(p=>p.id!==id);if(!remove)next.push({id,name:label,...note});
        const result=await K("/v1/session-author-note-presets",{method:"PUT",body:{items:next}});
        if(result?.ok===false)throw new Error("save failed");
        presets=result.items||next;renderPresets(remove?"":id);schedule();
      } catch {status.textContent="프리셋 저장/삭제 실패 · 다시 시도하세요.";}
      finally {presetBusy=false;select.disabled=name.disabled=presetSave.disabled=close.disabled=false;presetDelete.disabled=!presets.some(p=>p.id===select.value);}
    };
    presetSave.onclick=()=>mutatePresets(false);presetDelete.onclick=()=>mutatePresets(true);
    group.append(select,name,presetSave,presetDelete);content.append(group);
    for(const [key,label] of [["prefix","선행"],["suffix","후행"],["location","장소"]]) {
      const lab=document.createElement("label");lab.textContent=label;const input=document.createElement("textarea");input.value=value[key]||"";input.maxLength=key==="location"?800:8000;input.style.cssText="display:block;box-sizing:border-box;width:100%;min-height:90px;resize:vertical;background:#192230;color:#eee;border:1px solid #394358;border-radius:12px;padding:10px;margin:8px 0 16px";input.oninput=event=>{if(!event?.isComposing)schedule();};input.oncompositionend=schedule;input.onblur=save;fields[key]=input;saved[key]=input.value;lab.append(input);content.append(lab);
    }
    const wearTitle=document.createElement("div");wearTitle.textContent="옷 상태";wearTitle.style.cssText="margin:0 0 8px;font-size:13px;color:#9fb0c3";content.append(wearTitle);
    const wearSearch=document.createElement("input");wearSearch.placeholder="이름 검색";wearSearch.maxLength=200;wearSearch.setAttribute("aria-label","옷 상태 이름 검색");wearSearch.style.cssText="display:block;box-sizing:border-box;width:100%;min-height:32px;background:#192230;color:#eee;border:1px solid #394358;border-radius:8px;padding:6px 10px;margin:0 0 8px";wearSearch.oninput=()=>{const q=wearSearch.value.trim().toLowerCase();for(const id of Object.keys(wearRows)){const r=wearRows[id];r.row.style.display=(!q||r.name.toLowerCase().indexOf(q)>=0)?"flex":"none";}};content.append(wearSearch);
    const wearList=document.createElement("div");wearList.setAttribute("role","group");wearList.setAttribute("aria-label","옷 상태 목록");wearList.style.cssText="max-height:300px;overflow-y:auto;overscroll-behavior:contain;display:grid;grid-template-columns:1fr;gap:8px;margin:0 0 16px;padding:10px;background:#0b1119;border:1px solid #394358;border-radius:12px";content.append(wearList);
    const wearRows={};
    const addWearRow=(id,name,character)=>{
      if(!id)return;
      if(wearRows[id]){if(character)wearRows[id].setCostumes(character);return;}
      const row=document.createElement("div");row.style.cssText="display:flex;align-items:center;gap:8px";
      const lab=document.createElement("span");lab.textContent=name;lab.title=name;lab.style.cssText="flex:none;width:86px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px";row.append(lab);
      const sel=document.createElement("select");sel.setAttribute("aria-label",name+" 옷 상태");sel.style.cssText="flex:1;min-width:0;min-height:36px;background:#192230;color:#eee;border:1px solid #394358;border-radius:12px;padding:4px";
      for(const st of WEAR_STATES)sel.add(new Option(st,st));
      sel.value=wearEdit.map[id]?wearEdit.map[id].wear:"clothed";
      sel.onchange=()=>{
        if(closing)return;
        wearEdit.map[id]={name:name,wear:sel.value};
        schedule();
      };
      const outfit=document.createElement("div");outfit.style.cssText="flex:1;min-width:0";
      const choice=document.createElement("select");choice.setAttribute("aria-label",name+" 현재 코스튬");choice.style.cssText="box-sizing:border-box;width:100%;min-height:36px;background:#192230;color:#eee;border:1px solid #394358;border-radius:12px;padding:4px";
      const desc=document.createElement("div");desc.style.cssText="font-size:10px;line-height:1.4;color:#9fb0c3;margin-top:3px;overflow-wrap:anywhere";
      outfit.append(choice,desc);
      const setCostumes=c=>{
        const catalog=c?.costumes?.length?c.costumes:[{name:"default",note:""}];
        const pick=costumeEdit.map[id]?.costume||catalog[c?.active_costume||0]?.name||catalog[0].name;
        choice.replaceChildren();for(const item of catalog)choice.add(new Option(item.name,item.name));
        if(!catalog.some(item=>item.name===pick))choice.add(new Option(pick,pick));
        choice.value=pick;
        const explain=()=>{desc.textContent=catalog.find(item=>item.name===choice.value)?.note||"";};explain();
        choice.onchange=()=>{if(closing)return;costumeEdit.map[id]={name,scope:c?.scope||"",costume:choice.value};explain();schedule();};
      };
      setCostumes(character);
      row.append(sel,outfit);wearList.append(row);wearRows[id]={row:row,select:sel,name:name,setCostumes};
    };
    const initWear=(entries)=>{
      wearEdit.map={};
      for(const e of entries||[]){
        const wid=String(e&&e.id||"");if(!wid)continue;
        wearEdit.map[wid]={name:String(e.name||wid),wear:String(e.wear||"clothed")};
      }
      wearEdit.baseline=wearSnapshot();
      for(const id of Object.keys(wearEdit.map))addWearRow(id,wearEdit.map[id].name);
    };
    initWear(value.wear);
    for(const id of Object.keys(costumeEdit.map))addWearRow(id,costumeEdit.map[id].name);
    try{
      const roster=await K("/v1/characters?session_id="+encodeURIComponent(sid));
      const seen={};
      for(const list of [roster.characters,roster.global]){
        for(const c of list||[]){
          const cid=String(c&&(c.id||c.name)||"");if(!cid||seen[cid])continue;seen[cid]=1;
          addWearRow(cid,String(c.name||cid),c);
        }
      }
    }catch{status.textContent="로스터를 불러오지 못했습니다. 기억된 옷 상태만 편집할 수 있습니다.";}
    presetSave.onclick=()=>mutatePresets(false);presetDelete.onclick=()=>mutatePresets(true);
    const close=document.createElement("button");close.textContent="닫기";close.style.cssText="flex:none;min-height:36px;padding:6px 16px";
    close.onclick=async()=>{
      if(closing||presetBusy)return;closing=true;close.disabled=true;content.inert=true;
      const ok=await save();
      if(!ok){closing=false;close.disabled=false;content.inert=false;return;}
      root.remove();if(owned && !t.uiOpen)await k.hideContainer?.();
    };
    footer.append(status,close);panel.append(footer);root.append(panel);document.body.append(root);fields.prefix.focus();
    select.disabled=presetSave.disabled=presetDelete.disabled=true;
    try {
      const result=await K("/v1/session-author-note-presets");
      if(result?.ok===false)throw new Error("load failed");
      presets=result.items||[];renderPresets(saved.preset_id);
    } catch {status.textContent="프리셋을 불러오지 못했습니다. 노트 편집은 가능합니다.";}
    finally {select.disabled=presetSave.disabled=false;presetDelete.disabled=!presets.some(p=>p.id===select.value);}
  }
  async function runMsgChipAction(`);
  replace('  async function openOmniNote(msg) {', '  globalThis.__OMNI_AUTOTAG_FILE__ = (card,file) => Tt(card,file); globalThis.__OMNI_ANALYZE_FILE__ = file => Lt(file,null);\n  async function openOmniNote(msg) {');
  replace('  async function showSelectionToast(msg) {', '  async function showSelectionToast(msg) { return;');
  replace('  async function showAttachToast() {', '  async function showAttachToast() { return;');
  replace('  function schedulePointerSelect(reason, delayMs = 1e3) {', `  function schedulePointerSelect(reason, delayMs = 1e3) {
    if (!['boot','session','reply','bind','bind-retry'].includes(String(reason || ''))) return;`);
  replace('  async function injectChatInlineImages(msgEl, cards, pendingRows, opts) {', `  async function injectChatInlineImages(msgEl, cards, pendingRows, opts) {
    // Durable tokens exclusively own layout while baking is enabled.
    if (t.backendSettings?.card?.persist_chat_images !== !1) return;`);
  replace('  function messageSelectGesture() {', '  function messageSelectGesture() { return "off";');
  replace('      const gesture = messageSelectGesture();', '      const gesture = messageSelectGesture();\n      if (gesture === "off") return;');
  replace('  async function Da(e, n, opts = {}) {', '  async function Da(e, n, opts = {}) {\n    if (opts.source === "text" || opts.source === "scroll") return !1;');
  out=out.split("글로벌 캐릭터").join("전역 로스터");
  // Host queries cross an async bridge. Restrict hit testing before reading any rects.
  replace('root.querySelectorAll("[x-inlay-msg-chip]")', 'root.querySelectorAll(":is([x-inlay-msg-chip]):is(:active,:hover)")');
  replace(`    if (!nodes.length) {
      try {
        const els = await getCachedMsgEls(doc);
        for (const el of els || []) {
          const extra = await collect(el);
          if (extra.length) nodes = nodes.concat(extra);
        }
      } catch {
      }
    }`, '    if (!nodes.length) return null;');
  for (const selector of ["[title='접기 / 펼치기'],[aria-label='접기 / 펼치기']", '[x-inray-fs],[data-inray-fs]', '[x-inray-refresh],[data-inray-refresh]']) {
    replace('e.querySelectorAll("'+selector+'")', 'e.querySelectorAll(":is('+selector+'):active")');
  }
  // Settings and stop actions do not require resolving a chat message first.
  replace('    if (!kind0) return;\n    let els = [];', `    if (!kind0) return;
    if (kind0 === "stop") { await optimisticStopJobs(); return; }
    const tab = {counts:"gen_options",preset:"style_presets",char:"characters"}[kind0];
    if (tab) { await openSettingsTab(tab); return; }
    if (kind0 === "note") { await openOmniNote(null); return; }
    let els = [];`);
  replace('if (idx >= 0 && Array.isArray(els) && els[idx]) {\n      try {\n        await Da(idx, els, { source: "provisional" });', 'if (idx >= 0 && Array.isArray(els) && els[idx]) {\n      try {\n        await omniResolveActionMessage(idx, els);');
  replace('  async function runMsgChipAction(kind, msgIndex) {', `  async function omniResolveActionMessage(index, els) {
    const bubble=els[index];
    if (!bubble) throw new Error("메시지를 찾지 못했습니다.");
    const [text,scope]=await Promise.all([De(bubble),Za()]);
    if (!text) throw new Error("편집 중인 메시지에는 실행할 수 없습니다.");
    const [prevText,nextText]=await Promise.all([els[index+1]?De(els[index+1]):undefined,index>0?De(els[index-1]):undefined]);
    const match=qa(text,scope.messages,index,els.length,{prevText,nextText});
    const clean=w(text);
    t.selectedMessage={domIndex:index,chatIndex:match.chatIndex,messageIndex:match.chatIndex,
      charSlot:scope.charIndex,chatSlot:scope.chatIndex,characterId:scope.characterId,chatId:scope.chatId,
      characterName:scope.characterName,chatName:scope.chatName,sessionId:scope.sessionId,
      role:w(match.role || ""),text:clean,hash:ye(clean),preview:We(clean,56),
      paragraphCount:Xt(text).length || 1,selectedAt:Date.now(),selectSource:"provisional"};
  }
  async function runMsgChipAction(kind, msgIndex) {`);
  // A failed resolution must never fall through to the previously selected message.
  replace('        await omniResolveActionMessage(idx, els);\n      } catch {\n      }', '        await omniResolveActionMessage(idx, els);\n      } catch (error) { y("warn","msg.action.resolve",String(error)); return; }');
  replace('    y("info", "msg.chip.dispatch",', '    if (!els[idx]) return;\n    y("info", "msg.chip.dispatch",');
  // Mutation observation handles remounts; the watchdog only reconnects a changed document.
  replace('      if (nxMsgFan() && !t.uiOpen) paintAllMsgFans().catch(()=>y("warn","msg.fan","repaint failed"));\n    },450);', '    },2000);');
  // Short messages legitimately have one toolbar: do not reread their prose every pass.
  replace('if(bars.length===2) {', 'if(bars.length===1 || bars.length===2) {');
  // Independent listener registrations must not serialize seventy bridge round trips.
  replace(`        for (let i = 0; i < fanKinds.length && i < trayKids.length; i += 1) {
          if (trayKids[i] && typeof trayKids[i].setAttribute == "function") {`, `        await Promise.all(trayKids.slice(0,fanKinds.length).map(async (button,i) => {
          if (button && typeof button.setAttribute == "function") {`);
  replace('            const button = trayKids[i];', '            // Each button is independent of the other toolbar buttons.');
  replace(`          }
        }
        if (placement === "top" && typeof mount.prepend === "function")`, `          }
        }));
        if (placement === "top" && typeof mount.prepend === "function")`);
  // Backend reroll already commits the replacement token. Merge its response, not the whole gallery.
  replace('                    await ce((await Z({useOverride:!1})).sessionId);', `                    const at=(t.gallery || []).findIndex(card=>String(card.id)===String(cardId));
                    if(at>=0)t.gallery.splice(at,1,result.card);`);
  // Force generation used to unlink/reload the gallery twice before even calling the tagger.
  const forceStart=out.indexOf('    if (o) {\n      await pa(e.sessionId, m, p);');
  const forceEnd=out.indexOf('    const u = {\n      session_id: e.sessionId,',forceStart);
  if(forceStart<0 || forceEnd<0)throw new Error('[omni repair] force generation cleanup drift');
  out=out.slice(0,forceStart)+out.slice(forceEnd);
  replace(`        await nxAroundScrollHold(async () => {
          if (t.backendSettings?.card?.persist_chat_images !== !1) return;`, `        if (t.backendSettings?.card?.persist_chat_images === !1) await nxAroundScrollHold(async () => {`,2);
  // A user scroll is a new position, even while images/toasts are mutating.
  replace('        if (t._scrollHoldRebase || Date.now()-lastMutation>2200) rebase();', '        rebase();');
  replace('t._scrollHoldDepth = 0;t._omniScrollJob=null;', 't._scrollHoldDepth = 0;t._omniScrollJob=null;t._scrollHold=null;');
  replace('t._omniScrollJob=null;t._omniUnpin=null;t._scrollHoldDepth=0;', 't._omniScrollJob=null;t._omniUnpin=null;t._scrollHoldDepth=0;t._scrollHold=null;');
  // Inspect sheet buttons follow the settings UI: 12px radius, Kraken purple primary.
  replace('border-radius:10px;padding:9px 14px;font:700 12px Segoe UI', 'border-radius:12px;padding:9px 14px;font:700 12px Segoe UI');
  replace('addInspectBtn(actRow, "재생성", "regen", `${actStyle};background:rgba(124,108,255,.92);color:#fff`)', 'addInspectBtn(actRow, "재생성", "regen", `${actStyle};background:#7132f5;color:#fff`)');
  return repairGestures(repairResponsiveness(repairInspectGuardCloseUp(repairInspectGuardClose(repairInspectCloseNow(repairAsyncInspect(repairInspectFullscreen(rebuildMessageRuntime(out))))))));
}
