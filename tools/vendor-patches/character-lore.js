// Each operation owns a bot id and state object for its entire lifetime.
// Completing off-screen work only updates that bot's cache, never another form.
function omniLoreState(cid = String(t.lastScope?.characterId || "")) {
  const states = t._omniLoreStates || (t._omniLoreStates = new Map());
  if (!states.has(cid)) states.set(cid, {
    character_id: cid, selected: [], catalog: [], open: false, folded: true,
    peek: null, loaded: false, pending: null, message: "", busy: false,
  });
  return states.get(cid);
}

function omniPaintLorefilter(state) {
  if (!t.uiOpen || t.uiTab !== "characters" || String(t.lastScope?.characterId || "") !== state.character_id) return;
  const slot = document.getElementById("nx-lorefilter-slot");
  if (!slot) return;
  const catalogY = slot.querySelector("#nx-lorefilter-catalog")?.scrollTop || 0;
  const chipsY = slot.querySelector("[data-lorefilter-chips]")?.scrollTop || 0;
  slot.innerHTML = omniLoreHtml(state);
  const catalog = slot.querySelector("#nx-lorefilter-catalog");
  const chips = slot.querySelector("[data-lorefilter-chips]");
  if (catalog) catalog.scrollTop = catalogY;
  if (chips) chips.scrollTop = chipsY;
  omniBindLorefilter();
}

function omniAcceptLorefilter(state, result) {
  if (!result || result.ok === false || result.character_id !== state.character_id) throw new Error(result?.error?.message || "로어북 응답을 확인하지 못했습니다");
  state.selected = Array.isArray(result.selected) ? result.selected : [];
  state.catalog = Array.isArray(result.catalog) ? result.catalog : state.catalog;
  state.initialized = result.initialized === true || state.selected.length > 0;
}

function omniRunLorefilter(state, work) {
  if (state.pending) return state.pending;
  state.busy = true;
  state.message = "불러오는 중…";
  const pending = (async () => {
    try { await work(); }
    catch (error) { state.message = String(error?.message || error); }
    finally {
      state.loaded = true;
      state.busy = false;
      state.pending = null;
      omniPaintLorefilter(state);
    }
  })();
  state.pending = pending;
  omniPaintLorefilter(state);
  return pending;
}

async function omniScanLorefilter(state) {
  // The backend resolves lore by this id; la() follows Risu's live chat instead.
  const result = await K("/v1/characters/lorefilter", {
    method: "POST", body: { character_id: state.character_id, rescan: true },
  }, 12e4);
  omniAcceptLorefilter(state, result);
  state.message = state.catalog.length === 0 ? "로어북이 비어 있습니다. 봇 로어북에 항목을 먼저 넣으세요"
    : !state.selected.length ? "고른 로어가 없습니다. 필요한 항목을 추가하거나 자동채우기를 다시 실행하세요"
    : "캐릭터 로어 " + state.selected.length + "개 채움";
}

function omniLoadLorefilter() {
  const state = omniLoreState();
  if (!state.character_id || state.loaded) return state.pending;
  return omniRunLorefilter(state, async () => {
    const result = await K("/v1/characters/lorefilter?character_id=" + encodeURIComponent(state.character_id), { method: "GET" }, 15e3);
    omniAcceptLorefilter(state, result);
    if (!state.initialized && state.catalog.length) await omniScanLorefilter(state);
    else state.message = "";
  });
}

function omniBindLorefilter() {
  const root = document.getElementById("nx-lorefilter");
  if (!root || root.dataset.omniBound) return;
  root.dataset.omniBound = "1";
  const state = omniLoreState();
  const row = id => state.catalog.find(item => item.id === id) || { id, title: id, keys: [], content: "" };
  root.addEventListener("toggle", () => { if (root.isConnected) state.folded = !root.open; });
  const changeSelected = id => {
    if (state.busy || !id) return;
    const next = state.selected.includes(id) ? state.selected.filter(value => value !== id) : [...state.selected, id];
    void omniRunLorefilter(state, async () => {
      const result = await K("/v1/characters/lorefilter", { method: "POST", body: { character_id: state.character_id, selected: next } }, 15e3);
      omniAcceptLorefilter(state, result);
      state.peek = null;
      state.message = "";
    });
  };
  root.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    if (button.id === "nx-lorefilter-rescan") {
      if (!state.busy) void omniRunLorefilter(state, () => omniScanLorefilter(state));
      return;
    }
    if (button.id === "nx-lorefilter-toggle-add") {
      state.open = !state.open; state.folded = false;
    } else if (button.hasAttribute("data-lorefilter-peek")) {
      state.peek = row(button.getAttribute("data-lorefilter-peek"));
    } else {
      changeSelected(button.getAttribute("data-lorefilter-remove") || button.getAttribute("data-lorefilter-add"));
      return;
    }
    omniPaintLorefilter(state);
  });
  const hover = root.querySelector("#nx-lorefilter-hover");
  root.querySelectorAll("[data-lorefilter-chip]").forEach(chip => {
    chip.addEventListener("pointerenter", () => { if (hover) hover.textContent = row(chip.dataset.lorefilterChip).keys.join(", "); });
    chip.addEventListener("pointerleave", () => { if (hover) hover.textContent = ""; });
  });
  const peek = document.getElementById("nx-lorefilter-peek");
  peek?.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (button?.hasAttribute("data-lorefilter-remove")) { changeSelected(button.getAttribute("data-lorefilter-remove")); return; }
    if (event.target === peek || button) { state.peek = null; omniPaintLorefilter(state); }
  });
}
