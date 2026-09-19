const style = document.createElement("style");style.textContent = ":root{--lightningcss-light:initial;--lightningcss-dark: ;color-scheme:light dark;color:canvastext;background:canvas;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}@media (prefers-color-scheme:dark){:root{--lightningcss-light: ;--lightningcss-dark:initial}}body{margin:0}.risu-panel{box-sizing:border-box;place-items:center;min-height:100dvh;padding:24px;display:grid}.risu-card{border:1px solid color-mix(in srgb, CanvasText 18%, transparent);background:color-mix(in srgb, Canvas 94%, CanvasText 6%);width:min(640px,100%);box-shadow:0 18px 50px color-mix(in srgb, CanvasText 14%, transparent);border-radius:20px;padding:24px}.risu-header{justify-content:space-between;align-items:start;gap:16px;display:flex}.risu-title{margin:0;font-size:1.35rem;line-height:1.2}.risu-subtitle{color:color-mix(in srgb, CanvasText 70%, transparent);margin:8px 0 0}.risu-grid{gap:10px;margin-top:24px;display:grid}.risu-row{border-top:1px solid color-mix(in srgb, CanvasText 12%, transparent);grid-template-columns:minmax(120px,.4fr) 1fr;gap:12px;padding:12px 0;display:grid}.risu-label{color:color-mix(in srgb, CanvasText 66%, transparent)}.risu-value{overflow-wrap:anywhere}.risu-button{color:canvas;cursor:pointer;font:inherit;background:canvastext;border:0;border-radius:999px;padding:10px 16px}.risu-button:focus-visible{outline-offset:3px;outline:3px solid highlight}.risu-error{border-color:color-mix(in srgb, #ef4444 56%, CanvasText 18%)}.risu-error-message{color:color-mix(in srgb, #ef4444 88%, CanvasText 12%);overflow-wrap:anywhere;margin:16px 0 0}\n/*$vite$:1*/";document.head.append(style);
var Zt = "inlay-nexus-native", ea = "Inlay Nexus", He = "1.3.0", rn = class extends Error {
  segment;
  constructor($) {
    super(`Storage key segment must be non-empty and cannot contain colon: ${$}`), this.segment = $, this.name = "PluginStorageKeyError";
  }
};
function on($) {
  const L = [
    $.pluginName,
    $.scope,
    ...$.ids,
    $.key
  ];
  for (const M of L) if (M.length === 0 || M.includes(":")) throw new rn(M);
  return L.join(":");
}
function ta($, L, M) {
  return on({
    pluginName: Zt,
    scope: $,
    ids: L,
    key: M
  });
}
async function Kt($) {
  return await risuai.pluginStorage.getItem(ta("global", [], $));
}
async function Jt($, L) {
  await risuai.pluginStorage.setItem(ta("global", [], $), L);
}
var sn = class {
  generation = 0;
  tail = Promise.resolve();
  run($) {
    const L = ++this.generation, M = this.tail.then(async () => {
      if (L === this.generation)
        return $();
    });
    return this.tail = M.catch(() => {
    }), M;
  }
}, Xt = ($) => String($ ?? "").replace(/\r\n/g, `
`).split(`
`).map((L) => L.trim()).filter(Boolean), ln = ($) => String($ ?? "").replace(/<br\s*\/?>/gi, `
`).replace(/<\/(?:p|div|li|blockquote|h[1-6]|tr)>/gi, `
`).replace(/<(?:p|div|li|blockquote|h[1-6]|tr)(?:\s[^>]*)?>/gi, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/[^\S\n]+/g, " ").replace(/ *\n */g, `
`).replace(/\n{2,}/g, `
`).trim(), ft = ($) => Math.max(0, Math.min(100, $)), aa = ($, L = 0.42) => Math.max(0, $) * (Number.isFinite(L) ? L : 0.42), na = ($, L, M = 0.42) => {
  const V = Math.max(1, $.height), Y = aa(L, M);
  return Y < $.top || Y > $.bottom ? null : ft((Y - $.top) / V * 100);
}, cn = ($, L, M = 0.42) => {
  const V = na($, L, M);
  if (V != null) return V;
  const Y = aa(L, M);
  return $.bottom < Y ? 100 : ($.top > Y, 0);
}, dn = ($, L) => {
  if (!$.length) return -1;
  const M = ft(Number(L)), q = $.map((Y) => ft(Number(Y) || 0)), ne = q.reduce((Y, te, ae) => (te <= 20 ? Y.concat(ae) : Y), []);
  const V = ne.length === 1 && q[ne[0]] > 0 ? q.map((Y, te) => te === ne[0] ? 1 : Y) : q;
  if (V[0] > 0 && M < V[0]) return -1;
  let Y = 0;
  for (let te = 0; te < V.length; te += 1) M >= V[te] && (Y = te);
  return Y;
}, gt = ($, L) => {
  const M = Math.max(1, L);
  return Math.max(0, Math.min($, M - 1)) / M * 100;
}, ht = ($) => {
  const L = String($ || "").replace(/\r\n/g, `
`);
  if (!/\[Positive\]/i.test(L)) return null;
  const M = L.match(/\[Positive\]\s*([\s\S]*?)(?=\s*\[Negative\]|$)/i), V = L.match(/\[Negative\]\s*([\s\S]*?)\s*$/i), Y = (M?.[1] || "").trim(), q = (V?.[1] || "").trim();
  return !Y && !q ? null : {
    positive: Y,
    negative: q
  };
}, mt = ($, L) => `${String($ || "preset").toLowerCase().replace(/[^a-z0-9\uac00-\ud7a3]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "preset"}_${L}_${Math.random().toString(36).slice(2, 7)}`, Qt = ($, L) => {
  if (!$ || typeof $ != "object") return null;
  const M = $, V = String(M.name || M.comment || M.title || `프리셋 ${L + 1}`).trim();
  let Y = String(M.positive || M.pos || "").trim(), q = String(M.negative || M.neg || "").trim();
  if (!Y && !q && typeof M.content == "string") {
    const ne = ht(M.content);
    if (!ne) return null;
    Y = ne.positive, q = ne.negative;
  }
  return !Y && !q ? null : {
    id: String(M.id || mt(V, L)),
    name: V,
    positive: Y,
    negative: q
  };
}, pn = ($) => {
  const L = String($ || "").trim();
  if (!L) return [];
  if (!L.startsWith("{") && !L.startsWith("[") && /\[Positive\]/i.test(L)) {
    const q = ht(L);
    return q ? [{
      id: mt("imported", 0),
      name: "가져온 프리셋",
      positive: q.positive,
      negative: q.negative
    }] : [];
  }
  let M;
  try {
    M = JSON.parse(L);
  } catch {
    return [];
  }
  const V = [], Y = (q) => {
    if (!q) return;
    const ne = `${q.name}::${q.positive.slice(0, 80)}`;
    V.some((ie) => `${ie.name}::${ie.positive.slice(0, 80)}` === ne) || V.push(q);
  };
  if (Array.isArray(M))
    return M.forEach((q, ne) => Y(Qt(q, ne))), V;
  if (M && typeof M == "object") {
    const q = M;
    if (Array.isArray(q.presets) && (q.presets.forEach((ie, se) => Y(Qt(ie, se))), V.length))
      return V;
    const ne = (q.data?.character_book || q.character_book || q.data?.characterBook)?.entries;
    Array.isArray(ne) && ne.forEach((ie, se) => {
      if (!ie || typeof ie != "object") return;
      const be = ie, Te = String(be.content || ""), k = ht(Te);
      if (!k) return;
      const t = String(be.comment || be.name || `프리셋 ${se + 1}`).trim().replace(/^프리셋\s*/i, (Ae) => Ae);
      Y({
        id: mt(t, se),
        name: t || `프리셋 ${se + 1}`,
        positive: k.positive,
        negative: k.negative
      });
    });
  }
  return V;
}, un = ($, L) => {
  const M = [...$ || []];
  for (const V of L || []) {
    const Y = M.findIndex((q) => q.name === V.name);
    Y >= 0 ? M[Y] = {
      ...M[Y],
      positive: V.positive,
      negative: V.negative
    } : M.push(V);
  }
  return M;
};
async function gn() {
  "use strict";
  const $ = ea, L = "http://127.0.0.1:28120", M = "inlay-nx-launcher", V = "inlay-nx-gallery-root", Y = "inlay-nx-overlay-root", q = "inlay-nx-debug-root", ne = "viewerGeo", iconStoreKey = "viewerIconGeo", ie = "viewerCastOpen", minStoreKey = "viewerMinimized", se = {
    left: 24,
    top: 72,
    w: 380,
    h: 560
  }, iconSe = {
    left: 24,
    top: 120
  }, be = 24, Te = 250, pinYDefault = 120, pinXPctDefault = 38, pinYPctDefault = 80, k = globalThis.risuai || globalThis.Risuai || null;
  if (!k) {
    console.warn(`[${$}] RisuAI API is unavailable.`);
    return;
  }
  const t = {
    settings: null,
    settingsAt: 0,
    backendSettings: null,
    prompts: [],
    promptDrafts: {},
    uiOpen: !1,
    uiTab: "dashboard",
    uiRenderGen: 0,
    uiMessage: null,
    uiBusy: "",
    health: null,
    replacerReady: !1,
    replacerError: "",
    pendingBySession: /* @__PURE__ */ new Map(),
    timersBySession: /* @__PURE__ */ new Map(),
    lastScope: null,
    scopeOverride: null,
    activeJobId: "",
    gallery: [],
    appearance: {},
    charactersSession: [],
    charactersGlobal: [],
    disabledGlobals: [],
    viewerOpen: !1,
    viewerIndex: 0,
    pollTimer: null,
    unloading: !1,
    modelTestResults: {},
    launcherMounted: !1,
    launcherDoc: null,
    launcherBtn: null,
    launcherPointerId: null,
    galleryUi: null,
    overlayUi: null,
    progressUi: null,
    viewerMinimized: !1,
    charEditUi: null,
    cardTagUi: null,
    hostDoc: null,
    overlayScrolling: !1,
    overlayScrollTimer: null,
    overlayRaf: null,
    jobsInFlight: /* @__PURE__ */ new Map(),
    lastOverlayFocusHash: "",
    selectedMessage: null,
    lastImagedMessage: null,
    _pointerClientX: null,
    _pointerClientY: null,
    pendingSessionId: "",
    pendingSessionCount: 0,
    settingsSavePending: null,
    settingsSaveTimer: null,
    settingsSaveInFlight: null,
    settingsWriteGen: 0,
    _presetSwitching: !1,
    activePresetId: "",
    quickButtonRegistered: !1,
    startupRetryTimer: null,
    debugLog: [],
    debugUi: null,
    debugUiTimer: null,
    debugUiOpen: !0,
    debugCompareIndex: null,
    lastJobState: "",
    jobProgress: null,
    debugInsight: null,
    explorer: {
      folders: [],
      items: [],
      folderKey: "",
      query: "",
      loadedAt: 0
    },
    charCatalog: [],
    autotagFocus: null,
    autotagThreshold: 0.2
  };
  function Ae(e) {
    if (e == null) return "";
    if (typeof e == "string") return e;
    if (typeof e == "number" || typeof e == "boolean") return String(e);
    if (e instanceof Error) return e.message || String(e);
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  function y(e, n, o = "") {
    const a = {
      t: Date.now(),
      level: e || "info",
      event: String(n || ""),
      detail: z(Ae(o), 700)
    };
    t.debugLog.push(a), t.debugLog.length > Te && t.debugLog.splice(0, t.debugLog.length - Te);
    const r = `[${$}] ${a.event}${a.detail ? ` · ${a.detail}` : ""}`;
    a.level === "error" ? console.warn(r) : (t.settings?.debug || a.level === "warn") && console.log(r), t.debugUi?.refreshSoon && t.debugUi.refreshSoon();
  }
  function Pe(...e) {
    y("warn", e.map(Ae).filter(Boolean).join(" "));
  }
  function We(e, n = 48) {
    return z(w(e, 400).replace(/\s+/g, " "), n);
  }
  function ra() {
    const e = t.gallery || [], n = /* @__PURE__ */ new Map();
    for (const r of e) {
      const i = r.content_hash || `msg${r.message_index ?? "?"}` || "unknown";
      n.has(i) || n.set(i, []), n.get(i).push(r);
    }
    const o = [];
    let a = 0;
    for (const [r, i] of n) {
      const s = [...new Set(i.map((m) => m.paragraph))].sort((m, u) => Number(m) - Number(u)), c = i.map((m) => m.y_percent != null && Number.isFinite(Number(m.y_percent)) ? `${Math.round(Number(m.y_percent))}%` : null).filter(Boolean), l = c.length ? ` y[${c.join(",")}]` : "", p = i[0]?.message_index;
      if (o.push(`  ${String(r).slice(0, 8) || "?"} ×${i.length} msg#${p ?? "-"} P[${s.join(",")}]${l}`), a += 1, a >= 6) break;
    }
    return o.length ? o.join(`
`) : "  (empty)";
  }
  function Ve() {
    const e = t.backendSettings?.card || {}, n = [...t.jobsInFlight.keys()].map((i) => i.slice(0, 8)).join(",") || "-", o = t.selectedMessage, a = t.debugInsight, r = [
      `enabled=${t.settings?.enabled !== !1}`,
      `hook=${t.replacerReady ? "afterRequest" : t.replacerError || "off"}`,
      `power=${e.power !== !1}`,
      `execute=${e.execute || "auto"}`,
      `job=${t.activeJobId || "-"}`,
      `jobState=${t.lastJobState || "-"}`,
      `gallery=${(t.gallery || []).length}`,
      `markers=${t.overlayUi?.markers?.length ?? 0}`,
      `flight=${n}`,
      `session=${t.lastScope?.sessionId || "-"}`,
      "",
      "=== SELECTED (click) ==="
    ];
    if (o ? (r.push(`za hash=${(o.hash || "").slice(0, 16)} session=${o.sessionId || "-"} msg#${o.chatIndex ?? "-"} role=${o.role || "-"} chars=${(o.text || "").length}`), r.push(`char[${o.charSlot ?? "-"}] ${o.characterName || "-"}`), r.push(`chat[${o.chatSlot ?? "-"}] ${o.chatName || "-"}`), r.push(`msg#${o.chatIndex ?? "-"} role=${o.role || "-"} via=${o.matchMethod || "-"}`), r.push(`session=${o.sessionId || "-"}`), r.push(`DOM#${o.domIndex} hash=${(o.hash || "").slice(0, 16)}`), r.push(`chars=${(o.text || "").length} paragraphs=${o.paragraphCount ?? "?"}`), r.push(`hasImage=${o.hasImage ? "YES" : "NO"} cards=${o.cardCount ?? 0}`), r.push(`parasWithImg=P[${(o.paragraphsWithImages || []).join(",") || "-"}]`), r.push(`imgMatch=${o.matchMode || "-"}`), r.push(`preview=${o.preview || "-"}`)) : r.push("없음 — 채팅 메시지를 클릭해서 선택하세요"), r.push("", "=== VISIBLE MSGS ==="), a?.messages?.length) for (const i of a.messages) {
      const s = i.isSelected ? "*" : " ";
      r.push(`${s}#${i.domIndex} hash=${(i.hash || "").slice(0, 8)} img=${i.hasImage ? "Y" : "N"}(${i.cardCount}) ${i.preview}`);
    }
    else r.push("(scan 후 표시)");
    if (r.push("", "=== GALLERY GROUPS ==="), r.push(ra()), a?.markers?.length) {
      r.push("", "=== MARKERS ===");
      for (const i of a.markers.slice(0, 10)) r.push(`  P${i.paragraph} → ${We(i.main || i.id, 40)}`);
    }
    return a?.lastPlace && r.push("", `lastPlace=${a.lastPlace}`), r.push("", "팁: 메시지 본문을 클릭하면 선택됩니다"), r.join(`
`);
  }
  function Ye(e = 80) {
    return t.debugLog.slice(-e).map((n) => `${new Date(n.t).toLocaleTimeString("ko-KR", { hour12: !1 })} [${n.level === "error" ? "E" : n.level === "warn" ? "W" : "I"}] ${n.event}${n.detail ? ` | ${n.detail}` : ""}`).join(`
`);
  }
  function Ke(e) {
    if (e == null) return "";
    if (typeof e == "string") return e;
    if (typeof e == "number" || typeof e == "boolean") return String(e);
    if (Array.isArray(e)) return e.map(Ke).filter(Boolean).join(`
`);
    if (typeof e == "object") {
      if (typeof e.content == "string") return e.content;
      if (typeof e.text == "string") return e.text;
      if (typeof e.data == "string") return e.data;
      if (e.data != null) return Ke(e.data);
    }
    return "";
  }
  function w(e, n = 2e5) {
    return Ke(e).replace(/\u0000/g, " ").replace(/\r\n/g, `
`).trim().slice(0, n);
  }
  function z(e, n = 600) {
    const o = w(e, n * 3).replace(/\s+/g, " ").trim();
    return o.length <= n ? o : `${o.slice(0, Math.max(1, n - 1)).trim()}…`;
  }
  function re(e, n, o, a) {
    const r = Number.parseInt(String(e ?? ""), 10);
    return Number.isFinite(r) ? Math.max(n, Math.min(o, r)) : a;
  }
  function Ne(e, n = 0) {
    const o = Number.parseInt(String(e ?? ""), 10);
    return Number.isFinite(o) ? o : n;
  }
  function xt(e, n = !1) {
    if (e == null || String(e).trim() === "") return n;
    const o = String(e).trim().toLowerCase();
    return [
      "true",
      "1",
      "yes",
      "on",
      "enabled"
    ].includes(o) ? !0 : [
      "false",
      "0",
      "no",
      "off",
      "disabled"
    ].includes(o) ? !1 : n;
  }
  function h(e) {
    return String(e ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function ye(e) {
    const n = w(e, 1e6);
    let o = 2166136261, a = 2654435769;
    for (let r = 0; r < n.length; r += 1) {
      const i = n.charCodeAt(r);
      o ^= i, o = Math.imul(o, 16777619), a ^= i + (o << 6 | o >>> 26), a = Math.imul(a, 2246822507);
    }
    return `${(o >>> 0).toString(16).padStart(8, "0")}${(a >>> 0).toString(16).padStart(8, "0")}`;
  }
  async function D(e, n, o = null) {
    try {
      return await n();
    } catch (a) {
      return Pe(e, a), o;
    }
  }
  async function we(e) {
    if (typeof k.getArgument == "function")
      return D(`getArgument:${e}`, () => k.getArgument(e), void 0);
  }
  async function ve() {
    const e = Date.now();
    if (t.settings && e - t.settingsAt < 800) return t.settings;
    const n = {
      enabled: xt(await we("inlay_enabled"), !0),
      backendUrl: w(await we("inlay_backend_url")) || L,
      backendToken: w(await we("inlay_backend_token")),
      requestTimeoutMs: re(await we("inlay_request_timeout_ms"), 5e3, 6e5, 12e4),
      captureDelayMs: re(await we("inlay_capture_delay_ms"), 0, 1e4, 1400),
      debug: xt(await we("inlay_debug"), !1)
    };
    return t.settings = n, t.settingsAt = e, n;
  }
  function Ue(e, n) {
    return `${String(e || "").replace(/\/+$/, "")}/${String(n || "").replace(/^\/+/, "")}`;
  }
  async function K(e, n = {}, o = null) {
    const a = await ve(), r = re(o, 500, 6e5, a.requestTimeoutMs);
    const N = globalThis.__INLAY_NATIVE__;
    if (!N || typeof N.fetch != "function") throw new Error("Inlay Nexus backend unavailable");
    await N.ready();
    return N.fetch(e, n, r);
  }
  async function bt() {
    try {
      const e = await K("/v1/health", { method: "GET" }, 5e3);
      return t.health = e?.health || e, {
        ok: !0,
        health: t.health
      };
    } catch (e) {
      return t.health = null, {
        ok: !1,
        error: z(e?.message || e)
      };
    }
  }
  function presetIdEq(a, b) {
    return String(a || "") === String(b || "");
  }
  function resolveActivePresetId(card) {
    const presets = Array.isArray(card?.presets) ? card.presets : [];
    const preferred = String(t.activePresetId || "");
    if (preferred && presets.some((p) => presetIdEq(p.id, preferred))) return preferred;
    const cur = String(card?.active_preset_id || "");
    if (cur && presets.some((p) => presetIdEq(p.id, cur))) return cur;
    return String(presets[0]?.id || "");
  }
  function pinActivePreset(card, presetId) {
    const id = String(presetId || "");
    if (!card || !id) return card;
    t.activePresetId = id, card.active_preset_id = id;
    return card;
  }
  async function le() {
    const writeGen = t.settingsWriteGen || 0, preferred = String(t.activePresetId || "");
    const e = await K("/v1/settings", { method: "GET" });
    // A newer local PUT (viewer/card) won while this GET was in flight — keep local.
    if ((t.settingsWriteGen || 0) !== writeGen) return t.backendSettings;
    let incoming = e?.settings || null;
    if (incoming && t.settingsSavePending) incoming = mergeSettingsPatch(incoming, t.settingsSavePending);
    // Viewer/card choice is source of truth until explicitly changed again.
    if (incoming?.card && preferred) {
      const presets = Array.isArray(incoming.card.presets) ? incoming.card.presets : [];
      if (presets.some((p) => presetIdEq(p.id, preferred))) {
        incoming.card.active_preset_id = preferred;
        const active = presets.find((p) => presetIdEq(p.id, preferred));
        active && (incoming.card.custom_pos = active.positive || "", incoming.card.custom_neg = active.negative || "");
      }
    } else if (incoming?.card?.active_preset_id) t.activePresetId = String(incoming.card.active_preset_id);
    if (incoming?.card) normalizeLoadedPinCard(incoming.card);
    return t.backendSettings = incoming, t.backendSettings;
  }
  /** Ensure sticky pin % fields are marked so first paint matches settings (no open/close needed). */
  function normalizeLoadedPinCard(card) {
    if (!card || typeof card !== "object") return card;
    const hasPct = Number.isFinite(Number(card.overlay_x_pct)) || Number.isFinite(Number(card.overlay_y_pct));
    if (!hasPct && card.overlay_pin_unit !== "pct") return card;
    card.overlay_pin_unit = "pct";
    const origin = String(card.overlay_pin_origin || "");
    if (!origin || origin === "bottom-left") card.overlay_pin_origin = "bl";
    return card;
  }
  async function pe(e) {
    const writeGen = ++t.settingsWriteGen, sentActive = e?.card && "active_preset_id" in e.card ? String(e.card.active_preset_id || "") : "";
    sentActive && (t.activePresetId = sentActive);
    const n = await K("/v1/settings", {
      method: "PUT",
      body: e
    });
    // Only the latest write may replace memory; older responses must not rewind active_preset_id.
    if (writeGen === t.settingsWriteGen) {
      t.backendSettings = n?.settings || t.backendSettings;
      const prefer = String(t.activePresetId || sentActive || "");
      if (prefer && t.backendSettings?.card) {
        pinActivePreset(t.backendSettings.card, prefer);
        const active = (t.backendSettings.card.presets || []).find((p) => presetIdEq(p.id, prefer));
        active && (t.backendSettings.card.custom_pos = e?.card?.custom_pos ?? active.positive ?? "", t.backendSettings.card.custom_neg = e?.card?.custom_neg ?? active.negative ?? "");
      }
    }
    return n;
  }
  async function syncQuickSettingsButton(enabled) {
    if (enabled) {
      if (t.quickButtonRegistered || typeof k.registerButton != "function") return;
      const registered = await D("registerButton", () => k.registerButton({
        name: "Inlay Nexus",
        icon: "🖼️",
        iconType: "html",
        location: "action",
        id: "inlay-nexus-gui"
      }, At), null);
      registered !== null && (t.quickButtonRegistered = !0);
      return;
    }
    if (!t.quickButtonRegistered) return;
    if (typeof k.unregisterUIPart == "function") {
      await D("unregisterButton", () => k.unregisterUIPart("inlay-nexus-gui"), null);
      t.quickButtonRegistered = !1;
    }
  }
  function mergeSettingsPatch(e, n) {
    const o = { ...e || {} };
    for (const [a, r] of Object.entries(n || {})) o[a] = r && typeof r == "object" && !Array.isArray(r) ? mergeSettingsPatch(o[a] && typeof o[a] == "object" ? o[a] : {}, r) : r;
    return o;
  }
  async function flushSettingsSave() {
    t.settingsSaveTimer && (clearTimeout(t.settingsSaveTimer), t.settingsSaveTimer = null);
    if (t.settingsSaveInFlight) return t.settingsSaveInFlight;
    return t.settingsSaveInFlight = (async () => {
      while (t.settingsSavePending) {
        const e = t.settingsSavePending;
        t.settingsSavePending = null, await pe(e), e?.card && "show_risu_settings_button" in e.card && await syncQuickSettingsButton(e.card.show_risu_settings_button !== !1);
      }
    })().finally(() => {
      t.settingsSaveInFlight = null;
    }), t.settingsSaveInFlight;
  }
  function queueSettingsSave(e, opts = null) {
    // force: allow viewer (and other non-UI writers) to enqueue even when settings panel is closed.
    // Never strand a pending patch behind a !uiOpen timer abort — that reverts viewer preset changes.
    if (!e || t._uiRendering) return;
    if (!t.uiOpen && !opts?.force) return;
    t.settingsSavePending = mergeSettingsPatch(t.settingsSavePending, e), t.settingsSaveTimer && clearTimeout(t.settingsSaveTimer), t.settingsSaveTimer = setTimeout(() => {
      t.settingsSaveTimer = null;
      if (t._uiRendering) return;
      flushSettingsSave().then(() => {
        t.uiOpen && $e("자동 저장됨");
      }).catch((n) => {
        t.uiOpen && $e(`자동 저장 실패: ${z(n?.message || n, 60)}`, !1);
      });
    }, 500);
  }
  function syncCardPresetFormFromSettings() {
    if (typeof document > "u") return;
    const card = kt(t.backendSettings?.card || {}), activeId = resolveActivePresetId(card), active = (card.presets || []).find((p) => presetIdEq(p.id, activeId)) || null;
    pinActivePreset(card, activeId);
    const sel = document.getElementById("nx-preset-select");
    if (!sel && !document.querySelector("[data-preset-select]") && !document.getElementById("nx-custom-pos")) return;
    if (sel && activeId) {
      try {
        sel.value = activeId;
      } catch {
      }
      // Force selected attribute for hosts that ignore .value on re-show.
      try {
        Array.from(sel.options || []).forEach((opt) => {
          opt.selected = presetIdEq(opt.value, activeId);
        });
      } catch {
      }
    }
    document.querySelectorAll("[data-preset-select]").forEach((btn) => {
      btn.classList.toggle("active", presetIdEq(btn.getAttribute("data-preset-select"), activeId));
    });
    if (!active) return;
    const name = document.getElementById("nx-preset-name"), pos = document.getElementById("nx-custom-pos"), neg = document.getElementById("nx-custom-neg");
    if (name) name.value = active.name || "";
    if (pos) pos.value = active.positive || "";
    if (neg) neg.value = active.negative || "";
  }
  async function Je() {
    const e = await K("/v1/prompts", { method: "GET" });
    t.prompts = e?.prompts || [];
    for (const n of t.prompts) t.promptDrafts[n.key] == null && (t.promptDrafts[n.key] = n.text || "");
    return t.prompts;
  }
  async function oa(e, n) {
    // During active generation, never wipe the selected message / gallery —
    // host chat-index flicker used to clear the strip mid-shot ("생성 중…만 보임").
    const busyHash = [...t.jobsInFlight.keys()][0] || "";
    const keepSelection = !!(busyHash || (t.jobProgress && formatViewerJob(t.jobProgress)?.busy));
    y("info", "session.change", `${(e || "").slice(-8) || "-"} → ${(n || "").slice(-8) || "-"} · ${keepSelection ? "keep selection (job busy)" : "clear selection"}`);
    if (!keepSelection) {
      t.selectedMessage = null, t.lastImagedMessage = null, t.lastOverlayFocusHash = "", t.gallery = [], t._galleryCache = null, t._msgElsCache = null;
    } else {
      t._galleryCache = null;
    }
    try {
      await Fe();
    } catch {
    }
    if (n) try {
      await ce(n, !0);
    } catch {
    }
    if (t.galleryUi?.renderGal) try {
      await t.galleryUi.renderGal();
    } catch {
    }
    t.debugUi?.refreshSoon && t.debugUi.refreshSoon();
  }
  async function Z(e = {}) {
    const n = e.useOverride !== !1 ? t.scopeOverride : null;
    let o = Number(await D("getCurrentCharacterIndex", () => k.getCurrentCharacterIndex?.(), -1)), a = Number(await D("getCurrentChatIndex", () => k.getCurrentChatIndex?.(), -1));
    const r = !n || n.charIndex == null || n.charIndex === "live", i = !n || n.chatIndex == null || n.chatIndex === "live", unified = !!(!i && n?.chatIndex === "unified");
    !r && Number.isFinite(Number(n.charIndex)) && Number(n.charIndex) >= 0 && (o = Number(n.charIndex)), unified || (!i && Number.isFinite(Number(n.chatIndex)) && Number(n.chatIndex) >= 0 ? a = Number(n.chatIndex) : r || (a = Number.isFinite(a) && a >= 0 ? a : 0));
    // Host APIs sometimes return -1 while NAI/IDB is busy. Do not treat that as a real session switch.
    if (r && (!Number.isFinite(o) || o < 0) && t.lastScope?.sessionId) {
      y("warn", "session.skip", `live charIndex=${o} · keep ${String(t.lastScope.sessionId).slice(-8)}`);
      return t.lastScope;
    }
    if (!unified && i && (!Number.isFinite(a) || a < 0) && t.lastScope?.sessionId) {
      y("warn", "session.skip", `live chatIndex=${a} · keep ${String(t.lastScope.sessionId).slice(-8)}`);
      return t.lastScope;
    }
    const s = o >= 0 ? await D("getCharacterFromIndex", () => k.getCharacterFromIndex?.(o), null) : await D("getCharacter", () => k.getCharacter?.(), null), c = !unified && o >= 0 && a >= 0 ? await D("getChatFromIndex", () => k.getChatFromIndex?.(o, a), null) : null, l = w(s?.chaId || s?.id || s?.name || `char_${o}`), p = unified ? "__unified__" : w(c?.id || c?.chatId || `chat_${a}`), m = w(s?.name || s?.charName || "", 200), u = unified ? "통합 챗" : w(c?.name || c?.chatName || c?.title || `Chat ${a}`, 200), b = `risu_${ye(`${l}|${p}`)}`, E = `risu_${ye(`${l}|__unified__`)}`, C = {
      charIndex: o,
      chatIndex: unified ? "unified" : a,
      characterId: l,
      chatId: p,
      sessionId: b,
      unifiedSessionId: E,
      character: s,
      chat: c,
      characterName: m,
      chatName: u,
      liveChar: r,
      liveChat: i && !unified,
      unified
    }, S = t.lastScope?.sessionId || "";
    if (S && S !== b) {
      if (t.pendingSessionId === b) t.pendingSessionCount += 1;
      else t.pendingSessionId = b, t.pendingSessionCount = 1;
      if (t.pendingSessionCount >= 2) return t.pendingSessionId = "", t.pendingSessionCount = 0, t.lastScope = C, await oa(S, b), C;
      return C;
    }
    return t.pendingSessionId = "", t.pendingSessionCount = 0, t.lastScope = C, C;
  }

  async function ia() {
    const e = await D("getDatabase", () => k.getDatabase?.(["characters"]), null), n = Array.isArray(e?.characters) ? e.characters : [];
    return t.charCatalog = n.map((o, a) => {
      const r = Array.isArray(o?.chats) ? o.chats : [];
      return {
        index: a,
        name: w(o?.name || o?.charName || `Character ${a}`, 200) || `Character ${a}`,
        chaId: w(o?.chaId || o?.id || "", 200),
        chats: r.map((i, s) => ({
          index: s,
          name: w(i?.name || i?.chatName || i?.title || `Chat ${s}`, 200) || `Chat ${s}`,
          id: w(i?.id || i?.chatId || "", 200)
        }))
      };
    }), t.charCatalog;
  }
  function sa(e) {
    const n = t.charCatalog || [], o = t.scopeOverride, a = !o || o.charIndex == null || o.charIndex === "live", unified = !!(o && o.chatIndex === "unified"), r = !unified && (!o || o.chatIndex == null || o.chatIndex === "live"), i = Number(e?.charIndex ?? -1), s = Number(e?.chatIndex ?? -1), c = (!a ? n.find((l) => l.index === i) : null) || n.find((l) => l.index === i) || n[0];
    const unifiedFirst = !!(t.backendSettings?.card?.unified_chat_priority);
    const chatOpts = unifiedFirst ? [
      `<option value="unified"${unified ? " selected" : ""}>통합 챗</option>`,
      `<option value="live"${r ? " selected" : ""}>현재 챗</option>`
    ] : [
      `<option value="live"${r ? " selected" : ""}>현재 챗</option>`,
      `<option value="unified"${unified ? " selected" : ""}>통합 챗</option>`
    ];
    const l = [
      `<option value="live"${a ? " selected" : ""}>현재 캐릭터 챗</option>`,
      ...n.map((p) => `<option value="${p.index}" ${!a && p.index === i ? "selected" : ""}>${h(p.name)}</option>`)
    ].join(""), p = [
      ...chatOpts,
      ...(c?.chats || []).map((m) => `<option value="${m.index}" ${!unified && !r && m.index === s ? "selected" : ""}>${h(m.name)}</option>`)
    ].join("");
    return `
      <div class="scope-bar card" style="margin:0 0 14px;padding:12px 14px">
        <div class="prompt-group-label" style="margin:0 0 8px;border:0;padding:0">현재 작업 캐릭터 챗</div>
        <div class="model-form" style="margin:0">
          <label><span>캐릭터</span><select id="nx-scope-char">${l}</select></label>
          <label><span>채팅</span><select id="nx-scope-chat">${p}</select></label>
        </div>
        <div class="muted" style="margin-top:8px;font-size:12px">${unified ? "통합 챗: 이 캐릭터의 모든 채팅 캐릭터를 별칭 겹침 기준으로 묶은 공용 로스터입니다." : "설정/캐릭터 탭에서 다루는 세션입니다. 자동 생성(afterRequest)은 Risu 실제 현재 채팅을 따릅니다."}</div>
      </div>`;
  }

  function yt(e) {
    return w(e?.data ?? e?.content ?? e?.message ?? e?.text ?? "");
  }
  function Xe(e, n, o) {
    const a = Array.isArray(e?.message) ? e.message : [], r = [];
    for (let i = a.length - 1; i >= 0 && r.length < Math.max(1, n + 1); i -= 1) {
      const s = a[i], VC = globalThis.__INLAY_VIEWER_CORE__, c = typeof VC?.rawMessageRole == "function" ? VC.rawMessageRole(s) : w(s?.role || s?.type || "").toLowerCase(), l = c === "char" || c === "assistant" || c === "bot", p = c === "user";
      !l && !(o && p) || r.unshift({
        role: p ? "user" : "char",
        content: yt(s)
      });
    }
    return r;
  }
  function isCharacterImageExtraLore(e) {
    return String(e?.comment || e?.name || "").trim().toLowerCase() === "lb-xnai.lb.extra";
  }
  async function la() {
    const e = await D("getCurrentLorebookEntries", () => k.getCurrentLorebookEntries?.(), []);
    return Array.isArray(e) ? e.slice(0, 500).map((n) => {
      const o = n?.key ?? n?.keys ?? "", a = Array.isArray(o) ? o.map((r) => w(r, 200)).filter(Boolean).join(", ") : w(o, 2e3);
      const comment = w(n?.comment || n?.name || "", 200);
      const extra = String(comment).trim().toLowerCase() === "lb-xnai.lb.extra";
      return {
        comment,
        content: w(n?.content || n?.data || "", extra ? 5e4 : 8e3),
        key: a,
        secondkey: w(n?.secondkey || n?.secondKey || "", 400),
        alwaysActive: !!(n?.alwaysActive || n?.constant),
        mode: w(n?.mode || "", 40)
      };
    }).filter((n) => n.content && n.mode !== "folder" && !String(n.key || "").startsWith("folder:")) : [];
  }
  function filledNamesFromUiRoster() {
    const out = [], seen = /* @__PURE__ */ new Set();
    const pushToken = (raw) => {
      const text = w(raw, 200);
      const key = text.toLowerCase().replace(/[^a-z0-9\uac00-\ud7a3\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]+/gi, "");
      if (!text || !key || seen.has(key)) return;
      seen.add(key);
      out.push(text);
    };
    for (const c of [...(t.charactersSession || []), ...(t.charactersGlobal || [])]) {
      if (!w(c?.appearance || "", 4000)) continue;
      pushToken(c?.name);
      const aliases = Array.isArray(c?.aliases) ? c.aliases : String(c?.aliases || "").split(/[,/\n]/);
      for (const a of aliases) pushToken(a);
    }
    return out;
  }
  function trimExtraLoreForMessage(entries, message, triggerKeys, filledNames = []) {
    const LE = globalThis.__INLAY_LORE_EXTRA__;
    const keys = Array.isArray(triggerKeys) ? triggerKeys : collectTriggeredLoreKeys(entries, message);
    const filled = Array.isArray(filledNames) ? filledNames : [];
    const out = [];
    for (const s of entries || []) {
      if (!isCharacterImageExtraLore(s) || !s?.content) continue;
      const raw = w(s.content, 5e4);
      let keepNames = [];
      if (typeof LE?.matchCharacterImageSectionTitles == "function") {
        keepNames = LE.matchCharacterImageSectionTitles(raw, message, keys) || [];
      }
      let trimmed = "";
      if (typeof LE?.trimCharacterImageTagLore == "function") {
        trimmed = LE.trimCharacterImageTagLore(raw, filled, keepNames) || "";
      }
      // Never ship the raw multi-character file. No keep → omit entirely.
      if (!trimmed || !keepNames.length) continue;
      out.push({
        ...s,
        content: trimmed,
        key: keepNames.join(", "),
        always: !0
      });
    }
    return out;
  }
  function normalizeLoreExtraMode(value) {
    if (value === !1 || value === "false" || value === "off" || value === "none") return "off";
    if (value === "full") return "full";
    return "tags";
  }
  function fullExtraLoreEntries(entries) {
    const out = [];
    for (const s of entries || []) {
      if (!isCharacterImageExtraLore(s) || !s?.content) continue;
      out.push({
        ...s,
        content: w(s.content, 5e4),
        key: "full",
        always: !0
      });
    }
    return out;
  }
  function ca(e, n, o = 5, loreExtraMode = "tags") {
    const mode = normalizeLoreExtraMode(loreExtraMode);
    const triggerKeys = collectTriggeredLoreKeys(e, n);
    const extras = mode === "off" ? [] : mode === "full" ? fullExtraLoreEntries(e) : trimExtraLoreForMessage(e, n, triggerKeys, filledNamesFromUiRoster());
    const a = w(n || "").toLowerCase(), r = a.replace(/\s+/g, "");
    if (!a) return extras;
    const countOcc = (hay, needle) => {
      if (!hay || !needle || needle.length < 2) return 0;
      let hits = 0, from = 0;
      while (from <= hay.length - needle.length) {
        const at = hay.indexOf(needle, from);
        if (at < 0) break;
        hits += 1, from = at + needle.length;
      }
      return hits;
    };
    const scored = [];
    for (const s of e || []) {
      if (!s?.content || isCharacterImageExtraLore(s) || s.mode === "folder" || String(s.key || "").startsWith("folder:")) continue;
      const c = String(s.key || "").split(/[,|\n]/).map((l) => l.trim()).filter(Boolean);
      if (s.secondkey) String(s.secondkey).split(/[,|\n]/).forEach((l) => {
        const p = l.trim();
        p && c.push(p);
      });
      if (!c.length) continue;
      let hits = 0;
      for (const l of c) {
        const p = l.toLowerCase(), m = p.replace(/\s+/g, "");
        if (m.length < 2) continue;
        hits += Math.max(countOcc(a, p), countOcc(r, m));
      }
      if (hits <= 0) continue;
      scored.push({
        ...s,
        content: w(s.content, 1200),
        hits
      });
    }
    scored.sort((x, y) => y.hits - x.hits || String(x.comment || "").localeCompare(String(y.comment || "")));
    return [...extras, ...scored.slice(0, Math.max(1, o)).map(({ hits, ...rest }) => rest)];
  }
  /** All trigger keys from EVERY lore entry that hits (not limited to top-5 content pack). */
  function collectTriggeredLoreKeys(entries, message) {
    const a = w(message || "").toLowerCase(), r = a.replace(/\s+/g, "");
    if (!a) return [];
    const countOcc = (hay, needle) => {
      if (!hay || !needle || needle.length < 2) return 0;
      let hits = 0, from = 0;
      while (from <= hay.length - needle.length) {
        const at = hay.indexOf(needle, from);
        if (at < 0) break;
        hits += 1, from = at + needle.length;
      }
      return hits;
    };
    const out = [], seen = /* @__PURE__ */ new Set();
    for (const s of entries || []) {
      if (!s || isCharacterImageExtraLore(s) || s.mode === "folder" || String(s.key || "").startsWith("folder:")) continue;
      const c = String(s.key || "").split(/[,|\n]/).map((l) => l.trim()).filter(Boolean);
      if (s.secondkey) String(s.secondkey).split(/[,|\n]/).forEach((l) => {
        const p = l.trim();
        p && c.push(p);
      });
      if (!c.length) continue;
      let hits = 0;
      for (const l of c) {
        const p = l.toLowerCase(), m = p.replace(/\s+/g, "");
        if (m.length < 2) continue;
        hits += Math.max(countOcc(a, p), countOcc(r, m));
      }
      if (hits <= 0) continue;
      for (const l of c) {
        const k = l.toLowerCase().replace(/\s+/g, "");
        if (k.length < 2 || seen.has(k)) continue;
        seen.add(k), out.push(l);
      }
    }
    return out;
  }
  function da(e) {
    const n = Array.isArray(e?.message) ? e.message : [];
    for (let o = n.length - 1; o >= 0; o -= 1) {
      const a = w(n[o]?.role || n[o]?.type || "").toLowerCase();
      if (a === "char" || a === "assistant" || a === "bot") return o;
    }
    return -1;
  }
  async function pa(e, n, o) {
    if (!e) return {
      ok: !1,
      unlinked: 0
    };
    try {
      const a = await K("/v1/gallery/unlink", {
        method: "POST",
        body: {
          session_id: e,
          content_hash: n || "",
          message_index: o
        }
      }, 15e3);
      return y("info", "gallery.unlink", `n=${a?.unlinked || 0} hash=${String(n || "").slice(0, 8)}`), a || {
        ok: !0,
        unlinked: 0
      };
    } catch (a) {
      return y("warn", "gallery.unlink.fail", a?.message || a), {
        ok: !1,
        unlinked: 0,
        error: a?.message || String(a)
      };
    }
  }
  async function flushDirtyCharacters(sessionId = "") {
    if (!t._charsDirty) return null;
    const scope = await Z().catch(() => null);
    const sid = w(sessionId || scope?.sessionId || t.lastScope?.sessionId || "", 200) || "";
    const hasDom = !!document.querySelector('[data-char-scope="session"], [data-char-scope="global"]');
    const body = withRootSessions({
      session_id: sid,
      character_id: w(scope?.characterId || t.lastScope?.characterId || "", 200),
      characters: hasDom ? oe("session") : t.charactersSession || [],
      global: hasDom ? oe("global") : t.charactersGlobal || []
    }, scope || t.lastScope);
    const res = await K("/v1/characters", {
      method: "POST",
      body
    }, 2e4);
    if (Array.isArray(res?.characters)) t.charactersSession = res.characters;
    if (Array.isArray(res?.global)) t.charactersGlobal = res.global;
    if (res?.appearance) t.appearance = res.appearance;
    t._charsDirty = !1;
    return res;
  }
  async function Be(e, n, o = !1) {
    const a = (t.backendSettings || await le())?.card || {};
    if (!o && a.power === !1)
      return y("warn", "job.skip", "power off"), null;
    // Persist cleared/edited appearance before LLM sees the roster.
    try {
      await flushDirtyCharacters(e.sessionId);
    } catch (err) {
      y("warn", "chars.flush", err?.message || err);
    }
    const loreExtraMode = normalizeLoreExtraMode(a.lore_extra), r = re(a.include_max, 0, 20, 0), i = a.lorebook ? await la() : [], s = a.lorebook ? ca(i, n, 5, loreExtraMode) : [], loreTriggerKeys = a.lorebook ? collectTriggeredLoreKeys(i, n) : [], c = e.character || {};
    y("info", "job.lore", `raw=${i.length} matched=${s.length} triggerKeys=${loreTriggerKeys.length} lore_extra=${loreExtraMode}`);
    const l = t.selectedMessage, m = ye(n), selectedMatches = !!(l?.hash && l.hash === m), p = selectedMatches && l?.chatIndex != null && Number(l.chatIndex) >= 0 ? Number(l.chatIndex) : da(e.chat);
    // Same-message work already running → defend (no interrupt), force or not.
    if (t.jobsInFlight.has(m) || (t.jobProgress && formatViewerJob(t.jobProgress)?.busy && t.selectedMessage?.hash === m)) {
      y("info", "job.busy", `same message in flight ${m.slice(0, 8)}`);
      try {
        if (t.galleryUi?.status?.setTextContent) await t.galleryUi.status.setTextContent("이미 작업 중… 끝날 때까지 기다려 주세요");
      } catch {
      }
      return null;
    }
    // Claim lock before unlink/create so duplicate clicks cannot race.
    t.jobsInFlight.set(m, Date.now()), t._lastShotDone = -1;
    if (!o) {
      try {
        await ce(e.sessionId);
      } catch {
      }
      // Exact hash first; streaming-complete text may need one-shot hash rebind.
      let b = ge(m, n);
      if (!b.length && !o) {
        try {
          b = await maybeRebindAndLink({
            hash: m,
            text: n,
            characterId: e.characterId,
            chatId: e.chatId,
            sessionId: e.sessionId,
            chatIndex: p,
            messageIndex: p,
            role: w(t.selectedMessage?.role || "char", 40)
          }, e);
        } catch {
        }
      }
      if (b.length)
        return t.jobsInFlight.delete(m), y("info", "job.skip", `cache hit hash=${m.slice(0, 8)} cards=${b.length}`), null;
      y("info", "job.noHash", `hash=${m.slice(0, 8)} · no cards → tag+generate`);
    }
    if (o) {
      await pa(e.sessionId, m, p);
      try {
        await ce(e.sessionId);
      } catch {
      }
      t.selectedMessage && t.selectedMessage.hash === m && (t.selectedMessage.hasImage = !1, t.selectedMessage.cardCount = 0, t.selectedMessage.paragraphsWithImages = [], t.selectedMessage.matchMode = "none");
      try {
        await he();
      } catch {
      }
      if (t.galleryUi?.renderGal) try {
        await t.galleryUi.renderGal();
      } catch {
      }
    }
    const u = {
      session_id: e.sessionId,
      character_id: e.characterId,
      character_name: w(e.characterName || c?.name || "", 200),
      chat_id: e.chatId,
      chat_name: w(e.chatName || "", 200),
      unified_session_id: e.unifiedSessionId || `risu_${ye(`${e.characterId || ""}|__unified__`)}`,
      source_session_ids: rootChatSessionIds(e),
      char_index: Number(e.charIndex ?? -1),
      chat_index: e.chatIndex === "unified" ? -1 : Number(e.chatIndex ?? -1),
      assistant_text: n,
      message_index: p,
      message_role: w(t.selectedMessage?.role || "char", 40),
      content_hash: m,
      recent_messages: Xe(e.chat, r, !!a.userchat),
      lorebook: s,
      lore_trigger_keys: loreTriggerKeys,
      character_description: w(c?.description || c?.desc || "", 12e3),
      persona_description: w(c?.personality || "", 8e3),
      force: o
    };
    y("info", "job.create", `hash=${m.slice(0, 8)} msg#${p} chars=${n.length} force=${!!o}`);
    try {
      const b = await K("/v1/jobs/create", {
        method: "POST",
        body: u
      }, 3e4);
      if (b?.busy || b?.error?.code === "busy") {
        t.jobsInFlight.delete(m);
        y("info", "job.busy", b?.error?.message || "busy");
        try {
          if (t.galleryUi?.status?.setTextContent) await t.galleryUi.status.setTextContent(b?.error?.message || "이미 작업 중… 끝날 때까지 기다려 주세요");
        } catch {
        }
        return null;
      }
      return t.activeJobId = b?.job_id || "", t.lastJobState = "queued", t.jobProgress = {
        state: "queued",
        message: "대기열…",
        progress: 0,
        shot_index: 0,
        shot_count: 0,
        shot_done: 0,
        jobId: b?.job_id || ""
      }, await Se(), y("info", "job.queued", b?.job_id || "(no id)"), t.galleryUi?.renderGal && await t.galleryUi.renderGal(), ua(e.sessionId, b?.job_id, m), b;
    } catch (b) {
      throw t.jobsInFlight.delete(m), t.lastJobState = "error", y("error", "job.create.fail", b?.message || b), b;
    }
  }
  function ua(e, n, o = "") {
    n && (t.pollTimer && clearInterval(t.pollTimer), t.pollTimer = setInterval(async () => {
      try {
        const a = await K(`/v1/jobs/${n}`, { method: "GET" }, 15e3);
        if (!a?.ok) return;
        const r = a.progress || {};
        t.jobProgress = {
          state: a.state || "",
          message: r.message || (a.state === "tagging" ? "장면 태깅 중…" : a.state === "generating" ? "이미지 생성 중…" : a.state === "queued" ? "대기열…" : a.state || ""),
          progress: Number(r.progress ?? (a.state === "done" ? 100 : 0)),
          shot_index: Number(r.shot_index ?? 0),
          shot_count: Number(r.shot_count ?? 0),
          shot_done: Number(r.shot_done ?? 0),
          jobId: n
        }, await Se();
        if (t.uiOpen) {
          if (a.state === "done" || a.state === "cancelled") {
            clearInterval(t.pollTimer), t.pollTimer = null, o && t.jobsInFlight.delete(o), y("info", a.state === "cancelled" ? "job.cancelled" : "job.done", n), t.jobProgress = {
              ...t.jobProgress,
              state: a.state === "cancelled" ? "cancelled" : "done",
              progress: a.state === "cancelled" ? Number(r.progress || 0) : 100,
              message: r.message || (a.state === "cancelled" ? "이전 작업 중단" : "생성 완료")
            }, await Se(), setTimeout(() => {
              t.jobProgress = null, Se().catch(() => {
              });
            }, a.state === "cancelled" ? 600 : 1800);
          } else a.state === "error" && (clearInterval(t.pollTimer), t.pollTimer = null, o && t.jobsInFlight.delete(o), t.uiMessage = {
            type: "error",
            text: z(a.error || "job failed", 400)
          }, t.jobProgress = {
            state: "error",
            progress: 0,
            message: z(a.error || "실패", 120),
            jobId: n
          }, await Se());
          return;
        }
        const i = Number(r.shot_done ?? 0), s = !!(a.state && a.state !== t.lastJobState), c = i !== Number(t._lastShotDone ?? -1);
        const VC = globalThis.__INLAY_VIEWER_CORE__;
        if (s && (t.lastJobState = a.state, y("info", "job.poll", `${n.slice(0, 8)}… → ${a.state}`)), r.message && r.message !== t._lastJobMsg && (t._lastJobMsg = r.message, y("info", "job.progress", r.message)), r.message && r.message !== t._lastJobMsg && (t._lastJobMsg = r.message, y("info", "job.progress", r.message)), (a.state === "generating" || a.state === "done") && (c || s && (a.state === "generating" || a.state === "done"))) {
          t._lastShotDone = i;
          const prevIds = (t.gallery || []).map((card) => String(card?.id || ""));
          try {
            if (await ce(e), t.selectedMessage) {
              const l = linkedCards(t.selectedMessage);
              t.selectedMessage.hasImage = l.length > 0, t.selectedMessage.cardCount = l.length, t.selectedMessage.paragraphsWithImages = [...new Set(l.map((p) => p.paragraph))].sort((p, m) => Number(p) - Number(m)), t.selectedMessage.matchMode = l.length ? (l.some((p) => p.content_hash && p.content_hash === t.selectedMessage.hash) ? "hash" : "prefix") : "none";
            }
          } catch {
          }
          const nextIds = (t.gallery || []).map((card) => String(card?.id || ""));
          const idsChanged = VC?.shouldRefreshGallery ? VC.shouldRefreshGallery(prevIds, nextIds) : prevIds.join("|") !== nextIds.join("|");
          if (idsChanged) {
            if (c) scheduleOverlayPlace(120);
            await onSelectionChanged("content");
          } else if (t.galleryUi?.paintStatus) await t.galleryUi.paintStatus();
          else await onSelectionChanged("chrome");
        } else if (s || a.state === "generating" || a.state === "tagging" || a.state === "queued") {
          if (t.galleryUi?.paintStatus) await t.galleryUi.paintStatus();
          else await onSelectionChanged("chrome");
        }
        if (a.state === "done" || a.state === "cancelled") {
          clearInterval(t.pollTimer), t.pollTimer = null, o && t.jobsInFlight.delete(o), y("info", a.state === "cancelled" ? "job.cancelled" : "job.done", n), t.jobProgress = {
            ...t.jobProgress,
            state: a.state === "cancelled" ? "cancelled" : "done",
            progress: a.state === "cancelled" ? Number(r.progress || 0) : 100,
            message: r.message || (a.state === "cancelled" ? "이전 작업 중단 · 새 요청 진행" : "생성 완료")
          }, await Se(), setTimeout(() => {
            t.jobProgress = null, Se().catch(() => {
            });
          }, a.state === "cancelled" ? 600 : 1800), y("info", "gallery.refresh", `${(t.gallery || []).length} cards`), await it();
          scheduleOverlayPlace(80);
          await onSelectionChanged("full");
        } else a.state === "error" && (clearInterval(t.pollTimer), t.pollTimer = null, o && t.jobsInFlight.delete(o), t.uiMessage = {
          type: "error",
          text: z(a.error || "job failed", 400)
        }, t.jobProgress = {
          state: "error",
          progress: 0,
          message: z(a.error || "실패", 120),
          jobId: n
        }, await Se(), y("error", "job.error", a.error || "failed"), await onSelectionChanged("chrome"));
      } catch (a) {
        Pe("poll", a);
      }
    }, 1e3));
  }
  async function ce(e, force = !1) {
    const n = e || t.lastScope?.sessionId;
    if (!n) return [];
    if (!force && t._galleryCache?.sessionId === n && Date.now() - Number(t._galleryCache.at || 0) < 2200 && Array.isArray(t.gallery)) return t.gallery;
    const prevGallery = Array.isArray(t.gallery) ? t.gallery : [];
    let o;
    try {
      o = await K(`/v1/gallery?session_id=${encodeURIComponent(n)}&limit=120`, { method: "GET" });
    } catch (err) {
      y("warn", "gallery.load.fail", err?.message || err);
      // Keep previous strip during job/IDB contention — empty overwrite looked like "연결 끊김".
      return prevGallery;
    }
    const nextItems = Array.isArray(o?.items) ? o.items : null;
    if (!nextItems) {
      y("warn", "gallery.load.empty", `session=${String(n).slice(-8)} · keep ${prevGallery.length}`);
      return prevGallery;
    }
    // Unexpected empty while we still have cards + a busy job → keep previous.
    if (!nextItems.length && prevGallery.length && (t.jobsInFlight.size || t.jobProgress)) {
      y("warn", "gallery.load.preserve", `busy + empty response · keep ${prevGallery.length}`);
      return prevGallery;
    }
    t.gallery = nextItems;
    t._galleryCache = { sessionId: n, at: Date.now() };
    try {
      const VC = globalThis.__INLAY_VIEWER_CORE__, N = globalThis.__INLAY_NATIVE__;
      if (typeof VC?.rebindGalleryMessageIndexes == "function") {
        try {
          const scope = await Za();
          const rebound = VC.rebindGalleryMessageIndexes(t.gallery, scope?.messages || [], ye);
          t.gallery = rebound.cards;
          if (rebound.changed) y("info", "gallery.rebind", `updated ${rebound.changed} card index(es)`);
        } catch {
        }
      }
      const focus = typeof VC?.galleryFocusMessage == "function" ? VC.galleryFocusMessage(t.selectedMessage, t.lastImagedMessage, t.gallery) : t.selectedMessage;
      const ordered = typeof VC?.galleryForMessage == "function" ? VC.galleryForMessage(t.gallery, focus, 8) : (t.gallery || []).slice(0, 8);
      const idx = Number(t.galleryUi?.index) || 0;
      const ids = VC?.visibleGalleryImageIds ? VC.visibleGalleryImageIds(ordered, idx, 1, Math.max(8, ordered.length || 0)) : ordered.map((c) => c?.id).filter(Boolean);
      if (typeof N?.warmImages == "function") N.warmImages(ids).catch(() => {
      });
    } catch {
    }
    try {
      const charId = w(t.lastScope?.characterId || "", 200), a = await K(`/v1/characters?session_id=${encodeURIComponent(n)}${charId ? `&character_id=${encodeURIComponent(charId)}` : ""}`, { method: "GET" });
      t.appearance = a?.appearance || {}, t.charactersSession = a?.characters || [], t.charactersGlobal = a?.global || [], t.disabledGlobals = Array.isArray(a?.disabled_globals) ? a.disabled_globals : [];
    } catch {
      try {
        const r = await K(`/v1/appearance/${encodeURIComponent(n)}`, { method: "GET" });
        t.appearance = r?.appearance || {}, t.charactersSession = r?.characters || [], t.charactersGlobal = r?.global || [];
      } catch {
      }
    }
    return t.gallery;
  }
  function globalCharKey(e) {
    return w(e?.id || e?.name || "", 200);
  }
  function isGlobalEnabledForCharacter(e) {
    const n = t.disabledGlobals || [], o = globalCharKey(e), a = w(e?.name || "", 200);
    if (n.some((r) => r === o || r === a || String(r).toLowerCase() === a.toLowerCase())) return !1;
    return e && typeof e.enabled_for_character == "boolean" ? e.enabled_for_character : !0;
  }
  function enabledGlobalsForCharacter() {
    return (t.charactersGlobal || []).filter((e) => isGlobalEnabledForCharacter(e));
  }
  async function saveGlobalToggles() {
    const e = await Z().catch(() => null), n = w(e?.characterId || t.lastScope?.characterId || "", 200);
    if (!n) throw new Error("캐릭터 없음");
    const o = await K("/v1/characters/global-toggles", {
      method: "POST",
      body: {
        character_id: n,
        disabled_globals: Array.isArray(t.disabledGlobals) ? t.disabledGlobals : []
      }
    }, 12e3);
    return t.disabledGlobals = Array.isArray(o?.disabled_globals) ? o.disabled_globals : t.disabledGlobals, o;
  }
  function oe(e) {
    return [...document.querySelectorAll(`[data-char-scope="${e}"]`)].map((n, o) => {
      const a = n.getAttribute("data-char-id") || "", r = n.querySelector("[data-char-name]")?.value || "", i = n.querySelector("[data-char-original]")?.value || "", s = n.querySelector("[data-char-aliases]")?.value || "", c = n.querySelector("[data-char-appearance]")?.value || "", l = n.querySelector("[data-char-attire]")?.value || "", acc = n.querySelector("[data-char-accessories]")?.value || "", p = (q) => String(n.querySelector(q)?.value || "").split(/[,/\n]/).map((B) => B.trim()).filter(Boolean);
      return {
        id: a || `tmp_${e}_${o}`,
        name: String(r).trim(),
        original: String(i).trim(),
        aliases: String(s).split(/[,/\n]/).map((B) => B.trim()).filter(Boolean),
        surname: String(n.querySelector("[data-char-surname]")?.value || "").trim(),
        given_name: String(n.querySelector("[data-char-given]")?.value || "").trim(),
        surname_variants: p("[data-char-surname-variants]"),
        given_name_variants: p("[data-char-given-variants]"),
        appearance: String(c).trim(),
        attire: String(l).trim(),
        accessories: String(acc).trim(),
        attire_locked: !!n.querySelector("[data-char-attire-locked]")?.checked,
        accessories_locked: !!n.querySelector("[data-char-accessories-locked]")?.checked,
        priority: Number(n.querySelector("[data-char-priority]")?.value || 0)
      };
    }).filter((n) => n.name);
  }
  function charExportKey(e) {
    return String(e?.id || e?.name || "").trim().toLowerCase();
  }
  function mergeCharacterLists(existing, incoming) {
    const out = Array.isArray(existing) ? existing.map((e) => ({
      ...e
    })) : [];
    for (const raw of incoming || []) {
      if (!raw || typeof raw != "object") continue;
      const name = String(raw.name || "").trim();
      if (!name) continue;
      const key = charExportKey(raw), nameKey = name.toLowerCase();
      const idx = out.findIndex((e) => charExportKey(e) === key || String(e?.name || "").trim().toLowerCase() === nameKey);
      const next = {
        id: String(raw.id || "").trim() || (idx >= 0 ? out[idx].id : name),
        name,
        original: String(raw.original || "").trim(),
        aliases: Array.isArray(raw.aliases) ? raw.aliases : String(raw.aliases || "").split(/[,/\n]/).map((B) => B.trim()).filter(Boolean),
        surname: String(raw.surname || "").trim(),
        given_name: String(raw.given_name || "").trim(),
        surname_variants: Array.isArray(raw.surname_variants) ? raw.surname_variants : String(raw.surname_variants || "").split(/[,/\n]/).map((B) => B.trim()).filter(Boolean),
        given_name_variants: Array.isArray(raw.given_name_variants) ? raw.given_name_variants : String(raw.given_name_variants || "").split(/[,/\n]/).map((B) => B.trim()).filter(Boolean),
        appearance: String(raw.appearance || "").trim(),
        attire: String(raw.attire || "").trim(),
        accessories: String(raw.accessories || "").trim(),
        attire_locked: !!raw.attire_locked,
        accessories_locked: !!raw.accessories_locked,
        priority: Number(raw.priority || 0) || 0
      };
      if (idx >= 0) out[idx] = {
        ...out[idx],
        ...next,
        id: out[idx].id || next.id
      };
      else out.push(next);
    }
    return out;
  }
  function parseCharactersImportJson(text, preferScope) {
    const parsed = JSON.parse(String(text || ""));
    if (Array.isArray(parsed)) {
      return {
        session: preferScope === "session" ? parsed : null,
        global: preferScope === "global" ? parsed : null
      };
    }
    if (!parsed || typeof parsed != "object") throw new Error("JSON 객체가 아닙니다");
    const session = Array.isArray(parsed.session) ? parsed.session : Array.isArray(parsed.characters) && (parsed.scope === "session" || preferScope === "session" && parsed.scope !== "global") ? parsed.characters : null;
    const global = Array.isArray(parsed.global) ? parsed.global : Array.isArray(parsed.characters) && (parsed.scope === "global" || preferScope === "global" && parsed.scope !== "session") ? parsed.characters : null;
    if (!session && !global && Array.isArray(parsed.characters)) {
      return preferScope === "global" ? {
        session: null,
        global: parsed.characters
      } : {
        session: parsed.characters,
        global: null
      };
    }
    if (!session && !global) throw new Error("characters / session / global 배열이 없습니다");
    return {
      session,
      global
    };
  }
  function downloadCharactersJson(filename, payload) {
    const n = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    }), o = URL.createObjectURL(n), a = document.createElement("a");
    a.href = o, a.download = filename, document.body.appendChild(a), a.click(), a.remove(), setTimeout(() => URL.revokeObjectURL(o), 1e3);
  }
  async function exportCharactersScope(scope) {
    const list = oe(scope);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCharactersJson(`inlay-${scope}-characters-${stamp}.json`, {
      format: "inlay-nexus-characters",
      version: 1,
      scope,
      exported_at: new Date().toISOString(),
      characters: list,
      ...(scope === "session" ? {
        session: list
      } : {
        global: list
      })
    });
    return list.length;
  }
  async function importCharactersFromFile(file, preferScope) {
    const parsed = parseCharactersImportJson(await file.text(), preferScope);
    const scope = await Z().catch(() => null);
    const body = {
      session_id: scope?.sessionId || "",
      character_id: scope?.characterId || ""
    };
    let sessionCount = 0, globalCount = 0;
    if (Array.isArray(parsed.session)) {
      const merged = mergeCharacterLists(oe("session"), parsed.session);
      body.characters = merged, sessionCount = merged.length;
    }
    if (Array.isArray(parsed.global)) {
      const merged = mergeCharacterLists(oe("global"), parsed.global);
      body.global = merged, globalCount = merged.length;
    }
    if (!("characters" in body) && !("global" in body)) throw new Error("가져올 캐릭터가 없습니다");
    const res = await K("/v1/characters", {
      method: "POST",
      body
    }, 2e4);
    if (Array.isArray(res?.characters)) t.charactersSession = res.characters;
    else if (body.characters) t.charactersSession = body.characters;
    if (Array.isArray(res?.global)) t.charactersGlobal = res.global;
    else if (body.global) t.charactersGlobal = body.global;
    if (res?.appearance) t.appearance = res.appearance;
    t._charsDirty = !1;
    return {
      sessionCount,
      globalCount
    };
  }
  function wt(e, n, o) {
    const a = Array.isArray(e) ? e : [];
    return a.length ? a.map((r) => {
      const i = Array.isArray(r.aliases) ? r.aliases.join(", ") : String(r.aliases || ""), s = String(r.id || r.name || ""), c = h(s), l = t.autotagFocus && String(t.autotagFocus.scope || "") === String(n) && String(t.autotagFocus.id || "") === s, p = n === "global" ? isGlobalEnabledForCharacter(r) : !0;
      const appEmpty = !String(r.appearance || "").trim();
      const globalHit = n === "session" && appEmpty
        ? (t.charactersGlobal || []).find((g) => String(g?.name || "").trim().toLowerCase() === String(r.name || "").trim().toLowerCase() && String(g?.appearance || "").trim())
        : null;
      const globalHint = globalHit
        ? `<div class="notice info" style="margin:8px 0 0;font-size:12px">채팅 외형은 비어 있지만 같은 이름 <strong>글로벌</strong> 외형이 적용됩니다(옷만 이 채팅에 덮어쓴 상태). 비우거나 다시 뽑게 하려면 글로벌 외형을 지우세요.</div>`
        : appEmpty
          ? `<div class="muted" style="margin:8px 0 0;font-size:12px">외형 비어 있음 → 생성 시 미완성으로 보내 new_characters 수집</div>`
          : "";
      return `
        <details class="card char-card${l ? " autotag-armed" : ""}${n === "global" && !p ? " global-off" : ""}" data-char-scope="${h(n)}" data-char-id="${c}"${l ? " open" : ""} style="${n === "global" && !p ? "opacity:.62" : ""}">
          <summary style="cursor:pointer;font-weight:700;display:flex;align-items:center;gap:8px;list-style:none;flex-wrap:wrap">
            <span style="flex:1;min-width:120px">${h(r.name || "(이름 없음)")}${r.original ? ` · <span class="muted" style="font-weight:500">${h(r.original)}</span>` : ""}${appEmpty ? ' · <span class="muted" style="font-weight:500;color:#fbbf24">외형 없음</span>' : ""}</span>
            <span class="autotag-badge${l ? " show" : ""}" data-autotag-badge>${l ? "선택됨 · Ctrl+V" : ""}</span>
            <button type="button" class="secondary${l ? " armed" : ""}" data-char-autotag title="클릭: 붙여넣기 대상 선택 · 더블클릭: 파일 선택">${l ? "붙여넣기 대기" : "오토태그"}</button>
            ${n === "session" ? '<button type="button" class="secondary" data-char-to-global style="min-height:30px;padding:4px 10px;flex-shrink:0">글로벌</button>' : ""}
            <button type="button" class="secondary" data-char-delete style="min-height:30px;padding:4px 10px;flex-shrink:0">삭제</button>
          </summary>
          ${globalHint}
          <div class="model-form" style="margin-top:12px">
            ${n === "global" ? `<label class="toggle-row" data-global-toggle-wrap><input data-global-toggle="${c}" type="checkbox" ${p ? "checked" : ""}><span>이 캐릭터 챗에서 사용 (ON/OFF)</span></label>` : ""}
            <label><span>이름</span><input data-char-name value="${h(r.name || "")}"></label>
            <label><span>원본 태그</span><input data-char-original value="${h(r.original || "")}" placeholder="(원작 캐릭터 태그)"></label>
            <div class="char-name-grid wide">
              <span class="char-name-corner"></span><span class="char-name-col">기본</span><span class="char-name-col">한·영</span>
              <span class="char-name-row">성</span>
              <input data-char-surname value="${h(r.surname || "")}" placeholder="한">
              <input data-char-surname-variants value="${h(Array.isArray(r.surname_variants) ? r.surname_variants.join(", ") : r.surname_variants || "")}" placeholder="Han, HAN">
              <span class="char-name-row">이름</span>
              <input data-char-given value="${h(r.given_name || "")}" placeholder="진우">
              <input data-char-given-variants value="${h(Array.isArray(r.given_name_variants) ? r.given_name_variants.join(", ") : r.given_name_variants || "")}" placeholder="Jinwoo, JINWOO">
            </div>
            <label class="wide"><span>트리거/별칭</span><input data-char-aliases value="${h(i)}" placeholder="한진우, HAN JINWOO, 진우"></label>
            <label class="wide"><span>외형 태그 (옷·악세사리 제외)</span><textarea data-char-appearance rows="3">${h(r.appearance || "")}</textarea></label>
            <div class="char-wear-grid wide">
              <div class="char-wear-col">
                <div class="char-wear-head"><span>옷 태그</span><label class="char-lock"><input data-char-attire-locked type="checkbox" ${r.attire_locked ? "checked" : ""}><span>고정</span></label></div>
                <textarea data-char-attire rows="2">${h(r.attire || "")}</textarea>
              </div>
              <div class="char-wear-col">
                <div class="char-wear-head"><span>악세사리·무기·기타</span><label class="char-lock"><input data-char-accessories-locked type="checkbox" ${r.accessories_locked ? "checked" : ""}><span>고정</span></label></div>
                <textarea data-char-accessories rows="2">${h(r.accessories || "")}</textarea>
              </div>
            </div>
            <label><span>우선순위</span><input data-char-priority type="number" value="${h(r.priority ?? 0)}"></label>
            <div class="autotag-status muted${l ? " pending" : ""}" data-autotag-status>${l ? "이 캐릭터 선택됨 · Ctrl+V로 이미지 붙여넣기 · 더블클릭으로 파일 선택" : "오토태그: 버튼 클릭=대상 선택(노란 표시) · 더블클릭=파일"}</div>
          </div>
        </details>`;
    }).join("") : `<div class="card"><div class="muted">${h(o)}</div></div>`;
  }
  function vt() {
    document.querySelectorAll(".char-card.autotag-armed").forEach((e) => e.classList.remove("autotag-armed")), document.querySelectorAll("[data-char-autotag].armed").forEach((e) => {
      e.classList.remove("armed"), e.textContent = "오토태그";
    }), document.querySelectorAll("[data-autotag-badge]").forEach((e) => {
      e.classList.remove("show"), e.textContent = "";
    });
  }
  function Qe(e, { open: n = !0 } = {}) {
    if (!e) return;
    vt(), t.autotagFocus = {
      scope: e.getAttribute("data-char-scope"),
      id: e.getAttribute("data-char-id") || ""
    }, e.classList.add("autotag-armed"), n && (e.open = !0);
    const o = e.querySelector("[data-char-autotag]");
    o && (o.classList.add("armed"), o.textContent = "붙여넣기 대기");
    const a = e.querySelector("[data-autotag-badge]");
    a && (a.classList.add("show"), a.textContent = "선택됨 · Ctrl+V");
    const r = e.querySelector("[data-autotag-status]");
    r && (r.className = "autotag-status muted pending", r.textContent = "이 캐릭터 선택됨 · Ctrl+V로 이미지 붙여넣기 · 더블클릭으로 파일 선택");
  }
  async function _t(e, n = "") {
    try {
      const o = await ve();
      if (!o.enabled)
        return y("info", "afterRequest.skip", "plugin disabled"), e;
      const a = w(e, 5e4);
      if (!a || a.length < 8)
        return y("info", "afterRequest.skip", "text too short"), e;
      const r = await Z({ useOverride: !1 });
      if (!r || r.charIndex < 0)
        return y("warn", "afterRequest.skip", "no scope"), e;
      try {
        await le();
      } catch {
      }
      try {
        if (!t.galleryUi?.root || !t.overlayUi?.root) await it();
      } catch {
      }
      const i = t.backendSettings?.card || {};
      if (i.power === !1) return y("info", "afterRequest.skip", "power off"), e;
      if (i.execute === "manual") return y("info", "afterRequest.skip", "execute=manual"), e;
      if (!i.auto_gen_on_reply) return y("info", "afterRequest.skip", "reply-auto-gen-off"), e;
      y("info", "afterRequest.gen", `chars=${a.length} session=${(r.sessionId || "").slice(-8)}`);
      await Be(r, a, !1);
      return e;
    } catch (o) {
      y("error", "afterRequest.fail", o?.message || o);
    }
    return e;
  }
  const ga = `
:root{color-scheme:dark;--bg:#080b12;--surface:#101622;--border:rgba(163,184,216,.14);--border2:rgba(163,184,216,.24);--accent:#7c6cff;--accent2:#9b8cff;--accent-soft:rgba(124,108,255,.14);--text:#f4f7fb;--muted:#a6b1c2;--muted2:#778398;--ok:#68d9a0;--warn:#f5c76d;--err:#ff7e92}
*{box-sizing:border-box}html{min-height:100%;background:var(--bg)}
body{min-height:100vh;margin:0;background:radial-gradient(circle at 12% 0,rgba(124,108,255,.13),transparent 32rem),var(--bg);color:var(--text);font:14px/1.6 "Segoe UI Variable Text",Pretendard,"Noto Sans KR","Segoe UI",system-ui,sans-serif}
button,input,select,textarea{font:inherit}
.wrap{width:min(1240px,100%);margin:0 auto;padding:24px clamp(16px,3vw,38px) 56px}
.chrome{position:sticky;top:0;z-index:200;margin:0 0 16px;padding:10px 0 8px;background:linear-gradient(180deg,rgba(8,11,18,.98) 70%,rgba(8,11,18,.88));backdrop-filter:blur(18px)}
.head{position:relative;z-index:2;display:flex;justify-content:space-between;gap:12px;align-items:center;margin:0 0 10px;padding:10px 14px 10px 16px;min-height:92px;background:rgba(13,18,29,.92);border:1px solid var(--border);border-radius:18px}
.head-brand{flex:0 0 auto;min-width:0;display:flex;flex-direction:column;justify-content:center}
.head-help{flex:1 1 auto;min-width:320px;max-width:760px;height:72px;min-height:72px;max-height:72px;padding:8px 12px;border-radius:12px;border:1px solid var(--border);background:rgba(7,10,17,.55);display:flex;flex-direction:row;align-items:stretch;gap:10px;overflow:hidden;box-sizing:border-box}
.head-help.is-active{border-color:rgba(124,108,255,.35);background:rgba(124,108,255,.08)}
.head-help-title{flex:0 0 108px;width:108px;max-width:108px;display:flex;align-items:center;padding-right:10px;margin-right:2px;border-right:1px solid var(--border);font-size:10px;font-weight:740;color:var(--accent2);letter-spacing:.01em;line-height:1.25;word-break:keep-all;overflow:hidden}
.head-help-body{flex:1 1 auto;min-width:0;min-height:0;font-size:11px;line-height:1.4;color:var(--muted);overflow-x:hidden;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(163,184,216,.35) transparent}
.head-help-body::-webkit-scrollbar{width:6px}
.head-help-body::-webkit-scrollbar-thumb{background:rgba(163,184,216,.35);border-radius:999px}
.tabs{position:relative;z-index:2;margin:0!important}
h1{margin:0;font-size:clamp(18px,2.4vw,26px);font-weight:760;letter-spacing:-.035em}h1:before{content:"";display:inline-block;width:10px;height:10px;margin:0 11px 2px 1px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 5px var(--accent-soft)}
.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:18px 0}
.card,.model-card{background:linear-gradient(145deg,rgba(23,31,46,.94),rgba(14,20,31,.96));border:1px solid var(--border);border-radius:18px;padding:18px;box-shadow:0 12px 34px rgba(0,0,0,.18)}
.model-card{border-radius:20px;padding:22px;margin:15px 0}
.card strong{font-size:11px;font-weight:720;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.value{font-size:18px;font-weight:720;margin-top:7px}
button{min-height:38px;padding:8px 15px;border:1px solid rgba(255,255,255,.08);border-radius:11px;background:var(--accent);color:#fff;font-weight:680;cursor:pointer}
button.secondary{background:rgba(150,166,190,.1);border-color:var(--border);color:#dce4f0;box-shadow:none}
.tabs{display:flex;gap:7px;margin:20px 0 16px;padding:5px;width:max-content;max-width:100%;overflow:auto;background:rgba(17,23,35,.75);border:1px solid var(--border);border-radius:14px}
.tab{min-height:38px;padding:8px 17px;border:0;border-radius:10px;background:transparent;color:var(--muted);box-shadow:none}.tab.active{background:var(--accent-soft);color:#dcd7ff}
.notice{margin:16px 0;padding:13px 15px;border:1px solid;border-radius:14px;font-size:13px}.notice.info{background:rgba(67,126,218,.11);border-color:rgba(85,145,240,.3)}.notice.success{background:rgba(56,177,116,.1);border-color:rgba(75,210,142,.28)}.notice.error{background:rgba(219,72,94,.11);border-color:rgba(255,100,123,.3)}
.prompt-toolbar,.model-head,.model-actions,.toolbar-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}
.prompt-toolbar{margin:6px 0 16px}.prompt-title{font-size:19px;font-weight:740;letter-spacing:-.02em}
.badge{white-space:nowrap;border:1px solid transparent;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:720}
.badge.default{background:rgba(57,193,124,.12);border-color:rgba(80,218,148,.18);color:var(--ok)}
.badge.custom{background:rgba(225,167,56,.13);border-color:rgba(245,199,109,.2);color:var(--warn)}
.model-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px;margin-top:18px}
.model-form label{display:flex;flex-direction:column;gap:6px;color:#bbc6d8;font-size:11px;font-weight:680;text-transform:uppercase;letter-spacing:.055em}
.model-form label.wide{grid-column:1/-1;text-transform:none}
.char-name-grid{grid-column:1/-1;display:grid;grid-template-columns:36px minmax(0,1fr) minmax(0,1.15fr);gap:6px 8px;align-items:center;padding:8px 10px;border:1px solid var(--border);border-radius:12px;background:rgba(7,10,17,.35)}
.char-wear-grid{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:start}
.char-wear-col{display:grid;gap:4px;min-width:0}
.char-wear-head{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:12px;font-weight:600;color:var(--muted)}
.char-lock{display:inline-flex;align-items:center;gap:4px;margin:0;padding:0;font-size:11px;font-weight:550;color:var(--text);cursor:pointer;white-space:nowrap;user-select:none}
.char-lock input{width:14px!important;height:14px!important;min-width:14px!important;min-height:14px!important;max-width:14px!important;margin:0;padding:0;flex:0 0 14px;accent-color:var(--accent)}
.char-wear-grid textarea{width:100%;min-height:56px;resize:vertical;box-sizing:border-box}
.char-name-corner{min-height:1px}.char-name-col{font-size:10px;font-weight:700;color:#778398;letter-spacing:.04em;text-transform:uppercase}
.char-name-row{font-size:11px;font-weight:700;color:#9aa6b8;letter-spacing:.04em}
.char-name-grid input{width:100%;min-height:34px;border:1px solid var(--border2);border-radius:9px;background:rgba(7,10,17,.7);color:var(--text);padding:6px 9px;font-size:13px}
.model-form label.check{flex-direction:row;align-items:center;gap:8px;text-transform:none;font-size:13px;font-weight:600;letter-spacing:0;color:var(--text);min-height:auto}
.model-form input:not([type=checkbox]),.model-form select,textarea{width:100%;min-height:41px;border:1px solid var(--border2);border-radius:11px;background:rgba(7,10,17,.7);color:var(--text);padding:9px 11px;font-size:13px}
.model-form input[type=checkbox],.toggle-row input[type=checkbox],.row input[type=checkbox]{width:16px!important;height:16px!important;min-width:16px!important;min-height:16px!important;max-width:16px!important;margin:0;padding:0;flex:0 0 16px;accent-color:var(--accent);border:none;background:transparent;border-radius:3px}
textarea{min-height:280px;resize:vertical;font:12.5px/1.65 Consolas,monospace}
.row{display:flex;align-items:center;gap:10px;margin-top:9px;flex-wrap:wrap}
.toggle-row{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:nowrap;line-height:1.4;color:var(--text);font-size:14px;font-weight:560;border-radius:10px;padding:4px 6px;margin-left:-6px;margin-right:-6px;cursor:help;transition:background .12s ease}
.toggle-row:hover,.toggle-row.is-help-active{background:rgba(124,108,255,.08)}
.toggle-row span{flex:1;min-width:0}
.model-form label[data-nx-help-id],.row button[data-nx-help-id]{cursor:help}
.model-form label.is-help-active{color:var(--text)}
.checks-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px 16px;margin-top:8px}
.preset-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0 12px}
.preset-toolbar select{min-width:min(280px,100%);flex:1}
.preset-chip-row{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
.preset-chip{border:1px solid var(--border);background:rgba(150,166,190,.08);color:var(--muted);border-radius:999px;padding:5px 11px;min-height:30px;font-size:12px;font-weight:650}
.preset-chip.active{background:var(--accent-soft);border-color:rgba(124,108,255,.45);color:#e4e0ff}
.import-box{min-height:120px;font:12px/1.5 Consolas,monospace}
.section-split{height:1px;background:var(--border);margin:18px 0}
.model-hint{margin-top:14px}.model-actions{justify-content:flex-start;margin-top:15px;gap:9px;flex-wrap:wrap}
.nx-seg{display:flex;gap:0;border:1px solid var(--border2);border-radius:11px;overflow:hidden;background:rgba(7,10,17,.55)}
.nx-seg button{flex:1;min-height:40px;border:0;border-right:1px solid var(--border2);background:transparent;color:#9aa6b8;font-size:13px;font-weight:700;cursor:pointer;padding:8px 10px}
.nx-seg button:last-child{border-right:0}
.nx-seg button.active{background:rgba(124,108,255,.22);color:var(--text)}
.nx-comfy-help{margin-top:12px;padding:12px 14px;border:1px solid rgba(85,145,240,.28);border-radius:12px;background:rgba(67,126,218,.08);color:#c5d0e2;font-size:12.5px;line-height:1.55}
.nx-comfy-help code{font-family:Consolas,monospace;color:#e8eef8;background:rgba(0,0,0,.25);padding:1px 5px;border-radius:5px}
.test-result{color:var(--muted);font-size:12px;line-height:1.45;max-width:100%}
.test-result.success{color:var(--ok)}.test-result.error{color:var(--err)}.test-result.pending{color:var(--warn)}
.key-status{color:var(--ok);font-weight:700;margin-left:6px}
.prompt-group-label{font-size:11px;font-weight:750;color:#8995aa;text-transform:uppercase;letter-spacing:.11em;margin:24px 3px 8px;padding-bottom:9px;border-bottom:1px solid var(--border)}
.head-actions{display:flex;gap:8px;align-items:center;flex-shrink:0}
.scope-bar .model-form{gap:10px}
.ref-preview{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:10px}
.ref-preview img{width:88px;height:88px;object-fit:cover;border-radius:12px;border:1px solid var(--border);background:#0b0f18}
.explorer-layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:14px;min-height:520px}
.explorer-side,.explorer-main{background:linear-gradient(145deg,rgba(23,31,46,.94),rgba(14,20,31,.96));border:1px solid var(--border);border-radius:18px;overflow:hidden}
.explorer-side{display:flex;flex-direction:column}
.explorer-side-head,.explorer-main-head{padding:12px 14px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.explorer-folders{flex:1;overflow:auto;padding:8px}
.explorer-folder{width:100%;text-align:left;border:0;background:transparent;color:var(--muted);padding:10px 12px;border-radius:10px;cursor:pointer;display:flex;flex-direction:column;gap:3px}
.explorer-folder.active,.explorer-folder:hover{background:var(--accent-soft);color:#e8e4ff}
.explorer-folder strong{font-size:13px;font-weight:700;color:inherit}
.explorer-folder span{font-size:11px;opacity:.8}
.explorer-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.explorer-selbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 14px;border-bottom:1px solid var(--border);background:rgba(124,108,255,.08);min-height:44px}
.explorer-selbar .ex-mobile-select.active{background:var(--accent-soft);border-color:rgba(124,108,255,.45);color:#e4e0ff}
.explorer-grid{position:relative;display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--ex-thumb,148px),1fr));gap:12px;padding:14px;max-height:620px;overflow:auto;user-select:none}
.explorer-card{position:relative;border:1px solid var(--border);border-radius:14px;overflow:hidden;background:rgba(7,10,17,.55);cursor:pointer;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease}
.explorer-card:hover{transform:translateY(-2px);border-color:rgba(124,108,255,.55)}
.explorer-card.selected{border-color:rgba(124,108,255,.9);box-shadow:0 0 0 2px rgba(124,108,255,.35)}
.explorer-card.focus{outline:2px solid rgba(232,228,255,.55);outline-offset:1px}
.explorer-card img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;background:#0b0f18;pointer-events:none}
.explorer-card .cap{padding:8px 10px;font-size:11px;color:#c4d0e2;line-height:1.35}
.explorer-card .ex-check{position:absolute;left:8px;top:8px;width:18px;height:18px;border-radius:5px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.35);z-index:2;display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff}
.explorer-card.selected .ex-check{background:var(--accent);border-color:transparent}
.explorer-card .ex-star{position:absolute;right:6px;top:6px;z-index:3;border:0;margin:0;padding:0;background:rgba(8,12,20,.72);color:#fbbf24;border-radius:999px;width:36px;height:36px;min-width:36px;min-height:36px;cursor:pointer;font-size:18px;line-height:1;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.35);-webkit-tap-highlight-color:transparent}
.explorer-card .ex-star:hover,.explorer-card .ex-star:focus-visible{background:rgba(20,28,44,.9);transform:scale(1.06)}
.explorer-card .ex-star.is-on{background:rgba(251,191,36,.22);color:#fcd34d}
.explorer-marquee{position:absolute;border:1px solid rgba(124,108,255,.8);background:rgba(124,108,255,.15);pointer-events:none;z-index:5;display:none}
.explorer-tip{position:fixed;z-index:40;pointer-events:none;max-width:280px;padding:10px 12px;border-radius:12px;background:rgba(10,14,22,.95);border:1px solid rgba(163,184,216,.28);color:#e8eef8;font-size:12px;box-shadow:0 12px 30px rgba(0,0,0,.35);display:none}
.explorer-ctx{position:fixed;z-index:60;min-width:180px;padding:6px;border-radius:12px;background:rgba(12,16,24,.98);border:1px solid rgba(163,184,216,.28);box-shadow:0 16px 40px rgba(0,0,0,.45);display:none}
.explorer-ctx button{display:block;width:100%;text-align:left;border:0;background:transparent;color:#e8eef8;padding:8px 10px;border-radius:8px;font-size:12px;cursor:pointer}
.explorer-ctx button:hover{background:rgba(124,108,255,.18)}
.explorer-lightbox{position:fixed;inset:0;z-index:300;display:none;background:rgba(0,0,0,.92);align-items:center;justify-content:center;flex-direction:column;gap:10px;padding:16px;box-sizing:border-box}
.explorer-lightbox.show{display:flex}
.explorer-lightbox .lb-stage{position:relative;flex:1;width:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:default}
.explorer-lightbox img{max-width:100%;max-height:calc(100dvh - 120px);object-fit:contain;transform-origin:center center;user-select:none;-webkit-user-drag:none;cursor:grab}
.explorer-lightbox .lb-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:center;pointer-events:auto}
.explorer-lightbox .lb-bar .ex-mobile-select.active{background:var(--accent-soft);border-color:rgba(124,108,255,.45);color:#e4e0ff}
.model-form-pair{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}
.preset-chip{cursor:grab}.preset-chip.dragging{opacity:.45}.preset-chip.drag-over{outline:2px dashed rgba(124,108,255,.7)}
@media(max-width:700px){.model-form-pair{grid-template-columns:1fr}}
.progress-rail{height:8px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:8px}
.progress-fill{height:100%;width:0;border-radius:inherit;background:linear-gradient(90deg,#7c6cff,#9b8cff);transition:width .25s ease}
.save-flash{font-size:11px;color:var(--ok);min-width:4em;text-align:right}
.autotag-status{grid-column:1/-1;font-size:12px;line-height:1.4}
.autotag-status.pending{color:var(--warn)}.autotag-status.ok{color:var(--ok)}.autotag-status.err{color:var(--err)}
.char-card.autotag-armed{border-color:rgba(255,196,72,.9)!important;box-shadow:0 0 0 1px rgba(255,196,72,.4),0 10px 28px rgba(255,196,72,.12)}
button[data-char-autotag]{min-height:30px;padding:4px 10px;flex-shrink:0;transition:background .15s ease,border-color .15s ease,color .15s ease}
button[data-char-autotag].armed{background:rgba(255,196,72,.24);border-color:rgba(255,196,72,.8);color:#ffe7a8;font-weight:800}
.autotag-badge{display:none;font-size:11px;font-weight:750;color:#ffe7a8;background:rgba(255,196,72,.2);border:1px solid rgba(255,196,72,.5);border-radius:999px;padding:3px 9px;white-space:nowrap;flex-shrink:0}
.autotag-badge.show{display:inline-flex;align-items:center}
@media(max-width:900px){.explorer-layout{grid-template-columns:1fr}.head{flex-wrap:wrap;min-height:0;align-items:stretch}.head-help{order:3;flex:1 1 100%;max-width:none;min-width:0;height:72px;min-height:72px;max-height:72px}.head-help-title{flex-basis:96px;width:96px;max-width:96px}}
@media(max-width:700px){.model-form{grid-template-columns:1fr}.model-head{align-items:flex-start;flex-direction:column}.head-actions{flex-wrap:wrap;justify-content:flex-end}}
`;
  const HEAD_HELP_DEFAULT = {
    title: "도움말",
    body: "설정에 마우스를 올리면 설명이 여기에 나타납니다."
  };
  const HEAD_HELP = {
    "nx-power": { title: "Power ON", body: "플러그인 전체를 켜거나 끕니다. 끄면 이미지 생성과 표시가 멈춥니다." },
    "nx-floating-viewer": { title: "플로팅 뷰어", body: "채팅 위에 이미지 창을 항상 띄워 둡니다. 끌어서 옮기고 모서리를 잡아 크기를 바꿀 수 있습니다. 캐릭터·프롬프트 수정 창이 열리면 잠시 숨겨집니다." },
    "nx-overlay": { title: "채팅 왼쪽 줄 오버레이", body: "채팅 왼쪽에 핀과 이미지를 함께 둡니다. 스크롤하는 동안에도 지금 읽는 구간의 이미지를 계속 보여 줍니다. 짧게 누르면 이미지를 숨기고, 핀을 누르면 다시 나타납니다. 길게 누르면 크게보기와 태그·재생성·리롤·캐릭터 칩 메뉴가 열립니다." },
    "nx-llm-anchor": { title: "LLM 읽기 위치 배치", body: "ON이면 AI가 장면 흐름에 맞춰 읽기 위치(y%)를 잡아 저장·표시합니다. OFF면 저장값은 그대로 두고, 화면에서만 메시지 높이를 장 수로 균등 분할해 보여 줍니다(예: 3장 → 0–33 / 33–66 / 66–100). 다시 ON하면 저장된 AI 위치로 돌아갑니다." },
    "nx-natural-base": { title: "자연어 base 태그", body: "이미지 요청에 짧은 자연어 장면도 함께 넣습니다. 태그만 쓸 때보다 분위기가 자연스러워질 수 있습니다." },
    "nx-inline-preview": { title: "채팅 왼쪽 줄 오버레이", body: "채팅 왼쪽 줄 오버레이와 같은 설정입니다." },
    "nx-hide-offscreen": { title: "화면 밖이면 이미지 숨김", body: "선택한 메시지가 화면에서 벗어나면 상시 미리보기 이미지만 숨깁니다. 스티키 핀은 그대로 둡니다." },
    "nx-scroll-track": { title: "스크롤로 메시지 추적", body: "채팅을 스크롤하다가 멈추면(짧게), 마우스 커서에 가장 가까운 메시지를 고릅니다. 스크롤 중에는 스티키만 가볍게 갱신하고, 이미지 없는 메시지로 넘어가도 이전 대표 이미지는 유지합니다." },
    "nx-click-track": { title: "메시지 클릭으로 선택", body: "메시지를 눌러 그 메시지의 이미지를 볼 수 있게 합니다. 아래 「메시지 선택 동작」에서 한 번/두 번 클릭을 고를 수 있습니다." },
    "nx-text-drag": { title: "글자 드래그 선택", body: "메시지 안 글자를 드래그해 고르면 그 메시지를 바로 선택합니다. 한 번/두 번 클릭 설정과 관계없이 동작합니다." },
    "nx-mobile-pin": { title: "모바일 모서리 고정", body: "상시 이미지를 화면 모서리(우상·우하·좌상·좌하)에 붙이고, 스티키 핀을 그 이미지 상단 중앙에 둡니다. 핀 X/Y % 위치는 이 모드에서 쓰지 않습니다. 제스처는 상시 이미지와 같습니다." },
    "nx-hover-preview": { title: "스티키 핀 호버 미리보기", body: "왼쪽 핀에 마우스를 올리면 미리보기 이미지가 뜹니다. 끄면 호버 미리보기를 쓰지 않습니다." },
    "nx-risu-settings-button": { title: "Risu 설정 바로가기", body: "RisuAI 설정 화면으로 바로 가는 버튼을 보여 줍니다." },
    "nx-debug-panel": { title: "디버그 패널", body: "채팅 왼쪽 아래에 로그 창을 띄웁니다. 문제 확인할 때만 켜고, 평소에는 꺼 두셔도 됩니다." },
    "nx-gen-all-roles": { title: "모든 메시지 이미지 생성", body: "켜면 유저/캐릭터 구분 없이 선택한 모든 메시지에 이미지를 생성합니다. 끄면 캐릭터(assistant) 메시지만 자동 생성합니다." },
    "nx-auto-gen-reply": { title: "응답 후 자동 생성", body: "AI 답변이 끝나면 메시지를 클릭하지 않아도 이미지를 만듭니다. 이미 이미지가 있으면 건너뜁니다(덮어쓰지 않음). Power OFF이거나 발동이 수동일 때는 동작하지 않습니다." },
    "nx-lore": { title: "Lorebook 주입", body: "이미지 태그를 만들 때 로어북에 적힌 설정을 참고합니다. 세계관·외형 메모가 반영되기 쉽습니다." },
    "nx-lore-extra": { title: "lb-xnai.lb.extra", body: "캐릭터 태그만: 트리거된 캐릭터 섹션만 넣습니다. 전체: 로어 통째로(커스텀 프롬프트 포함). 넣지 않음: 이 특수 로어를 무시합니다." },
    "nx-unified-priority": { title: "통합 챗 우선", body: "켜면 채팅 목록에서 통합 챗이 맨 위에 오고, 캐릭터만 바꿀 때 기본 선택도 통합 챗이 됩니다. 생성/재생성 태그는 모든 채팅 로스터를 합쳐서 읽습니다(저장은 현재 채팅에만)." },
    "nx-charinfo": { title: "CharInfo", body: "캐릭터 카드의 기본 정보를 태깅에 넣습니다. 외형·성격이 더 맞게 나오도록 돕습니다." },
    "nx-userinfo": { title: "UserInfo", body: "유저(페르소나) 정보를 태깅에 넣습니다. 주인공 외형이 있을 때 켜세요." },
    "nx-appearance": { title: "CharAppearance 누적", body: "한 번 잡힌 캐릭터 외형을 다음 생성에도 이어 씁니다. 옷·머리색이 장면마다 크게 바뀌는 걸 줄입니다." },
    "nx-execute": { title: "발동", body: "자동: 메시지를 골랐는데 이미지가 없으면 바로 생성합니다. 수동: 이미지가 없어도 「지금 생성」을 눌러야만 만듭니다. 응답 후 자동 생성 토글은 별도이며, 발동이 수동일 때는 응답 후 생성도 막힙니다." },
    "nx-inline-pct": { title: "상시 이미지 크기", body: "상시·모바일 모서리 미리보기 크기입니다. 100%가 기준이고, 200%면 약 두 배로 보입니다." },
    "nx-overlay-x": { title: "스티키 핀 가로 위치 (%)", body: "화면 왼쪽 기준 가로 퍼센트입니다(0=왼쪽, 100=오른쪽). 창 크기가 바뀌어도 같은 비율로 유지됩니다. 기본값 38." },
    "nx-overlay-y": { title: "스티키 핀 세로 위치 (%)", body: "화면 아래 기준 세로 퍼센트입니다(0=맨 아래, 100=맨 위). 창 크기가 바뀌어도 같은 비율로 유지됩니다. 기본값 80." },
    "nx-hover-anchor": { title: "호버 미리보기 기준", body: "미리보기를 화면의 정해진 자리에 둘지, 마우스 옆에 따라다니게 할지 정합니다. 마우스 기준은 위치를 가볍게만 갱신합니다." },
    "nx-minimize-mode": { title: "접힘 표시 방식", body: "플로팅 아이콘: 접으면 작은 아이콘으로 따로 둔 자리로 갑니다. 상단 툴바 한 줄: 접어도 지금 창 자리 그대로 얇은 바로만 줄어듭니다." },
    "nx-select-gesture": { title: "메시지 선택 동작", body: "클릭으로 고를 때만 적용됩니다. 한 번: 바로 확정. 두 번: 첫 클릭은 임시, 같은 메시지 두 번째 클릭에 확정. 스크롤·글자 드래그는 이 설정과 무관합니다." },
    "nx-hover-corner": { title: "이미지 모서리", body: "모바일 모서리 고정이 켜져 있을 때 상시 이미지를 붙일 모서리(우상·우하·좌상·좌하)를 고릅니다. 스티키 핀은 그 이미지 상단 중앙에 따라갑니다." },
    "nx-reset-windows": { title: "창 위치 초기화", body: "뷰어·접힘 아이콘·핀이 화면 밖으로 나가 안 보일 때 기본 위치로 되돌립니다." },
    "nx-reset-settings": { title: "모든 설정 초기화", body: "카드·LLM·NAI 등 설정을 기본값으로 되돌립니다. API 키·창 위치·카드 프리셋은 유지됩니다." },
    "nx-save-dash": { title: "대시보드 저장", body: "이 탭의 설정을 저장합니다. 대부분 항목은 바꾸면 자동으로도 저장됩니다." },
    "nx-run-now": { title: "지금 생성", body: "지금 선택된 메시지로 이미지를 바로 만듭니다. 수동일 때는 이미지가 없어도 이 버튼을 눌러야 생성됩니다." },
    "nx-open-viewer": { title: "뷰어 앞으로", body: "플로팅 뷰어를 열고 맨 앞으로 가져옵니다." }
  };
  function setHeadHelp(e = null) {
    const n = document.getElementById("nx-head-help"), o = document.getElementById("nx-head-help-title"), a = document.getElementById("nx-head-help-body");
    if (!o || !a) return;
    const r = e && e.title ? e : HEAD_HELP_DEFAULT;
    o.textContent = r.title || HEAD_HELP_DEFAULT.title, a.textContent = r.body || HEAD_HELP_DEFAULT.body, n && n.classList.toggle("is-active", !!(e && e.title));
  }
  function resolveHeadHelpTarget(e) {
    const n = e?.closest?.("[data-nx-help-id], .toggle-row, .model-form label, #nx-reset-windows, #nx-reset-settings, #nx-save-dash, #nx-run-now, #nx-open-viewer");
    if (!n) return null;
    const o = n.getAttribute("data-nx-help-id") || (n.id && HEAD_HELP[n.id] ? n.id : "") || n.querySelector?.("input[id],select[id],button[id]")?.id || "";
    return o && HEAD_HELP[o] ? { id: o, tip: HEAD_HELP[o], host: n } : null;
  }
  function bindHeadHelp(e) {
    if (!e || e.dataset.nxHelpBound) return;
    e.dataset.nxHelpBound = "1";
    let n = null;
    const o = (a) => {
      document.querySelectorAll(".is-help-active").forEach((i) => i.classList.remove("is-help-active"));
      const r = resolveHeadHelpTarget(a);
      if (!r) {
        n = null, setHeadHelp(null);
        return;
      }
      n = r.id, r.host.classList.add("is-help-active"), setHeadHelp(r.tip);
    };
    e.addEventListener("pointerover", (a) => {
      const r = resolveHeadHelpTarget(a.target);
      if (!r || r.id === n) return;
      if (a.relatedTarget && r.host.contains(a.relatedTarget)) return;
      o(a.target);
    }), e.addEventListener("pointerout", (a) => {
      const r = resolveHeadHelpTarget(a.target);
      if (!r) return;
      const i = a.relatedTarget;
      if (i && r.host.contains(i)) return;
      const s = resolveHeadHelpTarget(i);
      if (s) {
        o(i);
        return;
      }
      n = null, document.querySelectorAll(".is-help-active").forEach((c) => c.classList.remove("is-help-active")), setHeadHelp(null);
    }), e.addEventListener("focusin", (a) => o(a.target)), e.addEventListener("focusout", (a) => {
      const r = a.relatedTarget;
      if (r && e.contains(r) && resolveHeadHelpTarget(r)) {
        o(r);
        return;
      }
      n = null, document.querySelectorAll(".is-help-active").forEach((i) => i.classList.remove("is-help-active")), setHeadHelp(null);
    }), setHeadHelp(null);
  }

  function $t(e) {
    const n = t.modelTestResults[e];
    return n ? `<div id="nx-test-result-${e}" class="test-result ${n.ok ? "success" : "error"}">${n.ok ? "성공 · " : "실패 · "}${h(n.message || "")}</div>` : `<div id="nx-test-result-${e}" class="test-result">아직 테스트하지 않았습니다.</div>`;
  }
  function je(e, n, o) {
    t.modelTestResults[e] = {
      ok: !!n,
      message: z(o || "", 400)
    };
    const a = document.getElementById(`nx-test-result-${e}`);
    a && (a.className = `test-result ${n ? "success" : "error"}`, a.textContent = `${n ? "성공" : "실패"} · ${t.modelTestResults[e].message}`);
  }
  function kt(e) {
    t.backendSettings || (t.backendSettings = {}), t.backendSettings.card || (t.backendSettings.card = e || {});
    const n = t.backendSettings.card;
    if (Array.isArray(n.presets) || (n.presets = []), !n.presets.length && (n.custom_pos || n.custom_neg)) {
      const o = `legacy_${Date.now()}`;
      n.presets.push({
        id: o,
        name: "기본",
        positive: n.custom_pos || "",
        negative: n.custom_neg || ""
      }), pinActivePreset(n, o);
    }
    const resolved = resolveActivePresetId(n);
    return resolved && pinActivePreset(n, resolved), n;
  }
  function _e() {
    const e = kt(t.backendSettings?.card || {}), n = e.presets.find((a) => String(a.id) === String(e.active_preset_id));
    if (!n) return e;
    // Form absent (settings closed / other tab) — never wipe preset text with empty N().
    const nameEl = typeof document < "u" ? document.getElementById("nx-preset-name") : null, posEl = typeof document < "u" ? document.getElementById("nx-custom-pos") : null, negEl = typeof document < "u" ? document.getElementById("nx-custom-neg") : null;
    if (!nameEl && !posEl && !negEl) return e;
    return nameEl && (n.name = nameEl.value || ""), posEl && (n.positive = posEl.value || "", e.custom_pos = n.positive), negEl && (n.negative = negEl.value || "", e.custom_neg = n.negative), e;
  }
  function fa(e) {
    // Persist the form into the preset the DOM currently shows, then switch.
    // Snapshot the form owner BEFORE any pin/resolve — if t.activePresetId was
    // already moved to the target, _e()/kt() would write preset-1 text into every other preset.
    const id = String(e || "");
    const n = t.backendSettings?.card || {};
    Array.isArray(n.presets) || (n.presets = []);
    const formOwnerId = String(n.active_preset_id || t.activePresetId || "");
    const owner = formOwnerId ? n.presets.find((a) => String(a.id) === formOwnerId) : null;
    const nameEl = typeof document < "u" ? document.getElementById("nx-preset-name") : null, posEl = typeof document < "u" ? document.getElementById("nx-custom-pos") : null, negEl = typeof document < "u" ? document.getElementById("nx-custom-neg") : null;
    if (owner && (nameEl || posEl || negEl)) {
      nameEl && (owner.name = nameEl.value || "");
      posEl && (owner.positive = posEl.value || "", n.custom_pos = owner.positive);
      negEl && (owner.negative = negEl.value || "", n.custom_neg = owner.negative);
    }
    if (!id || !n.presets.some((a) => String(a.id) === id)) return n;
    pinActivePreset(n, id);
    const o = n.presets.find((a) => String(a.id) === id);
    return o && (n.custom_pos = o.positive || "", n.custom_neg = o.negative || ""), n;
  }
  async function applyActivePreset(presetId, opts = null) {
    const id = String(presetId || "");
    if (!id || t._presetSwitching) return null;
    const formMounted = !!(t.uiOpen && typeof document < "u" && document.getElementById("nx-custom-pos"));
    let card;
    if (formMounted) {
      // Persist old form first; fa() pins the new id. Do NOT set t.activePresetId before fa().
      card = fa(id);
    } else {
      t.activePresetId = id;
      card = kt(t.backendSettings?.card || {});
      if (!card.presets.some((p) => presetIdEq(p.id, id))) return null;
      pinActivePreset(card, id);
      const active = card.presets.find((p) => presetIdEq(p.id, id));
      active && (card.custom_pos = active.positive || "", card.custom_neg = active.negative || "");
    }
    if (!card?.presets?.some((p) => presetIdEq(p.id, id))) return null;
    pinActivePreset(card, id);
    t._presetSwitching = !0;
    try {
      t.backendSettings = t.backendSettings || {}, t.backendSettings.card = card;
      if (t.settingsSavePending?.card) {
        t.settingsSavePending.card.active_preset_id = id, t.settingsSavePending.card.custom_pos = card.custom_pos, t.settingsSavePending.card.custom_neg = card.custom_neg;
        Array.isArray(card.presets) && (t.settingsSavePending.card.presets = card.presets);
      }
      queueSettingsSave({ card: { ...card } }, { force: !0 }), await flushSettingsSave();
      try {
        await pe({
          card: {
            active_preset_id: id,
            custom_pos: card.custom_pos,
            custom_neg: card.custom_neg,
            presets: card.presets
          }
        });
      } catch (err) {
        y("warn", "preset.save.fail", err?.message || err);
      }
      if (t.backendSettings?.card) {
        pinActivePreset(t.backendSettings.card, id), t.backendSettings.card.custom_pos = card.custom_pos, t.backendSettings.card.custom_neg = card.custom_neg;
        Array.isArray(card.presets) && (t.backendSettings.card.presets = card.presets);
      }
      // Always push into card-settings DOM when it exists; re-render if settings open.
      syncCardPresetFormFromSettings();
      if (t.uiOpen && opts?.rerender !== !1) {
        if (opts?.showCardTab) t.uiTab = "card";
        await P();
        syncCardPresetFormFromSettings();
      }
    } finally {
      t._presetSwitching = !1;
    }
    if (t.galleryUi?.syncViewerPresetSelect) try {
      await t.galleryUi.syncViewerPresetSelect();
    } catch {
    }
    return card;
  }
  function St(e) {
    const n = pn(e);
    if (!n.length) throw new Error("프리셋을 찾지 못했습니다. [Positive]/[Negative] 로어북 항목이 있는 card.json인지 확인하세요.");
    const o = _e();
    o.presets = un(o.presets || [], n);
    if (!o.active_preset_id || !o.presets.some((r) => presetIdEq(r.id, o.active_preset_id))) pinActivePreset(o, o.presets[0]?.id || "");
    else pinActivePreset(o, o.active_preset_id);
    const a = o.presets.find((r) => presetIdEq(r.id, o.active_preset_id)) || o.presets[0];
    o.custom_pos = a?.positive || "", o.custom_neg = a?.negative || "";
    try {
      queueSettingsSave({ card: { ...o } });
    } catch (err) {
      console.warn("[Inlay Nexus] preset auto-save failed", err);
    }
    return n.length;
  }
  function exportPresetsJson() {
    const e = _e(), n = (e.presets || []).map((a) => ({
      id: String(a.id || ""),
      name: String(a.name || ""),
      positive: String(a.positive || ""),
      negative: String(a.negative || "")
    })).filter((a) => a.name || a.positive || a.negative);
    if (!n.length) throw new Error("내보낼 프리셋이 없습니다.");
    const o = JSON.stringify({
      presets: n,
      active_preset_id: String(e.active_preset_id || n[0].id || "")
    }, null, 2), a = new Blob([o], { type: "application/json" }), r = URL.createObjectURL(a), i = document.createElement("a");
    return i.href = r, i.download = `inlay-nexus-presets-${new Date().toISOString().slice(0, 10)}.json`, document.body.appendChild(i), i.click(), i.remove(), setTimeout(() => URL.revokeObjectURL(r), 1e3), n.length;
  }
  function N(e) {
    const n = document.getElementById(e);
    return n ? n.value : "";
  }
  function ee(e) {
    const n = document.getElementById(e);
    return !!(n && n.checked);
  }
  function It(e) {
    return new Promise((n, o) => {
      const a = new FileReader();
      a.onload = () => n(String(a.result || "")), a.onerror = () => o(/* @__PURE__ */ new Error("파일 읽기 실패")), a.readAsDataURL(e);
    });
  }
  function exHelpers() {
    return globalThis.__INLAY_EXPLORER__ || {};
  }
  function ensureExplorerState() {
    const EX = exHelpers();
    if (!t.explorer) t.explorer = {};
    if (!t.explorer.selection) t.explorer.selection = EX.createSelectionState ? EX.createSelectionState() : { selected: new Set(), anchorId: "", focusId: "" };
    if (!(t.explorer.selection.selected instanceof Set)) t.explorer.selection.selected = new Set(t.explorer.selection.selected || []);
    if (!Array.isArray(t.explorer.favorites)) t.explorer.favorites = [];
    if (!t.explorer.sort) t.explorer.sort = "newest";
    if (!t.explorer.thumb) t.explorer.thumb = "m";
    if (t.explorer.favOnly == null) t.explorer.favOnly = !1;
    if (t.explorer.mobileSelect == null) t.explorer.mobileSelect = !1;
    return t.explorer;
  }
  async function Et(e = !1) {
    if (!e && t.explorer?.loadedAt && Date.now() - t.explorer.loadedAt < 2500) return t.explorer;
    ensureExplorerState();
    const n = await K("/v1/gallery/explore?limit=500", { method: "GET" }, 2e4), o = n?.folders || [], a = n?.items || [];
    let fav = t.explorer.favorites || [];
    try {
      const f = await K("/v1/gallery/favorites", { method: "GET" }, 1e4);
      if (Array.isArray(f?.ids)) fav = f.ids;
    } catch {
    }
    let r = t.explorer?.folderKey || "";
    return (r !== "__all__" && (!r || !o.some((i) => i.key === r))) && (r = "__all__"), t.explorer = {
      ...t.explorer,
      folders: o,
      items: a,
      folderKey: r,
      query: t.explorer?.query || "",
      favorites: fav,
      loadedAt: Date.now()
    }, t.explorer;
  }
  function Ze() {
    const EX = exHelpers();
    const e = ensureExplorerState(), n = w(e.query || "").toLowerCase(), o = e.folders || [];
    let a = e.folderKey || "";
    if (a !== "__all__" && (!a || !o.some((f) => f.key === a))) a = o[0]?.key || "__all__";
    const allMode = a === "__all__";
    let r = (e.items || []).filter((i) => allMode || !a || i.folder_key === a);
    n && (r = r.filter((i) => `${i.character_name || ""} ${i.chat_name || ""} ${i.assistant_preview || ""} ${i.main_prompt || ""}`.toLowerCase().includes(n)));
    if (e.favOnly) {
      const fav = new Set(e.favorites || []);
      r = r.filter((i) => fav.has(i.id));
    }
    r = EX.sortExplorerItems ? EX.sortExplorerItems(r, e.sort || "newest") : r;
    return {
      ex: e,
      q: n,
      folders: o,
      folderKey: a,
      items: r,
      allMode
    };
  }
  function et(e) {
    const ex = ensureExplorerState(), sel = ex.selection?.selected || new Set(), fav = new Set(ex.favorites || []), focus = ex.selection?.focusId || "";
    return e.length ? e.map((n) => `
      <div class="explorer-card ${sel.has(n.id) ? "selected" : ""} ${focus === n.id ? "focus" : ""}" data-explorer-id="${h(n.id)}" tabindex="0"
        data-tip="${h(`${n.character_name || "?"} / ${n.chat_name || "?"}
메시지 #${Number(n.message_index) >= 0 ? n.message_index + 1 : "?"} · 샷 ${Number(n.shot_index) + 1}
${(n.assistant_preview || "").slice(0, 120)}`)}">
        <div class="ex-check">${sel.has(n.id) ? "✓" : ""}</div>
        <button type="button" class="ex-star ${fav.has(n.id) ? "is-on" : ""}" data-explorer-star title="즐겨찾기" aria-label="즐겨찾기">${fav.has(n.id) ? "★" : "☆"}</button>
        <img src="${h(Ie(n))}" alt="" loading="lazy">
        <div class="cap">msg #${Number(n.message_index) >= 0 ? n.message_index + 1 : "?"} · shot ${Number(n.shot_index) + 1}<br>${h((n.assistant_preview || n.main_prompt || "").slice(0, 48))}</div>
      </div>`).join("") : '<div class="muted" style="padding:18px">이 폴더에 이미지가 없습니다.</div>';
  }
  function paintExplorerSelectionUi() {
    const { items: n } = Ze(), ex = ensureExplorerState(), count = ex.selection?.selected?.size || 0;
    const bar = document.getElementById("nx-explorer-selbar");
    if (bar) {
      const countEl = bar.querySelector("[data-ex-selcount]");
      countEl && (countEl.textContent = count ? `${count}장 선택` : "선택 없음");
      const mobBtn = bar.querySelector("#nx-explorer-mobile-select");
      mobBtn && mobBtn.classList.toggle("active", !!ex.mobileSelect);
      const favBtn = bar.querySelector("#nx-explorer-favonly");
      favBtn && (favBtn.classList.toggle("active", !!ex.favOnly), favBtn.textContent = ex.favOnly ? "★ 즐겨찾기만" : "☆ 즐겨찾기만");
    }
    document.querySelectorAll("[data-explorer-id]").forEach((el) => {
      const id = el.getAttribute("data-explorer-id");
      el.classList.toggle("selected", !!ex.selection?.selected?.has(id));
      el.classList.toggle("focus", ex.selection?.focusId === id);
      const check = el.querySelector(".ex-check");
      check && (check.textContent = ex.selection?.selected?.has(id) ? "✓" : "");
    });
    const r = document.querySelector(".explorer-toolbar .muted");
    r && (r.textContent = `${n.length}장`);
  }
  function ha(e) {
    t.explorer = {
      ...ensureExplorerState(),
      folderKey: e || ""
    };
    const EX = exHelpers();
    t.explorer.selection = EX.clearSelection ? EX.clearSelection(t.explorer.selection) : { selected: new Set(), anchorId: "", focusId: "" };
    const { items: n, folderKey: o } = Ze();
    document.querySelectorAll("[data-explorer-folder]").forEach((i) => {
      i.classList.toggle("active", i.getAttribute("data-explorer-folder") === o);
    });
    const a = document.querySelector(".explorer-grid");
    a && (a.innerHTML = `<div class="explorer-marquee" id="nx-explorer-marquee"></div>${et(n)}`);
    const thumb = EX.thumbMinWidth ? EX.thumbMinWidth(t.explorer.thumb) : 148;
    a && a.style.setProperty("--ex-thumb", `${thumb}px`);
    paintExplorerSelectionUi(), tt();
  }
  function downloadBase64Zip(b64, filename) {
    const bin = atob(String(b64 || ""));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i);
    const blob = new Blob([u8], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url, a.download = filename || "inlay-gallery.zip", a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2e3);
  }
  async function explorerExport(scope = "selection") {
    const ex = ensureExplorerState(), body = {};
    if (scope === "all") body.all = !0;
    else if (scope === "folder") {
      if (!ex.folderKey || ex.folderKey === "__all__") body.all = !0;
      else body.folder_key = ex.folderKey || "";
    } else body.card_ids = [...ex.selection?.selected || []];
    if (scope === "selection" && !body.card_ids.length) {
      $e("선택된 이미지가 없습니다", !1);
      return;
    }
    try {
      const res = await K("/v1/gallery/export", { method: "POST", body }, 12e4);
      if (!res?.ok) throw new Error(res?.error?.message || "내보내기 실패");
      downloadBase64Zip(res.zip_base64, res.filename);
      $e(`ZIP 내보내기 · ${res.count}장`);
    } catch (err) {
      t.uiMessage = { type: "error", text: z(err?.message || err) }, await P();
    }
  }
  async function explorerImportFile(file) {
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i += 1) binary += String.fromCharCode(buf[i]);
    try {
      const res = await K("/v1/gallery/import", {
        method: "POST",
        body: { zip_base64: btoa(binary), prefer_new_ids: !0 }
      }, 12e4);
      if (!res?.ok) throw new Error(res?.error?.message || "불러오기 실패");
      const r = res.report || {};
      $e(`불러오기 ${res.imported}장 · 정확 ${r.exact || 0}/후보 ${r.candidate || 0}/고아 ${r.orphan || 0}`);
      await Et(!0), await P();
    } catch (err) {
      t.uiMessage = { type: "error", text: z(err?.message || err) }, await P();
    }
  }
  async function explorerDeleteSelected() {
    const ids = [...ensureExplorerState().selection?.selected || []];
    if (!ids.length || !confirm(`${ids.length}장을 삭제할까요?`)) return;
    try {
      await K("/v1/gallery/delete", { method: "POST", body: { card_ids: ids } }), await Et(!0), await P();
    } catch (err) {
      t.uiMessage = { type: "error", text: z(err?.message || err) }, await P();
    }
  }
  async function explorerToggleFavorite(id) {
    const ex = ensureExplorerState(), set = new Set(ex.favorites || []);
    set.has(id) ? set.delete(id) : set.add(id);
    ex.favorites = [...set];
    try {
      await K("/v1/gallery/favorites", { method: "POST", body: { ids: ex.favorites } });
    } catch {
    }
    const on = set.has(id);
    const btn = document.querySelector(`[data-explorer-id="${CSS.escape?.(id) || id.replace(/"/g, "")}"] [data-explorer-star]`);
    if (btn) {
      btn.textContent = on ? "★" : "☆";
      btn.classList.toggle("is-on", on);
    }
    const lbFav = document.getElementById("nx-lb-fav");
    const lbOpen = document.getElementById("nx-explorer-lightbox")?.classList.contains("show");
    if (lbFav && lbOpen) {
      const card = Ze().items[t.explorer.lbIndex || 0];
      if (card && card.id === id) {
        lbFav.textContent = on ? "★ 즐겨찾기" : "☆ 즐겨찾기";
        lbFav.classList.toggle("active", on);
      }
    }
    if (ex.favOnly) {
      const { items: r } = Ze(), grid = document.querySelector(".explorer-grid");
      grid && (grid.innerHTML = `<div class="explorer-marquee" id="nx-explorer-marquee"></div>${et(r)}`), paintExplorerSelectionUi(), tt();
    }
  }
  function openExplorerLightbox(id) {
    const { items } = Ze();
    const idx = items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    t.explorer.lbIndex = idx;
    const lb = document.getElementById("nx-explorer-lightbox");
    if (!lb) return;
    const paint = () => {
      const list = Ze().items, i = Math.max(0, Math.min(list.length - 1, t.explorer.lbIndex || 0));
      t.explorer.lbIndex = i;
      const card = list[i];
      if (!card) return;
      const img = lb.querySelector("img");
      const meta = lb.querySelector("[data-lb-meta]");
      const favBtn = document.getElementById("nx-lb-fav");
      const favOn = (ensureExplorerState().favorites || []).includes(card.id);
      img && (img.src = Ie(card), img.style.transform = `translate(${t.explorer.lbPanX || 0}px,${t.explorer.lbPanY || 0}px) scale(${t.explorer.lbZoom || 1})`);
      meta && (meta.textContent = `${i + 1}/${list.length} · msg #${Number(card.message_index) >= 0 ? card.message_index + 1 : "?"} · shot ${Number(card.shot_index) + 1}`);
      if (favBtn) {
        favBtn.textContent = favOn ? "★ 즐겨찾기" : "☆ 즐겨찾기";
        favBtn.classList.toggle("active", favOn);
      }
    };
    t.explorer.lbZoom = 1, t.explorer.lbPanX = 0, t.explorer.lbPanY = 0;
    lb.classList.add("show"), paint(), t._explorerLbPaint = paint;
  }
  function closeExplorerLightbox() {
    document.getElementById("nx-explorer-lightbox")?.classList.remove("show");
    t._explorerLbPaint = null;
  }
  async function explorerJumpToMessage(card) {
    if (!card) return;
    try {
      await pt(card);
      $e("원문 메시지로 이동");
    } catch (err) {
      $e(z(err?.message || "메시지 이동 실패"), !1);
    }
  }
  function hideExplorerCtx() {
    const ctx = document.getElementById("nx-explorer-ctx");
    ctx && (ctx.style.display = "none");
  }
  function showExplorerCtx(x, y, id) {
    const ctx = document.getElementById("nx-explorer-ctx");
    if (!ctx) return;
    ctx.dataset.id = id || "";
    ctx.style.display = "block";
    ctx.style.left = `${Math.min(window.innerWidth - 200, x)}px`;
    ctx.style.top = `${Math.min(window.innerHeight - 220, y)}px`;
  }
  function tt() {
    const e = document.getElementById("nx-explorer-tip");
    const grid = document.querySelector(".explorer-grid");
    const EX = exHelpers();
    document.querySelectorAll("[data-explorer-id]").forEach((n) => {
      if (n.dataset.nxBound) return;
      n.dataset.nxBound = "1";
      n.addEventListener("mouseenter", (a) => {
        e && (e.style.display = "block", e.textContent = n.getAttribute("data-tip") || "", e.style.left = `${Math.min(window.innerWidth - 300, a.clientX + 14)}px`, e.style.top = `${Math.min(window.innerHeight - 120, a.clientY + 14)}px`);
      }), n.addEventListener("mousemove", (a) => {
        !e || e.style.display === "none" || (e.style.left = `${Math.min(window.innerWidth - 300, a.clientX + 14)}px`, e.style.top = `${Math.min(window.innerHeight - 120, a.clientY + 14)}px`);
      }), n.addEventListener("mouseleave", () => {
        e && (e.style.display = "none");
      });
      n.addEventListener("click", (r) => {
        if (r.target?.closest?.("[data-explorer-star]")) return;
        r.preventDefault(), r.stopPropagation();
        const id = n.getAttribute("data-explorer-id"), { items } = Ze(), ids = items.map((x) => x.id), index = ids.indexOf(id);
        const ex = ensureExplorerState();
        const mobile = !!ex.mobileSelect;
        ex.selection = EX.applyExplorerClick ? EX.applyExplorerClick(ex.selection, id, {
          ids,
          index,
          shift: !!r.shiftKey,
          ctrl: !!(r.ctrlKey || r.metaKey || mobile)
        }) : ex.selection;
        paintExplorerSelectionUi();
      });
      n.addEventListener("dblclick", async (r) => {
        r.preventDefault(), r.stopPropagation();
        openExplorerLightbox(n.getAttribute("data-explorer-id"));
      });
      n.addEventListener("contextmenu", (r) => {
        r.preventDefault(), r.stopPropagation();
        const id = n.getAttribute("data-explorer-id"), ex = ensureExplorerState();
        if (!ex.selection?.selected?.has(id)) {
          const { items } = Ze(), ids = items.map((x) => x.id);
          ex.selection = EX.applyExplorerClick ? EX.applyExplorerClick(ex.selection, id, { ids, index: ids.indexOf(id) }) : ex.selection;
          paintExplorerSelectionUi();
        }
        showExplorerCtx(r.clientX, r.clientY, id);
      });
      let pressTimer = 0;
      n.addEventListener("pointerdown", (r) => {
        if (r.pointerType === "touch") {
          pressTimer = setTimeout(() => {
            ensureExplorerState().mobileSelect = !0;
            n.click();
            paintExplorerSelectionUi();
          }, 480);
        }
      });
      n.addEventListener("pointerup", () => clearTimeout(pressTimer));
      n.addEventListener("pointercancel", () => clearTimeout(pressTimer));
      n.querySelector("[data-explorer-star]")?.addEventListener("click", async (r) => {
        r.preventDefault(), r.stopPropagation();
        await explorerToggleFavorite(n.getAttribute("data-explorer-id"));
      });
    });
    if (grid && !grid.dataset.nxMarquee) {
      grid.dataset.nxMarquee = "1";
      const box = () => document.getElementById("nx-explorer-marquee");
      let drag = null;
      grid.addEventListener("pointerdown", (ev) => {
        if (ev.target?.closest?.("[data-explorer-id],button,input,select")) return;
        if (ev.button !== 0) return;
        const rect = grid.getBoundingClientRect();
        drag = { x0: ev.clientX - rect.left + grid.scrollLeft, y0: ev.clientY - rect.top + grid.scrollTop, additive: !!(ev.ctrlKey || ev.metaKey) };
        const m = box();
        m && (m.style.display = "block", m.style.left = `${drag.x0}px`, m.style.top = `${drag.y0}px`, m.style.width = "0px", m.style.height = "0px");
        grid.setPointerCapture?.(ev.pointerId);
      });
      grid.addEventListener("pointermove", (ev) => {
        if (!drag) return;
        const rect = grid.getBoundingClientRect();
        const x1 = ev.clientX - rect.left + grid.scrollLeft, y1 = ev.clientY - rect.top + grid.scrollTop;
        const left = Math.min(drag.x0, x1), top = Math.min(drag.y0, y1), w = Math.abs(x1 - drag.x0), h = Math.abs(y1 - drag.y0);
        const m = box();
        m && (m.style.left = `${left}px`, m.style.top = `${top}px`, m.style.width = `${w}px`, m.style.height = `${h}px`);
      });
      const endDrag = (ev) => {
        if (!drag) return;
        const rect = grid.getBoundingClientRect();
        const x1 = (ev?.clientX ?? drag.x0) - rect.left + grid.scrollLeft, y1 = (ev?.clientY ?? drag.y0) - rect.top + grid.scrollTop;
        const left = Math.min(drag.x0, x1), top = Math.min(drag.y0, y1), right = Math.max(drag.x0, x1), bottom = Math.max(drag.y0, y1);
        const ex = ensureExplorerState();
        const next = drag.additive ? new Set(ex.selection.selected) : new Set();
        grid.querySelectorAll("[data-explorer-id]").forEach((card) => {
          const cr = card.getBoundingClientRect();
          const cl = cr.left - rect.left + grid.scrollLeft, ct = cr.top - rect.top + grid.scrollTop;
          const cRight = cl + cr.width, cBottom = ct + cr.height;
          if (cl < right && cRight > left && ct < bottom && cBottom > top) next.add(card.getAttribute("data-explorer-id"));
        });
        ex.selection.selected = next;
        if (next.size) ex.selection.focusId = [...next][0];
        drag = null;
        const m = box();
        m && (m.style.display = "none");
        paintExplorerSelectionUi();
      };
      grid.addEventListener("pointerup", endDrag);
      grid.addEventListener("pointercancel", () => {
        drag = null;
        const m = box();
        m && (m.style.display = "none");
      });
    }
  }
  function ma() {
    const EX = exHelpers();
    const { ex: e, folders: n, folderKey: o, items: a } = Ze();
    const thumb = EX.thumbMinWidth ? EX.thumbMinWidth(e.thumb || "m") : 148;
    const selCount = e.selection?.selected?.size || 0;
    const totalCount = (e.items || []).length;
    const folderButtons = `
          <button type="button" class="explorer-folder ${o === "__all__" ? "active" : ""}" data-explorer-folder="__all__">
            <strong>통합 이미지보기</strong>
            <span>모든 캐릭터·채팅 · ${totalCount}장</span>
          </button>${n.map((r) => `
          <button type="button" class="explorer-folder ${r.key === o ? "active" : ""}" data-explorer-folder="${h(r.key)}">
            <strong>${h(r.character_name || "Unknown")}</strong>
            <span>${h(r.chat_name || "")} · ${Number(r.count) || 0}장</span>
          </button>`).join("")}`;
    return `
      <div class="explorer-layout">
        <aside class="explorer-side">
          <div class="explorer-side-head">
            <strong style="font-size:13px">캐릭터 챗</strong>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" id="nx-explorer-refresh" class="secondary" style="min-height:30px;padding:4px 10px">새로고침</button>
              <button type="button" id="nx-explorer-delete-folder" style="min-height:30px;padding:4px 10px">폴더 삭제</button>
            </div>
          </div>
          <div class="explorer-folders" id="nx-explorer-folders">${folderButtons}</div>
        </aside>
        <section class="explorer-main">
          <div class="explorer-main-head">
            <div class="explorer-toolbar" style="flex:1">
              <input id="nx-explorer-q" placeholder="검색: 캐릭터/채팅/프리뷰" value="${h(e.query || "")}" style="flex:1;min-width:140px">
              <select id="nx-explorer-sort" style="min-height:34px;border-radius:10px;border:1px solid var(--border2);background:rgba(7,10,17,.7);color:var(--text);padding:4px 8px">
                <option value="newest" ${e.sort === "newest" ? "selected" : ""}>최신</option>
                <option value="oldest" ${e.sort === "oldest" ? "selected" : ""}>오래된</option>
                <option value="message" ${e.sort === "message" ? "selected" : ""}>메시지순</option>
                <option value="shot" ${e.sort === "shot" ? "selected" : ""}>샷순</option>
              </select>
              <select id="nx-explorer-thumb" style="min-height:34px;border-radius:10px;border:1px solid var(--border2);background:rgba(7,10,17,.7);color:var(--text);padding:4px 8px">
                <option value="s" ${e.thumb === "s" ? "selected" : ""}>작게</option>
                <option value="m" ${e.thumb === "m" ? "selected" : ""}>보통</option>
                <option value="l" ${e.thumb === "l" ? "selected" : ""}>크게</option>
              </select>
              <button type="button" id="nx-explorer-export-folder" class="secondary" style="min-height:30px;padding:4px 10px">폴더 ZIP</button>
              <button type="button" id="nx-explorer-export-all" class="secondary" style="min-height:30px;padding:4px 10px">전체 ZIP</button>
              <button type="button" id="nx-explorer-import" class="secondary" style="min-height:30px;padding:4px 10px">ZIP 불러오기</button>
              <input id="nx-explorer-import-file" type="file" accept=".zip,application/zip" style="display:none">
              <span class="muted" style="font-size:12px">${a.length}장</span>
            </div>
          </div>
          <div id="nx-explorer-selbar" class="explorer-selbar">
            <strong data-ex-selcount style="font-size:12px">${selCount ? `${selCount}장 선택` : "선택 없음"}</strong>
            <button type="button" id="nx-explorer-mobile-select" class="secondary ex-mobile-select ${e.mobileSelect ? "active" : ""}" style="min-height:28px;padding:4px 10px" title="터치에서 탭할 때마다 선택 토글">선택모드</button>
            <button type="button" id="nx-explorer-export-sel" class="secondary" style="min-height:28px;padding:4px 10px">선택 ZIP</button>
            <button type="button" id="nx-explorer-save-one" class="secondary" style="min-height:28px;padding:4px 10px">단건 저장</button>
            <button type="button" id="nx-explorer-favonly" class="secondary ex-mobile-select ${e.favOnly ? "active" : ""}" style="min-height:28px;padding:4px 10px" title="별 표시한 이미지만 보기">${e.favOnly ? "★ 즐겨찾기만" : "☆ 즐겨찾기만"}</button>
            <button type="button" id="nx-explorer-delete-sel" style="min-height:28px;padding:4px 10px">삭제</button>
            <button type="button" id="nx-explorer-clear-sel" class="secondary" style="min-height:28px;padding:4px 10px">선택 해제</button>
          </div>
          <div class="explorer-grid" style="--ex-thumb:${thumb}px"><div class="explorer-marquee" id="nx-explorer-marquee"></div>${et(a)}</div>
        </section>
      </div>
      <div class="notice info" style="margin-top:12px">클릭=선택 · Shift 범위 · Ctrl/⌘ 토글 · 더블클릭=크게보기 · 드래그=박스선택 · Del=삭제 · ZIP에 manifest 포함(불러오기 시 content_hash 재부착).</div>
      <div id="nx-explorer-ctx" class="explorer-ctx">
        <button type="button" data-ex-act="view">크게보기</button>
        <button type="button" data-ex-act="jump">원문 메시지로</button>
        <button type="button" data-ex-act="save">이미지 저장</button>
        <button type="button" data-ex-act="zip">선택 ZIP</button>
        <button type="button" data-ex-act="star">즐겨찾기</button>
        <button type="button" data-ex-act="delete">삭제</button>
      </div>
      <div id="nx-explorer-lightbox" class="explorer-lightbox" data-lb-backdrop>
        <div class="lb-stage" data-lb-backdrop><img alt="크게보기"></div>
        <div class="lb-bar">
          <button type="button" id="nx-lb-prev" class="secondary">◀</button>
          <span data-lb-meta class="muted" style="font-size:12px"></span>
          <button type="button" id="nx-lb-next" class="secondary">▶</button>
          <button type="button" id="nx-lb-fav" class="secondary ex-mobile-select">☆ 즐겨찾기</button>
          <button type="button" id="nx-lb-close">닫기</button>
        </div>
      </div>`;
  }
  function $e(e, n = !0) {
    const o = document.getElementById("nx-save-flash");
    o && (o.style.color = n ? "var(--ok)" : "var(--err)", o.textContent = e, clearTimeout(t._saveFlashTimer), t._saveFlashTimer = setTimeout(() => {
      o.textContent === e && (o.textContent = "");
    }, 1800));
  }
  function Mt() {
    return document.getElementById("nx-power") ? {
      power: ee("nx-power"),
      execute: N("nx-execute"),
      gallery_fab: !1,
      floating_viewer: ee("nx-floating-viewer"),
      overlay_markers: ee("nx-overlay"),
      llm_anchor_percent: ee("nx-llm-anchor"),
      natural_base: ee("nx-natural-base"),
      inline_previews: ee("nx-overlay"),
      overlay_hide_offscreen: ee("nx-hide-offscreen"),
      scroll_message_track: ee("nx-scroll-track"),
      click_message_track: ee("nx-click-track"),
      message_select_gesture: N("nx-select-gesture") === "double" ? "double" : "single",
      text_drag_select: ee("nx-text-drag"),
      mobile_toggle_pin: ee("nx-mobile-pin"),
      hover_preview: ee("nx-hover-preview"),
      show_risu_settings_button: ee("nx-risu-settings-button"),
      debug_panel: ee("nx-debug-panel"),
      generate_all_roles: ee("nx-gen-all-roles"),
      auto_gen_on_reply: ee("nx-auto-gen-reply"),
      lorebook: ee("nx-lore"),
      unified_chat_priority: ee("nx-unified-priority"),
      char_info: ee("nx-charinfo"),
      user_info: ee("nx-userinfo"),
      char_appearance: ee("nx-appearance"),
      inline_thumb_pct: Math.max(1, Ne(N("nx-inline-pct"), 100)),
      overlay_x_pct: Math.max(0, Math.min(100, Math.floor(Ne(N("nx-overlay-x"), pinXPctDefault)))),
      overlay_y_pct: Math.max(0, Math.min(100, Math.floor(Ne(N("nx-overlay-y"), pinYPctDefault)))),
      overlay_pin_unit: "pct",
      overlay_pin_origin: "bl",
      hover_preview_anchor: Bt(N("nx-hover-anchor")),
      hover_preview_corner: Ut(N("nx-hover-corner")),
      viewer_minimize_mode: N("nx-minimize-mode") === "toolbar" ? "toolbar" : "icon"
    } : null;
  }
  function Ct() {
    if (!document.getElementById("nx-mode") && !document.getElementById("nx-char-max")) return null;
    const e = document.getElementById("nx-custom-pos") ? _e() : t.backendSettings?.card || {}, n = re(N("nx-char-max") || e.character_max || 6, 1, 6, 6);
    return {
      mode: N("nx-mode") || e.mode || "illustration",
      image_min: Number(N("nx-min") || e.image_min || 1),
      image_max: Number(N("nx-max") || e.image_max || 3),
      character_max: n,
      include_max: Number(N("nx-include-max") || e.include_max || 0),
      preprocessing: document.getElementById("nx-preprocess") ? ee("nx-preprocess") : !!e.preprocessing,
      person_tag_mode: N("nx-person-tag-mode") || e.person_tag_mode || "gender",
      auto_person_tags: (N("nx-person-tag-mode") || e.person_tag_mode || "gender") !== "off",
      lore_extra: document.getElementById("nx-lore-extra") ? normalizeLoreExtraMode(N("nx-lore-extra")) : normalizeLoreExtraMode(e.lore_extra),
      presets: e.presets || [],
      active_preset_id: e.active_preset_id || "",
      custom_pos: e.custom_pos || "",
      custom_neg: e.custom_neg || ""
    };
  }
  async function xa() {
    try {
      await flushSettingsSave();
      const e = {}, n = Mt(), o = Ct();
      if ((n || o) && (e.card = {
        ...t.backendSettings?.card || {},
        ...n || {},
        ...o || {}
      }), document.getElementById("nx-llm-model") || document.getElementById("nx-nai-model")) {
        const a = ba();
        a && (e.llm = a.llm, e.nai = a.nai);
      }
      if (Object.keys(e).length && await pe(e), t.uiTab === "characters" && await K("/v1/characters", {
        method: "POST",
        body: withRootSessions({
          session_id: (await Z()).sessionId,
          character_id: w(t.lastScope?.characterId || "", 200),
          characters: oe("session"),
          global: oe("global")
        }, t.lastScope)
      }).then((res) => {
        if (Array.isArray(res?.characters)) t.charactersSession = res.characters;
        if (Array.isArray(res?.global)) t.charactersGlobal = res.global;
        if (res?.appearance) t.appearance = res.appearance;
        t._charsDirty = !1;
      }), t.uiTab === "prompts") for (const a of t.prompts || []) {
        const r = document.getElementById(`nx-prompt-${a.key}`);
        if (!r) continue;
        const i = r.value || "";
        t.promptDrafts[a.key] = i, await K(`/v1/prompts/${encodeURIComponent(a.key)}`, {
          method: "PUT",
          body: { text: i }
        });
      }
      t.uiMessage = {
        type: "success",
        text: "전체 저장됨"
      }, $e("저장됨");
    } catch (e) {
      $e("저장 실패", !1), t.uiMessage = {
        type: "error",
        text: z(e?.message || e)
      };
    }
    await P();
  }
  function Oe() {
    const e = {
      source: N("nx-llm-source") || "custom",
      provider: N("nx-llm-provider"),
      model: N("nx-llm-model"),
      endpoint: N("nx-llm-endpoint"),
      temperature: Number(N("nx-llm-temp") || 0.4),
      max_tokens: Number(N("nx-llm-max") || 8e3),
      reasoning_effort: N("nx-llm-reasoning") || "default",
      vertex_region: N("nx-llm-vertex-region") || "us-central1",
      anthropic_version: N("nx-llm-anthropic-version") || "2023-06-01"
    }, n = N("nx-llm-key");
    n && (e.api_key = n);
    const sa = N("nx-llm-service-account");
    sa && (e.service_account_json = sa);
    if (ee("nx-llm-clear-sa")) e.clearServiceAccount = !0;
    const hasEl = (id) => !!document.getElementById(id);
    const o = {
      backend: N("nx-img-backend") || "nai",
      provider: hasEl("nx-nai-provider") ? N("nx-nai-provider") : void 0,
      model: hasEl("nx-nai-model") ? N("nx-nai-model") : void 0,
      request_url: hasEl("nx-nai-url") ? N("nx-nai-url") : void 0,
      width: hasEl("nx-nai-w") ? Number(N("nx-nai-w") || 832) : void 0,
      height: hasEl("nx-nai-h") ? Number(N("nx-nai-h") || 1216) : void 0,
      sampler: hasEl("nx-nai-sampler") ? N("nx-nai-sampler") : void 0,
      scheduler: hasEl("nx-nai-sched") ? N("nx-nai-sched") : void 0,
      steps: hasEl("nx-nai-steps") ? Number(N("nx-nai-steps") || 28) : void 0,
      cfg_scale: hasEl("nx-nai-cfg") ? Number(N("nx-nai-cfg") || 7) : void 0,
      cfg_rescale: hasEl("nx-nai-rescale") ? Number(N("nx-nai-rescale") || 0.36) : void 0,
      image_reference: hasEl("nx-nai-ref") ? N("nx-nai-ref") || "none" : void 0,
      image_reference_strength: hasEl("nx-nai-ref-strength") ? Number(N("nx-nai-ref-strength") || 0.6) : void 0,
      image_reference_fidelity: hasEl("nx-nai-ref-fidelity") ? Number(N("nx-nai-ref-fidelity") || 1) : void 0,
      image_reference_type: hasEl("nx-nai-ref-type") ? N("nx-nai-ref-type") || "character&style" : void 0,
      vibe_transfer: hasEl("nx-nai-vibe") ? N("nx-nai-vibe") || "none" : void 0,
      vibe_transfer_strength: hasEl("nx-nai-vibe-strength") ? Number(N("nx-nai-vibe-strength") || 0.6) : void 0,
      vibe_transfer_information_extracted: hasEl("nx-nai-vibe-ie") ? Number(N("nx-nai-vibe-ie") || 1) : void 0,
      variety_plus: hasEl("nx-nai-var") ? ee("nx-nai-var") : void 0,
      enable_i2i: hasEl("nx-nai-i2i") ? ee("nx-nai-i2i") : void 0,
      apply_quality_tags: hasEl("nx-nai-quality") ? ee("nx-nai-quality") : void 0,
      comfy_url: hasEl("nx-comfy-url") ? N("nx-comfy-url") : void 0,
      comfy_workflow_json: hasEl("nx-comfy-workflow") ? N("nx-comfy-workflow") : void 0,
      backend_timeout_seconds: hasEl("nx-backend-timeout") ? Number(N("nx-backend-timeout") || 300) : void 0
    };
    for (const k of Object.keys(o)) if (o[k] === void 0) delete o[k];
    const a = hasEl("nx-nai-key") ? N("nx-nai-key") : "";
    return a && (o.api_key = a), {
      llm: e,
      nai: o
    };
  }
  function ba() {
    return !document.getElementById("nx-llm-model") && !document.getElementById("nx-nai-model") && !document.getElementById("nx-img-backend") ? null : Oe();
  }
  async function Lt(e, n) {
    const o = (r, i = "pending") => {
      n && (n.className = `autotag-status muted ${i}`, n.textContent = r);
    };
    o("로딩중… 연결 LLM에 이미지 전송", "pending");
    let a;
    try {
      a = await K("/v1/autotag", {
        method: "POST",
        body: {
          image_b64: await It(e),
          threshold: t.autotagThreshold || 0.2
        }
      }, 18e4);
    } catch (err) {
      throw new Error(err?.data?.error?.message || err?.message || err || "오토태그 실패");
    }
    if (!a?.ok && !a?.appearance && !a?.attire && !a?.accessories && !a?.text) {
      throw new Error(a?.error?.message || a?.message || "태그 없음");
    }
    const appearance = w(a.appearance || "", 4e3);
    const attire = w(a.attire || "", 4e3);
    const accessories = w(a.accessories || "", 4e3);
    const text = w(a.text || [appearance, attire, accessories].filter(Boolean).join(", ") || (a.tags || []).join(", "), 8e3);
    const count = a.count || (a.tags || []).length || [appearance, attire, accessories].filter(Boolean).length;
    return o(`LLM 태그 완료 · 외형/의상/악세 ${count ? `${count}토큰` : "반영"}`, "ok"), {
      appearance: appearance || (!attire && !accessories ? text : ""),
      attire,
      accessories,
      text,
      count
    };
  }
  async function Tt(e, n) {
    if (!e) return;
    Qe(e, { open: !0 });
    const o = e.querySelector("[data-autotag-status]"), a = e.querySelector("[data-autotag-badge]"), r = e.querySelector("[data-char-autotag]");
    const appEl = e.querySelector("[data-char-appearance]"), attEl = e.querySelector("[data-char-attire]"), accEl = e.querySelector("[data-char-accessories]");
    a && (a.classList.add("show"), a.textContent = "분석 중…"), r && (r.classList.add("armed"), r.textContent = "분석 중…");
    try {
      const s = await Lt(n, o);
      if (appEl) appEl.value = s.appearance || "";
      if (attEl) attEl.value = s.attire || "";
      if (accEl) accEl.value = s.accessories || "";
      a && (a.textContent = "완료"), r && (r.textContent = "오토태그");
    } catch (s) {
      o && (o.className = "autotag-status muted err", o.textContent = `실패: ${z(s?.message || s, 80)}`), a && (a.textContent = "실패"), r && (r.textContent = "붙여넣기 대기");
    }
  }

  async function withImageRerollToast(e, n, opts = {}) {
    const o = String(e || "이미지 리롤 중…");
    const shotCount = Math.max(1, Math.floor(Number(opts.shotCount) || 1));
    t.jobProgress = {
      state: "generating",
      message: o,
      progress: 12,
      shot_index: 0,
      shot_count: shotCount,
      shot_done: 0,
      jobId: "reroll",
      kind: "reroll"
    }, await Se();
    const a = setInterval(() => {
      if (!t.jobProgress || t.jobProgress.jobId !== "reroll") return;
      const r = Number(t.jobProgress.progress) || 12;
      r < 88 && (t.jobProgress = {
        ...t.jobProgress,
        progress: Math.min(88, r + 4)
      }, Se().catch(() => {
      }));
    }, 900);
    try {
      const r = await n((patch) => {
        if (!t.jobProgress || t.jobProgress.jobId !== "reroll") return;
        t.jobProgress = { ...t.jobProgress, ...patch };
        Se().catch(() => {
        });
      });
      return clearInterval(a), t.jobProgress = {
        state: "done",
        message: "리롤 완료",
        progress: 100,
        shot_index: shotCount,
        shot_count: shotCount,
        shot_done: shotCount,
        jobId: "reroll",
        kind: "reroll"
      }, await Se(), setTimeout(() => {
        t.jobProgress?.jobId === "reroll" && (t.jobProgress = null, Se().catch(() => {
        }));
      }, 1800), r;
    } catch (r) {
      throw clearInterval(a), t.jobProgress = {
        state: "error",
        message: z(r?.message || r, 120),
        progress: 100,
        shot_index: 0,
        shot_count: shotCount,
        shot_done: 0,
        jobId: "reroll",
        kind: "reroll"
      }, await Se(), r;
    }
  }

  function messageCardsByY(msg) {
    const VC = globalThis.__INLAY_VIEWER_CORE__;
    const all = Array.isArray(t.gallery) ? t.gallery : [];
    if (!msg) return [];
    if (typeof VC?.galleryForMessage == "function") {
      const ordered = VC.galleryForMessage(all, msg, 0);
      const n = typeof VC.gallerySelectedCount == "function" ? VC.gallerySelectedCount(all, msg) : ordered.length;
      return ordered.slice(0, Math.max(0, n));
    }
    const yOf = (c) => {
      const n = Number(c?.y_percent ?? c?.anchor_percent ?? c?.read_percent);
      return Number.isFinite(n) ? n : 999;
    };
    return all
      .filter((c) => c?.content_hash && c.content_hash === msg.hash)
      .sort((a, b) => yOf(a) - yOf(b) || Number(a.shot_index || 0) - Number(b.shot_index || 0));
  }

  /** Reroll each message image in y% order; refresh gallery after every shot. */
  async function rerollMessageImagesLive(msg, opts = {}) {
    const scope = opts.scope || await Z({ useOverride: !1 }).catch(() => null);
    const sessionId = msg?.sessionId || scope?.sessionId || "";
    let targets = messageCardsByY(msg);
    if (!targets.length) throw new Error("재생성할 이미지 없음");
    const total = targets.length;
    const cards = [], replaced = [], failed = [];
    const report = typeof opts.report == "function" ? opts.report : () => {
    };
    const onShot = typeof opts.onShot == "function" ? opts.onShot : null;
    for (let i = 0; i < total; i += 1) {
      // Re-resolve left strip each time — card ids change after each replace.
      if (sessionId) await ce(sessionId, !0);
      targets = messageCardsByY(msg);
      const current = targets[i];
      if (!current?.id) {
        failed.push({ id: "", error: `slot ${i + 1} missing` });
        continue;
      }
      report({
        message: `${i + 1}/${total} 이미지 재생성 중…`,
        progress: Math.max(8, Math.min(92, Math.round(i / total * 90))),
        shot_index: i,
        shot_count: total,
        shot_done: i
      });
      try {
        const result = await K(`/v1/cards/${encodeURIComponent(current.id)}/reroll`, {
          method: "POST",
          body: { mode: "nai" }
        }, 18e4);
        if (result?.busy || result?.error?.code === "busy") {
          failed.push({ id: current.id, error: result?.error?.message || "busy" });
          break;
        }
        if (result?.ok && result.card) {
          cards.push(result.card);
          if (result.replaced) replaced.push(result.replaced);
        } else {
          failed.push({ id: current.id, error: result?.error?.message || "reroll failed" });
          continue;
        }
        if (sessionId) await ce(sessionId, !0);
        try {
          await he();
        } catch {
        }
        report({
          message: `${i + 1}/${total} 완료`,
          progress: Math.max(12, Math.min(96, Math.round((i + 1) / total * 95))),
          shot_index: i + 1,
          shot_count: total,
          shot_done: i + 1
        });
        if (onShot) await onShot(i, result, total);
        else if (t.galleryUi?.renderGal) await t.galleryUi.renderGal();
      } catch (err) {
        failed.push({ id: current.id, error: z(err?.message || err, 400) });
      }
    }
    if (!cards.length) throw new Error(failed[0]?.error || "전체 재생성 실패");
    return { ok: !0, count: cards.length, replaced, cards, failed };
  }

  async function dismissProgressToast() {
    t.jobProgress = null;
    try {
      await Se();
    } catch {
    }
  }
  async function Se() {
    try {
      if (t.galleryUi?.paintStatus) await t.galleryUi.paintStatus();
    } catch {
    }
  }
  async function ya() {
    return null;
  }
  async function P() {
    if (!t.uiOpen || typeof document > "u") return;
    if (t.charEditUi?.root) {
      if (t.charEditUi.root.isConnected) return;
      t.charEditUi = null;
    }
    t._uiRendering = !0;
    try {
    const e = ++t.uiRenderGen;
    let n = t.settings || {
      backendUrl: "http://127.0.0.1:28120",
      enabled: !0
    };
    ve().catch(() => {
    });
    let o = "";
    t.backendSettings ? le().catch(() => {
    }) : le().then(() => {
      t.uiOpen && e === t.uiRenderGen && P();
    }).catch((d) => {
      t.uiMessage = {
        type: "error",
        text: z(d?.message || d)
      }, t.uiOpen && e === t.uiRenderGen && P();
    });
    if (t.uiTab === "prompts" && (!(t.prompts || []).length && !t._promptsLoading ? (t._promptsLoading = !0, Je().catch((d) => {
      t.uiMessage = {
        type: "error",
        text: z(d?.message || d)
      };
    }).finally(() => {
      t._promptsLoading = !1, t.uiOpen && t.uiTab === "prompts" && P().catch(() => {
      });
    })) : Je().catch(() => {
    })), t.uiTab === "characters" && !t._charsBgRefresh) {
      const d = e, U = () => JSON.stringify({
        s: t.charactersSession || [],
        g: t.charactersGlobal || []
      }), f = U();
      t._charsBgRefresh = !0, (async () => {
        try {
          const x = t.lastScope || await Z();
          // Keep unsaved draft rows (new_/gnew_/tmp_) — ce() reloads from API and would wipe them.
          const isDraft = (c) => {
            const id = String(c?.id || "");
            return id.startsWith("new_") || id.startsWith("gnew_") || id.startsWith("tmp_");
          };
          const mergeDrafts = (serverList, localList) => {
            const server = Array.isArray(serverList) ? serverList : [];
            const ids = new Set(server.map((c) => String(c?.id || "")));
            const extras = (Array.isArray(localList) ? localList : []).filter((c) => isDraft(c) && !ids.has(String(c?.id || "")));
            return extras.length ? [...server, ...extras] : server;
          };
          const localSession = [...(t.charactersSession || [])];
          const localGlobal = [...(t.charactersGlobal || [])];
          await ce(x?.sessionId);
          // Unsaved add/delete edits must not be overwritten by the background reload.
          if (t._charsDirty) {
            t.charactersSession = localSession;
            t.charactersGlobal = localGlobal;
            return;
          }
          t.gallerySessionId = x?.sessionId || "";
          t.charactersSession = mergeDrafts(t.charactersSession, localSession);
          t.charactersGlobal = mergeDrafts(t.charactersGlobal, localGlobal);
          if (f === U() || d !== t.uiRenderGen || !t.uiOpen || t.uiTab !== "characters" || t.charEditUi?.root?.isConnected) return;
          await P();
        } catch {
        } finally {
          t._charsBgRefresh = !1;
        }
      })();
    }
    if (t.uiTab === "explorer" && !t._explorerLoading) {
      const d = !!((t.explorer?.items || []).length || (t.explorer?.folders || []).length);
      t._explorerLoading = !0, Et(!1).then((U) => {
        if (!t.uiOpen || t.uiTab !== "explorer") return;
        const f = !!((U?.items || []).length || (U?.folders || []).length);
        !d && f && P().catch(() => {
        });
      }).catch(() => {
      }).finally(() => {
        t._explorerLoading = !1;
      });
    }
    if (e !== t.uiRenderGen) return;
    let a = t.health ? {
      ok: !0,
      health: t.health
    } : {
      ok: !1,
      error: "확인 중…"
    };
    bt().then((d) => {
      if (!(e !== t.uiRenderGen || !t.uiOpen))
        try {
          const U = document.querySelectorAll(".grid > .card .value");
          U[0] && (U[0].textContent = d.ok ? `연결됨 · v${d.health?.version || "?"}` : `연결 실패 · ${d.error || "unknown"}`);
        } catch {
        }
    }).catch(() => {
    });
    const r = t.backendSettings || {}, i = r.card || {}, s = r.nai || {}, c = r.llm || {}, l = a.ok ? `연결됨 · v${h(a.health?.version || "?")}` : a.error ? `연결 실패 · ${h(a.error)}` : "확인 중…", p = t.uiMessage;
    const VCPin = globalThis.__INLAY_VIEWER_CORE__, vwUi = typeof window < "u" && window.innerWidth || 1200, vhUi = typeof window < "u" && window.innerHeight || 800;
    const pinUiX = typeof VCPin?.resolveStoredPinPercent == "function" ? VCPin.resolveStoredPinPercent(i, "x", vwUi, { x: pinXPctDefault, y: pinYPctDefault }) : Ne(i.overlay_x_pct, pinXPctDefault);
    const pinUiY = typeof VCPin?.resolveStoredPinPercent == "function" ? VCPin.resolveStoredPinPercent(i, "y", vhUi, { x: pinXPctDefault, y: pinYPctDefault }) : Ne(i.overlay_y_pct, pinYPctDefault);
    let m = t.lastScope;
    let u = "";
    if (t.uiTab === "dashboard") u = `
        <div class="card"><strong>카드 전원</strong>
          <div class="checks-grid">
            <label class="toggle-row" data-nx-help-id="nx-power"><input type="checkbox" id="nx-power" ${i.power !== !1 ? "checked" : ""}><span>Power ON</span></label>
            <label class="toggle-row" data-nx-help-id="nx-floating-viewer"><input type="checkbox" id="nx-floating-viewer" ${i.floating_viewer !== !1 ? "checked" : ""}><span>플로팅 뷰어</span></label>
            <label class="toggle-row" data-nx-help-id="nx-overlay"><input type="checkbox" id="nx-overlay" ${i.overlay_markers !== !1 ? "checked" : ""}><span>채팅 왼쪽 줄 오버레이</span></label>
            <label class="toggle-row" data-nx-help-id="nx-llm-anchor"><input type="checkbox" id="nx-llm-anchor" ${i.llm_anchor_percent ? "checked" : ""}><span>LLM 읽기 위치 배치</span></label>
            <label class="toggle-row" data-nx-help-id="nx-natural-base"><input type="checkbox" id="nx-natural-base" ${i.natural_base !== !1 ? "checked" : ""}><span>자연어 base 태그</span></label>
            <label class="toggle-row" data-nx-help-id="nx-hide-offscreen"><input type="checkbox" id="nx-hide-offscreen" ${i.overlay_hide_offscreen !== !1 ? "checked" : ""}><span>화면 밖이면 이미지 숨김</span></label>
            <label class="toggle-row" data-nx-help-id="nx-scroll-track"><input type="checkbox" id="nx-scroll-track" ${i.scroll_message_track !== !1 ? "checked" : ""}><span>스크롤로 메시지 추적</span></label>
            <label class="toggle-row" data-nx-help-id="nx-click-track"><input type="checkbox" id="nx-click-track" ${i.click_message_track !== !1 ? "checked" : ""}><span>메시지 클릭으로 선택</span></label>
            <label class="toggle-row" data-nx-help-id="nx-text-drag"><input type="checkbox" id="nx-text-drag" ${i.text_drag_select !== !1 ? "checked" : ""}><span>글자 드래그 선택</span></label>
            <label class="toggle-row" data-nx-help-id="nx-mobile-pin"><input type="checkbox" id="nx-mobile-pin" ${i.mobile_toggle_pin ? "checked" : ""}><span>모바일 모서리 고정</span></label>
            <label class="toggle-row" data-nx-help-id="nx-hover-preview"><input type="checkbox" id="nx-hover-preview" ${i.hover_preview !== !1 ? "checked" : ""}><span>스티키 핀 호버 미리보기</span></label>
            <label class="toggle-row" data-nx-help-id="nx-risu-settings-button"><input type="checkbox" id="nx-risu-settings-button" ${i.show_risu_settings_button !== !1 ? "checked" : ""}><span>Risu 설정 바로가기</span></label>
            <label class="toggle-row" data-nx-help-id="nx-debug-panel"><input type="checkbox" id="nx-debug-panel" ${i.debug_panel ? "checked" : ""}><span>디버그 패널</span></label>
            <label class="toggle-row" data-nx-help-id="nx-gen-all-roles"><input type="checkbox" id="nx-gen-all-roles" ${i.generate_all_roles ? "checked" : ""}><span>모든 메시지 이미지 생성</span></label>
            <label class="toggle-row" data-nx-help-id="nx-auto-gen-reply"><input type="checkbox" id="nx-auto-gen-reply" ${i.auto_gen_on_reply ? "checked" : ""}><span>응답 후 자동 생성</span></label>
            <label class="toggle-row" data-nx-help-id="nx-lore"><input type="checkbox" id="nx-lore" ${i.lorebook !== !1 ? "checked" : ""}><span>Lorebook 주입</span></label>
            <label class="toggle-row" data-nx-help-id="nx-unified-priority"><input type="checkbox" id="nx-unified-priority" ${i.unified_chat_priority ? "checked" : ""}><span>통합 챗 우선</span></label>
            <label class="toggle-row" data-nx-help-id="nx-charinfo"><input type="checkbox" id="nx-charinfo" ${i.char_info !== !1 ? "checked" : ""}><span>CharInfo</span></label>
            <label class="toggle-row" data-nx-help-id="nx-userinfo"><input type="checkbox" id="nx-userinfo" ${i.user_info ? "checked" : ""}><span>UserInfo</span></label>
            <label class="toggle-row" data-nx-help-id="nx-appearance"><input type="checkbox" id="nx-appearance" ${i.char_appearance !== !1 ? "checked" : ""}><span>CharAppearance 누적</span></label>
          </div>
          <div class="model-form" style="margin-top:14px">
            <label data-nx-help-id="nx-execute"><span>발동</span>
              <select id="nx-execute"><option value="auto" ${i.execute !== "manual" ? "selected" : ""}>자동</option><option value="manual" ${i.execute === "manual" ? "selected" : ""}>수동</option></select>
            </label>
            <label data-nx-help-id="nx-inline-pct"><span>상시 이미지 크기 (%)</span>
              <input id="nx-inline-pct" type="number" min="1" step="10" value="${h(i.inline_thumb_pct ?? 100)}">
            </label>
            <label data-nx-help-id="nx-overlay-x"><span>스티키 핀 가로 위치 (% · 왼쪽 기준)</span>
              <input id="nx-overlay-x" type="number" min="0" max="100" step="1" value="${h(Math.floor(Number(pinUiX) || 0))}" ${i.mobile_toggle_pin ? "disabled" : ""}>
            </label>
            <label data-nx-help-id="nx-overlay-y"><span>스티키 핀 세로 위치 (% · 아래 기준)</span>
              <input id="nx-overlay-y" type="number" min="0" max="100" step="1" value="${h(Math.floor(Number(pinUiY) || 0))}">
            </label>
            <label data-nx-help-id="nx-hover-anchor"><span>호버 미리보기 기준</span>
              <select id="nx-hover-anchor">
                <option value="screen" ${(i.hover_preview_anchor || "screen") === "screen" ? "selected" : ""}>화면 기준</option>
                <option value="mouse" ${i.hover_preview_anchor === "mouse" ? "selected" : ""}>마우스 기준</option>
              </select>
            </label>
            <label data-nx-help-id="nx-minimize-mode"><span>접힘 표시 방식</span>
              <select id="nx-minimize-mode">
                <option value="icon" ${(i.viewer_minimize_mode || "icon") === "icon" ? "selected" : ""}>플로팅 아이콘</option>
                <option value="toolbar" ${i.viewer_minimize_mode === "toolbar" ? "selected" : ""}>상단 툴바 한 줄</option>
              </select>
            </label>
            <label data-nx-help-id="nx-select-gesture"><span>메시지 선택 동작</span>
              <select id="nx-select-gesture">
                <option value="single" ${(i.message_select_gesture || "single") === "single" ? "selected" : ""}>한 번 클릭</option>
                <option value="double" ${i.message_select_gesture === "double" ? "selected" : ""}>두 번 클릭</option>
              </select>
            </label>
            <label data-nx-help-id="nx-hover-corner"><span>이미지 모서리</span>
              <select id="nx-hover-corner">
                <option value="top-right" ${i.hover_preview_corner === "top-right" ? "selected" : ""}>우상단</option>
                <option value="bottom-right" ${(i.hover_preview_corner || "bottom-right") === "bottom-right" ? "selected" : ""}>우하단</option>
                <option value="top-left" ${i.hover_preview_corner === "top-left" ? "selected" : ""}>좌상단</option>
                <option value="bottom-left" ${i.hover_preview_corner === "bottom-left" ? "selected" : ""}>좌하단</option>
              </select>
            </label>
          </div>
          <div class="row" style="margin-top:12px"><button id="nx-save-dash" data-nx-help-id="nx-save-dash">대시보드 저장</button><button id="nx-run-now" class="secondary" data-nx-help-id="nx-run-now">지금 생성 (수동)</button><button id="nx-open-viewer" class="secondary" data-nx-help-id="nx-open-viewer">뷰어 앞으로</button></div>
          <div class="row" style="margin-top:8px"><button id="nx-reset-windows" class="secondary" type="button" data-nx-help-id="nx-reset-windows">모든 창 위치 초기화</button><button id="nx-reset-settings" class="secondary" type="button" data-nx-help-id="nx-reset-settings">모든 설정 초기화</button></div>
        </div>`;
    else if (t.uiTab === "card") {
      const d = kt(i), activePid = resolveActivePresetId(d), U = d.presets, f = U.find((g) => presetIdEq(g.id, activePid)) || U[0] || null, x = U.length ? U.map((g) => `<option value="${h(g.id)}" ${f && presetIdEq(g.id, f.id) ? "selected" : ""}>${h(g.name)}</option>`).join("") : '<option value="">(프리셋 없음)</option>', I = U.map((g) => `<button type="button" class="preset-chip ${f && presetIdEq(g.id, f.id) ? "active" : ""}" data-preset-select="${h(g.id)}" draggable="true">${h(g.name)}</button>`).join(""), R = [
        "gender",
        "girls",
        "people",
        "off"
      ].includes(i.person_tag_mode) ? i.person_tag_mode : i.auto_person_tags === !1 ? "off" : "gender", loreExtraUi = normalizeLoreExtraMode(i.lore_extra);
      u = `
        <div class="card model-card">
          <div class="prompt-group-label">생성 옵션</div>
          <div class="model-form">
            <label><span>Mode</span><select id="nx-mode"><option value="illustration" ${i.mode !== "asset" ? "selected" : ""}>삽화</option><option value="asset" ${i.mode === "asset" ? "selected" : ""}>에셋</option></select></label>
            <label><span>Image Min</span><input id="nx-min" type="number" min="1" max="6" value="${h(i.image_min ?? 1)}"></label>
            <label><span>Image Max</span><input id="nx-max" type="number" min="1" max="6" value="${h(i.image_max ?? 3)}"></label>
            <label><span>캐릭터 수 제한 (char1~)</span><input id="nx-char-max" type="number" min="1" max="6" value="${h(i.character_max ?? 6)}"></label>
            <label><span>Include Max (최근 문맥 개수)</span><input id="nx-include-max" type="number" min="0" max="20" value="${h(i.include_max ?? 0)}"></label>
            <label class="check wide"><input id="nx-preprocess" type="checkbox" ${i.preprocessing ? "checked" : ""}> Preprocessing (토큰 추가 소모)</label>
            <label class="wide"><span>사람 태그 자동넣기</span><select id="nx-person-tag-mode">
              <option value="gender" ${R === "gender" ? "selected" : ""}>성별 분리 (1girl, 1boy…)</option>
              <option value="girls" ${R === "girls" ? "selected" : ""}>인원수 → girls (4girls)</option>
              <option value="people" ${R === "people" ? "selected" : ""}>인원수 → people (4people)</option>
              <option value="off" ${R === "off" ? "selected" : ""}>안 넣기</option>
            </select></label>
            <label class="wide" data-nx-help-id="nx-lore-extra"><span>lb-xnai.lb.extra</span><select id="nx-lore-extra">
              <option value="tags" ${loreExtraUi === "tags" ? "selected" : ""}>캐릭터 태그만</option>
              <option value="full" ${loreExtraUi === "full" ? "selected" : ""}>전체</option>
              <option value="off" ${loreExtraUi === "off" ? "selected" : ""}>넣지 않음</option>
            </select></label>
          </div>
          <div class="notice info" style="margin-top:12px">캐릭터 수 제한 N이면 LLM 프롬프트에 반영되며, 생성 시에도 char1~char${h(i.character_max ?? 6)}까지만 들어갑니다.</div>
        </div>
        <div class="card model-card">
          <div class="model-head">
            <div>
              <div class="prompt-title">스타일 프리셋</div>
              <div class="muted">card.json / 로어북 [Positive]·[Negative] 항목을 불러와 바로 씁니다.</div>
            </div>
            <span class="badge ${U.length ? "custom" : "default"}">${U.length}개</span>
          </div>
          <div class="preset-chip-row">${I || '<span class="muted">아직 프리셋이 없습니다. JSON을 불러오세요.</span>'}</div>
          <div class="preset-toolbar">
            <select id="nx-preset-select">${x}</select>
            <button type="button" id="nx-preset-new" class="secondary">새 프리셋</button>
            <button type="button" id="nx-preset-dup" class="secondary">복제</button>
            <button type="button" id="nx-preset-del" class="secondary">삭제</button>
          </div>
          <div class="model-form">
            <label class="wide"><span>프리셋 이름</span><input id="nx-preset-name" value="${h(f?.name || "")}" ${f ? "" : "disabled"}></label>
            <label class="wide"><span>Positive</span><textarea id="nx-custom-pos" ${f ? "" : "disabled"}>${h(f?.positive || "")}</textarea></label>
            <label class="wide"><span>Negative</span><textarea id="nx-custom-neg" ${f ? "" : "disabled"}>${h(f?.negative || "")}</textarea></label>
          </div>
          <div class="section-split"></div>
          <div class="prompt-group-label">프리셋 가져오기 / 내보내기</div>
          <div class="row" style="margin-top:8px">
            <button type="button" id="nx-preset-export" class="secondary">JSON 내보내기</button>
            <button type="button" id="nx-preset-file" class="secondary">JSON 파일 열기</button>
            <button type="button" id="nx-preset-import">붙여넣기 가져오기</button>
            <input id="nx-preset-file-input" type="file" accept=".json,application/json,text/plain" style="display:none">
          </div>
          <label class="wide" style="display:flex;flex-direction:column;gap:6px;margin-top:12px;color:#bbc6d8;font-size:11px;font-weight:680;text-transform:uppercase;letter-spacing:.055em">
            <span>card.json 또는 프리셋 JSON 붙여넣기</span>
            <textarea id="nx-preset-import-text" class="import-box" placeholder='Risu card.json 전체, 또는 {"presets":[...]} 형식'></textarea>
          </label>
          <div class="row" style="margin-top:14px">
            <button id="nx-save-card">카드 설정 저장</button>
          </div>
        </div>`;
    } else if (t.uiTab === "characters") {
      const d = (t.gallery || [])[0]?.characters || [], U = d.length ? d.map((R, g) => `<div class="card"><strong>char${g + 1} · ${h(R.name || "")}</strong><div class="muted" style="margin-top:8px;white-space:pre-wrap">${h(R.prompt || "")}</div></div>`).join("") : '<div class="card"><div class="muted">최근 샷 캐릭터 없음</div></div>', Nn = !!(t.scopeOverride?.chatIndex === "unified" || t.lastScope?.unified), f = wt(t.charactersSession, "session", Nn ? "통합 챗에 모인 캐릭터가 없습니다. 채팅을 고른 뒤 다시 통합 챗을 선택하세요." : "이 채팅에 쌓인 캐릭터가 없습니다. 생성 후 자동으로 생깁니다."), x = wt(t.charactersGlobal, "global", "글로벌 캐릭터 없음. 모든 채팅에서 공유되며, 같은 이름은 글로벌이 우선합니다."), I = Number(i.character_max ?? 6) || 6;
      u = `
        ${sa(m)}
        <div class="notice info">별칭으로 메시지 매칭합니다. LLM에는 이름만 보내고, 외형/옷/악세사리 태그는 char1~char${I}에 직접 주입합니다. ${Nn ? "통합 챗은 성+이름이 한·영 표기 기준으로 일치할 때만 하나로 묶어 보여 줍니다(원본 기록은 지우지 않음)." : "옷·악세사리가 바뀌면 해당 칸만 교체됩니다."} 오토태그는 버튼 더블클릭(파일) 또는 클릭 후 Ctrl+V.</div>
        <div class="prompt-group-label">이번 샷 (최근 카드)</div>${U}
        <div class="prompt-group-label">${Nn ? "통합 챗 캐릭터" : "현재 채팅 캐릭터"}</div>
        <div id="nx-char-session-list">${f}</div>
        <div class="row" style="margin-top:10px">
          <button id="nx-char-add-session" class="secondary">${Nn ? "통합 캐릭터 추가" : "채팅 캐릭터 추가"}</button>
          <button id="nx-save-chars">${Nn ? "통합 캐릭터 저장" : "채팅 캐릭터 저장"}</button>
          <button id="nx-export-session-chars" class="secondary">JSON 내보내기</button>
          <button id="nx-import-session-chars" class="secondary">JSON 불러오기</button>
          <input id="nx-import-session-chars-file" type="file" accept=".json,application/json,text/plain" style="display:none">
          ${Nn ? '<button id="nx-unify-rebuild" class="secondary">채팅에서 다시 모으기</button>' : ""}
        </div>
        <div class="prompt-group-label" style="margin-top:18px">글로벌 캐릭터</div>
        <div class="notice info" style="margin-bottom:10px">글로벌 캐릭터는 모든 채팅에서 공유됩니다. 특정 챗에서만 끄려면 카드를 펼쳐 「이 캐릭터 챗에서 사용」을 해제하세요. JSON 내보내기/불러오기는 이름·성·별칭·외형 태그를 파일로 옮깁니다.</div>
        <div id="nx-char-global-list">${x}</div>
        <div class="row" style="margin-top:10px">
          <button id="nx-char-add-global" class="secondary">글로벌 캐릭터 추가</button>
          <button id="nx-save-global-chars">글로벌 저장</button>
          <button id="nx-export-global-chars" class="secondary">JSON 내보내기</button>
          <button id="nx-import-global-chars" class="secondary">JSON 불러오기</button>
          <input id="nx-import-global-chars-file" type="file" accept=".json,application/json,text/plain" style="display:none">
          <button id="nx-refresh-chars" class="secondary">새로고침</button>
        </div>`;
    } else if (t.uiTab === "prompts") {
      const promptMeta = {
        author_note: {
          title: "작가의 노트 (사용자 프롬프트 지침)",
          hint: "비워두면 무시됩니다. 태깅 LLM 요청 맨 끝에 최우선 지침으로 들어갑니다.",
        },
      };
      u = (t.prompts || []).map((d) => {
        const meta = promptMeta[d.key] || null;
        const title = meta?.title || d.key;
        const hint = meta?.hint ? `<div class="muted" style="margin:4px 0 8px">${h(meta.hint)}</div>` : "";
        return `
          <div class="card">
            <strong>${h(title)}</strong>${d.key !== title ? `<div class="muted" style="font-size:11px;margin-top:2px">${h(d.key)}</div>` : ""}
            ${hint}
            <textarea id="nx-prompt-${h(d.key)}" placeholder="${d.key === "author_note" ? "예: 항상 실내 조명, 캐릭터는 교복 유지…" : ""}">${h(t.promptDrafts[d.key] ?? d.text ?? "")}</textarea>
            <div class="row"><button data-save-prompt="${h(d.key)}">저장</button><button class="secondary" data-reset-prompt="${h(d.key)}">기본값 복원</button></div>
          </div>`;
      }).join("");
    }
    else if (t.uiTab === "models") {
      const LH = globalThis.__INLAY_LLM__ || {}, llmSource = c.source === "main" || c.source === "aux" ? c.source : "custom", providerRaw = w(c.provider) || "openrouter", f = LH.normalizeLlmProvider?.(providerRaw) || providerRaw, providers = LH.LLM_PROVIDERS || [
        { value: "openrouter", label: "OpenRouter" },
        { value: "openai", label: "OpenAI" },
        { value: "google_ai", label: "Google AI Studio" },
        { value: "vertex", label: "Vertex AI (Google Cloud)" },
        { value: "anthropic_compatible", label: "Anthropic-compatible" },
        { value: "lmstudio", label: "LM Studio (로컬)" },
        { value: "ollama", label: "Ollama (로컬)" },
        { value: "custom", label: "Custom endpoint" }
      ], reasoning = w(c.reasoning_effort) || "default", vertexOn = f === "vertex", anthropicOn = f === "anthropic_compatible", openrouterish = f === "openrouter" || f === "openai" || f === "custom", credOk = vertexOn ? !!(c.service_account_configured || c.api_key_configured) : !!c.api_key_configured, d = llmSource !== "custom" || !!(w(c.model) && (credOk || w(c.endpoint))), imgBk = w(s.backend) === "comfy" ? "comfy" : "nai", U = imgBk === "comfy" ? !!s.comfy_configured || !!w(s.comfy_workflow_json) : !!s.api_key_configured, epPh = LH.defaultEndpointForProvider?.(f, { region: c.vertex_region }) || "https://openrouter.ai/api/v1/chat/completions", modelPh = LH.llmModelPlaceholder?.(f) || "model-id", customSource = llmSource === "custom";
      u = `
        <div class="prompt-toolbar">
          <div><strong>모델 설정</strong><div class="muted">태깅은 직접 LLM 또는 Risu 메인/보조 모델로, 이미지는 NovelAI 또는 ComfyUI로 생성합니다. 시크릿 원문은 다시 표시하지 않습니다.</div></div>
          <div class="toolbar-actions"><button id="nx-save-models">전체 설정 저장</button></div>
        </div>
        <div class="prompt-group-label">태깅 LLM</div>
        <article class="model-card">
          <div class="model-head">
            <div><div class="prompt-title">태깅 LLM</div><div class="muted">OpenRouter · OpenAI · Google · Vertex · Anthropic · 로컬 · Risu</div></div>
            <span class="badge ${d ? "custom" : "default"}">${d ? "활성" : "비활성"} · ${llmSource === "main" ? "Risu 메인" : llmSource === "aux" ? "Risu 보조" : `${vertexOn ? "Service Account" : "API key"} ${credOk ? "설정됨" : "없음"}`}</span>
          </div>
          <div class="notice info" style="margin:12px 0 0"><strong>소스</strong>에서 Risu 메인/보조를 고르면 플러그인 키가 필요 없습니다. 직접 입력일 때 Provider를 바꾸면 Endpoint가 기본값으로 바뀝니다.</div>
          <div class="model-form">
            <label class="wide"><span>태깅 모델 소스</span>
              <select id="nx-llm-source">
                <option value="custom" ${customSource ? "selected" : ""}>직접 입력 (엔드포인트 + 키)</option>
                <option value="main" ${llmSource === "main" ? "selected" : ""}>Risu 메인 모델</option>
                <option value="aux" ${llmSource === "aux" ? "selected" : ""}>Risu 보조 모델</option>
              </select>
            </label>
            <label><span>Provider</span>
              <select id="nx-llm-provider" ${customSource ? "" : "disabled"}>
                ${providers.map((opt) => `<option value="${h(opt.value)}" ${f === opt.value ? "selected" : ""}>${h(opt.label)}</option>`).join("")}
              </select>
            </label>
            <label><span>Model</span><input id="nx-llm-model" value="${h(c.model || "")}" placeholder="${h(modelPh)}"></label>
            <label class="wide"><span>Endpoint${vertexOn || f === "google_ai" || anthropicOn ? " (비워두면 기본값)" : ""}</span><input id="nx-llm-endpoint" type="url" value="${h(c.endpoint || "")}" placeholder="${h(epPh)}" ${vertexOn ? "disabled" : ""}></label>
            ${vertexOn ? `<label><span>Region</span><input id="nx-llm-vertex-region" value="${h(c.vertex_region || "us-central1")}" placeholder="us-central1"></label>` : `<input id="nx-llm-vertex-region" type="hidden" value="${h(c.vertex_region || "us-central1")}">`}
            ${vertexOn ? `<label class="wide"><span>Service Account JSON <span class="key-status">${c.service_account_configured ? "설정됨" : "없음"}</span></span><textarea id="nx-llm-service-account" rows="4" autocomplete="off" placeholder='{"client_email":"...","private_key":"-----BEGIN PRIVATE KEY-----\\n...","project_id":"..."}'></textarea></label><label class="check wide"><input id="nx-llm-clear-sa" type="checkbox"> 저장된 Service Account JSON 지우기</label><label class="wide"><span>Access token (선택) <span class="key-status">${c.api_key_configured ? "설정됨" : "없음"}</span></span><input id="nx-llm-key" type="password" autocomplete="new-password" placeholder="SA 대신 Bearer access token을 쓸 때만"></label>` : `<label class="wide"><span>API key <span class="key-status">${c.api_key_configured ? "설정됨" : "없음"}</span></span><input id="nx-llm-key" type="password" autocomplete="new-password" placeholder="비워 두면 기존 키 유지"></label><textarea id="nx-llm-service-account" style="display:none"></textarea><input id="nx-llm-clear-sa" type="checkbox" style="display:none">`}
            ${anthropicOn ? `<label><span>Anthropic version</span><input id="nx-llm-anthropic-version" value="${h(c.anthropic_version || "2023-06-01")}" placeholder="2023-06-01"></label>` : `<input id="nx-llm-anthropic-version" type="hidden" value="${h(c.anthropic_version || "2023-06-01")}">`}
            <label><span>Temperature</span><input id="nx-llm-temp" type="number" min="0" max="${anthropicOn ? 1 : 2}" step="0.01" value="${h(c.temperature ?? 0.4)}"></label>
            <label><span>Max tokens</span><input id="nx-llm-max" type="number" min="64" max="128000" value="${h(c.max_tokens ?? 8e3)}"></label>
            ${openrouterish || f === "google_ai" || vertexOn ? `<label><span>Reasoning (추론)</span>
              <select id="nx-llm-reasoning">
                ${[
        ["default", "기본값 (모델 기본)"],
        ["none", "none · 추론 끔"],
        ["minimal", "minimal"],
        ["low", "low"],
        ["medium", "medium"],
        ["high", "high"],
        ["xhigh", "xhigh"],
        ["max", "max"]
      ].map(([val, lab]) => `<option value="${val}" ${reasoning === val ? "selected" : ""}>${lab}</option>`).join("")}
              </select>
            </label>` : `<input id="nx-llm-reasoning" type="hidden" value="${h(reasoning)}">`}
          </div>
          <div class="muted model-hint">OpenRouter Reasoning은 지원 모델에만 적용됩니다. Provider를 바꾸면 알려진 기본 Endpoint로 자동 교체되고, 직접 고친 커스텀 URL은 유지합니다.</div>
          <div class="model-actions"><button id="nx-test-llm">태깅 LLM 연결 테스트</button>${$t("llm")}</div>
        </article>
        <div class="prompt-group-label">이미지 생성</div>
        <article class="model-card">
          <div class="model-head">
            <div><div class="prompt-title">${imgBk === "comfy" ? "ComfyUI" : "Novel AI"}</div><div class="muted">${imgBk === "comfy" ? "로컬 ComfyUI API · [[pos]] / [[neg]] / [[char1]]… / [[seed]]" : `char1~char${Number(i.character_max ?? 6) || 6} CharacterCaption + t2i 생성`}</div></div>
            <span class="badge ${U ? "custom" : "default"}">${imgBk === "comfy" ? (U ? "활성 · 워크플로 설정됨" : "비활성 · 워크플로 없음") : `${U ? "활성" : "비활성"} · API key ${s.api_key_configured ? "설정됨" : "없음"}`}</span>
          </div>
          <div class="model-form">
            <label class="wide"><span>이미지 생성 공급자</span>
              <input type="hidden" id="nx-img-backend" value="${h(imgBk)}">
              <div class="nx-seg" id="nx-img-backend-bar">
                <button type="button" data-backend="nai" class="${imgBk === "nai" ? "active" : ""}">NovelAI (NAI)</button>
                <button type="button" data-backend="comfy" class="${imgBk === "comfy" ? "active" : ""}">ComfyUI</button>
              </div>
            </label>
            ${imgBk === "comfy" ? `
            <label class="wide"><span>ComfyUI 요청 URL</span><input id="nx-comfy-url" type="url" value="${h(s.comfy_url || "http://localhost:8188")}" placeholder="http://localhost:8188"></label>
            <label class="wide"><span>Workflow <span class="key-status">API Export JSON</span></span>
              <textarea id="nx-comfy-workflow" rows="8" spellcheck="false" placeholder='{"3":{"inputs":{"text":"[[pos]]\\n[[char1]]"},"class_type":"CLIPTextEncode"}}'>${h(s.comfy_workflow_json || "")}</textarea>
              <div class="row" style="margin:8px 0 0">
                <button type="button" id="nx-comfy-wf-pick" class="secondary">JSON 파일 불러오기</button>
                <input id="nx-comfy-wf-file" type="file" accept="application/json,.json" style="display:none">
                <span class="muted">${s.comfy_workflow_json ? "등록됨 (" + Math.round(String(s.comfy_workflow_json).length / 1024) + "KB)" : "미등록"}</span>
              </div>
            </label>
            <label><span>Timeout (sec)</span><input id="nx-backend-timeout" type="number" min="30" max="1800" value="${h(s.backend_timeout_seconds ?? 300)}"></label>
            ` : `
            <label><span>이미지 생성 공급자 이름</span><input id="nx-nai-provider" value="${h(s.provider || "Novel AI")}"></label>
            <label><span>Model</span><input id="nx-nai-model" value="${h(s.model || "nai-diffusion-4-5-full")}"></label>
            <label class="wide"><span>Novel AI 요청 URL</span><input id="nx-nai-url" type="url" value="${h(s.request_url || "https://image.novelai.net/ai/generate-image")}"></label>
            <label class="wide"><span>API key <span class="key-status">${s.api_key_configured ? "설정됨" : "없음"}</span></span><input id="nx-nai-key" type="password" autocomplete="new-password" placeholder="비워 두면 기존 키 유지"></label>
            <label><span>Width</span><input id="nx-nai-w" type="number" step="64" value="${h(s.width ?? 832)}"></label>
            <label><span>Height</span><input id="nx-nai-h" type="number" step="64" value="${h(s.height ?? 1216)}"></label>
            <label><span>Sampler</span>
              <select id="nx-nai-sampler">
                ${[
        ["k_euler_ancestral", "Euler Ancestral"],
        ["k_euler", "Euler"],
        ["k_dpmpp_2m", "DPM++ 2M"],
        ["k_dpmpp_2s_ancestral", "DPM++ 2S Ancestral"],
        ["k_dpmpp_sde", "DPM++ SDE"],
        ["ddim_v3", "DDIM"]
      ].map(([x, I]) => `<option value="${x}" ${(s.sampler || "k_euler_ancestral") === x ? "selected" : ""}>${I}</option>`).join("")}
              </select>
            </label>
            <label><span>Noise Schedule</span>
              <select id="nx-nai-sched">
                ${[
        "karras",
        "native",
        "exponential",
        "polyexponential"
      ].map((x) => `<option value="${x}" ${(s.scheduler || "karras") === x ? "selected" : ""}>${x}</option>`).join("")}
              </select>
            </label>
            <label><span>Steps</span><input id="nx-nai-steps" type="number" min="1" max="150" value="${h(s.steps ?? 28)}"></label>
            <label><span>CFG scale</span><input id="nx-nai-cfg" type="number" step="0.1" value="${h(s.cfg_scale ?? 7)}"></label>
            <label><span>CFG rescale</span><input id="nx-nai-rescale" type="number" step="0.01" value="${h(s.cfg_rescale ?? 0.36)}"></label>
            <label><span>Reference Strength</span><input id="nx-nai-ref-strength" type="number" min="0" max="1" step="0.05" value="${h(s.image_reference_strength ?? 0.6)}"></label>
            <label><span>Reference Fidelity</span><input id="nx-nai-ref-fidelity" type="number" min="0" max="1" step="0.05" value="${h(s.image_reference_fidelity ?? 1)}"></label>
            <label class="wide"><span>Image Reference Type</span>
              <select id="nx-nai-ref-type">
                ${[
        ["character&style", "Character & Style"],
        ["character", "Character"],
        ["style", "Style"]
      ].map(([x, I]) => `<option value="${x}" ${(s.image_reference_type || "character&style") === x ? "selected" : ""}>${I}</option>`).join("")}
              </select>
            </label>
            <label class="wide"><span>Image Reference (PC 파일)</span>
              <div class="row" style="margin:0">
                <button type="button" id="nx-nai-ref-pick" class="secondary">이미지 불러오기</button>
                <button type="button" id="nx-nai-ref-clear" class="secondary">제거</button>
                <span id="nx-nai-ref-status" class="muted">${s.image_reference_configured ? "설정됨" : "없음"}</span>
              </div>
              <input id="nx-nai-ref-file" type="file" accept="image/*" style="display:none">
              <input id="nx-nai-ref" type="hidden" value="${h(s.image_reference_configured ? "file" : s.image_reference || "none")}">
            </label>
            <div class="ref-preview wide" id="nx-nai-ref-preview">${s.image_reference_configured ? `<img src="${h((globalThis.__INLAY_NATIVE__?.refPreviewUrl?.() || ""))}" alt="reference">` : '<span class="muted">선택된 참조 이미지 없음</span>'}</div>
            <div class="model-form-pair">
              <label><span>Vibe Strength</span><input id="nx-nai-vibe-strength" type="number" min="0" max="1" step="0.05" value="${h(s.vibe_transfer_strength ?? 0.6)}"></label>
              <label><span>Vibe Information Extracted</span><input id="nx-nai-vibe-ie" type="number" min="0" max="1" step="0.05" value="${h(s.vibe_transfer_information_extracted ?? 1)}"></label>
            </div>
            <label class="wide"><span>Vibe Transfer (PC 파일)</span>
              <div class="row" style="margin:0">
                <button type="button" id="nx-nai-vibe-pick" class="secondary">이미지 불러오기</button>
                <button type="button" id="nx-nai-vibe-clear" class="secondary">제거</button>
                <span id="nx-nai-vibe-status" class="muted">${s.vibe_transfer_configured ? "설정됨" : "없음"}</span>
              </div>
              <input id="nx-nai-vibe-file" type="file" accept="image/*" style="display:none">
              <input id="nx-nai-vibe" type="hidden" value="${h(s.vibe_transfer_configured ? "file" : s.vibe_transfer || "none")}">
            </label>
            <div class="ref-preview wide" id="nx-nai-vibe-preview">${s.vibe_transfer_configured ? `<img src="${h((globalThis.__INLAY_NATIVE__?.vibePreviewUrl?.() || ""))}" alt="vibe">` : '<span class="muted">선택된 vibe 이미지 없음</span>'}</div>
            <div class="muted wide" style="font-size:12px">Vibe 업로드 시 encode-vibe가 즉시 실행되며 2 Anlas가 소모됩니다. 결과는 캐시되어 재사용됩니다.</div>
            <label class="check wide"><input id="nx-nai-var" type="checkbox" ${s.variety_plus ? "checked" : ""}> Variety+</label>
            <label class="check wide"><input id="nx-nai-i2i" type="checkbox" ${s.enable_i2i ? "checked" : ""}> Enable I2I</label>
            <label class="check wide"><input id="nx-nai-quality" type="checkbox" ${s.apply_quality_tags !== !1 ? "checked" : ""}> Quality Tags 자동 적용</label>
            `}
          </div>
          <div class="muted model-hint">${imgBk === "comfy" ? "연결 테스트는 ComfyUI /system_stats와 워크플로 [[pos]] 검사를 합니다. 실제 생성은 채팅 job에서 수행됩니다." : "테스트는 토큰/잔액 확인 위주입니다. 실제 이미지 생성은 채팅 job에서 수행됩니다."}</div>
          <div class="model-actions"><button id="nx-test-nai">${imgBk === "comfy" ? "ComfyUI 연결 테스트" : "Novel AI 연결 테스트"}</button>${$t("nai")}</div>
          ${imgBk === "comfy" ? `
          <div class="nx-comfy-help">
              <strong>사용법</strong><br>
              1) ComfyUI 설정에서 개발자 옵션 → <strong>API 내보내기</strong>를 켭니다.<br>
              2) Workflow → <strong>Export (API)</strong>로 JSON을 받은 뒤, 위에 붙여넣거나 파일로 불러옵니다.<br>
              3) JSON 안에서 긍정 프롬프트를 넣는 칸에 <code>[[pos]]</code>, 부정에 <code>[[neg]]</code>, 캐릭터 태그를 넣고 싶은 칸에 <code>[[char1]]</code> / <code>[[char2]]</code> … 를 적어 둡니다.<br>
              4) 저장 후 생성하면 Inlay가 만든 프롬프트로 그 자리가 치환됩니다.<br><br>
              <strong>시드 (랜덤)</strong> — API Export의 숫자 seed는 요청마다 Inlay가 새 랜덤 시드로 덮어씁니다.<br>
              명시적으로 쓰려면 <code>"seed": "[[seed]]"</code>처럼 <strong>따옴표로 감싸서</strong> 넣으세요. (숫자만 남겨둬도 자동 랜덤)<br><br>
              <strong>조건부 마커</strong> — 캐릭터가 없을 때 헤더까지 통째로 지우려면 블록으로 감싸세요.<br>
              <code>[[#char3]]</code> …내용… <code>[[/char3]]</code><br>
              <code>[[char3]]</code> 값이 비어 있으면 그 블록 전체가 삭제되고, 있으면 안쪽만 남긴 뒤 <code>[[char3]]</code>가 치환됩니다.<br>
              예:<br>
              <code>[[#char1]]</code><br>
              ## Character 1<br>
              ### Outfit, Appearance Design &amp; Facial Expression<br>
              <code>[[char1]]</code><br>
              <code>[[/char1]]</code>
          </div>` : ""}
        </article>`;
    } else t.uiTab === "explorer" ? u = ma() : t.uiTab === "debug" && (u = `
        <div class="card">
          <strong>런타임 상태</strong>
          <pre id="nx-debug-status" style="margin-top:10px;white-space:pre-wrap;font:12px/1.5 Consolas,monospace;color:#c9d4e6;max-height:360px;overflow:auto;background:rgba(0,0,0,.25);padding:12px;border-radius:12px">${h(Ve())}</pre>
          <div class="row" style="margin-top:12px">
            <button id="nx-debug-refresh" class="secondary">새로고침</button>
            <button id="nx-debug-clear" class="secondary">로그 비우기</button>
            <button id="nx-debug-copy" class="secondary">로그 복사</button>
            <button id="nx-debug-ping" class="secondary">핑 로그</button>
          </div>
        </div>
        <div class="card" style="margin-top:14px">
          <strong>이벤트 로그 (최신 ${Math.min(120, t.debugLog.length)} / ${t.debugLog.length})</strong>
          <pre id="nx-debug-log" style="margin-top:10px;white-space:pre-wrap;font:11.5px/1.45 Consolas,monospace;color:#b8c4d8;max-height:420px;overflow:auto;background:rgba(0,0,0,.28);padding:12px;border-radius:12px">${h(Ye(120) || "(아직 로그 없음)")}</pre>
          <div class="notice info" style="margin-top:12px">채팅 화면 좌측 하단 디버그 패널에서도 같은 로그를 볼 수 있습니다. afterRequest → job → gallery → overlay 순서로 찍힙니다.</div>
        </div>`);
    const b = t.jobProgress, C = b ? `<div class="card"><strong>생성 진행</strong><div class="value" style="font-size:14px">${h(b.message || b.state || "-")}</div><div class="progress-rail"><div class="progress-fill" style="width:${Math.max(0, Math.min(100, Number(b.progress) || 0))}%"></div></div></div>` : `<div class="card"><strong>Job</strong><div class="value" style="font-size:14px">${h(t.activeJobId || "-")}</div></div>`, S = {
      dashboard: "대시보드",
      card: "카드 설정",
      characters: "캐릭터",
      prompts: "프롬프트",
      models: "모델 설정",
      explorer: "이미지 탐색",
      debug: "디버그"
    }, E = [
      "dashboard",
      "card",
      "characters",
      "prompts",
      "models",
      "explorer",
      "debug"
    ].map((d) => `<button type="button" class="tab ${t.uiTab === d ? "active" : ""}" data-nx-tab="${d}">${S[d]}</button>`).join(""), j = [p ? `<div class="notice ${h(p.type || "info")}">${h(p.text || "")}</div>` : "", o ? `<div class="notice error">${h(o)}</div>` : ""].join("");
    if (e === t.uiRenderGen) {
      if (!document.getElementById("nx-shell"))
        document.body.innerHTML = `
        <style>${ga}</style>
        <div class="wrap" id="nx-shell">
          <div class="chrome" id="nx-chrome">
            <div class="head">
              <div class="head-brand"><h1>Inlay Nexus</h1><div class="muted" id="nx-version-line">v${He}</div></div>
              <div class="head-help" id="nx-head-help" aria-live="polite">
                <div class="head-help-title" id="nx-head-help-title">${h(HEAD_HELP_DEFAULT.title)}</div>
                <div class="head-help-body" id="nx-head-help-body">${h(HEAD_HELP_DEFAULT.body)}</div>
              </div>
              <div class="head-actions">
                <span id="nx-save-flash" class="save-flash"></span>
                <button type="button" id="nx-save-all" class="secondary">전체 저장</button>
                <button type="button" id="nx-export-all" class="secondary">전체 설정 내보내기</button>
                <button type="button" id="nx-import-all" class="secondary">전체 설정 불러오기</button>
                <input id="nx-import-all-file" type="file" accept=".json,application/json,text/plain" style="display:none">
                <button type="button" id="nx-close" class="secondary">닫기</button>
              </div>
            </div>
            <nav class="tabs" id="nx-tabs">${E}</nav>
          </div>
          <div class="grid" id="nx-status-grid">
            <div class="card"><strong>백엔드</strong><div class="value" id="nx-health-value">${l}</div></div>
            <div class="card"><strong>훅</strong><div class="value" id="nx-hook-value" style="font-size:16px">${t.replacerReady ? "afterRequest 활성" : h(t.replacerError || "비활성")}</div></div>
            <div id="nx-job-card">${C}</div>
          </div>
          <div id="nx-notices">${j}</div>
          <div id="nx-main">${u}</div>
        </div>
        <div id="nx-explorer-tip" class="explorer-tip"></div>`, wa(), bindHeadHelp(document.getElementById("nx-shell"));
      else {
        const d = document.getElementById("nx-version-line");
        d && (d.textContent = `v${He}`);
        const U = document.getElementById("nx-health-value");
        U && (U.innerHTML = l);
        const f = document.getElementById("nx-hook-value");
        f && (f.textContent = t.replacerReady ? "afterRequest 활성" : t.replacerError || "비활성");
        const x = document.getElementById("nx-job-card");
        x && (x.innerHTML = C);
        const I = document.getElementById("nx-notices");
        I && (I.innerHTML = j), document.querySelectorAll("#nx-tabs [data-nx-tab]").forEach((g) => {
          g.classList.toggle("active", g.getAttribute("data-nx-tab") === t.uiTab);
        });
        const _sg = document.getElementById("nx-status-grid");
        _sg && (_sg.style.display = t.uiTab === "dashboard" ? "" : "none");
        const R = document.getElementById("nx-main");
        R && (R.innerHTML = u);
        const head = document.querySelector("#nx-chrome .head");
        if (head && !document.getElementById("nx-head-help")) {
          const brand = head.querySelector("h1")?.parentElement;
          brand && brand.classList.add("head-brand");
          const help = document.createElement("div");
          help.className = "head-help", help.id = "nx-head-help", help.setAttribute("aria-live", "polite"), help.innerHTML = `<div class="head-help-title" id="nx-head-help-title"></div><div class="head-help-body" id="nx-head-help-body"></div>`;
          const actions = head.querySelector(".head-actions");
          actions ? head.insertBefore(help, actions) : head.appendChild(help), setHeadHelp(null);
        }
        bindHeadHelp(document.getElementById("nx-shell"));
      }
      e === t.uiRenderGen && va();
    }
  } catch {
  } finally {
    t._uiRendering = !1;
  }
  }
  function wa() {
    document.getElementById("nx-close")?.addEventListener("click", async () => {
      try {
        await flushSettingsSave();
      } catch {
      }
      t.uiOpen = !1, t._debugTabTimer && (clearInterval(t._debugTabTimer), t._debugTabTimer = null), t._hostReaper && (clearInterval(t._hostReaper), t._hostReaper = null), t._settingsWatch && (clearInterval(t._settingsWatch), t._settingsWatch = null);
      try {
        await blockHostChrome(!1);
      } catch {
      }
      typeof k.hideContainer == "function" && await k.hideContainer(), invalidateOverlayLayoutCache();
      try {
        await it();
        await he();
        Ce();
      } catch {
      }
    }), document.getElementById("nx-save-all")?.addEventListener("click", async () => {
      await xa();
    }), document.getElementById("nx-export-all")?.addEventListener("click", async () => {
      try {
        await flushSettingsSave();
        const e = await K("/v1/settings/export", { method: "GET" }), n = new Blob([String(e?.json || "")], { type: "application/json" }), o = URL.createObjectURL(n), a = document.createElement("a");
        a.href = o, a.download = `inlay-nexus-settings-${new Date().toISOString().slice(0, 10)}.json`, document.body.appendChild(a), a.click(), a.remove(), setTimeout(() => URL.revokeObjectURL(o), 1e3), $e("설정 내보내기 완료");
      } catch (e) {
        $e(`내보내기 실패: ${z(e?.message || e, 60)}`, !1);
      }
    }), document.getElementById("nx-import-all")?.addEventListener("click", () => {
      document.getElementById("nx-import-all-file")?.click();
    }), document.getElementById("nx-import-all-file")?.addEventListener("input", async (e) => {
      const n = e.target?.files?.[0];
      if (!n) return;
      try {
        await flushSettingsSave(), await K("/v1/settings/import", {
          method: "POST",
          body: { json: await n.text() }
        }), await le(), t.uiMessage = {
          type: "success",
          text: "전체 설정을 불러왔습니다"
        }, $e("설정 불러오기 완료"), await P(), await it();
      } catch (o) {
        t.uiMessage = {
          type: "error",
          text: `설정 불러오기 실패: ${z(o?.message || o)}`
        }, $e("설정 불러오기 실패", !1), await P();
      }
    });
    const e = document.getElementById("nx-tabs");
    if (e && !e.dataset.nxBound) {
      e.dataset.nxBound = "1";
      const n = (o) => {
        const a = o.target?.closest?.("[data-nx-tab]");
        if (!a || !e.contains(a)) return;
        const r = a.getAttribute("data-nx-tab");
        if (!r || r === t.uiTab) return;
        o.preventDefault(), o.stopPropagation(), t.uiTab = r;
        try {
          window.scrollTo?.(0, 0);
        } catch {
        }
        try {
          document.getElementById("nx-char-edit-modal")?.remove?.();
        } catch {
        }
        t.charEditUi = null, e.querySelectorAll("[data-nx-tab]").forEach((i) => {
          i.classList.toggle("active", i.getAttribute("data-nx-tab") === r);
        }), P();
      };
      e.addEventListener("pointerdown", n), e.addEventListener("click", n);
    }
    const n = document.getElementById("nx-shell");
    if (n && !n.dataset.nxAutosaveBound) {
      n.dataset.nxAutosaveBound = "1";
      const o = (a) => {
        if (t._uiRendering || !t.uiOpen) return;
        const r = a.target;
        if (!r?.id || !/^nx-/.test(r.id) || r.type === "button" || r.type === "file" || /(?:save|run-now|open-viewer|close|export|import|test-|preset-file|preset-select|scope-|refresh|debug)/.test(r.id)) return;
        if (!document.getElementById("nx-power") || !document.getElementById("nx-shell")?.isConnected) return;
        const i = {}, s = Mt(), c = Ct(), l = ba();
        (s || c) && (i.card = {
          ...t.backendSettings?.card || {},
          ...s || {},
          ...c || {}
        }), l && (i.llm = l.llm, i.nai = l.nai), Object.keys(i).length && queueSettingsSave(i);
      };
      n.addEventListener("input", o), n.addEventListener("click", (a) => {
        const r = a.target;
        (r?.type === "checkbox" || r?.tagName === "SELECT") && o(a);
      });
    }
  }
  /** Per-chat session ids for the current Risu character (unified view roots). */
  function rootChatSessionIds(scope) {
    const e = scope || t.lastScope;
    if (!e?.characterId) return [];
    const n = (t.charCatalog || []).find((s) => Number(s.index) === Number(e.charIndex)) || (t.charCatalog || []).find((s) => w(s.chaId || "") === w(e.characterId || "")) || null;
    const out = [];
    for (const s of n?.chats || []) {
      const c = w(s.id || `chat_${s.index}`);
      out.push(`risu_${ye(`${e.characterId}|${c}`)}`);
    }
    return out;
  }
  /** @deprecated alias — use rootChatSessionIds */
  function cascadeChatSessionIds(scope) {
    return rootChatSessionIds(scope);
  }
  function withRootSessions(body, scope) {
    const e = scope || t.lastScope;
    const unified = !!(e?.unified || e?.chatIndex === "unified" || t.scopeOverride?.chatIndex === "unified");
    if (!unified) return body;
    const ids = rootChatSessionIds(e);
    if (ids.length) body.root_session_ids = ids;
    return body;
  }
  async function ensureUnifiedRoster(e) {
    if (!e?.unified || !e.characterId || !e.sessionId) return null;
    try {
      await ia();
    } catch {
    }
    const o = rootChatSessionIds(e);
    // Rebuild display cache from live chat roots only (do not seed from stale unified rows).
    const a = await K("/v1/characters/unify", {
      method: "POST",
      body: {
        target_session_id: e.sessionId,
        source_session_ids: o,
        include_target: !1
      }
    }, 2e4);
    return t.charactersSession = a?.characters || t.charactersSession, t.charactersGlobal = a?.global || t.charactersGlobal, t.appearance = a?.appearance || t.appearance, y("info", "scope.unified", `sources=${o.length} merged=${a?.merged ?? "?"}`), a;
  }
  /** Load characters for a session without swapping the live gallery. */
  async function loadRosterCharactersOnly(sessionId) {
    const n = w(sessionId || "", 200);
    if (!n) return;
    try {
      const charId = w(t.lastScope?.characterId || "", 200), a = await K(`/v1/characters?session_id=${encodeURIComponent(n)}${charId ? `&character_id=${encodeURIComponent(charId)}` : ""}`, { method: "GET" });
      t.charactersSession = a?.characters || [], t.charactersGlobal = a?.global || t.charactersGlobal || [], t.disabledGlobals = Array.isArray(a?.disabled_globals) ? a.disabled_globals : t.disabledGlobals || [], t.appearance = a?.appearance || t.appearance || {};
    } catch (err) {
      y("warn", "roster.load", err?.message || err);
    }
  }
  /**
   * When unified_chat_priority is ON, viewer chip/modals use the unified roster
   * (same tags generation uses). Gallery stays on the live chat session.
   */
  async function resolveViewerRosterSession() {
    const live = await Z({ useOverride: !1 }).catch(() => null);
    if (!live) return null;
    const preferUnified = !!(t.backendSettings?.card?.unified_chat_priority);
    if (!preferUnified || !live.characterId) {
      t._viewerRoster = { ...live, rosterSessionId: live.sessionId, rosterUnified: !1, unifiedScope: null };
      return t._viewerRoster;
    }
    const unifiedScope = {
      ...live,
      unified: !0,
      chatIndex: "unified",
      chatId: "__unified__",
      chatName: "통합 챗",
      sessionId: live.unifiedSessionId || `risu_${ye(`${live.characterId}|__unified__`)}`,
      liveChat: !1
    };
    try {
      await ensureUnifiedRoster(unifiedScope);
    } catch (err) {
      y("warn", "roster.unify", err?.message || err);
    }
    t._viewerRoster = { ...live, rosterSessionId: unifiedScope.sessionId, rosterUnified: !0, unifiedScope };
    return t._viewerRoster;
  }
  async function ensureViewerRosterLoaded() {
    const resolved = await resolveViewerRosterSession();
    if (!resolved?.rosterSessionId) return null;
    await loadRosterCharactersOnly(resolved.rosterSessionId);
    return resolved;
  }
  async function switchSettingsScope(e, n) {
    const o = e === "live" || e == null, unified = n === "unified", a = !unified && (n === "live" || n == null);
    o && a ? t.scopeOverride = null : t.scopeOverride = {
      charIndex: o ? "live" : Number(e),
      chatIndex: unified ? "unified" : a ? "live" : Number(n)
    }, t.selectedMessage = null, t.lastImagedMessage = null;
    try {
      await ia();
      const r = t.lastScope?.sessionId || "", i = await Z({ useOverride: !0 });
      i.unified && await ensureUnifiedRoster(i), await ce(i.sessionId, !0), t.gallerySessionId = i.sessionId || "";
    } catch (r) {
      t.uiMessage = {
        type: "error",
        text: z(r?.message || r)
      };
    }
    await P();
  }

  function defaultChatScopeForCharChange() {
    return t.backendSettings?.card?.unified_chat_priority ? "unified" : "live";
  }

  function bindScopeSelectHandlers() {
    const onChar = async () => {
      const a = N("nx-scope-char");
      if (a === "live") {
        await switchSettingsScope("live", defaultChatScopeForCharChange());
        return;
      }
      const r = Number(a);
      !Number.isFinite(r) || r < 0 || await switchSettingsScope(r, defaultChatScopeForCharChange());
    }, onChat = async () => {
      const a = N("nx-scope-char"), r = N("nx-scope-chat"), i = a === "live" ? "live" : Number(a);
      if (!(i !== "live" && (!Number.isFinite(i) || i < 0))) {
        if (r === "unified") {
          await switchSettingsScope(i, "unified");
          return;
        }
        if (r === "live") {
          await switchSettingsScope(i, "live");
          return;
        }
        const s = Number(r);
        await switchSettingsScope(i, Number.isFinite(s) ? s : 0);
      }
    };
    const charEl = document.getElementById("nx-scope-char"), chatEl = document.getElementById("nx-scope-chat");
    charEl && (charEl.addEventListener("change", onChar), charEl.addEventListener("input", onChar));
    chatEl && (chatEl.addEventListener("change", onChat), chatEl.addEventListener("input", onChat));
  }

  function va() {
    bindScopeSelectHandlers(), document.getElementById("nx-unified-priority")?.addEventListener("change", async () => {
      try {
        const a = Mt();
        t.backendSettings && (t.backendSettings.card = {
          ...t.backendSettings.card,
          ...a
        });
      } catch {
      }
      await P();
    }), document.getElementById("nx-save-dash")?.addEventListener("click", async () => {
      try {
        await flushSettingsSave(), await pe({ card: Mt() }), invalidateOverlayLayoutCache(), t.uiMessage = {
          type: "success",
          text: "대시보드 저장됨"
        }, $e("저장됨"), await it();
        try {
          await he();
        } catch {
        }
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: z(a.message || a)
        };
      }
      await P();
    }), document.getElementById("nx-reset-windows")?.addEventListener("click", async () => {
      try {
        await flushSettingsSave(), await resetAllWindowPositions(), t.uiMessage = {
          type: "success",
          text: "모든 창 위치를 기본값으로 되돌렸습니다 (사라졌을 때용)"
        }, $e("위치 초기화");
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: z(a?.message || a)
        };
      }
      await P();
    }), document.getElementById("nx-reset-settings")?.addEventListener("click", async () => {
      if (!globalThis.confirm?.("정말로 모든 설정을 기본값으로 초기화할까요?\n\n유지: API 키 · 창 위치 · 카드 프리셋(pos/neg)\n초기화: 그 외 카드/LLM/NAI 설정")) return;
      try {
        await flushSettingsSave();
        const a = await K("/v1/settings/reset", { method: "POST", body: {} });
        t.backendSettings = a?.settings || t.backendSettings;
        t.activePresetId = String(t.backendSettings?.card?.active_preset_id || "");
        t.settingsSavePending = null, t.uiMessage = {
          type: "success",
          text: "모든 설정을 기본값으로 되돌렸습니다 (프리셋·API 키 유지)"
        }, $e("설정 초기화");
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: z(a?.message || a)
        };
      }
      await P(), await it();
    }), document.getElementById("nx-inline-pct")?.addEventListener("input", () => {
      const a = Math.max(1, Ne(N("nx-inline-pct"), 100));
      t.backendSettings || (t.backendSettings = {}), t.backendSettings.card || (t.backendSettings.card = {}), t.backendSettings.card.inline_thumb_pct = a, invalidateOverlayLayoutCache();
    }), document.getElementById("nx-save-card")?.addEventListener("click", async () => {
      try {
        const a = Ct();
        await flushSettingsSave(), await pe({ card: a }), t.uiMessage = {
          type: "success",
          text: `카드 설정 저장됨 · 프리셋 ${(a.presets || []).length}개 · char≤${a.character_max}`
        }, $e("저장됨");
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: z(a.message || a)
        };
      }
      await P();
    });
    const e = async (a) => {
      if (!a) return;
      await applyActivePreset(a);
    };
    document.getElementById("nx-preset-select")?.addEventListener("change", async (a) => {
      await e(a.target?.value || "");
    }), (() => {
      const row = document.querySelector(".preset-chip-row");
      let dragId = "", moved = !1;
      document.querySelectorAll("[data-preset-select]").forEach((a) => {
        a.addEventListener("click", async (ev) => {
          ev.preventDefault(), ev.stopPropagation();
          if (moved) {
            moved = !1;
            return;
          }
          await e(a.getAttribute("data-preset-select") || "");
        });
        a.addEventListener("dragstart", (ev) => {
          dragId = a.getAttribute("data-preset-select") || "";
          moved = !1;
          a.classList.add("dragging");
          try {
            ev.dataTransfer?.setData("text/plain", dragId);
            ev.dataTransfer.effectAllowed = "move";
          } catch {
          }
        });
        a.addEventListener("dragend", () => {
          a.classList.remove("dragging");
          document.querySelectorAll(".preset-chip.drag-over").forEach((el) => el.classList.remove("drag-over"));
          dragId = "";
        });
        a.addEventListener("dragover", (ev) => {
          ev.preventDefault();
          a.classList.add("drag-over");
        });
        a.addEventListener("dragleave", () => a.classList.remove("drag-over"));
        a.addEventListener("drop", async (ev) => {
          ev.preventDefault(), ev.stopPropagation();
          a.classList.remove("drag-over");
          const from = dragId || ev.dataTransfer?.getData("text/plain") || "";
          const to = a.getAttribute("data-preset-select") || "";
          if (!from || !to || from === to) return;
          moved = !0;
          const card = kt(t.backendSettings?.card || {});
          const EX = globalThis.__INLAY_EXPLORER__;
          const ids = (card.presets || []).map((p) => p.id);
          const fromIdx = ids.findIndex((id) => presetIdEq(id, from));
          const toIdx = ids.findIndex((id) => presetIdEq(id, to));
          if (fromIdx < 0 || toIdx < 0) return;
          const nextIds = [...ids];
          const [picked] = nextIds.splice(fromIdx, 1);
          nextIds.splice(toIdx, 0, picked);
          card.presets = EX?.reorderByIds ? EX.reorderByIds(card.presets, nextIds) : nextIds.map((id) => card.presets.find((p) => presetIdEq(p.id, id))).filter(Boolean);
          if (row) {
            nextIds.forEach((id) => {
              const el = [...row.querySelectorAll("[data-preset-select]")].find((node) => presetIdEq(node.getAttribute("data-preset-select"), id));
              el && row.appendChild(el);
            });
          }
          try {
            await pe({ card });
            $e("프리셋 순서 저장");
            const sel = document.getElementById("nx-preset-select");
            if (sel) {
              const active = resolveActivePresetId(card);
              sel.innerHTML = (card.presets || []).map((g) => `<option value="${h(g.id)}" ${presetIdEq(g.id, active) ? "selected" : ""}>${h(g.name)}</option>`).join("") || '<option value="">(프리셋 없음)</option>';
            }
          } catch (err) {
            t.uiMessage = { type: "error", text: z(err?.message || err) }, await P();
          }
        });
      });
    })(), document.getElementById("nx-preset-new")?.addEventListener("click", async () => {
      const a = _e(), r = `preset_${Date.now()}`;
      a.presets.push({
        id: r,
        name: `새 프리셋 ${a.presets.length + 1}`,
        positive: "",
        negative: ""
      }), pinActivePreset(a, r), a.custom_pos = "", a.custom_neg = "", queueSettingsSave({ card: { ...a } }), await P();
    }), document.getElementById("nx-preset-dup")?.addEventListener("click", async () => {
      const a = _e(), r = a.presets.find((s) => presetIdEq(s.id, a.active_preset_id));
      if (!r) return;
      const i = `preset_${Date.now()}`;
      a.presets.push({
        id: i,
        name: `${r.name} 복사`,
        positive: r.positive || "",
        negative: r.negative || ""
      }), pinActivePreset(a, i), a.custom_pos = r.positive || "", a.custom_neg = r.negative || "", queueSettingsSave({ card: { ...a } }), await P();
    }), document.getElementById("nx-preset-del")?.addEventListener("click", async () => {
      const a = _e();
      if (!a.presets.length) return;
      a.presets = a.presets.filter((i) => !presetIdEq(i.id, a.active_preset_id));
      const nextId = a.presets[0]?.id || "";
      pinActivePreset(a, nextId);
      const r = a.presets[0];
      a.custom_pos = r?.positive || "", a.custom_neg = r?.negative || "", queueSettingsSave({ card: { ...a } }), await P();
    }), document.getElementById("nx-preset-export")?.addEventListener("click", async () => {
      try {
        const a = exportPresetsJson();
        t.uiMessage = {
          type: "success",
          text: `프리셋 JSON 내보내기 · ${a}개`
        }, $e("프리셋 내보내기 완료");
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: `내보내기 실패: ${z(a?.message || a)}`
        };
      }
      await P();
    }), document.getElementById("nx-preset-file")?.addEventListener("click", () => {
      document.getElementById("nx-preset-file-input")?.click();
    }), document.getElementById("nx-preset-file-input")?.addEventListener("change", async (a) => {
      const r = a.target?.files?.[0];
      if (r) {
        try {
          const i = St(await r.text());
          t.uiMessage = {
            type: "success",
            text: `${r.name}에서 프리셋 ${i}개 가져옴 · 저장을 누르세요`
          };
        } catch (i) {
          t.uiMessage = {
            type: "error",
            text: z(i.message || i)
          };
        }
        a.target.value = "", await P();
      }
    });
    const n = async (a, r = "붙여넣기") => {
      const i = St(a);
      t.uiMessage = {
        type: "success",
        text: `${r}에서 프리셋 ${i}개 가져옴 · 저장을 누르세요`
      };
      const s = document.getElementById("nx-preset-import-text");
      s && (s.value = ""), await P();
    };
    document.getElementById("nx-preset-import")?.addEventListener("click", async () => {
      try {
        await n(N("nx-preset-import-text"), "붙여넣기");
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: z(a.message || a)
        }, await P();
      }
    }), document.getElementById("nx-preset-import-text")?.addEventListener("paste", (a) => {
      setTimeout(async () => {
        const r = N("nx-preset-import-text");
        if (!(!r || r.length < 40) && !(!/\[Positive\]/i.test(r) && !/"character_book"|"presets"/i.test(r)))
          try {
            await n(r, "자동 감지");
          } catch (i) {
            t.uiMessage = {
              type: "error",
              text: z(i.message || i)
            }, await P();
          }
      }, 0);
    }), document.getElementById("nx-llm-source")?.addEventListener("change", async () => {
      try {
        const draft = Oe();
        t.backendSettings = t.backendSettings || {};
        t.backendSettings.llm = {
          ...(t.backendSettings.llm || {}),
          ...draft.llm,
          api_key: undefined,
          service_account_json: undefined,
          api_key_configured: t.backendSettings.llm?.api_key_configured,
          service_account_configured: t.backendSettings.llm?.service_account_configured
        };
      } catch {
      }
      await P();
    }), document.getElementById("nx-llm-provider")?.addEventListener("change", async (ev) => {
      const LH = globalThis.__INLAY_LLM__ || {}, provider = String(ev?.target?.value || "custom"), endpointEl = document.getElementById("nx-llm-endpoint"), modelEl = document.getElementById("nx-llm-model"), regionEl = document.getElementById("nx-llm-vertex-region"), nextEndpoint = LH.defaultEndpointForProvider?.(provider, { region: regionEl?.value || "us-central1" }) || "", known = LH.shouldAutoReplaceEndpoint?.(endpointEl?.value);
      if (endpointEl && (known || !String(endpointEl.value || "").trim())) endpointEl.value = provider === "vertex" ? "" : nextEndpoint;
      if (modelEl && (!modelEl.value || ["openai/gpt-oss-20b:nitro", "gpt-4o-mini", "gemini-2.5-flash"].includes(modelEl.value))) {
        const ph = LH.llmModelPlaceholder?.(provider);
        if (ph) modelEl.placeholder = ph;
      }
      // Re-render models tab so Vertex/Anthropic/Reasoning fields toggle.
      try {
        const draft = Oe();
        t.backendSettings = t.backendSettings || {};
        t.backendSettings.llm = {
          ...(t.backendSettings.llm || {}),
          ...draft.llm,
          api_key: undefined,
          service_account_json: undefined,
          api_key_configured: t.backendSettings.llm?.api_key_configured,
          service_account_configured: t.backendSettings.llm?.service_account_configured
        };
      } catch {
      }
      await P();
    }), document.getElementById("nx-llm-vertex-region")?.addEventListener("change", () => {
      const LH = globalThis.__INLAY_LLM__ || {}, provider = N("nx-llm-provider"), endpointEl = document.getElementById("nx-llm-endpoint"), region = N("nx-llm-vertex-region") || "us-central1";
      if (provider === "vertex" && endpointEl && LH.shouldAutoReplaceEndpoint?.(endpointEl.value)) {
        endpointEl.value = LH.defaultEndpointForProvider?.("vertex", { region }) || "";
      }
    }), document.getElementById("nx-save-models")?.addEventListener("click", async () => {
      try {
        const { llm: a, nai: r } = Oe(), llmSource = a.source === "main" || a.source === "aux" ? a.source : "custom";
        a.source = llmSource;
        const LH = globalThis.__INLAY_LLM__ || {}, provider = LH.normalizeLlmProvider?.(a.provider) || a.provider;
        if (llmSource === "custom") {
          if (!w(a.model)) {
            t.uiMessage = {
              type: "error",
              text: "태깅 LLM Model이 비어 있습니다."
            }, await P();
            return;
          }
          const hasKey = !!(a.api_key || t.backendSettings?.llm?.api_key_configured);
          const hasSa = !!(a.service_account_json || t.backendSettings?.llm?.service_account_configured) && !a.clearServiceAccount;
          if (provider === "vertex" ? !hasKey && !hasSa : !hasKey) {
            t.uiMessage = {
              type: "error",
              text: provider === "vertex" ? "Vertex AI Service Account JSON(또는 access token)을 입력하세요." : "태깅 LLM API key를 입력하세요. (NovelAI 키와 별개)"
            }, await P();
            return;
          }
        }
        await flushSettingsSave(), await pe({
          llm: a,
          nai: r
        }), t.uiMessage = {
          type: "success",
          text: llmSource === "main" ? "모델 설정 저장됨 · Risu 메인 모델" : llmSource === "aux" ? "모델 설정 저장됨 · Risu 보조 모델" : "모델 설정 저장됨"
        };
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: z(a.message || a)
        };
      }
      await P();
    }), document.getElementById("nx-test-llm")?.addEventListener("click", async () => {
      const a = document.getElementById("nx-test-llm"), r = document.getElementById("nx-test-result-llm");
      a && (a.disabled = !0), r && (r.className = "test-result pending", r.textContent = "저장 후 테스트 중…");
      try {
        const { llm: i, nai: s } = Oe(), llmSource = i.source === "main" || i.source === "aux" ? i.source : "custom";
        i.source = llmSource;
        const LH = globalThis.__INLAY_LLM__ || {}, provider = LH.normalizeLlmProvider?.(i.provider) || i.provider;
        if (llmSource === "custom") {
          if (!w(i.model)) throw new Error("태깅 LLM Model이 비어 있습니다.");
          const hasKey = !!(i.api_key || t.backendSettings?.llm?.api_key_configured);
          const hasSa = !!(i.service_account_json || t.backendSettings?.llm?.service_account_configured) && !i.clearServiceAccount;
          if (provider === "vertex" ? !hasKey && !hasSa : !hasKey) {
            throw new Error(provider === "vertex" ? "Vertex AI Service Account JSON(또는 access token)이 없습니다." : "태깅 LLM API key가 없습니다. NovelAI 키가 아니라 태깅용 LLM 키를 넣으세요.");
          }
        }
        await flushSettingsSave(), await pe({
          llm: i,
          nai: s
        });
        const c = await K("/v1/models/test", {
          method: "POST",
          body: { llm: i }
        });
        je("llm", !!c?.ok, c?.message || (c?.ok ? "연결 성공" : "연결 실패")), t.uiMessage = {
          type: c?.ok ? "success" : "error",
          text: c?.ok ? "태깅 LLM 테스트 성공" : `태깅 LLM 테스트 실패 · ${z(c?.message || "")}`
        };
      } catch (i) {
        je("llm", !1, i.message || i), t.uiMessage = {
          type: "error",
          text: `태깅 LLM 테스트 실패 · ${z(i.message || i)}`
        };
      } finally {
        a && (a.disabled = !1);
      }
      await P();
    }), document.getElementById("nx-img-backend-bar")?.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest?.("button[data-backend]");
      if (!btn) return;
      const next = btn.getAttribute("data-backend") === "comfy" ? "comfy" : "nai";
      const cur = ba();
      if (cur) {
        t.backendSettings = t.backendSettings || {};
        if (cur.llm) {
          delete cur.llm.api_key;
          delete cur.llm.service_account_json;
          t.backendSettings.llm = {
            ...(t.backendSettings.llm || {}),
            ...cur.llm,
            api_key_configured: t.backendSettings.llm?.api_key_configured,
            service_account_configured: t.backendSettings.llm?.service_account_configured
          };
        }
        if (cur.nai) {
          delete cur.nai.api_key;
          t.backendSettings.nai = {
            ...(t.backendSettings.nai || {}),
            ...cur.nai,
            backend: next,
            api_key_configured: t.backendSettings.nai?.api_key_configured,
            image_reference_configured: t.backendSettings.nai?.image_reference_configured,
            vibe_transfer_configured: t.backendSettings.nai?.vibe_transfer_configured,
            comfy_configured: t.backendSettings.nai?.comfy_configured
          };
        } else {
          t.backendSettings.nai = { ...(t.backendSettings.nai || {}), backend: next };
        }
      } else {
        t.backendSettings = t.backendSettings || {};
        t.backendSettings.nai = { ...(t.backendSettings.nai || {}), backend: next };
      }
      const hidden = document.getElementById("nx-img-backend");
      if (hidden) hidden.value = next;
      await P();
    }), document.getElementById("nx-comfy-wf-pick")?.addEventListener("click", () => {
      document.getElementById("nx-comfy-wf-file")?.click();
    }), document.getElementById("nx-comfy-wf-file")?.addEventListener("change", async (ev) => {
      const file = ev.target?.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        JSON.parse(text);
        const ta = document.getElementById("nx-comfy-workflow");
        if (ta) ta.value = text;
        t.backendSettings = t.backendSettings || {};
        t.backendSettings.nai = {
          ...(t.backendSettings.nai || {}),
          backend: "comfy",
          comfy_workflow_json: text,
          comfy_configured: true
        };
        t.uiMessage = { type: "success", text: `워크플로 불러옴 · ${file.name}` };
      } catch (err) {
        t.uiMessage = { type: "error", text: `워크플로 JSON 오류 · ${z(err.message || err)}` };
      }
      ev.target.value = "";
      await P();
    }), document.getElementById("nx-test-nai")?.addEventListener("click", async () => {
      const a = document.getElementById("nx-test-nai"), r = document.getElementById("nx-test-result-nai");
      a && (a.disabled = !0), r && (r.className = "test-result pending", r.textContent = "저장 후 테스트 중…");
      try {
        const { llm: i, nai: s } = Oe();
        const backend = s.backend || t.backendSettings?.nai?.backend || "nai";
        if (backend === "comfy") {
          if (!w(s.comfy_workflow_json) && !w(t.backendSettings?.nai?.comfy_workflow_json)) throw new Error("ComfyUI 워크플로 JSON이 없습니다.");
        } else if (!s.api_key && !t.backendSettings?.nai?.api_key_configured) {
          throw new Error("Novel AI API key가 없습니다.");
        }
        await flushSettingsSave(), await pe({
          llm: i,
          nai: s
        });
        const c = await K("/v1/nai/test", {
          method: "POST",
          body: {}
        });
        const label = backend === "comfy" ? "ComfyUI" : "Novel AI";
        je("nai", !!c?.ok, c?.message || (c?.ok ? "연결 성공" : "연결 실패")), t.uiMessage = {
          type: c?.ok ? "success" : "error",
          text: c?.ok ? `${label} 테스트 성공` : `${label} 테스트 실패 · ${z(c?.message || "")}`
        };
      } catch (i) {
        je("nai", !1, i.message || i), t.uiMessage = {
          type: "error",
          text: `이미지 공급자 테스트 실패 · ${z(i.message || i)}`
        };
      } finally {
        a && (a.disabled = !1);
      }
      await P();
    }), document.getElementById("nx-debug-refresh")?.addEventListener("click", async () => {
      await P();
    }), document.getElementById("nx-debug-clear")?.addEventListener("click", async () => {
      t.debugLog = [], y("info", "debug.clear", "log cleared"), await P();
    }), document.getElementById("nx-debug-copy")?.addEventListener("click", async () => {
      const a = `${Ve()}

${Ye(250)}`;
      try {
        if (typeof navigator < "u" && navigator.clipboard?.writeText) await navigator.clipboard.writeText(a);
        else {
          const r = document.createElement("textarea");
          r.value = a, document.body.appendChild(r), r.select(), document.execCommand("copy"), r.remove();
        }
        t.uiMessage = {
          type: "success",
          text: "디버그 로그 복사됨"
        };
      } catch (r) {
        t.uiMessage = {
          type: "error",
          text: z(r.message || r)
        };
      }
      await P();
    }), document.getElementById("nx-debug-ping")?.addEventListener("click", async () => {
      y("info", "debug.ping", `uiOpen=${t.uiOpen} gallery=${(t.gallery || []).length}`);
      try {
        const a = await bt();
        y("info", "debug.health", a.ok ? `ok v${a.health?.version || "?"}` : a.error || "fail");
      } catch (a) {
        y("error", "debug.health", a?.message || a);
      }
      await P();
    }), document.getElementById("nx-run-now")?.addEventListener("click", async () => {
      try {
        const a = await Z(), r = await D("getChatFromIndex", () => k.getChatFromIndex(a.charIndex, a.chatIndex), null);
        a.chat = r;
        const i = Xe(r, 0, !1).slice(-1)[0];
        if (!i?.content) throw new Error("최근 캐릭터 메시지가 없습니다.");
        await Be(a, i.content, !0), t.uiMessage = {
          type: "success",
          text: "생성 job 시작"
        };
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: z(a.message || a)
        };
      }
      await P();
    }), document.getElementById("nx-open-viewer")?.addEventListener("click", async () => {
      await Vt();
    }), document.getElementById("nx-refresh-chars")?.addEventListener("click", async () => {
      const a = await Z();
      a.unified && await ensureUnifiedRoster(a), await ce(a.sessionId), await P();
    }), document.getElementById("nx-unify-rebuild")?.addEventListener("click", async () => {
      try {
        const a = await Z();
        if (!a.unified) return;
        await ensureUnifiedRoster(a), await ce(a.sessionId), t.uiMessage = {
          type: "success",
          text: "통합 챗 캐릭터를 다시 모았습니다"
        }, await P();
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: z(a?.message || a)
        }, await P();
      }
    }), document.getElementById("nx-char-add-session")?.addEventListener("click", async () => {
      const mergeCharLists = (fromDom, fromMem) => {
        const dom = Array.isArray(fromDom) ? fromDom : [];
        const mem = Array.isArray(fromMem) ? fromMem : [];
        const ids = new Set(dom.map((c) => String(c?.id || "")));
        const extras = mem.filter((c) => {
          const id = String(c?.id || "");
          return id && !ids.has(id) && (id.startsWith("new_") || id.startsWith("gnew_") || id.startsWith("tmp_"));
        });
        return [...dom, ...extras];
      };
      t.charactersSession = mergeCharLists(oe("session"), t.charactersSession);
      t.charactersGlobal = mergeCharLists(oe("global"), t.charactersGlobal);
      t.charactersSession = [...t.charactersSession, {
        id: `new_${Date.now()}`,
        name: "New Character",
        original: "",
        aliases: [],
        appearance: "",
        attire: "",
        accessories: ""
      }], t._charsDirty = !0, await P();
    }), document.getElementById("nx-char-add-global")?.addEventListener("click", async () => {
      const mergeCharLists = (fromDom, fromMem) => {
        const dom = Array.isArray(fromDom) ? fromDom : [];
        const mem = Array.isArray(fromMem) ? fromMem : [];
        const ids = new Set(dom.map((c) => String(c?.id || "")));
        const extras = mem.filter((c) => {
          const id = String(c?.id || "");
          return id && !ids.has(id) && (id.startsWith("new_") || id.startsWith("gnew_") || id.startsWith("tmp_"));
        });
        return [...dom, ...extras];
      };
      t.charactersSession = mergeCharLists(oe("session"), t.charactersSession);
      t.charactersGlobal = mergeCharLists(oe("global"), t.charactersGlobal);
      t.charactersGlobal = [...t.charactersGlobal, {
        id: `gnew_${Date.now()}`,
        name: "Global Character",
        original: "",
        aliases: [],
        appearance: "",
        attire: "",
        accessories: ""
      }], t._charsDirty = !0, await P();
    }), document.getElementById("nx-save-chars")?.addEventListener("click", async () => {
      try {
        const a = await Z(), r = oe("session"), i = await K("/v1/characters", {
          method: "POST",
          body: withRootSessions({
            session_id: a.sessionId,
            character_id: w(a.characterId || "", 200),
            characters: r
          }, a)
        });
        t.charactersSession = i?.characters || r, t.appearance = i?.appearance || {}, t._charsDirty = !1, t.uiMessage = {
          type: "success",
          text: a.unified ? "채팅 캐릭터 저장됨 · 원본 채팅에 반영" : "채팅 캐릭터 저장됨"
        };
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: z(a.message || a)
        };
      }
      await P();
    }), document.getElementById("nx-save-global-chars")?.addEventListener("click", async () => {
      try {
        const a = await Z().catch(() => null), r = oe("global"), i = await K("/v1/characters", {
          method: "POST",
          body: {
            session_id: a?.sessionId || "",
            global: r
          }
        });
        t.charactersGlobal = i?.global || r, i?.characters && (t.charactersSession = i.characters), t._charsDirty = !1, t.uiMessage = {
          type: "success",
          text: "글로벌 캐릭터 저장됨"
        };
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: z(a.message || a)
        };
      }
      await P();
    }), document.getElementById("nx-export-session-chars")?.addEventListener("click", async () => {
      try {
        const n = await exportCharactersScope("session");
        t.uiMessage = {
          type: "success",
          text: `채팅 캐릭터 JSON 내보내기 · ${n}명`
        };
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: `내보내기 실패: ${z(a?.message || a)}`
        };
      }
      await P();
    }), document.getElementById("nx-export-global-chars")?.addEventListener("click", async () => {
      try {
        const n = await exportCharactersScope("global");
        t.uiMessage = {
          type: "success",
          text: `글로벌 캐릭터 JSON 내보내기 · ${n}명`
        };
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: `내보내기 실패: ${z(a?.message || a)}`
        };
      }
      await P();
    }), document.getElementById("nx-import-session-chars")?.addEventListener("click", () => {
      document.getElementById("nx-import-session-chars-file")?.click();
    }), document.getElementById("nx-import-global-chars")?.addEventListener("click", () => {
      document.getElementById("nx-import-global-chars-file")?.click();
    }), document.getElementById("nx-import-session-chars-file")?.addEventListener("input", async (e) => {
      const n = e.target?.files?.[0];
      if (e.target) e.target.value = "";
      if (!n) return;
      try {
        const r = await importCharactersFromFile(n, "session");
        t.uiMessage = {
          type: "success",
          text: `채팅 캐릭터 불러옴 · ${r.sessionCount}명${r.globalCount ? ` · 글로벌 ${r.globalCount}명` : ""}`
        };
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: `불러오기 실패: ${z(a?.message || a)}`
        };
      }
      await P();
    }), document.getElementById("nx-import-global-chars-file")?.addEventListener("input", async (e) => {
      const n = e.target?.files?.[0];
      if (e.target) e.target.value = "";
      if (!n) return;
      try {
        const r = await importCharactersFromFile(n, "global");
        t.uiMessage = {
          type: "success",
          text: `글로벌 캐릭터 불러옴 · ${r.globalCount}명${r.sessionCount ? ` · 채팅 ${r.sessionCount}명` : ""}`
        };
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: `불러오기 실패: ${z(a?.message || a)}`
        };
      }
      await P();
    }), document.querySelectorAll("[data-char-delete]").forEach((a) => {
      const r = (i) => {
        i.preventDefault(), i.stopPropagation();
      };
      a.addEventListener("pointerdown", r), a.addEventListener("mousedown", r), a.addEventListener("click", async (i) => {
        r(i);
        const s = a.closest("[data-char-scope]");
        if (!s) return;
        const c = s.getAttribute("data-char-scope"), l = s.getAttribute("data-char-id") || "", nameHint = String(s.querySelector("[data-char-name]")?.value || "").trim();
        const matchGone = (p) => {
          const id = String(p?.id || p?.name || "");
          const nm = String(p?.name || "").trim();
          return id === l || (nameHint && nm === nameHint);
        };
        t.charactersSession = oe("session"), t.charactersGlobal = oe("global");
        const gone = c === "session"
          ? (t.charactersSession || []).find((p) => matchGone(p))
          : (t.charactersGlobal || []).find((p) => matchGone(p));
        c === "session" ? t.charactersSession = (t.charactersSession || []).filter((p) => !matchGone(p)) : t.charactersGlobal = (t.charactersGlobal || []).filter((p) => !matchGone(p));
        t._charsDirty = !0, s.remove();
        // Persist immediately so tag regen cannot resurrect from stale DB leftovers.
        // Unified view: delete matching identity from each root chat.
        try {
          const scope = await Z().catch(() => null);
          const body = withRootSessions({
            session_id: scope?.sessionId || "",
            character_id: scope?.characterId || "",
            unified_session_id: scope?.unifiedSessionId || ""
          }, scope);
          if (c === "session") {
            body.characters = t.charactersSession || [];
            if (gone && Array.isArray(body.root_session_ids) && body.root_session_ids.length) {
              body.root_delete = [{
                id: gone.id || l || "",
                name: gone.name || nameHint || "",
                aliases: Array.isArray(gone.aliases) ? gone.aliases : [],
                surname: gone.surname || "",
                given_name: gone.given_name || "",
                surname_variants: gone.surname_variants || [],
                given_name_variants: gone.given_name_variants || []
              }];
            }
          } else body.global = t.charactersGlobal || [];
          const res = await K("/v1/characters", {
            method: "POST",
            body
          }, 15e3);
          if (Array.isArray(res?.characters)) t.charactersSession = res.characters;
          if (Array.isArray(res?.global)) t.charactersGlobal = res.global;
          t._charsDirty = !1;
          t.uiMessage = {
            type: "success",
            text: scope?.unified && c === "session"
              ? `${nameHint || "캐릭터"} 삭제·저장됨 · 원본 채팅에서도 제거`
              : `${nameHint || "캐릭터"} 삭제·저장됨`
          };
        } catch (err) {
          t.uiMessage = {
            type: "error",
            text: `삭제 저장 실패: ${z(err?.message || err)}`
          };
        }
      });
    }), document.querySelectorAll("[data-char-scope] input, [data-char-scope] textarea").forEach((a) => {
      a.addEventListener("input", () => {
        t._charsDirty = !0;
        try {
          t.charactersSession = oe("session"), t.charactersGlobal = oe("global");
        } catch {
        }
      });
    }), document.querySelectorAll("[data-global-toggle]").forEach((a) => {
      a.addEventListener("click", (r) => r.stopPropagation()), a.addEventListener("change", async (r) => {
        r.preventDefault(), r.stopPropagation();
        const i = a.getAttribute("data-global-toggle") || "", s = !!a.checked, c = (t.charactersGlobal || []).find((p) => String(p.id || p.name || "") === i), l = new Set((t.disabledGlobals || []).map(String));
        if (c) {
          for (const p of [globalCharKey(c), w(c.name || "", 200), w(c.name || "", 200).toLowerCase()]) p && (s ? l.delete(p) : l.add(p));
        } else i && (s ? l.delete(i) : l.add(i));
        t.disabledGlobals = [...l];
        try {
          await saveGlobalToggles(), t.uiMessage = {
            type: "success",
            text: `${w(c?.name || i, 80)} · 현재 캐릭터 ${s ? "ON" : "OFF"}`
          }, await P();
        } catch (p) {
          t.uiMessage = {
            type: "error",
            text: z(p?.message || p)
          }, await P();
        }
      });
    }), document.querySelectorAll("[data-char-to-global]").forEach((a) => {
      const r = (i) => {
        i.preventDefault(), i.stopPropagation();
      };
      a.addEventListener("pointerdown", r), a.addEventListener("mousedown", r), a.addEventListener("click", async (i) => {
        r(i);
        const s = a.closest("[data-char-scope]");
        if (s)
          try {
            t.charactersSession = oe("session"), t.charactersGlobal = oe("global");
            const c = s.getAttribute("data-char-id") || "", l = (t.charactersSession || []).find((j) => String(j.id || j.name || "") === c) || {
              id: c || `g_${Date.now()}`,
              name: s.querySelector("[data-char-name]")?.value || "",
              original: s.querySelector("[data-char-original]")?.value || "",
              aliases: String(s.querySelector("[data-char-aliases]")?.value || "").split(/[,/\n]/).map((j) => j.trim()).filter(Boolean),
              appearance: s.querySelector("[data-char-appearance]")?.value || "",
              attire: s.querySelector("[data-char-attire]")?.value || "",
              accessories: s.querySelector("[data-char-accessories]")?.value || ""
            };
            if (!String(l.name || "").trim()) {
              t.uiMessage = {
                type: "error",
                text: "이름이 비어 있어 글로벌로 보낼 수 없습니다"
              }, await P();
              return;
            }
            const p = await Z().catch(() => null), m = l.id && !String(l.id).startsWith("tmp_") ? l.id : `g_${Date.now()}`, u = {
              ...l,
              id: m
            }, b = String(l.name || "").trim().toLowerCase(), C = (t.charactersSession || []).filter((j) => String(j.id || j.name || "") !== c), S = [...(t.charactersGlobal || []).filter((j) => {
              const d = String(j.id || j.name || "");
              return d !== c && d !== m && String(j.name || "").trim().toLowerCase() !== b;
            }), u];
            t.charactersSession = C, t.charactersGlobal = S, t._charsDirty = !0, t.uiMessage = {
              type: "success",
              text: `글로벌로 이동 · ${l.name}`
            }, await P();
            const E = await K("/v1/characters", {
              method: "POST",
              body: withRootSessions({
                session_id: p?.sessionId || "",
                character_id: w(p?.characterId || "", 200),
                characters: C,
                root_delete: [{
                  id: l.id || c || "",
                  name: l.name || "",
                  aliases: Array.isArray(l.aliases) ? l.aliases : [],
                  surname: l.surname || "",
                  given_name: l.given_name || "",
                  surname_variants: l.surname_variants || [],
                  given_name_variants: l.given_name_variants || []
                }],
                scope: "__global__",
                character: u
              }, p)
            });
            E?.global && (t.charactersGlobal = E.global), E?.characters && (t.charactersSession = E.characters), t._charsDirty = !1, await P();
          } catch (c) {
            t.uiMessage = {
              type: "error",
              text: z(c?.message || c)
            }, await P();
          }
      });
    }), document.querySelectorAll("[data-save-prompt]").forEach((a) => {
      a.addEventListener("click", async () => {
        const r = a.getAttribute("data-save-prompt"), i = document.getElementById(`nx-prompt-${r}`)?.value || "";
        t.promptDrafts[r] = i;
        try {
          await K(`/v1/prompts/${encodeURIComponent(r)}`, {
            method: "PUT",
            body: { text: i }
          }), t.uiMessage = {
            type: "success",
            text: `${r} 저장됨`
          };
        } catch (s) {
          t.uiMessage = {
            type: "error",
            text: z(s.message || s)
          };
        }
        await P();
      });
    }), document.querySelectorAll("[data-reset-prompt]").forEach((a) => {
      a.addEventListener("click", async () => {
        const r = a.getAttribute("data-reset-prompt");
        try {
          await K(`/v1/prompts/${encodeURIComponent(r)}/reset`, {
            method: "POST",
            body: {}
          }), t.promptDrafts[r] = "", delete t.promptDrafts[r], t.uiMessage = {
            type: "success",
            text: `${r} 복원`
          }, await Je();
        } catch (i) {
          t.uiMessage = {
            type: "error",
            text: z(i.message || i)
          };
        }
        await P();
      });
    }), document.getElementById("nx-nai-ref-pick")?.addEventListener("click", () => {
      document.getElementById("nx-nai-ref-file")?.click();
    }), document.getElementById("nx-nai-ref-file")?.addEventListener("change", async (a) => {
      const r = a.target?.files?.[0];
      if (r) {
        try {
          await K("/v1/nai/reference", {
            method: "POST",
            body: { image_b64: await It(r) }
          }, 6e4);
          const i = document.getElementById("nx-nai-ref");
          i && (i.value = "file");
          const s = document.getElementById("nx-nai-ref-status");
          s && (s.textContent = "설정됨");
          const c = document.getElementById("nx-nai-ref-preview");
          c && (c.innerHTML = `<img src="${h((globalThis.__INLAY_NATIVE__?.refPreviewUrl?.() || ""))}" alt="reference">`), $e("참조 이미지 저장"), await le();
        } catch (i) {
          t.uiMessage = {
            type: "error",
            text: z(i?.message || i)
          }, await P();
        }
        a.target.value = "";
      }
    }), document.getElementById("nx-nai-ref-clear")?.addEventListener("click", async () => {
      try {
        await K("/v1/nai/reference/clear", {
          method: "POST",
          body: {}
        });
        const a = document.getElementById("nx-nai-ref");
        a && (a.value = "none"), $e("참조 제거"), await le(), await P();
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: z(a?.message || a)
        }, await P();
      }
    }), document.getElementById("nx-nai-vibe-pick")?.addEventListener("click", () => {
      document.getElementById("nx-nai-vibe-file")?.click();
    }), document.getElementById("nx-nai-vibe-file")?.addEventListener("change", async (a) => {
      const r = a.target?.files?.[0];
      if (r) {
        try {
          await K("/v1/nai/vibe", {
            method: "POST",
            body: {
              image_b64: await It(r),
              information_extracted: Number(N("nx-nai-vibe-ie") || 1),
              strength: Number(N("nx-nai-vibe-strength") || 0.6)
            }
          }, 12e4);
          const i = document.getElementById("nx-nai-vibe");
          i && (i.value = "file");
          const s = document.getElementById("nx-nai-vibe-status");
          s && (s.textContent = "설정됨");
          const c = document.getElementById("nx-nai-vibe-preview");
          c && (c.innerHTML = `<img src="${h((globalThis.__INLAY_NATIVE__?.vibePreviewUrl?.() || ""))}" alt="vibe">`), $e("Vibe 인코딩 저장"), await le();
        } catch (i) {
          t.uiMessage = {
            type: "error",
            text: z(i?.message || i)
          }, await P();
        }
        a.target.value = "";
      }
    }), document.getElementById("nx-nai-vibe-clear")?.addEventListener("click", async () => {
      try {
        await K("/v1/nai/vibe/clear", {
          method: "POST",
          body: {}
        });
        const a = document.getElementById("nx-nai-vibe");
        a && (a.value = "none"), $e("Vibe 제거"), await le(), await P();
      } catch (a) {
        t.uiMessage = {
          type: "error",
          text: z(a?.message || a)
        }, await P();
      }
    }), document.getElementById("nx-explorer-refresh")?.addEventListener("click", async () => {
      await Et(!0), await P();
    }),     document.getElementById("nx-explorer-delete-folder")?.addEventListener("click", async () => {
      const a = t.explorer?.folderKey || "", r = (t.explorer?.folders || []).find((i) => i.key === a);
      if (!a || a === "__all__") {
        t.uiMessage = {
          type: "error",
          text: a === "__all__" ? "통합 보기에서는 폴더 삭제를 쓸 수 없습니다. 개별 폴더를 고르세요." : "삭제할 폴더가 없습니다"
        }, await P();
        return;
      }
      const i = `${r?.character_name || "Unknown"} / ${r?.chat_name || a}`;
      if (!confirm(`폴더 "${i}"의 이미지를 모두 삭제할까요?`)) return;
      try {
        await K("/v1/gallery/delete", {
          method: "POST",
          body: { folder_key: a }
        }), await Et(!0), await P();
      } catch (s) {
        t.uiMessage = {
          type: "error",
          text: z(s?.message || s)
        }, await P();
      }
    }), document.getElementById("nx-explorer-q")?.addEventListener("input", (a) => {
      ensureExplorerState().query = a.target?.value || "";
      clearTimeout(t._explorerQTimer), t._explorerQTimer = setTimeout(() => {
        const { items: r } = Ze(), i = document.querySelector(".explorer-grid");
        i && (i.innerHTML = `<div class="explorer-marquee" id="nx-explorer-marquee"></div>${et(r)}`), paintExplorerSelectionUi(), tt();
      }, 160);
    });
    document.getElementById("nx-explorer-sort")?.addEventListener("change", (a) => {
      ensureExplorerState().sort = a.target?.value || "newest";
      const { items: r } = Ze(), i = document.querySelector(".explorer-grid");
      i && (i.innerHTML = `<div class="explorer-marquee" id="nx-explorer-marquee"></div>${et(r)}`), paintExplorerSelectionUi(), tt();
    });
    document.getElementById("nx-explorer-thumb")?.addEventListener("change", (a) => {
      const EX = exHelpers();
      ensureExplorerState().thumb = a.target?.value || "m";
      const grid = document.querySelector(".explorer-grid");
      grid && grid.style.setProperty("--ex-thumb", `${EX.thumbMinWidth ? EX.thumbMinWidth(t.explorer.thumb) : 148}px`);
    });
    document.getElementById("nx-explorer-favonly")?.addEventListener("click", () => {
      const ex = ensureExplorerState();
      ex.favOnly = !ex.favOnly;
      const { items: r } = Ze(), i = document.querySelector(".explorer-grid");
      i && (i.innerHTML = `<div class="explorer-marquee" id="nx-explorer-marquee"></div>${et(r)}`), paintExplorerSelectionUi(), tt();
      $e(ex.favOnly ? "즐겨찾기만 보기" : "전체 보기");
    });
    document.getElementById("nx-explorer-export-folder")?.addEventListener("click", () => explorerExport("folder"));
    document.getElementById("nx-explorer-export-all")?.addEventListener("click", () => explorerExport("all"));
    document.getElementById("nx-explorer-export-sel")?.addEventListener("click", () => explorerExport("selection"));
    document.getElementById("nx-explorer-import")?.addEventListener("click", () => document.getElementById("nx-explorer-import-file")?.click());
    document.getElementById("nx-explorer-import-file")?.addEventListener("change", async (a) => {
      const file = a.target?.files?.[0];
      a.target.value = "";
      await explorerImportFile(file);
    });
    document.getElementById("nx-explorer-delete-sel")?.addEventListener("click", () => explorerDeleteSelected());
    document.getElementById("nx-explorer-clear-sel")?.addEventListener("click", () => {
      const EX = exHelpers();
      ensureExplorerState().selection = EX.clearSelection ? EX.clearSelection(t.explorer.selection) : { selected: new Set(), anchorId: "", focusId: "" };
      paintExplorerSelectionUi();
    });
    document.getElementById("nx-explorer-save-one")?.addEventListener("click", async () => {
      const id = ensureExplorerState().selection?.focusId || [...ensureExplorerState().selection?.selected || []][0];
      const card = (Ze().items || []).find((x) => x.id === id) || (t.explorer?.items || []).find((x) => x.id === id);
      if (!card) return $e("선택된 이미지가 없습니다", !1);
      const a = document.createElement("a");
      a.href = Ie(card);
      a.download = `${card.character_name || "inlay"}_msg${Number(card.message_index) >= 0 ? card.message_index + 1 : "x"}_s${Number(card.shot_index) + 1}.png`;
      a.click();
      $e("이미지 저장");
    });
    document.getElementById("nx-explorer-mobile-select")?.addEventListener("click", () => {
      const ex = ensureExplorerState();
      ex.mobileSelect = !ex.mobileSelect;
      paintExplorerSelectionUi();
      $e(ex.mobileSelect ? "선택모드 ON · 탭할 때마다 토글" : "선택모드 OFF");
    });
    document.getElementById("nx-explorer-ctx")?.querySelectorAll("[data-ex-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.getAttribute("data-ex-act");
        const id = document.getElementById("nx-explorer-ctx")?.dataset?.id;
        const card = (t.explorer?.items || []).find((x) => x.id === id);
        hideExplorerCtx();
        if (act === "view") openExplorerLightbox(id);
        else if (act === "jump") await explorerJumpToMessage(card);
        else if (act === "save") {
          if (!card) return;
          const a = document.createElement("a");
          a.href = Ie(card), a.download = `${id}.png`, a.click();
        } else if (act === "zip") await explorerExport("selection");
        else if (act === "star") await explorerToggleFavorite(id);
        else if (act === "delete") {
          ensureExplorerState().selection.selected = new Set([id]);
          await explorerDeleteSelected();
        }
      });
    });
    if (!t._explorerCtxDocBound) {
      t._explorerCtxDocBound = !0;
      document.addEventListener("click", (ev) => {
        if (!ev.target?.closest?.("#nx-explorer-ctx")) hideExplorerCtx();
      });
    }
    const lb = document.getElementById("nx-explorer-lightbox");
    if (lb && !lb.dataset.nxBound) {
      lb.dataset.nxBound = "1";
      document.getElementById("nx-lb-close")?.addEventListener("click", closeExplorerLightbox);
      document.getElementById("nx-lb-prev")?.addEventListener("click", () => {
        t.explorer.lbIndex = Math.max(0, (t.explorer.lbIndex || 0) - 1);
        t.explorer.lbZoom = 1, t.explorer.lbPanX = 0, t.explorer.lbPanY = 0;
        t._explorerLbPaint?.();
      });
      document.getElementById("nx-lb-next")?.addEventListener("click", () => {
        const n = Ze().items.length;
        t.explorer.lbIndex = Math.min(n - 1, (t.explorer.lbIndex || 0) + 1);
        t.explorer.lbZoom = 1, t.explorer.lbPanX = 0, t.explorer.lbPanY = 0;
        t._explorerLbPaint?.();
      });
      document.getElementById("nx-lb-fav")?.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const card = Ze().items[t.explorer.lbIndex || 0];
        if (card?.id) await explorerToggleFavorite(card.id);
      });
      lb.addEventListener("click", (ev) => {
        if (!lb.classList.contains("show")) return;
        if (ev.target?.closest?.(".lb-bar, button, img")) return;
        closeExplorerLightbox();
      });
      const stage = lb.querySelector(".lb-stage");
      const imgEl = lb.querySelector("img");
      stage?.addEventListener("wheel", (ev) => {
        if (!lb.classList.contains("show")) return;
        ev.preventDefault();
        const zoomed = (t.explorer.lbZoom || 1) > 1.05;
        const wantZoom = ev.ctrlKey || ev.metaKey || zoomed;
        if (wantZoom) {
          const z = Math.max(1, Math.min(6, (t.explorer.lbZoom || 1) * (ev.deltaY > 0 ? 0.9 : 1.1)));
          t.explorer.lbZoom = z;
          if (z <= 1) t.explorer.lbPanX = 0, t.explorer.lbPanY = 0;
          t._explorerLbPaint?.();
          return;
        }
        const now = Date.now();
        if (now - (t._explorerLbWheelAt || 0) < 180) return;
        t._explorerLbWheelAt = now;
        const delta = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
        if (!delta) return;
        if (delta > 0) document.getElementById("nx-lb-next")?.click();
        else document.getElementById("nx-lb-prev")?.click();
      }, { passive: !1 });
      let pan = null;
      imgEl?.addEventListener("pointerdown", (ev) => {
        if ((t.explorer.lbZoom || 1) <= 1) return;
        ev.stopPropagation();
        pan = { x: ev.clientX, y: ev.clientY, px: t.explorer.lbPanX || 0, py: t.explorer.lbPanY || 0 };
        imgEl.setPointerCapture?.(ev.pointerId);
      });
      imgEl?.addEventListener("pointermove", (ev) => {
        if (!pan) return;
        t.explorer.lbPanX = pan.px + (ev.clientX - pan.x);
        t.explorer.lbPanY = pan.py + (ev.clientY - pan.y);
        t._explorerLbPaint?.();
      });
      imgEl?.addEventListener("pointerup", () => {
        pan = null;
      });
      imgEl?.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        t.explorer.lbZoom = (t.explorer.lbZoom || 1) > 1 ? 1 : 2.2;
        t.explorer.lbPanX = 0, t.explorer.lbPanY = 0;
        t._explorerLbPaint?.();
      });
      imgEl?.addEventListener("click", (ev) => ev.stopPropagation());
    }
    if (!t._explorerKeysBound) {
      t._explorerKeysBound = !0;
      document.addEventListener("keydown", async (ev) => {
        if (t.uiTab !== "explorer") return;
        const tag = (ev.target?.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        const EX = exHelpers(), lbOpen = document.getElementById("nx-explorer-lightbox")?.classList.contains("show");
        if (lbOpen) {
          if (ev.key === "Escape") return closeExplorerLightbox();
          if (ev.key === "ArrowLeft") return document.getElementById("nx-lb-prev")?.click();
          if (ev.key === "ArrowRight") return document.getElementById("nx-lb-next")?.click();
          return;
        }
        const { items } = Ze(), ids = items.map((x) => x.id), ex = ensureExplorerState();
        if (ev.key === "Escape") {
          ex.selection = EX.clearSelection ? EX.clearSelection(ex.selection) : ex.selection;
          hideExplorerCtx();
          paintExplorerSelectionUi();
          return;
        }
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") {
          ev.preventDefault();
          ex.selection = EX.selectAll ? EX.selectAll(ex.selection, ids) : ex.selection;
          paintExplorerSelectionUi();
          return;
        }
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "f") {
          ev.preventDefault();
          document.getElementById("nx-explorer-q")?.focus();
          return;
        }
        if (ev.key === "Delete" || ev.key === "Backspace") {
          ev.preventDefault();
          await explorerDeleteSelected();
          return;
        }
        if (ev.key === "Enter") {
          const id = ex.selection?.focusId || ids[0];
          if (id) openExplorerLightbox(id);
          return;
        }
        if (ev.key === " " || ev.key === "Spacebar") {
          ev.preventDefault();
          const id = ex.selection?.focusId || ids[0];
          if (!id) return;
          ex.selection = EX.applyExplorerClick ? EX.applyExplorerClick(ex.selection, id, { ids, index: ids.indexOf(id), ctrl: !0 }) : ex.selection;
          paintExplorerSelectionUi();
          return;
        }
        if (ev.key === "ArrowRight" || ev.key === "ArrowLeft" || ev.key === "ArrowDown" || ev.key === "ArrowUp") {
          ev.preventDefault();
          const cols = Math.max(1, Math.floor((document.querySelector(".explorer-grid")?.clientWidth || 400) / (EX.thumbMinWidth ? EX.thumbMinWidth(ex.thumb) : 148)));
          let delta = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowDown" ? cols : -cols;
          const next = EX.moveFocus ? EX.moveFocus(ids, ex.selection?.focusId, delta) : ids[0];
          if (!next) return;
          if (ev.shiftKey) ex.selection = EX.applyExplorerClick ? EX.applyExplorerClick(ex.selection, next, { ids, index: ids.indexOf(next), shift: !0 }) : ex.selection;
          else if (ev.ctrlKey || ev.metaKey) {
            ex.selection.focusId = next;
          } else {
            ex.selection = EX.applyExplorerClick ? EX.applyExplorerClick(ex.selection, next, { ids, index: ids.indexOf(next) }) : ex.selection;
          }
          paintExplorerSelectionUi();
          document.querySelector(`[data-explorer-id="${CSS.escape(next)}"]`)?.scrollIntoView?.({ block: "nearest" });
        }
      });
    }
    const o = document.getElementById("nx-explorer-folders");
    if (o && !o.dataset.nxBound) {
      o.dataset.nxBound = "1";
      let a = 0;
      const r = (i) => {
        const s = i.target?.closest?.("[data-explorer-folder]");
        if (!s || !o.contains(s)) return;
        i.preventDefault(), i.stopPropagation();
        const c = Date.now();
        if (c - a < 200) return;
        const l = s.getAttribute("data-explorer-folder") || "";
        if (!l || l === t.explorer?.folderKey) return;
        a = c, ha(l);
      };
      o.addEventListener("pointerdown", r), o.addEventListener("mousedown", r), o.addEventListener("click", (i) => {
        i.target?.closest?.("[data-explorer-folder]") && (i.preventDefault(), i.stopPropagation());
      });
    }
    tt(), document.querySelectorAll("[data-char-autotag]").forEach((a) => {
      const r = (i) => {
        i.preventDefault(), i.stopPropagation();
      };
      a.addEventListener("pointerdown", r), a.addEventListener("mousedown", r), a.addEventListener("click", (i) => {
        r(i);
        const s = a.closest("[data-char-scope]");
        if (s) {
          if (t.autotagFocus && t.autotagFocus.scope === s.getAttribute("data-char-scope") && t.autotagFocus.id === (s.getAttribute("data-char-id") || "")) {
            vt(), t.autotagFocus = null;
            const c = s.querySelector("[data-autotag-status]");
            c && (c.className = "autotag-status muted", c.textContent = "오토태그: 버튼 클릭=대상 선택(노란 표시) · 더블클릭=파일");
            return;
          }
          Qe(s);
        }
      }), a.addEventListener("dblclick", (i) => {
        r(i);
        const s = a.closest("[data-char-scope]");
        if (!s) return;
        Qe(s);
        const c = document.createElement("input");
        c.type = "file", c.accept = "image/*", c.style.display = "none", document.body.appendChild(c), c.addEventListener("change", async () => {
          const l = c.files?.[0];
          c.remove(), l && await Tt(s, l);
        }), c.click();
      });
    }), t._autotagPasteBound || (t._autotagPasteBound = !0, window.addEventListener("paste", async (a) => {
      if (!t.autotagFocus || t.autotagFocus.scope === "modal" || !t.uiOpen || t.uiTab !== "characters") return;
      const r = Array.from(a.clipboardData?.items || []).find((p) => p.type.startsWith("image/"));
      if (!r) return;
      a.preventDefault();
      const i = r.getAsFile();
      if (!i) return;
      const s = String(t.autotagFocus.scope || ""), c = String(t.autotagFocus.id || ""), l = Array.from(document.querySelectorAll("[data-char-scope]")).find((p) => p.getAttribute("data-char-scope") === s && p.getAttribute("data-char-id") === c);
      l && await Tt(l, i);
    }));
  }

  async function blockHostChrome(e) {
    t._hostChromeBlocked = !!e;
    if (e) {
      // Hide host overlays while settings are open — do NOT destroy them (st/Wt),
      // or the floating viewer only comes back after closing settings.
      const hide = "position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;visibility:hidden;";
      try {
        for (const ui of [t.galleryUi?.root, t.overlayUi?.root, t.debugUi?.root, t.galleryUi?.panel, t.overlayUi?.layer, t.overlayUi?.pinned, t.overlayUi?.preview]) {
          if (ui && typeof ui.setStyleAttribute == "function") await ui.setStyleAttribute(hide);
        }
      } catch {
      }
      return;
    }
    try {
      t.hostDoc = null;
      if (t.galleryUi?.root && typeof t.galleryUi.root.setStyleAttribute == "function") {
        await t.galleryUi.root.setStyleAttribute("position:fixed;left:0;top:0;width:0;height:0;z-index:99990;pointer-events:none;opacity:1;visibility:visible;");
      }
      if (t.overlayUi?.root && typeof t.overlayUi.root.setStyleAttribute == "function") {
        await t.overlayUi.root.setStyleAttribute("position:fixed;left:0;top:0;width:0;height:0;z-index:99980;pointer-events:none;opacity:1;visibility:visible;");
      }
      // layer/panel were hidden individually on open — restore or markers stay invisible forever.
      if (t.overlayUi?.layer && typeof t.overlayUi.layer.setStyleAttribute == "function") {
        await t.overlayUi.layer.setStyleAttribute("position:fixed;left:0;top:0;width:0;height:0;z-index:99971;pointer-events:none;opacity:1;visibility:visible;");
      }
      if (t.overlayUi?.pinned && typeof t.overlayUi.pinned.setStyleAttribute == "function") {
        await t.overlayUi.pinned.setStyleAttribute("position:fixed;display:none;z-index:99997;pointer-events:auto;padding:0;margin:0;background:transparent;opacity:1;visibility:visible;");
      }
      if (t.overlayUi?.preview && typeof t.overlayUi.preview.setStyleAttribute == "function") {
        await t.overlayUi.preview.setStyleAttribute("position:fixed;display:none;z-index:99992;width:220px;pointer-events:none;border-radius:12px;overflow:hidden;opacity:1;visibility:visible;");
      }
      if (t.overlayUi?.fullscreen && typeof t.overlayUi.fullscreen.setStyleAttribute == "function") {
        await t.overlayUi.fullscreen.setStyleAttribute("position:fixed;inset:0;display:none;z-index:100001;pointer-events:auto;opacity:1;visibility:visible;");
      }
      if (t.debugUi?.root && typeof t.debugUi.root.setStyleAttribute == "function") {
        await t.debugUi.root.setStyleAttribute("position:fixed;left:0;top:0;width:0;height:0;z-index:99986;pointer-events:none;opacity:1;visibility:visible;");
      }
      if (t.galleryUi?.applyChrome) await t.galleryUi.applyChrome();
      else if (t.galleryUi?.paintStatus) await t.galleryUi.paintStatus();
      invalidateOverlayLayoutCache();
      await it();
      try {
        await he();
      } catch {
      }
      Ce();
    } catch {
    }
  }

  async function At() {
    t.uiOpen = !0;
    // Re-open settings with whatever the viewer last selected.
    try {
      if (t.backendSettings?.card) {
        const id = resolveActivePresetId(t.backendSettings.card);
        id && pinActivePreset(t.backendSettings.card, id);
      }
    } catch {
    }
    try {
      Va();
      t._overlayPlaceTimer && (clearTimeout(t._overlayPlaceTimer), t._overlayPlaceTimer = null);
      t._overlayRaf && (typeof cancelAnimationFrame == "function" && cancelAnimationFrame(t._overlayRaf), t._overlayRaf = 0);
      t.galleryUi?._softTimer && (clearTimeout(t.galleryUi._softTimer), t.galleryUi._softTimer = null);
      t._viewerPaintJob = null, t._viewerPaintScheduled = !1;
    } catch {
    }
    try {
      await blockHostChrome(!0);
    } catch {
    }
    try {
      t._hostReaper && clearInterval(t._hostReaper), t._hostReaper = null;
      // One-shot hide only — no recurring DOM work while settings are open.
      const hide = "position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;visibility:hidden;";
      for (const ui of [t.galleryUi?.root, t.overlayUi?.root, t.debugUi?.root, t.overlayUi?.pinned, t.overlayUi?.preview, t.overlayUi?.fullscreen]) {
        if (ui && typeof ui.setStyleAttribute == "function") ui.setStyleAttribute(hide).catch(() => {
        });
      }
    } catch {
    }
    armSettingsCloseWatch();
    try {
      await xe();
    } catch {
      t.charEditUi = null;
    }
    try {
      document.body.innerHTML = "";
    } catch {
    }
    t.charEditUi = null;
    try {
      await ia();
    } catch {
    }
    typeof k.showContainer == "function" && await k.showContainer("fullscreen");
    try {
      window.focus?.();
      document.body?.focus?.();
    } catch {
    }
    await P(), t._debugTabTimer && clearInterval(t._debugTabTimer), t._debugTabTimer = null;
  }
  const _a = [
    '[class*="chat-container"]',
    '[class*="message-list"]',
    "main",
    ".scroller"
  ], $a = [
    "[class*='message-content']",
    "[class*='MessageContent']",
    "[class*='chat-message']",
    "[class*='ChatMessage']",
    "[class*='message']"
  ], Pt = 22, at = 528, ka = 720, Sa = 100, Ia = new sn();
  function Nt() {
    // Overlay + always-on image are one setting (overlay_markers).
    return t.backendSettings?.card?.overlay_markers !== !1;
  }
  function mobilePinOn() {
    return !!t.backendSettings?.card?.mobile_toggle_pin;
  }
  function Ut(e) {
    const n = w(e || "", 40).toLowerCase().replace(/_/g, "-");
    return n === "top-left" || n === "top-right" || n === "bottom-left" || n === "bottom-right" ? n : "bottom-right";
  }
  function Bt(e) {
    const n = w(e || "", 40).toLowerCase();
    return n === "mouse" || n === "cursor" ? "mouse" : "screen";
  }
  function Ea() {
    return Ut(t.backendSettings?.card?.hover_preview_corner);
  }
  function Ma() {
    return Bt(t.backendSettings?.card?.hover_preview_anchor);
  }
  function hoverPreviewOn() {
    return (t.backendSettings?.card || {}).hover_preview !== !1;
  }
  function viewerMinimizeMode() {
    return (t.backendSettings?.card?.viewer_minimize_mode) === "toolbar" ? "toolbar" : "icon";
  }
  function viewerViewport() {
    let vw = 0, vh = 0;
    try {
      if (typeof window < "u") {
        vw = Number(window.innerWidth) || 0, vh = Number(window.innerHeight) || 0;
        // Floating viewer / sticky pin paint on the host; plugin iframe is often tiny.
        // Prefer parent / host defaultView so % → px matches the real screen.
        if (vw < 240 || vh < 240) try {
          const p = window.parent;
          if (p && p !== window) {
            vw = Math.max(vw, Number(p.innerWidth) || 0);
            vh = Math.max(vh, Number(p.innerHeight) || 0);
          }
        } catch {
        }
        if ((vw < 240 || vh < 240) && t.hostDoc?.defaultView) try {
          const hv = t.hostDoc.defaultView;
          vw = Math.max(vw, Number(hv.innerWidth) || 0);
          vh = Math.max(vh, Number(hv.innerHeight) || 0);
        } catch {
        }
        if ((vw < 240 || vh < 240) && window.visualViewport) {
          vw = Math.max(vw, Number(window.visualViewport.width) || 0);
          vh = Math.max(vh, Number(window.visualViewport.height) || 0);
        }
        if ((vw < 240 || vh < 240) && window.screen) {
          vw = Math.max(vw, Number(window.screen.availWidth) || 0);
          vh = Math.max(vh, Number(window.screen.availHeight) || 0);
        }
      }
    } catch {
    }
    return {
      vw: Math.max(320, vw || 1200),
      vh: Math.max(400, vh || 800)
    };
  }
  /** Keep floating panels inside the viewport. Prefered w/h are preserved — only display size shrinks to fit. */
  function clampViewerGeo(geo = {}, minimized = !1) {
    const {
      vw,
      vh
    } = viewerViewport(), margin = 8, mode = viewerMinimizeMode();
    const storeW = Math.max(260, Number(geo.w) || se.w), storeH = Math.max(280, Number(geo.h) || se.h);
    let dispW, dispH;
    if (minimized) {
      if (mode === "toolbar") {
        dispW = Math.max(280, Math.min(storeW, vw - margin * 2));
        dispH = 40;
      } else dispW = 48, dispH = 48;
    } else {
      dispW = Math.max(260, Math.min(storeW, vw - margin * 2));
      dispH = Math.max(280, Math.min(storeH, vh - margin * 2));
    }
    let left = Number(geo.left), top = Number(geo.top);
    if (!Number.isFinite(left)) left = se.left;
    if (!Number.isFinite(top)) top = se.top;
    left = Math.max(margin, Math.min(left, Math.max(margin, vw - dispW - margin)));
    top = Math.max(margin, Math.min(top, Math.max(margin, vh - dispH - margin)));
    return {
      left: Math.round(left),
      top: Math.round(top),
      w: Math.round(storeW),
      h: Math.round(storeH),
      dispW: Math.round(dispW),
      dispH: Math.round(dispH)
    };
  }
  async function hideFloatingViewerForModal() {
    t._viewerHiddenForModal = !0;
    const g = t.galleryUi;
    if (!g?.panel) return;
    try {
      if (g.root && typeof g.root.setStyleAttribute == "function") await g.root.setStyleAttribute("position:fixed;left:0;top:0;width:0;height:0;z-index:99990;pointer-events:none;opacity:0;visibility:hidden;");
      await g.panel.setStyleAttribute("position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;visibility:hidden;z-index:1;");
    } catch {
    }
  }
  async function restoreFloatingViewerAfterModal() {
    if (!t._viewerHiddenForModal) return;
    t._viewerHiddenForModal = !1;
    const g = t.galleryUi;
    if (!g) return;
    try {
      if (g.root && typeof g.root.setStyleAttribute == "function") await g.root.setStyleAttribute("position:fixed;left:0;top:0;width:0;height:0;z-index:99990;pointer-events:none;opacity:1;visibility:visible;");
      if (g.geo) g.geo = clampViewerGeo(g.geo, !!g.minimized);
      if (typeof g.applyChrome == "function") await g.applyChrome();
      else if (g.panel) await g.panel.setStyleAttribute(Ft(g.geo || se, !!g.minimized));
    } catch {
    }
  }
  function cornerFixedStyle(extra = []) {
    const f = Ea(), x = ["position:fixed", "display:block", ...extra];
    return f.includes("top") ? x.push("top:max(16px,env(safe-area-inset-top))") : x.push("bottom:max(16px,env(safe-area-inset-bottom))"), f.includes("left") ? x.push("left:max(16px,env(safe-area-inset-left))") : x.push("right:max(16px,env(safe-area-inset-right))"), x.join(";");
  }
  async function hitEl(A, _, O) {
    try {
      const G = await A.getBoundingClientRect();
      return _ >= G.left && _ <= G.right && O >= G.top && O <= G.bottom;
    } catch {
      return !1;
    }
  }
  function Ca(e = 220, n = null, o = null) {
    const i = Ea(), s = Ma(), c = typeof window < "u" && window.innerWidth || 1200, l = typeof window < "u" && window.innerHeight || 800, p = Math.max(180, Math.round(l * 0.55)), m = Math.min(p, Math.round(e * 1.35)), u = [
      "position:fixed",
      "display:block",
      "z-index:99996",
      `width:${e}px`,
      `max-height:${p}px`,
      "pointer-events:none",
      "border-radius:12px",
      "overflow:hidden",
      "border:1px solid rgba(255,255,255,.16)",
      "box-shadow:0 16px 40px rgba(0,0,0,.5)",
      "background:#0b0f18"
    ];
    if (s === "mouse" && Number.isFinite(Number(n)) && Number.isFinite(Number(o))) {
      const b = Number(n), C = Number(o);
      let S, E;
      return i === "top-left" ? (S = b - e - 14, E = C - m - 14) : i === "top-right" ? (S = b + 14, E = C - m - 14) : i === "bottom-left" ? (S = b - e - 14, E = C + 14) : (S = b + 14, E = C + 14), S = Math.max(16, Math.min(S, c - e - 16)), E = Math.max(16, Math.min(E, l - Math.min(m, p) - 16)), u.push(`left:${Math.round(S)}px`, `top:${Math.round(E)}px`, "right:auto", "bottom:auto"), u.join(";");
    }
    return i === "top-left" ? u.push("left:16px", "top:16px", "right:auto", "bottom:auto") : i === "top-right" ? u.push("right:16px", "top:16px", "left:auto", "bottom:auto") : i === "bottom-left" ? u.push("left:16px", "bottom:16px", "right:auto", "top:auto") : u.push("right:16px", "bottom:16px", "left:auto", "top:auto"), u.join(";");
  }
  function La() {
    const e = t.backendSettings?.card || {};
    let n = Ne(e.inline_thumb_pct, 0);
    if (!n) {
      const o = Ne(e.inline_thumb_w, at);
      n = Math.round(o / at * 100) || Sa;
    }
    return n = Math.max(1, n), {
      w: Math.max(1, Math.round(at * n / 100)),
      h: Math.max(1, Math.round(ka * n / 100)),
      pct: n
    };
  }
  function pinPctDefaults() {
    return { x: pinXPctDefault, y: pinYPctDefault };
  }
  function getPinXPct() {
    const VC = globalThis.__INLAY_VIEWER_CORE__, card = t.backendSettings?.card || {}, vw = viewerViewport().vw;
    if (typeof VC?.resolveStoredPinPercent == "function") return VC.resolveStoredPinPercent(card, "x", vw, pinPctDefaults());
    const n = Number(card.overlay_x_pct);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : pinXPctDefault;
  }
  function getPinYPct() {
    const VC = globalThis.__INLAY_VIEWER_CORE__, card = t.backendSettings?.card || {}, vh = viewerViewport().vh;
    if (typeof VC?.resolveStoredPinPercent == "function") return VC.resolveStoredPinPercent(card, "y", vh, pinPctDefaults());
    const n = Number(card.overlay_y_pct);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : pinYPctDefault;
  }
  /** Sticky pin left = viewport-width % from left (host viewport, not plugin iframe). */
  function resolvePinLeftX() {
    const VC = globalThis.__INLAY_VIEWER_CORE__, pinW = Pt, vw = viewerViewport().vw, pct = getPinXPct();
    if (typeof VC?.pinPercentToPx == "function") return VC.pinPercentToPx(pct, vw, pinW, 4);
    return Math.max(4, Math.min(vw - pinW - 4, Math.round(vw * pct / 100)));
  }
  /** Sticky pin top = viewport-height % from bottom (CSS top; host viewport). */
  function resolvePinTopY(pinSize = Pt) {
    const VC = globalThis.__INLAY_VIEWER_CORE__, vh = viewerViewport().vh, pct = getPinYPct();
    if (typeof VC?.pinPercentToPxFromBottom == "function") return VC.pinPercentToPxFromBottom(pct, vh, pinSize, 8);
    const fromBottom = Math.floor(vh * pct / 100);
    return Math.max(8, Math.min(vh - pinSize - 8, vh - fromBottom - pinSize));
  }
  function jt() {
    return resolvePinLeftX();
  }
  function nt() {
    return !!(t.backendSettings?.card || {}).llm_anchor_percent;
  }
  /** ON: card y% when present. OFF: equal scroll bands (ignore saved y%). */
  function Ot(e, n, o) {
    const VC = globalThis.__INLAY_VIEWER_CORE__;
    const forceEven = !nt();
    if (typeof VC?.resolveCardAnchorPercent == "function") return VC.resolveCardAnchorPercent(e, n, o, { forceEven });
    if (forceEven) return gt(n, o);
    const a = e?.y_percent ?? e?.anchor_percent ?? e?.read_percent, r = Number(a);
    if (Number.isFinite(r)) return Math.max(0, Math.min(100, r));
    return gt(n, o);
  }
  async function Rt() {
    try {
      const e = await D("getRootDocument", () => k.getRootDocument?.(), null);
      if (!e) return;
      const n = await D("qLauncher", () => e.querySelector?.(`.${M}`), null);
      n && await D("rmLauncher", () => n.remove?.(), null);
    } catch {
    }
    t.launcherMounted = !1;
  }
  function Ie(e) {
    try {
      const N = globalThis.__INLAY_NATIVE__;
      const u = N?.resolveImageUrl?.(e) || e?.image_url;
      // DOMPurify keeps data:image, strips blob:. Never use blob: or localhost backend.
      if (typeof u == "string" && /^data:image\//i.test(u)) return u;
    } catch {
    }
    return "";
  }
  /** Warm a card to a DOMPurify-safe data:image URL (Risu strips blob:/http). */
  async function ensureStickyCardImage(card) {
    if (!card?.id) return "";
    try {
      const N = globalThis.__INLAY_NATIVE__;
      let src = typeof N?.resolveImageUrl == "function" ? N.resolveImageUrl(card) || "" : "";
      if ((!src || !/^data:image\//i.test(src)) && typeof N?.ensureImageUrl == "function") {
        src = await N.ensureImageUrl(card.id) || "";
        if (src) card.image_url = src;
      }
      if (typeof src == "string" && /^data:image\//i.test(src)) return src;
    } catch {
    }
    try {
      const fallback = Ie(card);
      if (typeof fallback == "string" && /^data:image\//i.test(fallback)) return fallback;
    } catch {
    }
    return "";
  }
  async function ue(force = !1) {
    if (!force && t.hostDoc) return t.hostDoc;
    const tries = [
      () => k.getRootDocument?.(),
      () => globalThis.risuai?.getRootDocument?.()
    ];
    for (const fn of tries) {
      try {
        const e = await D("getRootDocument", fn, null);
        if (e && typeof e.createElement == "function") return t.hostDoc = e, e;
      } catch {
      }
    }
    return t.hostDoc = null, null;
  }
  function armSettingsCloseWatch() {
    t._settingsWatch && clearInterval(t._settingsWatch);
    let miss = 0;
    t._settingsWatch = setInterval(() => {
      if (!t.uiOpen) {
        clearInterval(t._settingsWatch), t._settingsWatch = null;
        return;
      }
      if (t._uiRendering) {
        miss = 0;
        return;
      }
      try {
        const shell = typeof document < "u" ? document.getElementById("nx-shell") : null;
        if (shell && shell.isConnected) {
          miss = 0;
          return;
        }
        miss += 1;
        if (miss < 4) return;
        t.uiOpen = !1, t._hostReaper && (clearInterval(t._hostReaper), t._hostReaper = null), clearInterval(t._settingsWatch), t._settingsWatch = null;
        flushSettingsSave().catch(() => {
        }), blockHostChrome(!1).catch(() => {
        }), y("info", "settings.closed", "host ui restore");
      } catch {
      }
    }, 500);
  }
  function startHostUiWatchdog() {
    if (t._hostWatch) return;
    let ticks = 0;
    t._hostWatch = setInterval(() => {
      if (t.unloading || t.uiOpen || t._hostChromeBlocked) return;
      ticks += 1;
      const card = t.backendSettings?.card || {}, needViewer = card.floating_viewer !== !1, needOverlay = card.overlay_markers !== !1;
      if (needViewer && !t.galleryUi?.root || needOverlay && !t.overlayUi?.root) {
        t.hostDoc = null, it().catch(() => {
        });
      }
      if (ticks >= 90 && t._hostWatch) {
        clearInterval(t._hostWatch);
        t._hostWatch = setInterval(() => {
          if (t.unloading || t.uiOpen || t._hostChromeBlocked) return;
          const c = t.backendSettings?.card || {};
          if (c.floating_viewer !== !1 && !t.galleryUi?.root) {
            t.hostDoc = null, it().catch(() => {
            });
          }
        }, 5e3);
      }
    }, 1e3);
  }
  async function Ee(e) {
    if (!e || typeof e.querySelector != "function") return null;
    const n = await D("hostBody", () => e.querySelector("body"), null);
    return !n || typeof n.appendChild != "function" ? null : n;
  }
  async function H(e, n, o = {}) {
    const a = await e.createElement(n);
    return o.className && typeof a.setClassName == "function" && await a.setClassName(o.className), o.style && typeof a.setStyleAttribute == "function" && await a.setStyleAttribute(o.style), o.html != null && typeof a.setInnerHTML == "function" ? await a.setInnerHTML(o.html) : o.text != null && typeof a.setTextContent == "function" && await a.setTextContent(o.text), a;
  }
  async function rt(e) {
    const n = await ue();
    if (n)
      try {
        const o = await D("qAll", () => n.querySelectorAll?.(`.${e}`), null), a = o && typeof k.unwarpSafeArray == "function" ? await D("unwrap", () => k.unwarpSafeArray(o), []) : o ? [o] : [];
        for (const r of a || []) await D("rm", () => r?.remove?.(), null);
      } catch {
        const a = await D("qOne", () => n.querySelector?.(`.${e}`), null);
        a && await D("rmOne", () => a.remove?.(), null);
      }
  }
  function Re(e) {
    return String(e || "").replace(/[^a-zA-Z0-9\uac00-\ud7a3\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/g, "").toLowerCase();
  }
  function Ta(e) {
    const n = w(e, 2e5);
    if (!n) return [];
    const o = n.split(/\n\s*\n/).map((a) => a.trim()).filter(Boolean);
    return o.length >= 2 ? o : n.split(`
`).map((a) => a.trim()).filter((a) => a.length >= 8);
  }
  function ge(e, text = "") {
    const n = t.gallery || [];
    if (!e) return [];
    return n.filter((o) => o.content_hash && o.content_hash === e);
  }
  function ot(e, n) {
    if (!e || !n) return 0;
    if (n.content_hash && ye(e) === n.content_hash) return 100;
    const VC = globalThis.__INLAY_VIEWER_CORE__;
    if (typeof VC?.prefixMatchRatio == "function") {
      return Math.round(VC.prefixMatchRatio(e, n.assistant_preview || n.text || "") * 100);
    }
    return 0;
  }
  /**
   * Streaming hash upgrade: same character/chat/msg#/role, Dice≥60% → rewrite card hash once.
   * Hot path stays exact-hash only after this.
   */
  async function maybeRebindAndLink(message, scope = null) {
    if (!message?.hash) return linkedCards(message);
    let linked = linkedCards(message);
    if (linked.length) return linked;
    const VC = globalThis.__INLAY_VIEWER_CORE__;
    if (typeof VC?.findHashRebindCandidates != "function" || !message.text) return [];
    const sc = scope || t.lastScope || {};
    const candidates = VC.findHashRebindCandidates(t.gallery || [], {
      newHash: message.hash,
      text: message.text,
      characterId: message.characterId || sc.characterId || "",
      chatId: message.chatId || sc.chatId || "",
      sessionId: message.sessionId || sc.sessionId || "",
      messageIndex: Number(message.chatIndex ?? message.messageIndex ?? -1),
      role: message.role || ""
    });
    if (!candidates.length) return [];
    try {
      const sid = message.sessionId || sc.sessionId || "";
      await K("/v1/gallery/rebind-hash", {
        method: "POST",
        body: {
          session_id: sid,
          card_ids: candidates.map((c) => c.id).filter(Boolean),
          to_hash: message.hash,
          assistant_preview: message.text || ""
        }
      }, 15e3);
      if (sid) await ce(sid, !0);
      y("info", "gallery.rebind", `n=${candidates.length} hash=${String(message.hash).slice(0, 8)} msg#${message.chatIndex ?? "?"}`);
    } catch (err) {
      return y("warn", "gallery.rebind.fail", err?.message || err), [];
    }
    return linkedCards(message);
  }
  function Me(e) {
    const n = /* @__PURE__ */ new Map();
    const yOf = (c) => {
      const v = Number(c?.y_percent ?? c?.anchor_percent ?? c?.read_percent);
      return Number.isFinite(v) ? v : 999;
    };
    for (const o of e || []) {
      const a = `${o.paragraph ?? "?"}|${o.shot_index ?? o.id}`, r = n.get(a);
      (!r || Number(o.created_at || 0) >= Number(r.created_at || 0)) && n.set(a, o);
    }
    // All current-message shots (y% asc) — do not cap at 8.
    return [...n.values()].sort((o, a) => yOf(o) - yOf(a) || Number(o.paragraph ?? 0) - Number(a.paragraph ?? 0) || Number(o.shot_index ?? 0) - Number(a.shot_index ?? 0) || Number(o.created_at || 0) - Number(a.created_at || 0));
  }
  async function it() {
    if (t.uiOpen) {
      try {
        await blockHostChrome(!0);
      } catch {
      }
      return;
    }
    try {
      await le();
    } catch {
    }
    const e = t.backendSettings?.card || {}, n = await Z().catch(() => null);
    if (n?.sessionId) try {
      await ce(n.sessionId);
    } catch {
    }
    e.floating_viewer !== !1 ? await lt() : await st(), e.overlay_markers !== !1 ? await Ya() : await Wt(), e.debug_panel ? await Ba() : await ct();
    // Re-apply pin % with host viewport (plugin iframe size is tiny on boot).
    if (e.overlay_markers !== !1) {
      const reapplyPin = async () => {
        try {
          invalidateOverlayLayoutCache(), await he(), Ce();
        } catch {
        }
      };
      await reapplyPin();
      // Host defaultView may appear a beat after overlay mount — one deferred pass.
      t._pinBootTimer && clearTimeout(t._pinBootTimer);
      t._pinBootTimer = setTimeout(() => {
        t._pinBootTimer = null;
        if (t.uiOpen || t.unloading) return;
        reapplyPin().catch(() => {
        });
      }, 220);
    }
  }
  async function Aa() {
    try {
      const e = await Kt(ne);
      if (e && typeof e == "object") return clampViewerGeo({
        left: re(e.left, -2e3, 6e3, se.left),
        top: re(e.top, -2e3, 6e3, se.top),
        w: re(e.w, 260, 2400, se.w),
        h: re(e.h, 280, 2400, se.h)
      }, !1);
    } catch {
    }
    return clampViewerGeo({
      ...se
    }, !1);
  }
  async function qt(e) {
    try {
      const g = clampViewerGeo(e || se, !1);
      await Jt(ne, {
        left: Math.round(g.left),
        top: Math.round(g.top),
        w: Math.round(g.w),
        h: Math.round(g.h)
      });
    } catch {
    }
  }
  async function loadViewerIconGeo() {
    try {
      const e = await Kt(iconStoreKey);
      if (e && typeof e == "object") {
        const left = re(e.left, -2e3, 6e3, iconSe.left), top = re(e.top, -2e3, 6e3, iconSe.top);
        return {
          left: Math.round(left),
          top: Math.round(top)
        };
      }
    } catch {
    }
    return {
      ...iconSe
    };
  }
  async function saveViewerIconGeo(e) {
    try {
      const left = Math.round(Number(e?.left) || iconSe.left), top = Math.round(Number(e?.top) || iconSe.top);
      await Jt(iconStoreKey, {
        left,
        top
      });
      return {
        left,
        top
      };
    } catch {
      return {
        left: Math.round(Number(e?.left) || iconSe.left),
        top: Math.round(Number(e?.top) || iconSe.top)
      };
    }
  }
  async function savePinPercent(xPctIn, yPctIn) {
    const VC = globalThis.__INLAY_VIEWER_CORE__, { vw, vh } = viewerViewport();
    const xPct = typeof VC?.clampPinPercent == "function" ? VC.clampPinPercent(xPctIn, pinXPctDefault) : Math.max(0, Math.min(100, Math.floor(Number(xPctIn) || pinXPctDefault)));
    const yPct = typeof VC?.clampPinPercent == "function" ? VC.clampPinPercent(yPctIn, pinYPctDefault) : Math.max(0, Math.min(100, Math.floor(Number(yPctIn) || pinYPctDefault)));
    const nx = typeof VC?.pinPercentToPx == "function" ? VC.pinPercentToPx(xPct, vw, Pt, 4) : Math.max(4, Math.min(vw - Pt - 4, Math.floor(vw * xPct / 100)));
    const ny = typeof VC?.pinPercentToPxFromBottom == "function" ? VC.pinPercentToPxFromBottom(yPct, vh, Pt, 8) : Math.max(8, Math.min(vh - Pt - 8, vh - Math.floor(vh * yPct / 100) - Pt));
    t.backendSettings = t.backendSettings || {}, t.backendSettings.card = {
      ...(t.backendSettings.card || {}),
      overlay_pin_unit: "pct",
      overlay_pin_origin: "bl",
      overlay_x_pct: xPct,
      overlay_y_pct: yPct,
      overlay_x_offset: nx,
      overlay_y_offset: ny
    };
    invalidateOverlayLayoutCache();
    try {
      const ix = typeof document < "u" ? document.getElementById("nx-overlay-x") : null, iy = typeof document < "u" ? document.getElementById("nx-overlay-y") : null;
      ix && (ix.value = String(xPct)), iy && (iy.value = String(yPct));
    } catch {
    }
    try {
      await pe({
        card: {
          overlay_pin_unit: "pct",
          overlay_pin_origin: "bl",
          overlay_x_pct: xPct,
          overlay_y_pct: yPct,
          overlay_x_offset: nx,
          overlay_y_offset: ny
        }
      });
    } catch {
    }
    return { x: nx, y: ny, xPct, yPct };
  }
  async function resetAllWindowPositions() {
    await qt({
      ...se
    });
    await saveViewerIconGeo({
      ...iconSe
    });
    const pin = await savePinPercent(pinXPctDefault, pinYPctDefault);
    if (t.galleryUi?.geo) {
      t.galleryUi.expandedGeo = {
        ...se
      };
      t.galleryUi.iconGeo = {
        ...iconSe
      };
      t.galleryUi.geo = t.galleryUi.minimized ? clampViewerGeo({
        ...se,
        left: iconSe.left,
        top: iconSe.top
      }, !0) : {
        ...se
      };
      t.galleryUi.expandedH = se.h;
      try {
        typeof t.galleryUi.applyChrome == "function" ? await t.galleryUi.applyChrome() : t.galleryUi.panel && await t.galleryUi.panel.setStyleAttribute?.(Ft(t.galleryUi.geo, !!t.galleryUi.minimized));
      } catch {
      }
    }
    try {
      await he();
    } catch {
    }
    Ce(), y("info", "windows.reset", `viewer=${se.left},${se.top} icon=${iconSe.left},${iconSe.top} pin=${pin.x},${pin.y}`);
    return pin;
  }
  async function Pa() {
    try {
      const e = await Kt(ie);
      if (typeof e == "boolean") return e;
      if (e && typeof e == "object" && typeof e.open == "boolean") return e.open;
    } catch {
    }
    return !1;
  }
  async function Na(e) {
    try {
      await Jt(ie, { open: !!e });
    } catch {
    }
  }
  async function loadViewerMinimized() {
    try {
      const e = await Kt(minStoreKey);
      if (typeof e == "boolean") return e;
      if (e && typeof e == "object" && typeof e.open == "boolean") return !e.open;
      if (e && typeof e == "object" && typeof e.minimized == "boolean") return e.minimized;
    } catch {
    }
    return !1;
  }
  async function saveViewerMinimized(e) {
    t.viewerMinimized = !!e;
    try {
      await Jt(minStoreKey, { minimized: !!e });
    } catch {
    }
  }
  const LOAD_SPIN = ["/", "-", "\\", "|"];
  function loadSpinChar() {
    return LOAD_SPIN[Math.floor(Date.now() / 180) % LOAD_SPIN.length];
  }
  function formatViewerJob(B) {
    if (!B) return null;
    const state = String(B.state || ""), pct = Math.max(0, Math.min(100, Math.round(Number(B.progress) || 0))), shotCount = Number(B.shot_count || 0), shotDone = Number(B.shot_done ?? B.shot_index ?? 0), shot = shotCount > 0 ? `${Math.min(Math.max(0, shotDone), shotCount)}/${shotCount}` : "", isReroll = B.kind === "reroll" || B.jobId === "reroll";
    let stage = "작업 중";
    return state === "queued" ? stage = "대기열" : state === "tagging" ? stage = "장면 태깅" : state === "generating" || state === "running" ? stage = isReroll ? "이미지 리롤" : "이미지 생성" : state === "cancelled" ? stage = "이전 작업 정리" : state === "done" ? stage = isReroll ? "리롤 완료" : "생성 완료" : state === "error" ? stage = isReroll ? "리롤 실패" : "생성 실패" : isReroll && (stage = "이미지 리롤"), {
      stage,
      pct,
      shot,
      detail: String(B.message || "").trim(),
      state,
      busy: state !== "done" && state !== "error" && state !== "cancelled"
    };
  }
  function readIndexProgress(B) {
    const N = globalThis.__INLAY_NATIVE__, VC = globalThis.__INLAY_VIEWER_CORE__;
    let warmPct = 0, warmBusy = !1;
    try {
      const w = typeof N?.warmProgress == "function" ? N.warmProgress() : null;
      if (w) warmPct = Number(w.pct) || 0, warmBusy = !!w.busy;
    } catch {
    }
    if (typeof VC?.resolveIndexProgress == "function") {
      return VC.resolveIndexProgress({
        warmPct,
        warmBusy,
        jobState: B?.state,
        jobPct: B?.progress
      });
    }
    if (warmBusy) return { pct: Math.max(6, warmPct), busy: !0, label: "인덱싱" };
    if (String(B?.state || "") === "tagging") return { pct: Math.max(6, Math.round(Number(B.progress) || 0)), busy: !0, label: "인덱싱" };
    return { pct: 0, busy: !1, label: "인덱싱" };
  }
  function viewerStatusHtml(B, extra = "") {
    const info = formatViewerJob(B);
    const idx = readIndexProgress(B);
    if (!info && !idx.busy) return `<span style="color:#a6b1c2;font-size:11px;line-height:1.2">${h(extra || "메시지를 클릭해서 선택하세요")}</span>`;
    const state = info?.state || (idx.busy ? "running" : "");
    const busy = !!(info?.busy || idx.busy);
    const label = busy ? `로딩${loadSpinChar()}` : state === "done" ? "완료" : state === "error" ? "실패" : "대기";
    const stage = info?.stage || idx.label;
    const pct = info ? info.pct : idx.pct;
    const shot = info?.shot || "";
    const meta = idx.busy && info?.busy
      ? `${stage}${shot ? ` ${shot}` : ""} ${pct}% · ${idx.label} ${idx.pct}%`
      : idx.busy && !info
        ? `${idx.label} ${idx.pct}%`
        : `${stage}${shot ? ` ${shot}` : ""} ${pct}%`;
    const accent = state === "error" ? "#f87171" : state === "done" ? "#86efac" : "#c4b5fd";
    const VC = globalThis.__INLAY_VIEWER_CORE__;
    const bars = typeof VC?.composeDualProgressBarsHtml == "function"
      ? VC.composeDualProgressBarsHtml({
        jobPct: info ? info.pct : 0,
        indexPct: idx.pct,
        jobBusy: !!(info && info.busy),
        indexBusy: !!idx.busy,
        error: state === "error"
      })
      : `<span style="flex:0 0 132px;display:flex;flex-direction:column;gap:3px"><span style="height:5px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden"><span style="display:block;height:100%;width:${Math.max(info?.busy ? 6 : 0, info?.pct || 0)}%;background:#7c6cff"></span></span><span style="height:5px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden"><span style="display:block;height:100%;width:${Math.max(idx.busy ? 6 : 0, idx.pct || 0)}%;background:#2dd4bf"></span></span></span>`;
    return `<div style="display:flex;align-items:center;gap:8px;min-width:0;min-height:28px"><span style="flex:0 0 auto;font-weight:700;color:${accent};font-size:10px;font-variant-numeric:tabular-nums">${label}</span><span style="min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8b97ab;font-size:10px">${h(meta)}${extra ? ` · ${h(extra)}` : ""}</span>${bars}</div>`;
  }
  function Dt(e) {
    const n = w(e || "", 200);
    if (!n) return null;
    const o = n.toLowerCase(), a = (r, i) => {
      for (const s of r || []) if ([s.name, ...Array.isArray(s.aliases) ? s.aliases : []].map((c) => w(c, 200)).filter(Boolean).some((c) => c.toLowerCase() === o)) return {
        ...s,
        scope: i
      };
      return null;
    };
    return a(enabledGlobalsForCharacter(), "__global__") || a(t.charactersSession, t.lastScope?.sessionId || "session");
  }
  function Ft(e, minimized = !1) {
    const c = clampViewerGeo(e || se, minimized), mode = viewerMinimizeMode();
    // Persist preferred size (c.w/h) + on-screen position; never overwrite preferred size with shrunk dispW/dispH.
    if (e && typeof e == "object") e.left = c.left, e.top = c.top, e.w = c.w, e.h = c.h;
    const n = c.dispH, o = c.dispW;
    return [
      "position:fixed",
      `left:${c.left}px`,
      `top:${c.top}px`,
      `width:${o}px`,
      `height:${n}px`,
      "z-index:99989",
      "display:flex",
      "flex-direction:column",
      "overflow:hidden",
      "pointer-events:auto",
      "opacity:1",
      "visibility:visible",
      "background:linear-gradient(165deg,rgba(20,24,36,.97),rgba(10,13,22,.98))",
      "border:1px solid rgba(151,139,255,.28)",
      "border-radius:16px",
      "box-shadow:0 20px 60px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.03) inset",
      "backdrop-filter:blur(14px)",
      "color:#e2e8f0",
      "font:13px/1.45 sans-serif",
      "touch-action:none",
      minimized ? "resize:none" : "resize:both",
      minimized && mode === "icon" ? "min-width:48px" : minimized ? "min-width:280px" : "min-width:260px",
      minimized ? `min-height:${n}px` : "min-height:280px"
    ].join(";");
  }
  function imageStageStyle(geo = {}) {
    const panelH = Math.max(280, Number(geo.h) || 560);
    // header + gaps + status + thumbs + chip row + padding. Prompt block removed — image can grow with panel.
    const reserved = 36 + 14 + 22 + 96 + 40 + 16;
    const h = Math.max(220, panelH - reserved);
    return [
      "width:100%",
      `height:${h}px`,
      `min-height:${h}px`,
      "flex:1 1 auto",
      "background:#0b0f18",
      "border-radius:12px",
      "overflow:hidden",
      "display:flex",
      "align-items:center",
      "justify-content:center"
    ].join(";");
  }
  async function xe() {
    const e = t.charEditUi, n = e?.root || (typeof document < "u" ? document.getElementById("nx-char-edit-modal") : null);
    try {
      n?.remove?.();
    } catch {
    }
    const o = !!e?.openedContainer;
    if (t.charEditUi = null, t.autotagFocus?.scope === "modal" && (t.autotagFocus = null), o && !t.uiOpen && typeof k.hideContainer == "function") try {
      await k.hideContainer();
    } catch {
    }
    // Viewer stays visible during overlays — no restoreFloatingViewerAfterModal.
    if (t.galleryUi?.renderCast) try {
      await t.galleryUi.renderCast();
    } catch {
    }
  }
  async function Ua(e) {
    if (!e?.name) return;
    if (typeof document > "u" || !document.body) {
      y("error", "char.edit.open", "plugin document unavailable");
      return;
    }
    await closeCardTagEdit(), await xe(), await closeCharacterCreateModal().catch(() => null);
    const rosterResolved = await ensureViewerRosterLoaded().catch(() => null);
    const n = e.roster || Dt(e.name) || {
      name: e.name,
      aliases: [e.name],
      original: "",
      appearance: "",
      attire: "",
      accessories: "",
      scope: rosterResolved?.rosterSessionId || t.lastScope?.sessionId || "",
      id: ""
    }, o = Array.isArray(n.aliases) ? n.aliases.join(", ") : String(n.aliases || ""), a = n.scope === "__global__" ? "글로벌" : rosterResolved?.rosterUnified ? "통합" : "채팅", r = !t.uiOpen;
    // Keep floating viewer visible: transparent plugin shell, do not hide host chrome.
    r && typeof k.showContainer == "function" && (await k.showContainer("fullscreen"), document.body.style.cssText = "margin:0;min-height:100vh;background:transparent;font:13px/1.45 Segoe UI,sans-serif;color:#e2e8f0;");
    const i = document.createElement("div");
    i.id = "nx-char-edit-modal", i.setAttribute("data-ce-root", "1"), i.innerHTML = [
      '<div data-ce-backdrop style="position:fixed;inset:0;z-index:100000;background:rgba(4,8,16,.72);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;">',
      '<div data-ce-card style="width:min(720px,100%);max-height:min(94vh,920px);background:linear-gradient(165deg,#1a1f2e,#0c1018);border:1px solid rgba(151,139,255,.4);border-radius:16px;box-shadow:0 28px 80px rgba(0,0,0,.55);display:flex;flex-direction:column;overflow:hidden;">',
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0">',
      `<div><div style="font-weight:700;font-size:15px">캐릭터 태그 수정</div><div style="margin-top:3px;color:#9aa6b8;font-size:11px">char${e.index + 1} · ${h(n.name || e.name)} · ${a}</div></div>`,
      '<button type="button" data-ce-x style="cursor:pointer;border:0;background:rgba(255,255,255,.08);color:#e2e8f0;padding:6px 10px;border-radius:8px">✕</button>',
      "</div>",
      '<form data-ce-form style="padding:14px 16px;display:grid;gap:10px;overflow:auto;flex:1;min-height:0">',
      `<label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px"><span>캐릭터 프리셋 (현재 챗/글로벌)</span><select data-ce-preset style="width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:9px 11px;font:13px/1.4 Segoe UI,sans-serif"><option value="">직접 입력 / 현재 값 유지</option>${(() => {
        const Vt = [], Xt = /* @__PURE__ */ new Set(), Yt = (Gt, Kt) => {
          for (const Qt of Gt || []) {
            const me = w(Qt?.name || "", 200);
            if (!me) continue;
            const nn = me.toLowerCase();
            if (Xt.has(nn)) continue;
            Xt.add(nn), Vt.push(`<option value="${h(Kt + "::" + me)}" ${me.toLowerCase() === w(n.name || e.name, 200).toLowerCase() && (Kt === "G" ? n.scope === "__global__" : n.scope !== "__global__") ? "selected" : ""}>[${Kt}] ${h(me)}</option>`);
          }
        };
        return Yt(enabledGlobalsForCharacter(), "G"), Yt(t.charactersSession, "S"), Vt.join("");
      })()}</select></label>`,
      `<div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:8px"><label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px"><span>이름</span><input data-ce-name value="${h(n.name || e.name)}" style="width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:8px 10px;font:13px/1.4 Segoe UI,sans-serif"></label><label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px"><span>원본 태그</span><input data-ce-original value="${h(n.original || "")}" placeholder="(원작 캐릭터 태그)" style="width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:8px 10px;font:13px/1.4 Segoe UI,sans-serif"></label></div>`,
      `<div style="display:grid;grid-template-columns:32px minmax(0,1fr) minmax(0,1.2fr);gap:6px 8px;align-items:center;padding:8px 10px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.03)"><span></span><span style="font-size:10px;font-weight:700;color:#778398;letter-spacing:.04em">기본</span><span style="font-size:10px;font-weight:700;color:#778398;letter-spacing:.04em">한·영 표기</span><span style="font-size:11px;font-weight:700;color:#9aa6b8">성</span><input data-ce-surname value="${h(n.surname || "")}" placeholder="한" style="width:100%;box-sizing:border-box;border-radius:9px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:7px 9px;font:13px Segoe UI,sans-serif"><input data-ce-surname-variants value="${h(Array.isArray(n.surname_variants) ? n.surname_variants.join(", ") : n.surname_variants || "")}" placeholder="Han, HAN" style="width:100%;box-sizing:border-box;border-radius:9px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:7px 9px;font:13px Segoe UI,sans-serif"><span style="font-size:11px;font-weight:700;color:#9aa6b8">이름</span><input data-ce-given value="${h(n.given_name || "")}" placeholder="진우" style="width:100%;box-sizing:border-box;border-radius:9px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:7px 9px;font:13px Segoe UI,sans-serif"><input data-ce-given-variants value="${h(Array.isArray(n.given_name_variants) ? n.given_name_variants.join(", ") : n.given_name_variants || "")}" placeholder="Jinwoo, JINWOO" style="width:100%;box-sizing:border-box;border-radius:9px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:7px 9px;font:13px Segoe UI,sans-serif"></div>`,
      `<label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px"><span>트리거/별칭</span><input data-ce-aliases value="${h(o)}" placeholder="한진우, HAN JINWOO, 진우" style="width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:8px 10px;font:13px/1.4 Segoe UI,sans-serif"></label>`,
      `<label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px"><span>외형 태그 (girl/boy · 옷·악세사리 제외)</span><textarea data-ce-appearance rows="5" style="width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:9px 11px;font:13px/1.45 Segoe UI,sans-serif;resize:vertical;min-height:110px">${h(n.appearance || "")}</textarea></label>`,
      `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px"><div style="display:grid;gap:4px;min-width:0"><div style="display:flex;align-items:center;justify-content:space-between;gap:6px;color:#9aa6b8;font-size:11px;font-weight:600"><span>옷 태그</span><label style="display:inline-flex;align-items:center;gap:4px;margin:0;color:#d7deea;font-size:11px;font-weight:550;cursor:pointer;white-space:nowrap"><input data-ce-attire-locked type="checkbox" ${n.attire_locked ? "checked" : ""} style="width:14px;height:14px;margin:0;accent-color:#7c6cff">고정</label></div><textarea data-ce-attire rows="3" style="width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:9px 11px;font:13px/1.45 Segoe UI,sans-serif;resize:vertical;min-height:72px">${h(n.attire || "")}</textarea></div><div style="display:grid;gap:4px;min-width:0"><div style="display:flex;align-items:center;justify-content:space-between;gap:6px;color:#9aa6b8;font-size:11px;font-weight:600"><span>악세사리·무기·기타</span><label style="display:inline-flex;align-items:center;gap:4px;margin:0;color:#d7deea;font-size:11px;font-weight:550;cursor:pointer;white-space:nowrap"><input data-ce-accessories-locked type="checkbox" ${n.accessories_locked ? "checked" : ""} style="width:14px;height:14px;margin:0;accent-color:#7c6cff">고정</label></div><textarea data-ce-accessories rows="3" style="width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:9px 11px;font:13px/1.45 Segoe UI,sans-serif;resize:vertical;min-height:72px">${h(n.accessories || "")}</textarea></div></div>`,
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,196,72,.35);background:rgba(255,196,72,.08)">',
      '<button type="button" data-ce-autotag style="cursor:pointer;border:1px solid rgba(255,196,72,.7);background:rgba(255,196,72,.2);color:#ffe7a8;padding:7px 12px;border-radius:9px;font:700 12px Segoe UI,sans-serif">오토태그</button>',
      '<button type="button" data-ce-regenerate style="cursor:pointer;border:1px solid rgba(124,108,255,.7);background:rgba(124,108,255,.2);color:#ddd6fe;padding:7px 12px;border-radius:9px;font:700 12px Segoe UI,sans-serif">관련 이미지 재생성</button>',
      '<span data-ce-autotag-badge style="display:none;font-size:11px;font-weight:750;color:#ffe7a8;background:rgba(255,196,72,.18);border:1px solid rgba(255,196,72,.45);border-radius:999px;padding:3px 9px"></span>',
      '<span data-ce-autotag-status style="color:#c9b56a;font-size:11px;flex:1;min-width:160px">클릭=붙여넣기 대상 · 더블클릭=파일</span>',
      "</div>",
      "</form>",
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-top:1px solid rgba(255,255,255,.08);flex-shrink:0;background:rgba(8,12,20,.92)">',
      '<span data-ce-status style="color:#9aa6b8;font-size:11px">수정 후 저장하세요</span>',
      '<div style="display:flex;gap:8px">',
      '<button type="button" data-ce-cancel style="cursor:pointer;border:0;background:#334155;color:#fff;padding:8px 12px;border-radius:9px;font:12px Segoe UI,sans-serif">취소</button>',
      '<button type="button" data-ce-save style="cursor:pointer;border:0;background:#7c6cff;color:#fff;padding:8px 14px;border-radius:9px;font:600 12px Segoe UI,sans-serif">저장</button>',
      "</div></div></div></div>"
    ].join(""), document.body.appendChild(i);
    const s = i.querySelector("[data-ce-name]"), c = i.querySelector("[data-ce-original]"), surnameEl = i.querySelector("[data-ce-surname]"), givenEl = i.querySelector("[data-ce-given]"), surnameVariantsEl = i.querySelector("[data-ce-surname-variants]"), givenVariantsEl = i.querySelector("[data-ce-given-variants]"), l = i.querySelector("[data-ce-aliases]"), p = i.querySelector("[data-ce-appearance]"), m = i.querySelector("[data-ce-attire]"), accEl = i.querySelector("[data-ce-accessories]"), attireLockedEl = i.querySelector("[data-ce-attire-locked]"), accLockedEl = i.querySelector("[data-ce-accessories-locked]"), presetEl = i.querySelector("[data-ce-preset]"), u = i.querySelector("[data-ce-status]"), b = i.querySelector("[data-ce-autotag]"), C = i.querySelector("[data-ce-autotag-badge]"), S = i.querySelector("[data-ce-autotag-status]"), E = (f) => {
      u && (u.textContent = f);
    }, applyPreset = (f) => {
      const x = String(f || ""), I = x.startsWith("G::") ? enabledGlobalsForCharacter().find((R) => w(R?.name || "", 200) === x.slice(3)) : x.startsWith("S::") ? (t.charactersSession || []).find((R) => w(R?.name || "", 200) === x.slice(3)) : null;
      if (!I) return;
      const R = Array.isArray(I.aliases) ? I.aliases.join(", ") : String(I.aliases || "");
      s && (s.value = w(I.name || "", 200)), c && (c.value = w(I.original || "", 400)), surnameEl && (surnameEl.value = w(I.surname || "", 200)), givenEl && (givenEl.value = w(I.given_name || "", 200)), surnameVariantsEl && (surnameVariantsEl.value = Array.isArray(I.surname_variants) ? I.surname_variants.join(", ") : String(I.surname_variants || "")), givenVariantsEl && (givenVariantsEl.value = Array.isArray(I.given_name_variants) ? I.given_name_variants.join(", ") : String(I.given_name_variants || "")), l && (l.value = R), p && (p.value = w(I.appearance || "", 4e3)), m && (m.value = w(I.attire || "", 4e3)), accEl && (accEl.value = w(I.accessories || "", 4e3)), attireLockedEl && (attireLockedEl.checked = !!I.attire_locked), accLockedEl && (accLockedEl.checked = !!I.accessories_locked), n.id = I.id || n.id, n.scope = I.scope || (x.startsWith("G::") ? "__global__" : n.scope), E(`[${x.startsWith("G::") ? "G" : "S"}] ${I.name} 불러옴 · 저장하세요`);
    }, j = (f, x = "선택됨 · Ctrl+V") => {
      t.autotagFocus = f ? {
        scope: "modal",
        id: "char-edit"
      } : null, b && (b.textContent = f ? "붙여넣기 대기" : "오토태그", b.style.background = f ? "rgba(255,196,72,.35)" : "rgba(255,196,72,.2)"), C && (C.style.display = f ? "inline-flex" : "none", C.textContent = f ? x : ""), S && (S.textContent = f ? "이 팝업 선택됨 · Ctrl+V로 이미지 붙여넣기 · 더블클릭으로 파일" : "클릭=붙여넣기 대상 · 더블클릭=파일", S.style.color = f ? "#ffe7a8" : "#c9b56a");
    }, d = async (f) => {
      if (f) {
        j(!0, "분석 중…"), b && (b.textContent = "분석 중…");
        try {
          const x = await Lt(f, S);
          p && (p.value = x.appearance || "");
          m && (m.value = x.attire || "");
          accEl && (accEl.value = x.accessories || "");
          j(!0, "완료"), b && (b.textContent = "오토태그"), E("오토태그 반영됨 · 외형/의상/악세 · 저장을 누르세요");
        } catch (x) {
          S && (S.textContent = `실패: ${z(x?.message || x, 80)}`, S.style.color = "#f87171"), j(!0, "실패"), b && (b.textContent = "붙여넣기 대기");
        }
      }
    };
    presetEl?.addEventListener("change", () => {
      applyPreset(presetEl.value);
    }), b?.addEventListener("click", (f) => {
      f.preventDefault(), f.stopPropagation();
      const x = t.autotagFocus?.scope === "modal" && t.autotagFocus?.id === "char-edit";
      j(!x);
    }), b?.addEventListener("dblclick", (f) => {
      f.preventDefault(), f.stopPropagation(), j(!0);
      const x = document.createElement("input");
      x.type = "file", x.accept = "image/*", x.style.display = "none", document.body.appendChild(x), x.addEventListener("change", async () => {
        const I = x.files?.[0];
        x.remove(), I && await d(I);
      }), x.click();
    }), i.addEventListener("paste", async (f) => {
      if (!(t.autotagFocus?.scope === "modal" && t.autotagFocus?.id === "char-edit")) return;
      const x = Array.from(f.clipboardData?.items || []).find((R) => R.type.startsWith("image/"));
      if (!x) return;
      f.preventDefault(), f.stopPropagation();
      const I = x.getAsFile();
      I && await d(I);
    });
    const U = async () => {
      const live = await Z({ useOverride: !1 }).catch(() => null);
      const rosterMeta = t._viewerRoster || await resolveViewerRosterSession().catch(() => null);
      const rosterSessionId = rosterMeta?.rosterSessionId || live?.sessionId || "";
      const x = n?.scope === "__global__" ? "__global__" : rosterSessionId;
      if (!x) {
        E("저장 실패: 세션 없음");
        return;
      }
      const I = w(s?.value || n.name || e.name, 200);
      if (!I) {
        E("이름이 비어 있습니다");
        return;
      }
      const R = w(c?.value || "", 400), splitNames = (v) => String(v || "").split(/[,/\n]/).map((Q) => Q.trim()).filter(Boolean), g = splitNames(l?.value), F = w(p?.value || "", 4e3), T = w(m?.value || "", 4e3), Acc = w(accEl?.value || "", 4e3);
      try {
        E(`저장 중… (${I})`);
        const edited = {
          id: n.id || "",
          name: I,
          original: R,
          aliases: g.length ? g : [I],
          surname: w(surnameEl?.value || "", 200),
          given_name: w(givenEl?.value || "", 200),
          surname_variants: splitNames(surnameVariantsEl?.value),
          given_name_variants: splitNames(givenVariantsEl?.value),
          appearance: F,
          attire: T,
          accessories: Acc,
          attire_locked: !!attireLockedEl?.checked,
          accessories_locked: !!accLockedEl?.checked,
          priority: Number(n.priority || 0)
        };
        let v;
        if (x === "__global__") {
          v = await K("/v1/characters", {
            method: "POST",
            body: {
              session_id: live?.sessionId || rosterSessionId || "",
              scope: "__global__",
              character: edited
            }
          }, 15e3);
        } else if (rosterMeta?.rosterUnified && rosterMeta.unifiedScope) {
          v = await K("/v1/characters", {
            method: "POST",
            body: withRootSessions({
              session_id: rosterSessionId,
              character_id: w(live?.characterId || rosterMeta.characterId || "", 200),
              character: edited
            }, rosterMeta.unifiedScope)
          }, 15e3);
        } else {
          v = await K("/v1/characters", {
            method: "POST",
            body: {
              session_id: live?.sessionId || rosterSessionId || "",
              scope: x,
              character: edited
            }
          }, 15e3);
        }
        if (t.charactersSession = v?.characters || t.charactersSession, t.charactersGlobal = v?.global || t.charactersGlobal, t.appearance = v?.appearance || t.appearance, y("info", "char.edit.save", `${I} → ${rosterMeta?.rosterUnified ? "roots" : x === "__global__" ? "global" : "session"} app=${F.length} attire=${T.length} acc=${Acc.length}`), t.galleryUi?.status?.setTextContent) try {
          await t.galleryUi.status.setTextContent(`캐릭터 저장됨 · ${I}`);
        } catch {
        }
        await xe();
      } catch (v) {
        y("error", "char.edit.save.fail", v?.message || v), E(`저장 실패: ${z(v?.message || v, 80)}`);
      }
    };
    i.querySelector("[data-ce-save]")?.addEventListener("click", (f) => {
      f.preventDefault(), f.stopPropagation(), U().catch(() => {
      });
    }), i.querySelector("[data-ce-cancel]")?.addEventListener("click", (f) => {
      f.preventDefault(), xe().catch(() => {
      });
    }), i.querySelector("[data-ce-x]")?.addEventListener("click", (f) => {
      f.preventDefault(), f.stopPropagation(), U().catch(() => {
      });
    }), (() => {
      const backdrop = i.querySelector("[data-ce-backdrop]");
      if (!backdrop) return;
      // Close only on a real outside click (down+up on dim). Text-drag release outside must not close.
      let downOnBackdrop = !1;
      backdrop.addEventListener("pointerdown", (f) => {
        downOnBackdrop = f.target === backdrop;
      });
      backdrop.addEventListener("pointercancel", () => {
        downOnBackdrop = !1;
      });
      backdrop.addEventListener("click", (f) => {
        const ok = f.target === backdrop && downOnBackdrop;
        downOnBackdrop = !1;
        ok && U().catch(() => {
        });
      });
    })(), i.querySelector("[data-ce-regenerate]")?.addEventListener("click", async (f) => {
      f.preventDefault(), f.stopPropagation();
      const x = t.selectedMessage, I = await Z({ useOverride: !1 }).catch(() => null);
      if (!x) return E("재생성할 메시지를 먼저 선택하세요");
      try {
        const targets = messageCardsByY(x);
        E("관련 이미지 재생성 중…"), await withImageRerollToast(`관련 이미지 재생성 중… (0/${targets.length || "?"})`, async (report) => {
          const result = await rerollMessageImagesLive(x, { scope: I, report });
          if (Array.isArray(result.failed) && result.failed.length) E(`관련 이미지 재생성 부분 실패 · 성공 ${result.count} / 실패 ${result.failed.length}`);
          return result;
        }, { shotCount: Math.max(1, targets.length || 1) }), I?.sessionId && await ce(I.sessionId, !0), await he(), t.galleryUi?.renderGal && await t.galleryUi.renderGal(), E("관련 이미지 재생성 완료");
      } catch (R) {
        E(`재생성 실패: ${z(R?.message || R, 80)}`);
      }
    }), i.querySelector("[data-ce-card]")?.addEventListener("click", (f) => f.stopPropagation()), i.querySelector("[data-ce-form]")?.addEventListener("submit", (f) => {
      f.preventDefault(), U().catch(() => {
      });
    }), t.charEditUi = {
      root: i,
      entryName: e.name,
      openedContainer: r,
      roster: n,
      entry: e
    };
    try {
      s?.focus?.();
    } catch {
    }
    y("info", "char.edit.open", `${n.name || e.name} (${a}) iframe-modal`);
  }

  async function closeCardTagEdit() {
    const e = t.cardTagUi, n = e?.root || (typeof document < "u" ? document.getElementById("nx-card-tag-modal") : null);
    try {
      n?.remove?.();
    } catch {
    }
    const o = !!e?.openedContainer;
    if (t.cardTagUi = null, o && !t.uiOpen && typeof k.hideContainer == "function") try {
      await k.hideContainer();
    } catch {
    }
  }
  async function closeCharacterCreateModal() {
    const e = t.charCreateUi, n = e?.root || (typeof document < "u" ? document.getElementById("nx-char-create-modal") : null);
    try {
      n?.remove?.();
    } catch {
    }
    const o = !!e?.openedContainer;
    if (t.charCreateUi = null, o && !t.uiOpen && !t.cardTagUi && !t.charEditUi && typeof k.hideContainer == "function") try {
      await k.hideContainer();
    } catch {
    }
  }
  async function openCharacterCreateModal(opts = {}) {
    if (typeof document > "u" || !document.body) throw new Error("plugin document unavailable");
    await closeCharacterCreateModal();
    const rosterResolved = t._viewerRoster || await ensureViewerRosterLoaded().catch(() => null);
    const opened = !t.uiOpen && !t.cardTagUi && !t.charEditUi;
    opened && typeof k.showContainer == "function" && (await k.showContainer("fullscreen"), document.body.style.cssText = "margin:0;min-height:100vh;background:transparent;font:13px/1.45 Segoe UI,sans-serif;color:#e2e8f0;");
    const field = "width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:8px 10px;font:13px/1.4 Segoe UI,sans-serif";
    const sessionTag = rosterResolved?.rosterUnified ? "U" : "S";
    const presetLabel = rosterResolved?.rosterUnified ? "캐릭터 프리셋 (통합/글로벌)" : "캐릭터 프리셋 (현재 챗/글로벌)";
    const presetOptions = (() => {
      const Vt = [], Xt = /* @__PURE__ */ new Set(), Yt = (Gt, Kt) => {
        for (const Qt of Gt || []) {
          const me = w(Qt?.name || "", 200);
          if (!me) continue;
          const nn = me.toLowerCase();
          if (Xt.has(nn)) continue;
          Xt.add(nn), Vt.push(`<option value="${h(Kt + "::" + me)}">[${Kt}] ${h(me)}</option>`);
        }
      };
      return Yt(enabledGlobalsForCharacter(), "G"), Yt(t.charactersSession, sessionTag), Vt.join("");
    })();
    const root = document.createElement("div");
    root.id = "nx-char-create-modal", root.setAttribute("data-cc-root", "1"), root.innerHTML = [
      '<div data-cc-backdrop style="position:fixed;inset:0;z-index:100060;background:rgba(4,8,16,.6);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;">',
      '<div data-cc-card style="width:min(720px,100%);max-height:min(94vh,920px);background:linear-gradient(165deg,#1a1f2e,#0c1018);border:1px solid rgba(151,139,255,.4);border-radius:16px;box-shadow:0 28px 80px rgba(0,0,0,.55);display:flex;flex-direction:column;overflow:hidden;">',
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0">',
      `<div><div style="font-weight:700;font-size:15px">캐릭터 추가</div><div style="margin-top:3px;color:#9aa6b8;font-size:11px">${rosterResolved?.rosterUnified ? "현재 라이브 채팅 로스터에 추가 (통합은 모아보기)" : "현재 채팅 로스터에 추가"}</div></div>`,
      '<button type="button" data-cc-x style="cursor:pointer;border:0;background:rgba(255,255,255,.08);color:#e2e8f0;padding:6px 10px;border-radius:8px">✕</button>',
      "</div>",
      '<div data-cc-body style="padding:14px 16px;display:grid;gap:10px;overflow:auto;flex:1;min-height:0">',
      `<label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px"><span>${presetLabel}</span><select data-cc-preset style="${field}"><option value="">직접 입력</option>${presetOptions}</select></label>`,
      `<div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:8px"><label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px"><span>이름</span><input data-cc-name value="" style="${field}"></label><label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px"><span>원본 태그</span><input data-cc-original placeholder="(원작 캐릭터 태그)" style="${field}"></label></div>`,
      `<div style="display:grid;grid-template-columns:32px minmax(0,1fr) minmax(0,1.2fr);gap:6px 8px;align-items:center;padding:8px 10px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.03)"><span></span><span style="font-size:10px;font-weight:700;color:#778398">기본</span><span style="font-size:10px;font-weight:700;color:#778398">한·영 표기</span><span style="font-size:11px;font-weight:700;color:#9aa6b8">성</span><input data-cc-surname placeholder="한" style="${field}"><input data-cc-surname-variants placeholder="Han, HAN" style="${field}"><span style="font-size:11px;font-weight:700;color:#9aa6b8">이름</span><input data-cc-given placeholder="진우" style="${field}"><input data-cc-given-variants placeholder="Jinwoo, JINWOO" style="${field}"></div>`,
      `<label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px"><span>트리거/별칭</span><input data-cc-aliases placeholder="한진우, HAN JINWOO, 진우" style="${field}"></label>`,
      `<label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px"><span>외형 태그 (옷·악세사리 제외)</span><textarea data-cc-appearance rows="4" style="${field};resize:vertical;min-height:88px"></textarea></label>`,
      `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px"><div style="display:grid;gap:4px"><div style="display:flex;justify-content:space-between;gap:6px;color:#9aa6b8;font-size:11px;font-weight:600"><span>옷 태그</span><label style="display:inline-flex;align-items:center;gap:4px;color:#d7deea;font-size:11px;cursor:pointer"><input data-cc-attire-locked type="checkbox" style="width:14px;height:14px;margin:0;accent-color:#7c6cff">고정</label></div><textarea data-cc-attire rows="3" style="${field};resize:vertical;min-height:64px"></textarea></div><div style="display:grid;gap:4px"><div style="display:flex;justify-content:space-between;gap:6px;color:#9aa6b8;font-size:11px;font-weight:600"><span>악세사리·무기·기타</span><label style="display:inline-flex;align-items:center;gap:4px;color:#d7deea;font-size:11px;cursor:pointer"><input data-cc-accessories-locked type="checkbox" style="width:14px;height:14px;margin:0;accent-color:#7c6cff">고정</label></div><textarea data-cc-accessories rows="3" style="${field};resize:vertical;min-height:64px"></textarea></div></div>`,
      `<div style="display:grid;grid-template-columns:minmax(0,.6fr) minmax(0,1.4fr);gap:8px;align-items:end"><label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px"><span>우선순위</span><input data-cc-priority type="number" value="0" style="${field}"></label><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,196,72,.35);background:rgba(255,196,72,.08)"><button type="button" data-cc-autotag style="cursor:pointer;border:1px solid rgba(255,196,72,.7);background:rgba(255,196,72,.2);color:#ffe7a8;padding:7px 12px;border-radius:9px;font:700 12px Segoe UI,sans-serif">오토태그</button><span data-cc-autotag-status style="color:#c9b56a;font-size:11px;flex:1;min-width:140px">클릭=붙여넣기 대상 · 더블클릭=파일</span></div></div>`,
      "</div>",
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-top:1px solid rgba(255,255,255,.08);flex-shrink:0;background:rgba(8,12,20,.96)">',
      '<span data-cc-status style="color:#9aa6b8;font-size:11px">필수: 이름 · 외형 권장</span>',
      '<div style="display:flex;gap:8px"><button type="button" data-cc-cancel style="cursor:pointer;border:0;background:#334155;color:#fff;padding:8px 12px;border-radius:9px;font:12px Segoe UI,sans-serif">취소</button><button type="button" data-cc-save style="cursor:pointer;border:0;background:#7c6cff;color:#fff;padding:8px 14px;border-radius:9px;font:600 12px Segoe UI,sans-serif">저장</button></div>',
      "</div></div></div>"
    ].join(""), document.body.appendChild(root);
    const nameEl = root.querySelector("[data-cc-name]"), originalEl = root.querySelector("[data-cc-original]"), surnameEl = root.querySelector("[data-cc-surname]"), givenEl = root.querySelector("[data-cc-given]"), surnameVariantsEl = root.querySelector("[data-cc-surname-variants]"), givenVariantsEl = root.querySelector("[data-cc-given-variants]"), aliasesEl = root.querySelector("[data-cc-aliases]"), appearanceEl = root.querySelector("[data-cc-appearance]"), attireEl = root.querySelector("[data-cc-attire]"), accessoriesEl = root.querySelector("[data-cc-accessories]"), attireLockedEl = root.querySelector("[data-cc-attire-locked]"), accLockedEl = root.querySelector("[data-cc-accessories-locked]"), priorityEl = root.querySelector("[data-cc-priority]"), statusEl = root.querySelector("[data-cc-status]"), autotagBtn = root.querySelector("[data-cc-autotag]"), autotagStatus = root.querySelector("[data-cc-autotag-status]"), presetEl = root.querySelector("[data-cc-preset]");
    const setStatus = (msg) => {
      statusEl && (statusEl.textContent = msg);
    }, splitNames = (v) => String(v || "").split(/[,/\n]/).map((Q) => Q.trim()).filter(Boolean);
    const applyPreset = (f) => {
      const x = String(f || "");
      const I = x.startsWith("G::")
        ? enabledGlobalsForCharacter().find((R) => w(R?.name || "", 200) === x.slice(3))
        : x.startsWith("U::") || x.startsWith("S::")
          ? (t.charactersSession || []).find((R) => w(R?.name || "", 200) === x.slice(3))
          : null;
      if (!I) return;
      const R = Array.isArray(I.aliases) ? I.aliases.join(", ") : String(I.aliases || "");
      nameEl && (nameEl.value = w(I.name || "", 200));
      originalEl && (originalEl.value = w(I.original || "", 400));
      surnameEl && (surnameEl.value = w(I.surname || "", 200));
      givenEl && (givenEl.value = w(I.given_name || "", 200));
      surnameVariantsEl && (surnameVariantsEl.value = Array.isArray(I.surname_variants) ? I.surname_variants.join(", ") : String(I.surname_variants || ""));
      givenVariantsEl && (givenVariantsEl.value = Array.isArray(I.given_name_variants) ? I.given_name_variants.join(", ") : String(I.given_name_variants || ""));
      aliasesEl && (aliasesEl.value = R);
      appearanceEl && (appearanceEl.value = w(I.appearance || "", 4e3));
      attireEl && (attireEl.value = w(I.attire || "", 4e3));
      accessoriesEl && (accessoriesEl.value = w(I.accessories || "", 4e3));
      attireLockedEl && (attireLockedEl.checked = !!I.attire_locked);
      accLockedEl && (accLockedEl.checked = !!I.accessories_locked);
      if (priorityEl && Number.isFinite(Number(I.priority))) priorityEl.value = String(Number(I.priority) || 0);
      setStatus(`[${x.slice(0, 1)}] ${I.name} 불러옴 · 수정 후 저장하세요`);
    };
    presetEl?.addEventListener("change", () => {
      applyPreset(presetEl.value);
    });
    const setAutotagFocus = (on, label = "선택됨 · Ctrl+V") => {
      t.autotagFocus = on ? { scope: "modal", id: "char-create" } : null;
      if (autotagBtn) autotagBtn.textContent = on ? "붙여넣기 대기" : "오토태그";
      if (autotagStatus) autotagStatus.textContent = on ? "이 팝업 선택됨 · Ctrl+V · 더블클릭=파일" : "클릭=붙여넣기 대상 · 더블클릭=파일", autotagStatus.style.color = on ? "#ffe7a8" : "#c9b56a";
    };
    const runAutotag = async (file) => {
      if (!file) return;
      setAutotagFocus(!0, "분석 중…");
      try {
        const tags = await Lt(file, autotagStatus);
        appearanceEl && (appearanceEl.value = tags.appearance || "");
        attireEl && (attireEl.value = tags.attire || "");
        accessoriesEl && (accessoriesEl.value = tags.accessories || "");
        setStatus("오토태그 반영됨 · 외형/의상/악세 · 저장하세요"), setAutotagFocus(!0, "완료");
      } catch (err) {
        setStatus(`오토태그 실패: ${z(err?.message || err, 80)}`), setAutotagFocus(!0, "실패");
      }
    };
    autotagBtn?.addEventListener("click", (ev) => {
      ev.preventDefault(), ev.stopPropagation();
      const on = t.autotagFocus?.scope === "modal" && t.autotagFocus?.id === "char-create";
      setAutotagFocus(!on);
    }), autotagBtn?.addEventListener("dblclick", (ev) => {
      ev.preventDefault(), ev.stopPropagation(), setAutotagFocus(!0);
      const input = document.createElement("input");
      input.type = "file", input.accept = "image/*", input.style.display = "none", document.body.appendChild(input), input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.remove(), file && await runAutotag(file);
      }), input.click();
    }), root.addEventListener("paste", async (ev) => {
      if (!(t.autotagFocus?.scope === "modal" && t.autotagFocus?.id === "char-create")) return;
      const item = Array.from(ev.clipboardData?.items || []).find((R) => R.type.startsWith("image/"));
      if (!item) return;
      ev.preventDefault();
      const file = item.getAsFile();
      file && await runAutotag(file);
    });
    const save = async () => {
      const name = w(nameEl?.value || "", 200);
      if (!name) return setStatus("이름이 비어 있습니다");
      const live = await Z({ useOverride: !1 }).catch(() => null);
      const rosterMeta = rosterResolved || t._viewerRoster || await resolveViewerRosterSession().catch(() => null);
      const rosterSessionId = rosterMeta?.rosterSessionId || live?.sessionId || "";
      if (!rosterSessionId) return setStatus("세션 없음");
      const edited = {
        id: `new_${Date.now()}`,
        name,
        original: w(originalEl?.value || "", 400),
        aliases: (() => {
          const g = splitNames(aliasesEl?.value);
          return g.length ? g : [name];
        })(),
        surname: w(surnameEl?.value || "", 200),
        given_name: w(givenEl?.value || "", 200),
        surname_variants: splitNames(surnameVariantsEl?.value),
        given_name_variants: splitNames(givenVariantsEl?.value),
        appearance: w(appearanceEl?.value || "", 4e3),
        attire: w(attireEl?.value || "", 4e3),
        accessories: w(accessoriesEl?.value || "", 4e3),
        attire_locked: !!attireLockedEl?.checked,
        accessories_locked: !!accLockedEl?.checked,
        priority: Number(priorityEl?.value || 0) || 0
      };
      try {
        setStatus("저장 중…");
        let res;
        // Always create on the live chat — unified is view-only for adds.
        res = await K("/v1/characters", {
          method: "POST",
          body: {
            session_id: live?.sessionId || rosterSessionId,
            scope: live?.sessionId || rosterSessionId,
            character: edited
          }
        }, 15e3);
        if (rosterMeta?.rosterUnified && rosterMeta.unifiedScope) {
          try {
            await ensureUnifiedRoster(rosterMeta.unifiedScope);
          } catch {
          }
        }
        t.charactersSession = res?.characters || t.charactersSession, t.charactersGlobal = res?.global || t.charactersGlobal, t.appearance = res?.appearance || t.appearance;
        if (rosterMeta?.rosterUnified) t.charactersSession = t.charactersSession;
        const saved = (t.charactersSession || []).find((row) => w(row?.name || "", 200).toLowerCase() === name.toLowerCase()) || edited;
        y("info", "char.create", `${name} → live`), await closeCharacterCreateModal(), typeof opts.onCreated == "function" && await opts.onCreated(saved);
      } catch (err) {
        y("error", "char.create.fail", err?.message || err), setStatus(`저장 실패: ${z(err?.message || err, 80)}`);
      }
    };
    root.querySelector("[data-cc-save]")?.addEventListener("click", (ev) => {
      ev.preventDefault(), save().catch(() => {
      });
    }), root.querySelector("[data-cc-cancel]")?.addEventListener("click", (ev) => {
      ev.preventDefault(), closeCharacterCreateModal().catch(() => {
      });
    }), root.querySelector("[data-cc-x]")?.addEventListener("click", (ev) => {
      ev.preventDefault(), closeCharacterCreateModal().catch(() => {
      });
    }), (() => {
      const backdrop = root.querySelector("[data-cc-backdrop]");
      if (!backdrop) return;
      let downOnBackdrop = !1;
      backdrop.addEventListener("pointerdown", (ev) => {
        downOnBackdrop = ev.target === backdrop;
      });
      backdrop.addEventListener("click", (ev) => {
        const ok = ev.target === backdrop && downOnBackdrop;
        downOnBackdrop = !1, ok && closeCharacterCreateModal().catch(() => {
        });
      });
    })(), root.querySelector("[data-cc-card]")?.addEventListener("click", (ev) => ev.stopPropagation());
    t.charCreateUi = { root, openedContainer: opened, slotIndex: opts.slotIndex };
    try {
      nameEl?.focus?.();
    } catch {
    }
  }
  async function openCardTagEdit(e) {
    if (!e?.id) return;
    if (typeof document > "u" || !document.body) {
      y("error", "card.tags.open", "plugin document unavailable");
      return;
    }
    await closeCharacterCreateModal().catch(() => null);
    await closeCardTagEdit(), await xe();
    try {
      await ensureViewerRosterLoaded();
    } catch {
    }
    const MAX = 6, field = "width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;padding:8px 10px;font:12px/1.4 Segoe UI,sans-serif", foldBox = "border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);padding:10px 12px", foldSum = "cursor:pointer;list-style:none;font-weight:700;font-size:12px;color:#d7deea;display:flex;align-items:center;justify-content:space-between;gap:8px;user-select:none", PERSON_COUNT_RE = /^\d+\+?(?:girls?|boys?|people|person)$/i, BARE_PERSON_RE = /^(?:girls?|boys?|people|person|solo)$/i, FEMALE_RE = /\b(?:\d+\+?)?girls?\b|\bwom(?:an|en)\b|\bfemale\b|\blady\b|\bladies\b|\bmilf\b|\bloli\b|\bmaiden\b/gi, MALE_RE = /\b(?:\d+\+?)?boys?\b|\bm(?:a|e)n\b|\bmale\b|\bguys?\b|\bgentleman\b|\botoko\b/gi, settingsMode = (() => {
      const Vt = t.backendSettings?.card || {}, Xt = String(Vt.person_tag_mode || "").toLowerCase();
      return ["gender", "girls", "people", "off"].includes(Xt) ? Xt : Vt.auto_person_tags === !1 ? "off" : "gender";
    })(), roster = (() => {
      const Vt = [], Xt = /* @__PURE__ */ new Set(), Yt = (Gt, Kt) => {
        for (const Qt of Gt || []) {
          const me = w(Qt?.name || "", 200);
          if (!me) continue;
          const nn = me.toLowerCase();
          if (Xt.has(nn)) continue;
          Xt.add(nn);
          const Le = [w(Qt.appearance || "", 4e3), w(Qt.attire || "", 4e3), w(Qt.accessories || "", 4e3)].filter(Boolean).join(", ") || w(Qt.tags || "", 4e3) || w(Qt.prompt || "", 4e3);
          Vt.push({
            name: me,
            prompt: Le,
            appearance: w(Qt.appearance || "", 4e3),
            attire: w(Qt.attire || "", 4e3),
            accessories: w(Qt.accessories || "", 4e3),
            scope: Kt,
            id: String(Qt.id || me)
          });
        }
      };
      return Yt(enabledGlobalsForCharacter(), "G"), Yt(t.charactersSession, t._viewerRoster?.rosterUnified ? "U" : "S"), Vt;
    })();
    let slots = (Array.isArray(e.characters) ? e.characters : []).slice(0, MAX).map((Vt) => ({
      name: w(Vt?.name || "", 200),
      prompt: w(Vt?.prompt || "", 4e3),
      raw: Vt && typeof Vt == "object" ? {
        ...Vt
      } : {},
      open: !0
    }));
    // Refresh looks from live roster so base modal shows updated appearance/attire without tab switch.
    for (const slot of slots) {
      const nm = w(slot.name || "", 200);
      if (!nm) continue;
      const match = roster.find((r) => r.name.toLowerCase() === nm.toLowerCase());
      if (!match) continue;
      const looks = match.prompt || [match.appearance, match.attire, match.accessories].filter(Boolean).join(", ");
      if (!looks) continue;
      const raw = slot.raw && typeof slot.raw === "object" ? slot.raw : {};
      const shotBits = [w(raw.expression || "", 400), w(raw.action || "", 400), w(raw.sex || "", 200)].filter(Boolean).join(", ");
      slot.prompt = shotBits ? `${looks}, ${shotBits}` : looks;
    }
    slots.length || (slots = [{
      name: "",
      prompt: "",
      raw: {},
      open: !0
    }]);
    const opened = !t.uiOpen, paraKeep = Number(e.paragraph), shotKeep = Number(e.shot_index), stripPersonCountTags = (Vt) => String(Vt || "").split(",").map((Xt) => Xt.trim()).filter((Xt) => Xt && !PERSON_COUNT_RE.test(Xt) && !BARE_PERSON_RE.test(Xt)).join(", "), formatCountTag = (Vt, Xt, Yt, Gt) => Vt <= 0 ? "" : Vt === 1 ? Xt : Vt <= 5 ? `${Vt}${Yt}` : Gt, classifyGender = (Vt) => {
      const Xt = String(Vt || "");
      if (!Xt.trim()) return null;
      const Yt = (Xt.match(FEMALE_RE) || []).length, Gt = (Xt.match(MALE_RE) || []).length;
      return Yt > Gt ? "f" : Gt > Yt ? "m" : null;
    }, personTagsForSlots = (Vt, Xt) => {
      const Yt = (Vt || []).filter((me) => w(me.name || "") || w(me.prompt || "")), Gt = Yt.length;
      if (!Gt || Xt === "off") return "";
      if (Xt === "girls") return formatCountTag(Gt, "1girl", "girls", "6+girls");
      if (Xt === "people") return formatCountTag(Gt, "1person", "people", "6+people");
      let Kt = 0, Qt = 0;
      for (const me of Yt) {
        const nn = w(me.name || "", 200), Le = roster.find((ut) => ut.name.toLowerCase() === nn.toLowerCase()), ut = classifyGender([Le?.appearance, Le?.attire, me.prompt, me.name].filter(Boolean).join(", "));
        ut === "f" ? Kt += 1 : ut === "m" && (Qt += 1);
      }
      return [formatCountTag(Kt, "1girl", "girls", "6+girls"), formatCountTag(Qt, "1boy", "boys", "6+boys")].filter(Boolean).join(", ");
    };
    opened && typeof k.showContainer == "function" && (await k.showContainer("fullscreen"), document.body.style.cssText = "margin:0;min-height:100vh;background:transparent;font:13px/1.45 Segoe UI,sans-serif;color:#e2e8f0;");
    const root = document.createElement("div"), initMode = settingsMode === "off" ? "gender" : settingsMode, initAuto = settingsMode !== "off";
    root.id = "nx-card-tag-modal", root.setAttribute("data-ct-root", "1"), root.innerHTML = [
      '<div data-ct-backdrop style="position:fixed;inset:0;z-index:100000;background:rgba(4,8,16,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;">',
      '<div data-ct-card style="width:min(620px,100%);max-height:min(90vh,860px);display:flex;flex-direction:column;overflow:hidden;background:linear-gradient(165deg,#1a1f2e,#0c1018);border:1px solid rgba(151,139,255,.4);border-radius:16px;box-shadow:0 28px 80px rgba(0,0,0,.55);">',
      '<div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08)">',
      `<div><div style="font-weight:700;font-size:15px">샷 태그 수정</div><div style="margin-top:3px;color:#9aa6b8;font-size:11px">P${e.paragraph ?? "?"} · ${h(String(e.id || "").slice(0, 8))} · 저장 / 저장·리롤</div></div>`,
      '<button type="button" data-ct-x style="cursor:pointer;border:0;background:rgba(255,255,255,.08);color:#e2e8f0;padding:6px 10px;border-radius:8px">✕</button>',
      "</div>",
      '<div data-ct-body style="flex:1;min-height:0;overflow:auto;padding:14px 16px;display:grid;gap:10px;align-content:start">',
      `<details data-ct-fold="base" open style="${foldBox}"><summary style="${foldSum}"><span>base 태그</span><span style="font-weight:500;color:#778398;font-size:11px">접기/펼치기</span></summary><div style="margin-top:8px;display:grid;gap:8px"><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:#d7deea;font-size:11px;font-weight:600;padding:5px 9px;border-radius:999px;border:1px solid rgba(124,108,255,.35);background:rgba(124,108,255,.12)"><input data-ct-auto-person type="checkbox" ${initAuto ? "checked" : ""} style="accent-color:#7c6cff">인원수 태그 자동</label><select data-ct-person-mode style="min-width:150px;${field}"><option value="gender" ${initMode === "gender" ? "selected" : ""}>성별 1girl/1boy</option><option value="girls" ${initMode === "girls" ? "selected" : ""}>인원 → girls</option><option value="people" ${initMode === "people" ? "selected" : ""}>인원 → people</option></select><button type="button" data-ct-person-apply style="cursor:pointer;border:0;background:#334155;color:#fff;padding:7px 10px;border-radius:8px;font:11px Segoe UI,sans-serif">지금 적용</button><span data-ct-person-hint style="color:#778398;font-size:10px;flex:1;min-width:140px">켜면 base 앞 인원태그 정리 후 char 수에 맞게 삽입</span></div><textarea data-ct-base rows="4" style="${field};font:12px/1.45 Segoe UI,sans-serif;resize:vertical;min-height:96px">${h(e.main_prompt || "")}</textarea></div></details>`,
      `<details data-ct-fold="neg" style="${foldBox}"><summary style="${foldSum}"><span>네거티브</span><span style="font-weight:500;color:#778398;font-size:11px">기본 접힘</span></summary><div style="margin-top:8px"><textarea data-ct-neg rows="2" style="${field};font:12px/1.45 Segoe UI,sans-serif;resize:vertical;min-height:56px">${h(e.negative_prompt || "")}</textarea></div></details>`,
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px"><div style="font-weight:700;font-size:12px;color:#d7deea">캐릭터 슬롯</div><div data-ct-count style="color:#778398;font-size:11px"></div></div>',
      '<div data-ct-slots style="display:grid;gap:10px"></div>',
      "</div>",
      '<div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-top:1px solid rgba(255,255,255,.08);background:rgba(8,12,20,.96)">',
      '<span data-ct-status style="color:#9aa6b8;font-size:11px">저장=태그 유지 · 저장·리롤=수정 태그로 재생성</span>',
      '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">',
      '<button type="button" data-ct-cancel style="cursor:pointer;border:0;background:#334155;color:#fff;padding:8px 12px;border-radius:9px;font:12px Segoe UI,sans-serif">취소</button>',
      '<button type="button" data-ct-save-only style="cursor:pointer;border:1px solid rgba(124,108,255,.45);background:rgba(124,108,255,.16);color:#e8e4ff;padding:8px 14px;border-radius:9px;font:600 12px Segoe UI,sans-serif">저장</button>',
      '<button type="button" data-ct-save style="cursor:pointer;border:0;background:#7c6cff;color:#fff;padding:8px 14px;border-radius:9px;font:600 12px Segoe UI,sans-serif">저장·리롤</button>',
      "</div></div></div></div>"
    ].join(""), document.body.appendChild(root);
    const baseEl = root.querySelector("[data-ct-base]"), negEl = root.querySelector("[data-ct-neg]"), statusEl = root.querySelector("[data-ct-status]"), slotsEl = root.querySelector("[data-ct-slots]"), countEl = root.querySelector("[data-ct-count]"), autoEl = root.querySelector("[data-ct-auto-person]"), modeEl = root.querySelector("[data-ct-person-mode]"), hintEl = root.querySelector("[data-ct-person-hint]"), setStatus = (Vt) => {
      statusEl && (statusEl.textContent = Vt);
    }, syncFromDom = () => {
      const Vt = [];
      for (let Xt = 0; Xt < slots.length; Xt += 1) {
        const Yt = root.querySelector(`[data-ct-name="${Xt}"]`), Gt = root.querySelector(`[data-ct-prompt="${Xt}"]`), Kt = root.querySelector(`details[data-ct-slotfold="${Xt}"]`);
        Vt.push({
          name: w(Yt?.value || slots[Xt]?.name || "", 200),
          prompt: w(Gt?.value || slots[Xt]?.prompt || "", 4e3),
          raw: slots[Xt]?.raw && typeof slots[Xt].raw == "object" ? {
            ...slots[Xt].raw
          } : {},
          open: Kt ? !!Kt.open : slots[Xt]?.open !== !1
        });
      }
      slots = Vt;
    }, currentMode = () => {
      const Vt = String(modeEl?.value || "gender");
      return ["gender", "girls", "people"].includes(Vt) ? Vt : "gender";
    }, applyAutoPerson = (Vt = !1) => {
      if (!baseEl) return "";
      if (!autoEl?.checked) {
        Vt && setStatus("인원수 태그 자동 꺼짐");
        return "";
      }
      syncFromDom();
      const Xt = currentMode(), Yt = personTagsForSlots(slots, Xt), Gt = stripPersonCountTags(baseEl.value || ""), Kt = Yt ? Yt + (Gt ? `, ${Gt}` : "") : Gt;
      return baseEl.value = Kt, hintEl && (hintEl.textContent = Yt ? `적용: ${Yt}` : "채울 char가 없어 인원태그 없음"), Vt && setStatus(Yt ? `인원수 태그 적용 · ${Yt}` : "인원수 태그 없음"), Yt;
    }, pickOptions = (Vt) => {
      const Xt = [`<option value="">선택…</option>`, `<option value="__add_character__">캐릭터 추가++</option>`];
      for (const Yt of roster) {
        const Gt = Vt && Yt.name.toLowerCase() === String(Vt).toLowerCase() ? " selected" : "";
        Xt.push(`<option value="${h(Yt.name)}"${Gt}>[${Yt.scope}] ${h(Yt.name)}</option>`);
      }
      return Xt.join("");
    }, previewOf = (Vt) => {
      const Xt = w(Vt?.name || "", 200), Yt = w(Vt?.prompt || "", 80);
      return Xt ? Yt ? `${Xt} · ${Yt}` : Xt : Yt || "비어 있음";
    }, rebuildRosterList = () => {
      roster.length = 0;
      const Xt = /* @__PURE__ */ new Set(), Yt = (Gt, Kt) => {
        for (const Qt of Gt || []) {
          const me = w(Qt?.name || "", 200);
          if (!me) continue;
          const nn = me.toLowerCase();
          if (Xt.has(nn)) continue;
          Xt.add(nn);
          const Le = [w(Qt.appearance || "", 4e3), w(Qt.attire || "", 4e3), w(Qt.accessories || "", 4e3)].filter(Boolean).join(", ") || w(Qt.tags || "", 4e3) || w(Qt.prompt || "", 4e3);
          roster.push({
            name: me,
            prompt: Le,
            appearance: w(Qt.appearance || "", 4e3),
            attire: w(Qt.attire || "", 4e3),
            accessories: w(Qt.accessories || "", 4e3),
            scope: Kt,
            id: String(Qt.id || me)
          });
        }
      };
      Yt(enabledGlobalsForCharacter(), "G"), Yt(t.charactersSession, t._viewerRoster?.rosterUnified ? "U" : "S");
    }, renderSlots = () => {
      if (!slotsEl) return;
      countEl && (countEl.textContent = `${slots.length} / ${MAX}`), slotsEl.innerHTML = slots.map((Vt, Xt) => `<details data-ct-slotfold="${Xt}" ${Vt.open === !1 ? "" : "open"} style="${foldBox}"><summary style="${foldSum}"><span>char${Xt + 1}<span style="font-weight:500;color:#9aa6b8;margin-left:8px">${h(previewOf(Vt))}</span></span><span style="display:flex;gap:6px;align-items:center"><button type="button" data-ct-del="${Xt}" ${slots.length <= 1 ? "disabled" : ""} style="cursor:${slots.length <= 1 ? "not-allowed" : "pointer"};border:0;background:${slots.length <= 1 ? "rgba(255,255,255,.04)" : "rgba(248,113,113,.16)"};color:${slots.length <= 1 ? "#64748b" : "#fecaca"};padding:4px 9px;border-radius:8px;font:11px Segoe UI,sans-serif">삭제</button><span style="font-weight:500;color:#778398;font-size:11px">접기</span></span></summary><div style="margin-top:10px;display:grid;gap:8px"><div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(140px,.9fr);gap:8px;align-items:end"><label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px"><span>이름</span><input data-ct-name="${Xt}" value="${h(Vt.name || "")}" style="${field}"></label><label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px"><span>캐릭터</span><select data-ct-pick="${Xt}" style="${field}">${pickOptions(Vt.name)}</select></label></div><label style="display:grid;gap:4px;color:#9aa6b8;font-size:11px"><span>캐릭터 태그 (prompt)</span><textarea data-ct-prompt="${Xt}" rows="3" style="${field};resize:vertical;min-height:68px">${h(Vt.prompt || "")}</textarea></label></div></details>`).join("") + (slots.length < MAX ? `<button type="button" data-ct-add style="cursor:pointer;border:1px dashed rgba(255,255,255,.22);background:rgba(255,255,255,.03);color:#c7d2fe;padding:10px 12px;border-radius:12px;font:600 12px Segoe UI,sans-serif">+ char 추가 · ${slots.length + 1}/${MAX}</button>` : '<div style="color:#64748b;font-size:11px;text-align:center;padding:4px 0">최대 6명까지</div>');
      slotsEl.querySelectorAll("[data-ct-del]").forEach((Vt) => {
        Vt.addEventListener("click", (Xt) => {
          Xt.preventDefault(), Xt.stopPropagation();
          const Yt = Number(Vt.getAttribute("data-ct-del"));
          if (!Number.isFinite(Yt) || slots.length <= 1) return;
          syncFromDom(), slots.splice(Yt, 1), renderSlots(), applyAutoPerson(!0), setStatus(`char${Yt + 1} 삭제됨`);
        });
      }), slotsEl.querySelectorAll("[data-ct-pick]").forEach((Vt) => {
        Vt.addEventListener("change", () => {
          const Xt = Number(Vt.getAttribute("data-ct-pick")), Yt = String(Vt.value || "");
          if (Yt === "__add_character__") {
            Vt.value = "";
            openCharacterCreateModal({
              slotIndex: Xt,
              onCreated: async (created) => {
                await ensureViewerRosterLoaded().catch(() => null);
                rebuildRosterList();
                syncFromDom();
                if (slots[Xt] && created?.name) {
                  const Gt = roster.find((me) => me.name.toLowerCase() === String(created.name).toLowerCase()) || {
                    name: created.name,
                    prompt: [created.appearance, created.attire, created.accessories].filter(Boolean).join(", ")
                  };
                  slots[Xt].name = Gt.name, slots[Xt].prompt = Gt.prompt || slots[Xt].prompt, slots[Xt].open = !0;
                }
                renderSlots(), applyAutoPerson(!1), setStatus(`캐릭터 추가됨 · ${created?.name || ""}`);
              }
            }).catch((err) => setStatus(`추가 실패: ${z(err?.message || err, 80)}`));
            return;
          }
          const Gt = roster.find((me) => me.name === Yt);
          if (syncFromDom(), !slots[Xt]) return;
          if (Gt) {
            slots[Xt].name = Gt.name, slots[Xt].prompt = Gt.prompt || slots[Xt].prompt, slots[Xt].open = !0;
            const Kt = root.querySelector(`[data-ct-name="${Xt}"]`), Qt = root.querySelector(`[data-ct-prompt="${Xt}"]`);
            Kt && (Kt.value = Gt.name), Qt && (Qt.value = Gt.prompt || ""), applyAutoPerson(!1), setStatus(`[${Gt.scope}] ${Gt.name} 적용됨 · 저장하세요`);
          }
        });
      });
      const Vt = slotsEl.querySelector("[data-ct-add]");
      Vt && Vt.addEventListener("click", (Xt) => {
        Xt.preventDefault(), Xt.stopPropagation(), syncFromDom(), slots.length >= MAX || (slots.push({
          name: "",
          prompt: "",
          raw: {},
          open: !0
        }), renderSlots(), applyAutoPerson(!0), setStatus(`char${slots.length} 추가됨`));
      }), applyAutoPerson(!1);
    }, collectPayload = () => {
      syncFromDom(), applyAutoPerson(!1);
      const Vt = [];
      for (let Yt = 0; Yt < slots.length; Yt += 1) {
        const Gt = slots[Yt], Kt = w(Gt.name || "", 200), Qt = w(Gt.prompt || "", 4e3);
        if (!Kt && !Qt) continue;
        Vt.push({
          ...(Gt.raw && typeof Gt.raw == "object" ? Gt.raw : {}),
          name: Kt || `char${Yt + 1}`,
          prompt: Qt || "girl"
        });
      }
      return {
        main_prompt: w(baseEl?.value || "", 8e3),
        negative_prompt: w(negEl?.value || "", 8e3),
        characters: Vt
      };
    }, refreshGalleryAfterTagSave = async (cardId, keepPara, keepShot, nextId = "") => {
      const Kt = await Z({ useOverride: !1 }).catch(() => null);
      if (Kt?.sessionId && await ce(Kt.sessionId, !0), t.galleryUi) {
        const Qt = t.selectedMessage ? ke(t.selectedMessage) : t.galleryUi.items || [], me = nextId ? Qt.findIndex((nn) => nn.id === nextId) : -1, nn = me >= 0 ? me : Qt.findIndex((Le) => Number(Le.paragraph) === keepPara && Number(Le.shot_index) === keepShot);
        nn >= 0 && (t.galleryUi.index = nn), t.galleryUi.renderGal && await t.galleryUi.renderGal();
      }
      try {
        await he();
      } catch {
      }
    }, saveOnly = async () => {
      const payload = collectPayload(), cardId = e.id, keepPara = paraKeep, keepShot = shotKeep;
      try {
        setStatus("저장 중…"), await K(`/v1/cards/${encodeURIComponent(cardId)}/tags`, {
          method: "POST",
          body: payload
        }, 15e3), y("info", "card.tags.save", `${String(cardId).slice(0, 8)} chars=${payload.characters.length} only`), await closeCardTagEdit(), await refreshGalleryAfterTagSave(cardId, keepPara, keepShot, cardId), t.galleryUi?.status?.setTextContent && await t.galleryUi.status.setTextContent(`태그 저장됨 · ${String(cardId).slice(0, 8)}`);
      } catch (Yt) {
        y("error", "card.tags.save.fail", Yt?.message || Yt);
        try {
          t.cardTagUi?.root && setStatus(`실패: ${z(Yt?.message || Yt, 80)}`);
        } catch {
        }
      }
    }, save = async () => {
      const payload = collectPayload(), cardId = e.id, keepPara = paraKeep, keepShot = shotKeep;
      try {
        setStatus("저장 중…"), await K(`/v1/cards/${encodeURIComponent(cardId)}/tags`, {
          method: "POST",
          body: payload
        }, 15e3), y("info", "card.tags.save", `${String(cardId).slice(0, 8)} chars=${payload.characters.length} autoPerson=${!!autoEl?.checked}`), await closeCardTagEdit();
        const Yt = await withImageRerollToast("태그 저장 후 리롤 중…", async () => await K(`/v1/cards/${encodeURIComponent(cardId)}/reroll`, {
          method: "POST",
          body: {
            mode: "nai",
            overrides: {
              main_prompt: payload.main_prompt,
              negative_prompt: payload.negative_prompt,
              characters: payload.characters
            }
          }
        }, 18e4)), Gt = String(Yt?.card?.id || "");
        await refreshGalleryAfterTagSave(cardId, keepPara, keepShot, Gt), t.galleryUi?.status?.setTextContent && await t.galleryUi.status.setTextContent(`저장·리롤 완료 · ${String(Gt || cardId).slice(0, 8)}`), y("info", "card.tags.reroll", `${String(cardId).slice(0, 8)}→${String(Gt).slice(0, 8)}`);
      } catch (Yt) {
        y("error", "card.tags.save.fail", Yt?.message || Yt);
        try {
          t.cardTagUi?.root && setStatus(`실패: ${z(Yt?.message || Yt, 80)}`);
        } catch {
        }
        t.galleryUi?.status?.setTextContent && await t.galleryUi.status.setTextContent(`저장·리롤 실패: ${z(Yt?.message || Yt, 80)}`);
      }
    };
    autoEl?.addEventListener("change", () => {
      applyAutoPerson(!0);
    }), modeEl?.addEventListener("change", () => {
      autoEl?.checked && applyAutoPerson(!0);
    }), root.querySelector("[data-ct-person-apply]")?.addEventListener("click", (Vt) => {
      Vt.preventDefault(), Vt.stopPropagation(), autoEl && (autoEl.checked = !0), applyAutoPerson(!0);
    }), root.querySelector("[data-ct-save]")?.addEventListener("click", (Vt) => {
      Vt.preventDefault(), Vt.stopPropagation(), save().catch(() => {
      });
    }), root.querySelector("[data-ct-save-only]")?.addEventListener("click", (Vt) => {
      Vt.preventDefault(), Vt.stopPropagation(), saveOnly().catch(() => {
      });
    }), root.querySelector("[data-ct-cancel]")?.addEventListener("click", (Vt) => {
      Vt.preventDefault(), closeCardTagEdit().catch(() => {
      });
    }), root.querySelector("[data-ct-x]")?.addEventListener("click", (Vt) => {
      Vt.preventDefault(), Vt.stopPropagation(), saveOnly().catch(() => {
      });
    }), (() => {
      const backdrop = root.querySelector("[data-ct-backdrop]");
      if (!backdrop) return;
      let downOnBackdrop = !1;
      backdrop.addEventListener("pointerdown", (Vt) => {
        downOnBackdrop = Vt.target === backdrop;
      });
      backdrop.addEventListener("pointercancel", () => {
        downOnBackdrop = !1;
      });
      backdrop.addEventListener("click", (Vt) => {
        const ok = Vt.target === backdrop && downOnBackdrop;
        downOnBackdrop = !1;
        ok && saveOnly().catch(() => {
        });
      });
    })(), root.querySelector("[data-ct-card]")?.addEventListener("click", (Vt) => Vt.stopPropagation()), renderSlots(), t.cardTagUi = {
      root,
      cardId: e.id,
      openedContainer: opened
    };
    try {
      baseEl?.focus?.();
    } catch {
    }
    y("info", "card.tags.open", `P${e.paragraph ?? "?"} ${String(e.id).slice(0, 8)} roster=${roster.length} autoPerson=${initAuto}`);
  }

  async function st() {
    await closeCardTagEdit(), await xe();
    const e = t.galleryUi;
    try {
      e?._spinTimer && clearInterval(e._spinTimer);
    } catch {
    }
    if (e?._thumbWheel && e?._thumbWheelTargets?.length) {
      for (const target of e._thumbWheelTargets) {
        try {
          target?.removeEventListener?.("wheel", e._thumbWheel, !0);
        } catch {
        }
      }
    }
    if (e?.wheelId != null && e?.doc?.removeEventListener) try {
      await D("rmGalWheel", () => e.doc.removeEventListener(e.wheelId), null);
    } catch {
    }
    if (e?._winResizeBound && e?._onWinResize && typeof window < "u") try {
      window.removeEventListener("resize", e._onWinResize);
    } catch {
    }
    e?.pointerId != null && e?.doc?.removeEventListener && await D("rmGalPtr", () => e.doc.removeEventListener(e.pointerId), null), e?.pointerUpId != null && e?.doc?.removeEventListener && await D("rmGalPtrUp", () => e.doc.removeEventListener(e.pointerUpId), null), e?.dblId != null && e?.doc?.removeEventListener && await D("rmGalDbl", () => e.doc.removeEventListener(e.dblId), null), e?.previewDblId != null && await de(e.preview, "dblclick", e.previewDblId), e?.presetChangeId != null && await de(e.presetSelect, "change", e.presetChangeId), e?.presetInputId != null && await de(e.presetSelect, "input", e.presetInputId), await rt(V), t.galleryUi = null, t.viewerOpen = !1;
  }
  async function lt() {
    if (t.uiOpen) return;
    if (t.galleryUi?.root) {
      t.galleryUi.renderGal && await t.galleryUi.renderGal();
      return;
    }
    const e = await ue();
    if (!e) return;
    const n = await Ee(e);
    if (!n || typeof e.createElement != "function") return;
    await st();
    const o = await Aa(), iconGeoInit = await loadViewerIconGeo(), minimizedInit = await loadViewerMinimized(), castOpenInit = await Pa();
    t.viewerMinimized = minimizedInit;
    // Toolbar mode stays at the expanded window spot; only icon mode parks at iconGeo.
    const startGeo = minimizedInit ? clampViewerGeo(viewerMinimizeMode() === "toolbar" ? o : {
      ...o,
      left: iconGeoInit.left,
      top: iconGeoInit.top
    }, !0) : o;
    const a = await H(e, "div", {
      className: V,
      style: "position:fixed;left:0;top:0;width:0;height:0;z-index:99990;pointer-events:none;"
    });
    await n.appendChild(a);
    const r = await H(e, "div", { style: Ft(startGeo, minimizedInit) }), i = await H(e, "div", { style: "height:36px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 10px;background:rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.06);cursor:move;user-select:none;flex-shrink:0;touch-action:none;" }), s = await H(e, "span", {
      style: "font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto;min-width:0;",
      html: "Inlay Viewer"
    }), viewerPresetLabel = (() => {
      const card = kt(t.backendSettings?.card || {}), presets = Array.isArray(card.presets) ? card.presets : [], activeId = resolveActivePresetId(card), active = presets.find((p) => presetIdEq(p.id, activeId));
      const name = String(active?.name || (presets.length ? "프리셋" : "없음"));
      return `${name.length > 12 ? `${name.slice(0, 11)}…` : name} ▾`;
    })(), viewerPresetBtn = await H(e, "span", {
      // Risu SafeDOM blocks change/input events — use clickable control + pointer hit-test instead of <select>.
      style: "max-width:140px;min-width:88px;flex:0 1 140px;height:26px;border-radius:7px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;font-size:11px;padding:0 8px;cursor:pointer;pointer-events:auto;display:inline-flex;align-items:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box;",
      text: viewerPresetLabel
    }), viewerPresetMenu = await H(e, "div", {
      style: "display:none;position:absolute;top:34px;left:10px;min-width:140px;max-width:220px;max-height:220px;overflow:auto;z-index:5;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;box-shadow:0 10px 28px rgba(0,0,0,.45);pointer-events:auto;",
      html: ""
    }), c = await H(e, "div", {
      style: "display:flex;gap:5px;align-items:center;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;",
      html: [
        '<span style="cursor:pointer;background:#475569;color:#fff;padding:4px 8px;border-radius:7px;font-size:11px;line-height:1">◀</span>',
        '<span style="cursor:pointer;background:#475569;color:#fff;padding:4px 8px;border-radius:7px;font-size:11px;line-height:1">▶</span>',
        '<span style="cursor:pointer;background:#0f766e;color:#fff;padding:4px 8px;border-radius:7px;font-size:11px;line-height:1" title="LLM 태그 재생성">태그</span>',
        '<span style="cursor:pointer;background:#7c6cff;color:#fff;padding:4px 8px;border-radius:7px;font-size:11px;line-height:1" title="이 메시지의 모든 샷 재생성">재생성</span>',
        `<span style="cursor:pointer;background:${Nt() ? "#0f766e" : "#334155"};color:#fff;padding:4px 8px;border-radius:7px;font-size:11px;line-height:1">${Nt() ? "상시ON" : "상시"}</span>`,
        `<span style="cursor:pointer;display:${(t.backendSettings?.card || {}).show_risu_settings_button !== !1 ? "inline-flex" : "none"};background:#334155;color:#dbe4f5;padding:4px 8px;border-radius:7px;font-size:11px;line-height:1;border:1px solid rgba(255,255,255,.12)">설정</span>`,
        `<span style="cursor:pointer;background:#1e293b;color:#dbe4f5;padding:4px 8px;border-radius:7px;font-size:11px;line-height:1;border:1px solid rgba(255,255,255,.12)">${minimizedInit ? "펼치기" : "접기"}</span>`
      ].join("")
    });
    await i.appendChild(s), await i.appendChild(viewerPresetBtn), await i.appendChild(c);
    const p = await H(e, "div", { style: "display:none;" }), m = await H(e, "div", { style: "display:none;", text: "" }), u = await H(e, "div", { style: "display:none;" });
    await p.appendChild(m), await p.appendChild(u);
    const b = await H(e, "div", { style: `flex:1;min-height:0;overflow:auto;padding:8px 10px;display:${minimizedInit ? "none" : "flex"};flex-direction:column;gap:6px;` }), S = await H(e, "div", {
      style: imageStageStyle(o),
      html: '<span style="color:#778398;font-size:12px">이미지 없음</span>'
    }), C = await H(e, "div", {
      style: "color:#a6b1c2;font-size:11px;flex-shrink:0;min-height:28px;max-height:40px;overflow:hidden;line-height:1.2;",
      text: "메시지를 클릭해서 선택하세요"
    // Native overflow-x so browser wheel / middle-drag autoscroll can move the strip.
    // (JS scrollLeft via SafeDOM is unreliable; custom window.wheel was also bound to the wrong window.)
    }), E = await H(e, "div", { style: "display:flex;gap:8px;overflow-x:auto;overflow-y:hidden;padding-bottom:2px;flex-shrink:0;min-height:92px;max-height:92px;align-items:center;width:100%;box-sizing:border-box;" }), j = await H(e, "div", { style: "display:flex;flex-wrap:nowrap;gap:6px;align-items:center;color:#a6b1c2;font-size:11px;flex:0 0 auto;min-height:34px;height:34px;max-height:34px;overflow:hidden;cursor:pointer;pointer-events:auto;box-sizing:border-box;" });
    await b.appendChild(S), await b.appendChild(C), await b.appendChild(E), await b.appendChild(j), await r.appendChild(i), await r.appendChild(viewerPresetMenu), await r.appendChild(p), await r.appendChild(b), await a.appendChild(r);
    const d = {
      doc: e,
      root: a,
      panel: r,
      header: i,
      bar: c,
      title: s,
      presetSelect: viewerPresetBtn,
      presetMenu: viewerPresetMenu,
      presetMenuOpen: !1,
      viewerPresetIds: [],
      status: C,
      preview: S,
      thumbs: E,
      meta: j,
      castPanel: p,
      castChips: u,
      castHint: m,
      castOpen: !1,
      bodyBox: b,
      minimized: minimizedInit,
      expandedH: Math.max(280, o.h || 560),
      expandedGeo: {
        left: o.left,
        top: o.top,
        w: o.w,
        h: o.h
      },
      iconGeo: {
        left: iconGeoInit.left,
        top: iconGeoInit.top
      },
      sizeLocked: !0,
      castEntries: [],
      geo: startGeo,
      index: 0,
      items: [],
      pointerId: null,
      drag: null,
      lastPreviewTap: 0,
      lastMainId: "",
      selectedCount: 0,
      _metaGen: 0,
      _metaCardId: "",
      metaHits: []
    };
    t.galleryUi = d, t.viewerOpen = !0;
    const galleryFocusOf = () => {
      const VC = globalThis.__INLAY_VIEWER_CORE__, all = Array.isArray(t.gallery) ? t.gallery : [];
      if (typeof VC?.galleryFocusMessage == "function") return VC.galleryFocusMessage(t.selectedMessage, t.lastImagedMessage, all);
      const sel = t.selectedMessage;
      if (sel && linkedCards(sel).length) return sel;
      return t.lastImagedMessage || sel;
    }, U = () => {
      const A = galleryFocusOf(), all = Array.isArray(t.gallery) ? t.gallery : [], order = globalThis.__INLAY_VIEWER_CORE__?.galleryForMessage;
      if (typeof order === "function") return order(all, A, 8);
      return A ? ke(A) : [...all].sort((x, y) => Number(y.created_at || 0) - Number(x.created_at || 0)).slice(0, 8);
    }, selectedCountOf = (items) => {
      const focus = galleryFocusOf(), fn = globalThis.__INLAY_VIEWER_CORE__?.gallerySelectedCount;
      if (typeof fn === "function") return fn(items, focus);
      if (!focus) return 0;
      return (items || []).filter((card) => (card?.content_hash && card.content_hash === focus.hash) || Number(card?.message_index) === Number(focus.chatIndex)).length;
    }, f = async () => {
      d.geo = clampViewerGeo(d.geo, d.minimized);
      let panelStyle = Ft(d.geo, d.minimized);
      // Toolbar-minimized keeps the same header controls; dropdown must escape the 40px bar.
      if (d.presetMenuOpen && (!d.minimized || viewerMinimizeMode() === "toolbar")) {
        panelStyle = panelStyle.replace(/overflow:[^;]+/i, "overflow:visible");
      }
      await r.setStyleAttribute(panelStyle);
      if (!d.minimized) try {
        await S.setStyleAttribute(imageStageStyle(d.geo));
      } catch {
      }
    }, applyViewerChrome = async () => {
      const mode = viewerMinimizeMode(), toolbarMin = d.minimized && mode === "toolbar", iconMin = d.minimized && mode === "icon";
      try {
        await s.setInnerHTML(iconMin ? "🖼️" : "Inlay Viewer"), await i.setStyleAttribute(`height:${iconMin ? 48 : toolbarMin ? 40 : 36}px;display:flex;align-items:center;justify-content:${iconMin ? "center" : "space-between"};gap:8px;padding:${iconMin ? "0" : "0 10px"};background:rgba(255,255,255,.04);border-bottom:${d.minimized && !toolbarMin ? "0" : "1px solid rgba(255,255,255,.06)"};cursor:move;user-select:none;flex-shrink:0;touch-action:none;`), await viewerPresetBtn.setStyleAttribute(`max-width:140px;min-width:88px;flex:0 1 140px;height:26px;border-radius:7px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;color:#e8eef8;font-size:11px;padding:0 8px;cursor:pointer;pointer-events:auto;display:${iconMin ? "none" : "inline-flex"};align-items:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box;`), await viewerPresetMenu.setStyleAttribute(`display:${!iconMin && d.presetMenuOpen ? "block" : "none"};position:absolute;top:34px;left:10px;min-width:140px;max-width:220px;max-height:220px;overflow:auto;z-index:5;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;box-shadow:0 10px 28px rgba(0,0,0,.45);pointer-events:auto;`), await c.setStyleAttribute(`display:${iconMin ? "none" : "flex"};gap:5px;align-items:center;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;`);
      } catch {
      }
      try {
        await b.setStyleAttribute(`flex:1;min-height:0;overflow:auto;padding:8px 10px;display:${d.minimized ? "none" : "flex"};flex-direction:column;gap:6px;`);
      } catch {
      }
      try {
        await p.setStyleAttribute("display:none;");
      } catch {
      }
      await f();
    }, x = async () => {
      if (d.minimized) {
        const left = Math.round(d.geo.left), top = Math.round(d.geo.top);
        if (viewerMinimizeMode() === "icon") {
          d.iconGeo = {
            left,
            top
          }, await saveViewerIconGeo(d.iconGeo);
        } else {
          // Toolbar: dragging the one-line bar moves the parked window itself.
          d.expandedGeo = {
            ...(d.expandedGeo || {
              w: d.geo.w,
              h: d.geo.h
            }),
            left,
            top
          }, await qt(d.expandedGeo);
        }
        d.geo = clampViewerGeo({
          ...d.expandedGeo,
          left,
          top
        }, !0), await f();
        return;
      }
      await v(), d.geo = clampViewerGeo(d.geo, !1), d.expandedGeo = {
        left: d.geo.left,
        top: d.geo.top,
        w: d.geo.w,
        h: d.geo.h
      }, await qt(d.geo), await f();
    }, I = async () => {
      try {
        const A = typeof k.unwarpSafeArray == "function" ? await k.unwarpSafeArray(await c.getChildren()) : [], inlineOn = Nt();
        // 0◀ 1▶ 2태그 3재생성 4상시 5설정 6접기
        const labels = [
          null,
          null,
          null,
          null,
          inlineOn ? "상시ON" : "상시",
          (t.backendSettings?.card || {}).show_risu_settings_button !== !1 ? "설정" : "",
          d.minimized ? "펼치기" : "접기"
        ], colors = [
          null,
          null,
          null,
          null,
          inlineOn ? "#0f766e" : "#334155",
          "#334155",
          "#1e293b"
        ];
        for (let idx = 4; idx <= 6; idx += 1) {
          const el = A[idx];
          if (!el) continue;
          if (idx === 5 && !labels[idx]) {
            typeof el.setStyleAttribute == "function" && await el.setStyleAttribute("display:none");
            continue;
          }
          typeof el.setInnerHTML == "function" && labels[idx] && await el.setInnerHTML(labels[idx]);
          typeof el.setStyleAttribute == "function" && colors[idx] && await el.setStyleAttribute(`cursor:pointer;${idx === 5 ? "display:inline-flex;" : ""}background:${colors[idx]};color:${idx === 4 ? "#fff" : "#dbe4f5"};padding:4px 8px;border-radius:7px;font-size:11px;line-height:1;border:1px solid rgba(255,255,255,.12)`);
        }
      } catch {
      }
    }, R = (A) => {
      const _ = Array.isArray(A?.characters) ? A.characters : [], O = [], G = /* @__PURE__ */ new Set();
      return _.forEach((B, W) => {
        const J = w(B?.name || B?.raw?.name || "", 200);
        if (!J) return;
        const Q = J.toLowerCase();
        if (G.has(Q)) return;
        G.add(Q);
        const me = Dt(J);
        O.push({
          index: W,
          name: me?.name || J,
          roster: me,
          prompt: w(B?.prompt || "", 400),
          scope: me?.scope || ""
        });
      }), O;
    }, g = async () => {
      d.castEntries = [];
      try {
        await p.setStyleAttribute("display:none;");
        await u.setInnerHTML("");
      } catch {
      }
      await I();
    };
    d.renderCast = g;
    d.applyChrome = applyViewerChrome;
    const F = async () => {
      await openCardTagEdit(U()[d.index]);
    }, toggleMinimizeBtn = async () => {
      const mode = viewerMinimizeMode();
      if (d.minimized) {
        const curLeft = Math.round(d.geo.left), curTop = Math.round(d.geo.top);
        if (mode === "icon") {
          d.iconGeo = {
            left: curLeft,
            top: curTop
          }, await saveViewerIconGeo(d.iconGeo);
        }
        const eg = d.expandedGeo || {
          left: se.left,
          top: se.top,
          w: se.w,
          h: Math.max(280, d.expandedH || 560)
        };
        // Toolbar expands in place; icon mode restores the saved expanded window spot.
        d.minimized = !1, d.geo = clampViewerGeo({
          ...eg,
          left: mode === "toolbar" ? curLeft : eg.left,
          top: mode === "toolbar" ? curTop : eg.top,
          h: Math.max(280, d.expandedH || eg.h || 560)
        }, !1);
      } else {
        try {
          const rect = await r.getBoundingClientRect();
          rect?.height > 80 && (d.expandedH = Math.max(280, rect.height), d.geo.h = d.expandedH);
        } catch {
        }
        d.expandedGeo = {
          left: Math.round(d.geo.left),
          top: Math.round(d.geo.top),
          w: Math.round(d.geo.w),
          h: Math.round(d.geo.h)
        }, await qt(d.expandedGeo);
        if (mode === "toolbar") {
          // Collapse in place — do not jump to floating-icon coordinates.
          d.minimized = !0, d.geo = clampViewerGeo({
            ...d.expandedGeo
          }, !0);
        } else {
          const ig = d.iconGeo || {
            ...iconSe
          };
          d.minimized = !0, d.geo = clampViewerGeo({
            ...d.expandedGeo,
            left: ig.left,
            top: ig.top
          }, !0);
        }
      }
      await saveViewerMinimized(d.minimized), await applyViewerChrome(), await I(), y("info", "viewer.minimize", d.minimized ? `min:${mode}` : `expand:${mode}`);
    }, paintStatus = async () => {
      const _ = Array.isArray(d.items) ? d.items : U(), O = t.selectedMessage, B = t.jobProgress, idx = readIndexProgress(B), busy = !!(B || O?.hash && t.jobsInFlight.has(O.hash) || idx.busy), extra = O ? `${_.length}장 · DOM#${O.domIndex}` : "";
      try {
        if (busy && (B || idx.busy)) await C.setInnerHTML(viewerStatusHtml(B || { state: "running", progress: idx.pct, message: idx.label }, extra));
        else if (O) await C.setInnerHTML(`<span style="color:#a6b1c2">${h(`${_.length}장 · DOM#${O.domIndex} · ${O.preview || ""}`)}</span>`);
        else await C.setInnerHTML(`<span style="color:#a6b1c2">메시지를 클릭해서 선택하세요</span>`);
      } catch {
      }
      // Toggle CSS spinner on main stage without waiting on image reload.
      try {
        const showSpin = !!(B && formatViewerJob(B)?.busy);
        if (showSpin !== d._mainBusyShown) {
          d._mainBusyShown = showSpin;
          const Q = _[d.index];
          if (Q && Ie(Q)) await S.setInnerHTML(mainImgHtml(Q));
        }
      } catch {
      }
    }, mainImgHtml = (Q, forcedSrc = "") => {
      const busy = !!(t.jobProgress && formatViewerJob(t.jobProgress)?.busy);
      // SMIL spin — no CSS keyframes / no JS interval (works inside SafeDOM).
      const spin = busy ? `<svg data-nx-busy-spin="1" width="18" height="18" viewBox="0 0 18 18" style="position:absolute;left:8px;top:8px;z-index:3;pointer-events:none" aria-hidden="true"><circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="2"/><circle cx="9" cy="9" r="7" fill="none" stroke="#c4b5fd" stroke-width="2" stroke-linecap="round" stroke-dasharray="11 33"><animateTransform attributeName="transform" type="rotate" from="0 9 9" to="360 9 9" dur="0.7s" repeatCount="indefinite"/></circle></svg>` : "";
      const src = forcedSrc || Ie(Q) || d._lastMainSrc || "";
      return `<div style="position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center">${spin}<span data-nx-img-reroll="1" style="position:absolute;right:8px;top:8px;z-index:3;cursor:pointer;background:rgba(124,108,255,.92);color:#fff;padding:5px 10px;border-radius:8px;font-size:11px;line-height:1;font-weight:600;border:1px solid rgba(255,255,255,.18);box-shadow:0 2px 10px rgba(0,0,0,.35);user-select:none" title="이 이미지만 리롤">리롤</span><img data-nx-main-img="1" src="${src}" style="max-width:100%;max-height:100%;object-fit:contain" loading="eager" decoding="async" /></div>`;
    }, ensureCardImage = async (Q) => {
      if (!Q?.id) return Q;
      if (Ie(Q)) return Q;
      try {
        const N = globalThis.__INLAY_NATIVE__;
        if (typeof N?.ensureImageUrl == "function") {
          const url = await N.ensureImageUrl(Q.id);
          if (url) Q.image_url = url;
        }
      } catch {
      }
      return Q;
    }, warmVisibleImages = (items, idx) => {
      try {
        const VC = globalThis.__INLAY_VIEWER_CORE__, N = globalThis.__INLAY_NATIVE__;
        const ids = VC?.visibleGalleryImageIds ? VC.visibleGalleryImageIds(items, idx, 1, Math.max(8, (items || []).length || 0)) : (items || []).slice(Math.max(0, idx - 3), idx + 5).map((c) => c?.id).filter(Boolean);
        const gen = d._metaGen || 0;
        const done = () => {
          if (gen !== (d._metaGen || 0) || t.uiOpen || d.minimized) return;
          // Fill srcs in place — avoid full strip rebuild (separator flicker).
          fillThumbSrcs(items, d.index).catch(() => {
          });
        };
        if (typeof N?.warmImages == "function") N.warmImages(ids).then(done).catch(() => {
        });
        else if (typeof N?.ensureImageUrl == "function") Promise.all(ids.map((id) => N.ensureImageUrl(id).catch(() => ""))).then(done).catch(() => {
        });
      } catch {
      }
    }, paintMainNow = async (Q) => {
      if (!Q) return !1;
      const id = String(Q.id || "");
      if (d.lastMainId === id && Ie(Q)) return !1;
      // Optimistic: paint cache/previous frame first; ensure fills in after (never blocks select/sync).
      const cached = Ie(Q);
      d.lastMainId = id;
      d._paintMainGen = (d._paintMainGen || 0) + 1;
      const gen = d._paintMainGen;
      try {
        if (cached) d._lastMainSrc = cached;
        await S.setInnerHTML(mainImgHtml(Q, cached || d._lastMainSrc || ""));
      } catch {
        return !1;
      }
      if (cached) return !0;
      ensureCardImage(Q).then(async (card) => {
        if (gen !== d._paintMainGen || d.lastMainId !== id) return;
        const src = Ie(card);
        if (!src) return;
        d._lastMainSrc = src;
        try {
          await S.setInnerHTML(mainImgHtml(card));
        } catch {
        }
      }).catch(() => {
      });
      return !0;
    }, selectGalIndex = async (idx) => {
      const items = Array.isArray(d.items) && d.items.length ? d.items : U();
      if (!items.length) {
        await T();
        return;
      }
      d.index = Math.max(0, Math.min(Number.isFinite(Number(idx)) ? Number(idx) : 0, items.length - 1));
      d.selectedCount = selectedCountOf(items);
      const card = items[d.index];
      // Trick: move outline/opacity on existing thumbs first (no strip rebuild), then swap main.
      paintThumbsQuick(d.index).catch(() => {
      });
      await paintMainNow(card);
      d._metaGen = (d._metaGen || 0) + 1;
      const gen = d._metaGen;
      warmVisibleImages(items, d.index);
      d._softTimer && clearTimeout(d._softTimer);
      d._softTimer = setTimeout(() => {
        if (gen !== d._metaGen || t.uiOpen) return;
        softAfterSelect(gen).catch(() => {
        });
      }, 90);
    }, syncToCardId = async (cardId) => {
      const id = String(cardId || "");
      if (!id || d.minimized || t.uiOpen) return !1;
      const items = Array.isArray(d.items) && d.items.length ? d.items : U();
      const idx = items.findIndex((card) => String(card?.id || "") === id);
      if (idx < 0) return !1;
      if (d.index === idx && d.lastMainId === id) return !0;
      await selectGalIndex(idx);
      return !0;
    }, thumbShellStyle = (on, split) => `width:64px;height:88px;object-fit:cover;border-radius:8px;cursor:pointer;opacity:${on ? 1 : 0.45};outline:${on ? "3px solid #a78bfa" : "1px solid rgba(255,255,255,.08)"};outline-offset:${on ? "1px" : "0"};background:#111827;flex:0 0 auto;transform:${on ? "scale(1.04)" : "none"};box-shadow:${on ? "0 0 0 1px rgba(124,108,255,.55),0 6px 16px rgba(0,0,0,.45)" : "none"};${split ? "margin-left:4px;" : ""}`, refreshThumbsRect = async () => {
      try {
        d._thumbsRect = await E.getBoundingClientRect(), d._thumbsRectAt = Date.now();
      } catch {
        d._thumbsRect = null;
      }
    }, paintThumbsChrome = async (items, idx) => {
      const list = items || [];
      d.selectedCount = selectedCountOf(list);
      const VC = globalThis.__INLAY_VIEWER_CORE__;
      const splitAt = typeof VC?.galleryStripSplitAt == "function" ? VC.galleryStripSplitAt(d.selectedCount || 0, list.length) : (d.selectedCount > 0 && d.selectedCount < list.length ? d.selectedCount : 0);
      const thumbBits = [];
      for (let ut = 0; ut < list.length; ut += 1) {
        if (splitAt > 0 && ut === splitAt) {
          thumbBits.push('<div data-nx-split="1" style="flex:0 0 auto;width:16px;height:88px;display:flex;align-items:center;justify-content:center;color:rgba(232,238,248,.55);font:700 15px/1 Consolas,monospace;user-select:none;pointer-events:none;letter-spacing:-1px;">|</div>');
        }
        const Le = list[ut], on = ut === idx, split = splitAt > 0 && ut === splitAt, src = Ie(Le) || THUMB_PLACEHOLDER;
        thumbBits.push(`<img data-gal-idx="${ut}" src="${src}" style="${thumbShellStyle(on, split)}" loading="lazy" decoding="async" />`);
      }
      await E.setInnerHTML(thumbBits.join(""));
      await refreshThumbsRect();
    }, paintThumbsQuick = async (idx) => {
      // Style-only selection move: keep existing <img> nodes + `|` separator, just retarget outline/opacity.
      try {
        const items = Array.isArray(d.items) && d.items.length ? d.items : U();
        const kids = typeof k.unwarpSafeArray == "function" ? await k.unwarpSafeArray(await E.getChildren()) : [];
        if (!kids?.length) {
          await paintThumbsChrome(items, idx);
          return;
        }
        const VC = globalThis.__INLAY_VIEWER_CORE__;
        const splitAt = typeof VC?.galleryStripSplitAt == "function" ? VC.galleryStripSplitAt(d.selectedCount || selectedCountOf(items) || 0, items.length) : (d.selectedCount > 0 && d.selectedCount < items.length ? d.selectedCount : 0);
        let touched = 0;
        for (let W = 0; W < kids.length; W += 1) {
          const el = kids[W];
          if (!el) continue;
          let galIdx = -1;
          try {
            if (typeof el.getAttribute == "function") {
              const split = await el.getAttribute("data-nx-split");
              if (split != null && split !== "") continue;
              const raw = await el.getAttribute("data-gal-idx");
              if (raw != null && raw !== "" && Number.isFinite(Number(raw))) galIdx = Number(raw);
              else if (typeof VC?.galleryIndexFromChildIndex == "function") galIdx = VC.galleryIndexFromChildIndex(W, splitAt || d.selectedCount || 0, items.length);
              else galIdx = W;
            }
          } catch {
            continue;
          }
          if (galIdx < 0 || galIdx >= items.length) continue;
          const on = galIdx === idx, split = splitAt > 0 && galIdx === splitAt, style = thumbShellStyle(on, split);
          try {
            if (typeof el.setStyleAttribute == "function") await el.setStyleAttribute(style);
            else if (typeof el.setAttribute == "function") await el.setAttribute("style", style);
          } catch {
          }
          touched += 1;
        }
        if (touched < Math.min(items.length, 1)) await paintThumbsChrome(items, idx);
      } catch {
        await paintThumbsChrome(Array.isArray(d.items) && d.items.length ? d.items : U(), idx);
      }
    }, softAfterSelect = async (gen) => {
      if (gen !== (d._metaGen || 0) || d.minimized) return;
      const items = Array.isArray(d.items) && d.items.length ? d.items : U(), Q = items[d.index];
      if (!Q) return;
      // Background: warm srcs in place. Do NOT rewrite strip HTML (flickers `|` and feels laggy).
      try {
        await fillThumbSrcs(items, d.index);
        if (gen !== (d._metaGen || 0)) return;
        await paintThumbsQuick(d.index);
      } catch {
        if (gen !== (d._metaGen || 0)) return;
        await paintThumbsStrip(items, d.index);
      }
      if (gen !== (d._metaGen || 0)) return;
      // Rebuild when card changes OR hit-test zones were lost (stale/racy bind).
      if ((d._metaCardId || "") !== String(Q.id || "") || !(d.metaHits || []).length) {
        await buildMetaUi(Q, gen);
        if (gen === (d._metaGen || 0)) d._metaCardId = String(Q.id || "");
      }
      if (gen !== (d._metaGen || 0)) return;
      await paintStatus();
    }, THUMB_PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", fillThumbSrcs = async (items, idx) => {
      try {
        const list = items || [];
        const kids = typeof k.unwarpSafeArray == "function" ? await k.unwarpSafeArray(await E.getChildren()) : [];
        if (!kids?.length) return;
        const VC = globalThis.__INLAY_VIEWER_CORE__;
        const warmIds = new Set(VC?.visibleGalleryImageIds ? VC.visibleGalleryImageIds(list, idx, 1, Math.max(8, list.length || 0)) : list.slice(Math.max(0, idx - 3), idx + 5).map((c) => String(c?.id || "")).filter(Boolean));
        for (const id of warmIds) {
          const card = list.find((c) => String(c?.id || "") === id);
          if (card) await ensureCardImage(card);
        }
        for (const el of kids) {
          if (!el || typeof el.getAttribute != "function") continue;
          let galIdx = null;
          try {
            const split = await el.getAttribute("data-nx-split");
            if (split != null && split !== "") continue;
            const raw = await el.getAttribute("data-gal-idx");
            if (raw != null && raw !== "") galIdx = Number(raw);
          } catch {
            continue;
          }
          if (!Number.isFinite(galIdx)) continue;
          const card = list[galIdx], id = String(card?.id || "");
          if (!warmIds.has(id)) continue;
          const src = Ie(card);
          if (!src || typeof el.setAttribute != "function") continue;
          try {
            await el.setAttribute("src", src);
          } catch {
          }
        }
      } catch {
      }
    }, paintThumbsStrip = async (items, idx) => {
      const list = items || [];
      d.selectedCount = selectedCountOf(list);
      const VC = globalThis.__INLAY_VIEWER_CORE__;
      const splitAt = typeof VC?.galleryStripSplitAt == "function" ? VC.galleryStripSplitAt(d.selectedCount || 0, list.length) : (d.selectedCount > 0 && d.selectedCount < list.length ? d.selectedCount : 0);
      const warmIds = new Set(VC?.visibleGalleryImageIds ? VC.visibleGalleryImageIds(list, idx, 1, Math.max(8, list.length || 0)) : list.slice(Math.max(0, idx - 3), idx + 5).map((c) => String(c?.id || "")).filter(Boolean));
      for (const id of warmIds) {
        const card = list.find((c) => String(c?.id || "") === id);
        if (card) await ensureCardImage(card);
      }
      const thumbBits = [];
      for (let ut = 0; ut < list.length; ut += 1) {
        if (splitAt > 0 && ut === splitAt) {
          thumbBits.push('<div data-nx-split="1" style="flex:0 0 auto;width:16px;height:88px;display:flex;align-items:center;justify-content:center;color:rgba(232,238,248,.55);font:700 15px/1 Consolas,monospace;user-select:none;pointer-events:none;letter-spacing:-1px;">|</div>');
        }
        const Le = list[ut], id = String(Le?.id || ""), on = ut === idx, split = splitAt > 0 && ut === splitAt, shell = thumbShellStyle(on, split), src = warmIds.has(id) ? Ie(Le) : "";
        thumbBits.push(`<img data-gal-idx="${ut}" src="${src || THUMB_PLACEHOLDER}" style="${shell}" loading="lazy" decoding="async" />`);
      }
      await E.setInnerHTML(thumbBits.join(""));
      await refreshThumbsRect();
    }, hitThumbAt = async (x, y) => {
      // Geometry hit-test — SafeDOM getBoundingClientRect on setInnerHTML <img> drifts past `|`.
      const items = Array.isArray(d.items) && d.items.length ? d.items : U();
      if (!items.length) return -1;
      try {
        await refreshThumbsRect();
        const strip = d._thumbsRect;
        if (!strip || x < strip.left || x > strip.right || y < strip.top || y > strip.bottom) return -1;
        const VC = globalThis.__INLAY_VIEWER_CORE__;
        const scrollLeft = await getScrollLeftSafe(E);
        const localX = x - strip.left + scrollLeft;
        if (typeof VC?.thumbIndexAtStripX == "function") {
          return VC.thumbIndexAtStripX(localX, {
            count: items.length,
            selectedCount: d.selectedCount || selectedCountOf(items) || 0
          });
        }
      } catch {
      }
      return -1;
    }, T = async (mode = "full") => {
      if (t.uiOpen) return;
      const VC = globalThis.__INLAY_VIEWER_CORE__;
      const paintMode = VC?.mergeViewerPaintJob ? VC.mergeViewerPaintJob(null, mode || "full") : mode || "full";
      if (paintMode === "chrome") {
        await paintStatus(), await I();
        return;
      }
      const A = Array.isArray(d.items) ? d.items.length : 0, prevItems = Array.isArray(d.items) ? d.items : [], _ = U();
      const VC2 = globalThis.__INLAY_VIEWER_CORE__;
      const prevIds = prevItems.map((c) => String(c?.id || "")).filter(Boolean);
      const nextIds = _.map((c) => String(c?.id || "")).filter(Boolean);
      const idsSame = VC2?.shouldRefreshGallery ? !VC2.shouldRefreshGallery(prevIds, nextIds) : prevIds.join("|") === nextIds.join("|");
      const nextSelectedCount = selectedCountOf(_);
      // Same strip (e.g. scrolled onto a no-image message while keeping last imaged focus) → skip rebuild.
      if (paintMode !== "full" && idsSame && A > 0 && _.length === A && (d.selectedCount || 0) === nextSelectedCount) {
        d.items = _;
        d.selectedCount = nextSelectedCount;
        await paintStatus(), await I();
        return;
      }
      // Invalidate any in-flight meta/thumb paint so old base/char chips cannot append after the new set.
      d._metaGen = (d._metaGen || 0) + 1;
      const gen = d._metaGen;
      d.items = _;
      const O = t.selectedMessage, G = !!(O?.hash && t.jobsInFlight.has(O.hash)), B = t.jobProgress, busy = !!(G || B);
      if (d.minimized) {
        await paintStatus(), await I();
        return;
      }
      if (!_.length) {
        // Keep last strip while generating — transient empty gallery lookups looked like a disconnect.
        if (busy && Array.isArray(prevItems) && prevItems.length) {
          d.items = prevItems;
          await paintStatus(), await I();
          if (paintMode !== "chrome") {
            try {
              await paintMainNow(prevItems[Math.max(0, Math.min(d.index, prevItems.length - 1))]);
              await paintThumbsStrip(prevItems, d.index);
            } catch {
            }
          }
          return;
        }
        d.lastMainId = "";
        const Le = busy ? `<span style="color:#8b97ab;font-size:12px">생성 중… 상태표시줄을 확인하세요</span>` : `<span style="color:#778398;font-size:12px">${O ? "연결된 이미지 없음" : "메시지를 선택하면 여기에 표시됩니다"}</span>`;
        await S.setInnerHTML(Le), await E.setInnerHTML(""), d.metaHits = [], d._metaCardId = "", await j.setInnerHTML(""), await paintStatus(), await g();
        return;
      }
      !A && _.length ? d.index = Math.max(0, _.length - 1) : d.index = Math.max(0, Math.min(d.index, _.length - 1)), _.length > A && d.index === Math.max(0, A - 1) && (d.index = _.length - 1);
      const Q = _[d.index];
      d.selectedCount = selectedCountOf(_);
      warmVisibleImages(_, d.index);
      await paintMainNow(Q);
      if (gen !== (d._metaGen || 0)) return;
      // Image stage height is locked to geo — do not reflow on message change.
      await paintThumbsStrip(_, d.index);
      if (gen !== (d._metaGen || 0)) return;
      // Rebuild when card changes OR hit zones missing (race left chips with empty metaHits).
      if (paintMode === "full" || (d._metaCardId || "") !== String(Q.id || "") || !(d.metaHits || []).length) {
        await buildMetaUi(Q, gen);
        if (gen === (d._metaGen || 0)) d._metaCardId = String(Q.id || "");
      }
      if (gen !== (d._metaGen || 0)) return;
      // Do NOT rebuild the preset <select> on every paint — that snaps the
      // user's in-progress choice back to whatever card settings still holds.
      await paintStatus(), await I();
    }, runMetaChip = async (chip, charI = -1, card = null) => {
      const target = card || U()[d.index];
      if (!target) return;
      const kind = String(chip || "");
      if (kind === "base") {
        await openCardTagEdit(target);
        return;
      }
      if (!/^char\d+/i.test(kind) && kind !== "char") return;
      await ensureViewerRosterLoaded().catch(() => null);
      const idx = Number.isFinite(Number(charI)) ? Number(charI) : Number(String(kind).replace(/^char/i, "")) - 1;
      const cast = R(target), entry = cast.find((row) => Number(row.index) === idx) || cast[idx];
      if (entry?.name) {
        entry.roster = Dt(entry.name) || entry.roster;
        await Ua(entry);
        return;
      }
      const raw = Array.isArray(target.characters) ? target.characters[idx] : null, name = w(raw?.name || "", 200);
      if (name) await Ua({
        name,
        prompt: w(raw?.prompt || "", 400),
        roster: Dt(name),
        index: idx
      });
      else await openCardTagEdit(target);
    }, hitMetaChipAt = async (x, y) => {
      let zones = d.metaHits || [];
      for (const zone of zones) {
        if (!zone?.el) continue;
        try {
          if (await X(zone.el, x, y)) return zone;
        } catch {
        }
      }
      // Live children fallback (SafeDOM sometimes drops stale wrappers).
      try {
        const kids = typeof k.unwarpSafeArray == "function" ? await k.unwarpSafeArray(await j.getChildren()) : [];
        for (const el of kids || []) {
          if (!el || typeof el.getAttribute != "function") continue;
          let chip = "";
          try {
            if (!(await X(el, x, y))) continue;
            chip = String(await el.getAttribute("data-nx-chip") || "");
          } catch {
            continue;
          }
          if (!chip || chip === "y") continue;
          let charI = -1;
          if (/^char\d+/i.test(chip)) {
            charI = Number(String(chip).replace(/^char/i, "")) - 1;
            try {
              const raw = await el.getAttribute("data-nx-char-i");
              if (raw != null && raw !== "" && Number.isFinite(Number(raw))) charI = Number(raw);
            } catch {
            }
          }
          return {
            el,
            kind: "chip",
            chip,
            charI
          };
        }
      } catch {
      }
      return null;
    }, buildMetaUi = async (Q, genIn = null) => {
      const gen = genIn != null ? genIn : d._metaGen || 0;
      d.metaHits = [];
      if (!Q) {
        if (gen !== (d._metaGen || 0)) return;
        try {
          await j.setInnerHTML("");
        } catch {
        }
        return;
      }
      try {
        if (!(t._viewerRoster?.rosterSessionId) || t.backendSettings?.card?.unified_chat_priority) await ensureViewerRosterLoaded();
      } catch {
      }
      const chipStyle = (on, accent) => `cursor:pointer;pointer-events:auto;display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;line-height:1.2;white-space:nowrap;border:1px solid ${accent || (on ? "rgba(255,255,255,.14)" : "rgba(248,113,113,.45)")};background:${accent ? "rgba(124,108,255,.18)" : on ? "rgba(255,255,255,.06)" : "rgba(248,113,113,.12)"};color:${on ? "#e8eef8" : "#fecaca"};opacity:${on ? 1 : 0.72}`, Yt = Array.isArray(Q.characters) ? Q.characters : [], cast = R(Q);
      d.castEntries = cast.map((entry) => ({
        ...entry,
        el: null
      }));
      if (gen !== (d._metaGen || 0)) return;
      // Clear first, then createElement chips (same reliable path as sticky inspect).
      // setInnerHTML chip spans lose click hit-testing under SafeDOM.
      try {
        await j.setInnerHTML("");
      } catch {
        return;
      }
      if (gen !== (d._metaGen || 0)) return;
      const addChip = async (label, chip, style, charI = -1) => {
        if (gen !== (d._metaGen || 0)) return null;
        const el = await H(e, "span", {
          text: label,
          style
        });
        try {
          await el.setAttribute("data-nx-chip", chip);
          if (charI >= 0) await el.setAttribute("data-nx-char-i", String(charI));
        } catch {
        }
        if (gen !== (d._metaGen || 0)) return null;
        await j.appendChild(el);
        if (chip && chip !== "y") {
          const action = {
            el,
            kind: "chip",
            chip
          };
          if (charI >= 0) action.charI = charI;
          d.metaHits.push(action);
        }
        return el;
      };
      {
        const yRaw = Q.y_percent ?? Q.anchor_percent ?? Q.read_percent, yNum = Number(yRaw);
        if (Number.isFinite(yNum)) {
          await addChip(`${Math.round(Math.max(0, Math.min(100, yNum)))}%`, "y", "padding:4px 8px;border-radius:999px;font-size:11px;line-height:1.2;border:1px solid rgba(255,255,255,.12);background:rgba(15,23,42,.72);color:#94a3b8;font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap;pointer-events:none");
        }
      }
      await addChip("base", "base", chipStyle(!0, "rgba(124,108,255,.45)"));
      for (let ut = 0; ut < Yt.length; ut += 1) {
        if (gen !== (d._metaGen || 0)) return;
        const Le = Yt[ut], roster = Dt(Le?.name || ""), on = !roster || roster.scope !== "__global__" || isGlobalEnabledForCharacter(roster), label = `c${ut + 1}${Le?.name ? `·${Le.name}` : ""}`;
        await addChip(label, `char${ut + 1}`, chipStyle(on), ut);
      }
    }, v = async (opts = {}) => {
      if (d.minimized) return;
      try {
        const A = await r.getBoundingClientRect();
        if (!(A.width > 40 && A.height > 40)) return;
        // Position from on-screen rect; size only when user actually resized (syncSize).
        d.geo.left = A.left, d.geo.top = A.top;
        if (opts.syncSize) {
          d.geo.w = Math.max(260, A.width), d.geo.h = Math.max(280, A.height), d.expandedH = d.geo.h;
        }
        d.geo = clampViewerGeo(d.geo, !1);
      } catch {
      }
    };
    d.renderGal = T, d.paintStatus = paintStatus;
    if (!t._onWarmProgressInstalled) {
      t._onWarmProgressInstalled = !0;
      try {
        const N = globalThis.__INLAY_NATIVE__;
        if (typeof N?.onWarmProgress == "function") {
          N.onWarmProgress(() => {
            if (t.uiOpen || t._indexPaintQueued) return;
            t._indexPaintQueued = !0;
            Promise.resolve().then(() => {
              t._indexPaintQueued = !1;
              if (t.galleryUi?.paintStatus) t.galleryUi.paintStatus().catch(() => {
              });
            });
          });
        }
      } catch {
      }
    }
    d.selectGalIndex = selectGalIndex, d.syncToCardId = syncToCardId, d.setOpen = async () => {
      await T();
    };
    d._spinTimer && clearInterval(d._spinTimer), d._spinTimer = setInterval(() => {
      const B = t.jobProgress;
      if (!B || d.minimized) return;
      const stt = String(B.state || "");
      if (stt === "done" || stt === "error") return;
      paintStatus().catch(() => {
      });
    }, 180);
    const X = hitEl, messageBusy = (hash) => {
      const h0 = String(hash || "");
      if (h0 && t.jobsInFlight.has(h0)) return !0;
      return !!(t.jobProgress && formatViewerJob(t.jobProgress)?.busy && t.selectedMessage?.hash && t.selectedMessage.hash === h0);
    }, te = async () => {
      const A = t.selectedMessage;
      if (!A?.text) {
        y("warn", "regen.tag.skip", "선택된 메시지 없음"), await C.setTextContent("태그 재생성: 먼저 메시지를 클릭하세요");
        return;
      }
      if (messageBusy(A.hash)) {
        await C.setTextContent("이미 작업 중… 끝날 때까지 기다려 주세요");
        return;
      }
      try {
        await C.setTextContent("태그 재생성 중…"), await Be(await Z({
          useOverride: !1
        }), A.text, !0), y("info", "regen.tag", A.hash.slice(0, 8));
      } catch (_) {
        y("error", "regen.tag.fail", _?.message || _), await C.setTextContent(`태그 재생성 실패: ${z(_?.message || _, 80)}`);
      }
    }, rerollImage = async () => {
      const A = U()[d.index], _ = d.index, O = Number(A?.paragraph), G = Number(A?.shot_index);
      if (!A?.id) {
        y("warn", "regen.image.skip", "현재 이미지 없음"), await C.setTextContent("리롤: 먼저 이미지를 선택하세요");
        return;
      }
      if (messageBusy(t.selectedMessage?.hash || A.content_hash)) {
        await C.setTextContent("이미 작업 중… 끝날 때까지 기다려 주세요");
        return;
      }
      try {
        await C.setTextContent("이미지 리롤 중…");
        const B = await withImageRerollToast(`P${Number.isFinite(O) ? O : "?"} 이미지 리롤 중…`, async () => await K(`/v1/cards/${encodeURIComponent(A.id)}/reroll`, {
          method: "POST",
          body: {
            mode: "nai"
          }
        }, 18e4));
        if (B?.busy || B?.error?.code === "busy") {
          await C.setTextContent(B?.error?.message || "이미 작업 중… 끝날 때까지 기다려 주세요");
          return;
        }
        const W = await Z({
          useOverride: !1
        }).catch(() => null);
        W?.sessionId && await ce(W.sessionId);
        try {
          await he();
        } catch {
        }
        const J = U(), Q = String(B?.card?.id || ""), me = Q ? J.findIndex((nn) => nn.id === Q) : -1, nn = me >= 0 ? me : J.findIndex((Yt) => Number(Yt.paragraph) === O && Number(Yt.shot_index) === G);
        d.index = nn >= 0 ? nn : Math.max(0, Math.min(_, Math.max(0, J.length - 1))), await T(), await C.setTextContent(`이미지 리롤 완료 · ${String(B?.card?.id || A.id).slice(0, 8)}`), y("info", "regen.image", `P${O} ${String(A.id).slice(0, 8)}→${String(B?.card?.id || "").slice(0, 8)}`);
      } catch (B) {
        y("error", "regen.image.fail", B?.message || B), await C.setTextContent(`리롤 실패: ${z(B?.message || B, 80)}`);
      }
    }, rerollAllImages = async () => {
      const A = t.selectedMessage, targets0 = messageCardsByY(A);
      if (!A || !targets0.length) {
        y("warn", "regen.all.skip", "재생성할 이미지 없음"), await C.setTextContent("재생성: 이미지가 있는 메시지를 선택하세요");
        return;
      }
      if (messageBusy(A.hash)) {
        await C.setTextContent("이미 작업 중… 끝날 때까지 기다려 주세요");
        return;
      }
      const hash = A.hash || "";
      if (hash) t.jobsInFlight.set(hash, Date.now());
      try {
        await C.setTextContent(`전체 ${targets0.length}장 재생성 중…`);
        const scope = await Z({ useOverride: !1 }).catch(() => null);
        const B = await withImageRerollToast(`전체 ${targets0.length}장 재생성 중…`, async (report) => rerollMessageImagesLive(A, {
          scope,
          report,
          onShot: async (i) => {
            d.index = i;
            await T();
            await C.setTextContent(`${i + 1}/${targets0.length} 교체 완료`);
          }
        }), { shotCount: targets0.length });
        scope?.sessionId && await ce(scope.sessionId, !0);
        try {
          await he();
        } catch {
        }
        const failCount = Array.isArray(B?.failed) ? B.failed.length : 0;
        d.index = 0, await T(), await C.setTextContent(failCount ? `전체 재생성 부분 실패 · 성공 ${Number(B?.count || 0)} / 실패 ${failCount}` : `전체 재생성 완료 · ${Number(B?.count || 0)}장`), y("info", "regen.all", `count=${B?.count || 0} failed=${failCount} hash=${String(A.hash || "").slice(0, 8)}`);
      } catch (B) {
        y("error", "regen.all.fail", B?.message || B), await C.setTextContent(`전체 재생성 실패: ${z(B?.message || B, 80)}`);
      } finally {
        if (hash) t.jobsInFlight.delete(hash);
      }
    }, syncViewerPresetSelect = async () => {
      if (!d.presetSelect || t._presetSwitching) return;
      const card = kt(t.backendSettings?.card || {}), presets = Array.isArray(card.presets) ? card.presets : [], activeId = resolveActivePresetId(card), active = presets.find((p) => presetIdEq(p.id, activeId));
      d.viewerPresetIds = presets.map((p) => String(p.id || ""));
      const label = `${String(active?.name || (presets.length ? "프리셋" : "없음")).slice(0, 12)}${String(active?.name || "").length > 12 ? "…" : ""} ▾`;
      try {
        typeof d.presetSelect.setTextContent == "function" ? await d.presetSelect.setTextContent(label) : await d.presetSelect.setInnerHTML(h(label));
      } catch {
      }
      if (d.presetMenu && typeof d.presetMenu.setInnerHTML == "function") {
        const menuHtml = presets.length ? presets.map((p) => {
          const on = presetIdEq(p.id, activeId);
          return `<div style="padding:7px 10px;cursor:pointer;font-size:11px;line-height:1.3;color:${on ? "#e8eef8" : "#a6b1c2"};background:${on ? "rgba(124,108,255,.22)" : "transparent"};border-bottom:1px solid rgba(255,255,255,.06)">${h(p.name || p.id)}</div>`;
        }).join("") : '<div style="padding:8px 10px;font-size:11px;color:#778398">프리셋 없음</div>';
        try {
          await d.presetMenu.setInnerHTML(menuHtml);
        } catch {
        }
      }
      const presetChromeLive = !d.minimized || viewerMinimizeMode() === "toolbar";
      try {
        await d.presetMenu?.setStyleAttribute?.(`display:${d.presetMenuOpen && presetChromeLive ? "block" : "none"};position:absolute;top:34px;left:10px;min-width:140px;max-width:220px;max-height:220px;overflow:auto;z-index:20;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:#0b0f18;box-shadow:0 10px 28px rgba(0,0,0,.45);pointer-events:auto;`);
      } catch {
      }
      // Panel clips absolute children when overflow:hidden — open the gate while menu shows.
      try {
        const base = Ft(d.geo, d.minimized);
        await r.setStyleAttribute(d.presetMenuOpen && presetChromeLive ? base.replace(/overflow:[^;]+/i, "overflow:visible") : base);
      } catch {
      }
    }, pickViewerPreset = async (selected) => {
      if (!selected || t._presetSwitching) return;
      try {
        const card = kt(t.backendSettings?.card || {});
        if (!Array.isArray(card.presets) || !card.presets.some((p) => presetIdEq(p.id, selected))) return;
        d.presetMenuOpen = !1;
        if (presetIdEq(card.active_preset_id, selected) && presetIdEq(t.activePresetId || card.active_preset_id, selected)) {
          await syncViewerPresetSelect();
          await C.setTextContent(`프리셋 · ${card.presets.find((p) => presetIdEq(p.id, selected))?.name || selected}`);
          return;
        }
        const saved = await applyActivePreset(selected, { showCardTab: !!t.uiOpen });
        const active = saved?.presets?.find((p) => presetIdEq(p.id, selected));
        await syncViewerPresetSelect();
        await C.setTextContent(`프리셋 적용 · ${active?.name || selected}`);
        y("info", "viewer.preset", selected);
      } catch (err) {
        y("warn", "viewer.preset.fail", err?.message || err);
      }
    }, ae = async () => {
      const A = t.backendSettings?.card || {}, _ = A.overlay_markers === !1;
      await flushSettingsSave(), await pe({ card: {
        ...A,
        overlay_markers: _,
        inline_previews: _
      } }), y("info", "overlay.toggle", String(_)), await he(), await T();
    }, Za = async (A) => {
      if (!d.drag) return;
      const cx = Number(A?.clientX), cy = Number(A?.clientY);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
      const _ = cx - d.drag.startCX, O = cy - d.drag.startCY;
      !d.drag.moved && Math.abs(_) + Math.abs(O) > 4 && (d.drag.moved = !0);
      if (d.drag.moved) try {
        A.preventDefault?.();
      } catch {
      }
      d.geo.left = d.drag.originX + _, d.geo.top = d.drag.originY + O, d.geo = clampViewerGeo(d.geo, d.minimized);
      const G = Date.now();
      if (G - (d.drag.lastApply || 0) < 16) return;
      d.drag.lastApply = G, await f();
    }, endViewerDrag = async (opts = {}) => {
      if (!d.drag) return;
      const { moveId: A, upId: _, cancelId: cancelId, moved: moved, expandOnTap: expandOnTap } = d.drag;
      d.drag = null;
      try {
        A != null && await e.removeEventListener(A);
      } catch {
      }
      try {
        _ != null && await e.removeEventListener(_);
      } catch {
      }
      try {
        cancelId != null && await e.removeEventListener(cancelId);
      } catch {
      }
      if (opts.cancelled) {
        if (moved) await x();
        await refreshThumbsRect();
        return;
      }
      if (!moved && expandOnTap && d.minimized) {
        await toggleMinimizeBtn();
        await refreshThumbsRect();
        return;
      }
      await x();
      await refreshThumbsRect();
    }, en = async () => {
      await endViewerDrag({});
    }, onViewerDragCancel = async () => {
      await endViewerDrag({ cancelled: !0 });
    }, startViewerDrag = async (A, _, O, expandOnTap) => {
      if (!expandOnTap) await v();
      const B = await e.addEventListener("pointermove", Za), W = await e.addEventListener("pointerup", en), cancelId = await e.addEventListener("pointercancel", onViewerDragCancel);
      d.drag = {
        startCX: _,
        startCY: O,
        originX: d.geo.left,
        originY: d.geo.top,
        moved: !1,
        expandOnTap: !!expandOnTap,
        moveId: B,
        upId: W,
        cancelId,
        lastApply: 0
      };
    }, tn = async (A) => {
      if (t.uiOpen || t._hostChromeBlocked || t.charEditUi || t._viewerHiddenForModal) return;
      // Ignore non-primary buttons (middle-click message jump removed — never reliable on SafeDOM).
      if (Number(A?.button) != null && Number(A.button) !== 0) return;
      const _ = A.clientX, O = A.clientY;
      if (!await X(r, _, O)) return;
      // Icon minimize is its own chrome (tap/drag to move/expand).
      // Toolbar minimize is the SAME header — just hide the body — so keep normal button/preset hit-tests.
      if (d.minimized && viewerMinimizeMode() === "icon") {
        await startViewerDrag(A, _, O, !0);
        return;
      }
      let G = !1;
      try {
        const B = await r.getBoundingClientRect();
        _ > B.right - 22 && O > B.bottom - 22 && (G = !0);
      } catch {
      }
      if (!G) {
        if (await X(c, _, O)) {
          try {
            const B = typeof k.unwarpSafeArray == "function" ? await k.unwarpSafeArray(await c.getChildren()) : [];
            for (let W = 0; W < B.length; W += 1) {
              const J = await B[W].getBoundingClientRect();
              if (_ >= J.left && _ <= J.right && O >= J.top && O <= J.bottom) {
                W === 0 ? await selectGalIndex(d.index - 1) : W === 1 ? await selectGalIndex(d.index + 1) : W === 2 ? await te() : W === 3 ? await rerollAllImages() : W === 4 ? await ae() : W === 5 ? (t.backendSettings?.card || {}).show_risu_settings_button !== !1 && await At() : W === 6 && await toggleMinimizeBtn();
                return;
              }
            }
          } catch {
          }
          return;
        }
        // Preset dropdown (SafeDOM forbids change/input — drive via pointer hit-test).
        if (d.presetMenuOpen && d.presetMenu && await X(d.presetMenu, _, O)) {
          try {
            const kids = typeof k.unwarpSafeArray == "function" ? await k.unwarpSafeArray(await d.presetMenu.getChildren()) : [];
            for (let W = 0; W < kids.length; W += 1) {
              const J = await kids[W].getBoundingClientRect();
              if (_ >= J.left && _ <= J.right && O >= J.top && O <= J.bottom) {
                const id = d.viewerPresetIds?.[W] || "";
                id && await pickViewerPreset(id);
                return;
              }
            }
          } catch {
          }
          return;
        }
        if (d.presetSelect && await X(d.presetSelect, _, O)) {
          d.presetMenuOpen = !d.presetMenuOpen;
          await syncViewerPresetSelect();
          return;
        }
        if (d.presetMenuOpen) {
          d.presetMenuOpen = !1;
          try {
            await syncViewerPresetSelect();
          } catch {
          }
        }
        if (await X(i, _, O)) {
          await startViewerDrag(A, _, O, !1);
          return;
        }
        // Meta chips BEFORE thumbs — SafeDOM thumb rects can overlap the chip row.
        if (await X(j, _, O)) {
          try {
            const zone = await hitMetaChipAt(_, O);
            if (zone?.chip) {
              await runMetaChip(zone.chip, zone.charI, U()[d.index]);
              return;
            }
            // Clicked chip row but missed a zone (stale) — rebuild once and retry.
            const card = U()[d.index];
            if (card && !(d.metaHits || []).length) {
              await buildMetaUi(card, d._metaGen || 0);
              const again = await hitMetaChipAt(_, O);
              if (again?.chip) {
                await runMetaChip(again.chip, again.charI, card);
                return;
              }
            }
          } catch (err) {
            y("error", "viewer.chip.fail", err?.message || err);
          }
          return;
        }
        {
          const galIdx = await hitThumbAt(_, O);
          if (galIdx >= 0) {
            await selectGalIndex(galIdx);
            return;
          }
        }
        if (await X(S, _, O)) {
          try {
            const B = await S.getBoundingClientRect();
            if (B && _ >= B.right - 78 && _ <= B.right - 4 && O >= B.top + 4 && O <= B.top + 40) {
              await rerollImage();
              return;
            }
          } catch {
          }
        }
      }
    }, an = async (A) => {
      if (d.drag || t.uiOpen || t._hostChromeBlocked) return;
      const _ = A.clientX, O = A.clientY;
      let nearResize = !1;
      try {
        const B = await r.getBoundingClientRect();
        if (B && typeof _ == "number" && typeof O == "number") nearResize = _ >= B.right - 28 && O >= B.bottom - 28;
      } catch {
        return;
      }
      if (!nearResize) return;
      const G = {
        w: d.geo.w,
        h: d.geo.h
      };
      await v({
        syncSize: !0
      }), (Math.abs(G.w - d.geo.w) > 1 || Math.abs(G.h - d.geo.h) > 1) && (await qt(d.geo), await f());
    };
    d.pointerId = await D("galPtr", () => e.addEventListener("pointerdown", tn), null), d.pointerUpId = await D("galPtrUp", () => e.addEventListener("pointerup", an), null);
    d.dblId = null;
    d.previewDblId = null;
    d.syncViewerPresetSelect = syncViewerPresetSelect;
    d.presetChangeId = null;
    d.presetInputId = null;
    await syncViewerPresetSelect();
    d._onWinResize = () => {
      if (t.galleryUi !== d || t._viewerHiddenForModal) return;
      d.geo = clampViewerGeo(d.geo, d.minimized);
      (async () => {
        try {
          typeof d.applyChrome == "function" ? await d.applyChrome() : await f();
        } catch {
        }
      })();
    };
    if (typeof window < "u") try {
      window.addEventListener("resize", d._onWinResize), d._winResizeBound = !0;
    } catch {
      d._winResizeBound = !1;
    }
    // Viewer DOM lives on the HOST document (getRootDocument). Plugin `window.wheel`
    // never sees those events — bind host doc + host defaultView, keep overflow-x:auto
    // so native wheel / middle-drag autoscroll can move the strip.
    d._thumbsRect = null;
    d._thumbsRectAt = 0;
    d._thumbWheelTargets = [];
    d._thumbWheel = (ev) => {
      if (t.uiOpen || t._hostChromeBlocked || d.minimized || d.drag) return;
      const x = ev?.clientX, y = ev?.clientY;
      if (typeof x != "number" || typeof y != "number") return;
      const dx = Number(ev.deltaX) || 0, dy = Number(ev.deltaY) || 0, delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      if (!delta) return;
      const rect = d._thumbsRect;
      // Fast sync reject when we have a fresh rect; otherwise refresh async and nudge.
      if (rect && (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)) return;
      (async () => {
        await refreshThumbsRect();
        const live = d._thumbsRect;
        if (!live || x < live.left || x > live.right || y < live.top || y > live.bottom) return;
        const before = await getScrollLeftSafe(E);
        const ok = await setScrollLeftSafe(E, before + delta);
        const after = await getScrollLeftSafe(E);
        if (ok && Math.abs(after - before) >= 0.5) {
          try {
            ev.preventDefault?.(), ev.stopPropagation?.();
          } catch {
          }
          return;
        }
        // Native overflow may still handle the event if we did not cancel it.
        // If scroll is stuck at an edge, step the selected thumbnail.
        if (Math.abs(after - before) < 0.5) await selectGalIndex(d.index + (delta > 0 ? 1 : -1));
      })().catch(() => {
      });
    };
    d.wheelId = null;
    try {
      d.wheelId = await e.addEventListener("wheel", d._thumbWheel, {
        capture: !0,
        passive: !1
      });
    } catch {
      try {
        d.wheelId = await e.addEventListener("wheel", d._thumbWheel, !0);
      } catch {
        d.wheelId = await fe(e, "wheel", d._thumbWheel, !0);
      }
    }
    try {
      const hostWin = e.defaultView || t.hostDoc?.defaultView || null;
      if (hostWin && typeof hostWin.addEventListener == "function") {
        hostWin.addEventListener("wheel", d._thumbWheel, {
          capture: !0,
          passive: !1
        }), d._thumbWheelTargets.push(hostWin);
      }
    } catch {
    }
    await applyViewerChrome(), await T();
    try {
      d._thumbsRect = await E.getBoundingClientRect(), d._thumbsRectAt = Date.now();
    } catch {
    }
  }
  async function ct() {
    t.debugUiTimer && (clearInterval(t.debugUiTimer), t.debugUiTimer = null), t.debugUi?.pointerId != null && t.debugUi?.doc?.removeEventListener && await D("rmDbgPtr", () => t.debugUi.doc.removeEventListener(t.debugUi.pointerId), null), await rt(q), t.debugUi = null;
  }
  async function Ba() {
    if (t.uiOpen) return;
    const e = await ue();
    if (!e) return;
    const n = await Ee(e);
    if (!n || typeof e.createElement != "function") return;
    await ct();
    const o = await H(e, "div", {
      className: q,
      style: "position:fixed;left:0;top:0;width:0;height:0;z-index:99986;pointer-events:none;"
    });
    await n.appendChild(o);
    const a = await H(e, "div", {
      style: [
        "position:fixed",
        "right:16px",
        "bottom:24px",
        "left:auto",
        "z-index:99987",
        "min-width:44px",
        "height:36px",
        "padding:0 12px",
        "border-radius:10px",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "font:700 12px/1 Segoe UI,sans-serif",
        "cursor:pointer",
        "pointer-events:auto",
        "color:#dce7ff",
        "background:rgba(20,28,44,.92)",
        "border:1px solid rgba(163,184,216,.28)",
        "box-shadow:0 8px 20px rgba(0,0,0,.35)"
      ].join(";"),
      html: "DBG"
    });
    await o.appendChild(a);
    const panelStyle = () => [
      "position:fixed",
      "right:12px",
      "bottom:68px",
      "left:auto",
      "width:min(860px,96vw)",
      "height:min(620px,72vh)",
      "z-index:99987",
      `display:${t.debugUiOpen ? "flex" : "none"}`,
      "flex-direction:column",
      "overflow:hidden",
      "pointer-events:auto",
      "background:rgba(10,14,22,.96)",
      "border:1px solid rgba(163,184,216,.22)",
      "border-radius:14px",
      "box-shadow:0 16px 40px rgba(0,0,0,.45)",
      "color:#d7e2f4",
      "font:11px/1.35 Consolas,ui-monospace,monospace"
    ].join(";");
    const r = await H(e, "div", { style: panelStyle() });
    const i = await H(e, "div", {
      style: "flex:0 0 34px;display:flex;align-items:center;justify-content:space-between;padding:0 10px;border-bottom:1px solid rgba(255,255,255,.08);font-weight:700;font-family:Segoe UI,sans-serif;font-size:12px;",
      html: '<span>Inlay Debug · DOM ↔ API</span><span style="opacity:.75">✕</span>'
    });
    const tool = await H(e, "div", {
      style: "flex:0 0 auto;display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);font-family:Segoe UI,sans-serif;"
    });
    const btn = async (label) => H(e, "div", {
      style: "padding:4px 10px;border-radius:8px;background:rgba(255,255,255,.08);border:1px solid rgba(163,184,216,.25);cursor:pointer;font:700 11px Segoe UI,sans-serif;color:#dce7ff;",
      text: label
    });
    const syncBtn = await btn("선택 msg#로");
    const prevBtn = await btn("◀");
    const nextBtn = await btn("▶");
    const idxLabel = await H(e, "div", {
      style: "min-width:120px;padding:4px 8px;border-radius:8px;background:rgba(0,0,0,.28);font:700 11px Consolas,monospace;",
      text: "msg#-"
    });
    const hitLabel = await H(e, "div", {
      style: "flex:1;min-width:160px;padding:4px 8px;border-radius:8px;background:rgba(0,0,0,.22);font:11px Consolas,monospace;color:#9eb6d8;",
      text: "overlap: ?"
    });
    await tool.appendChild(syncBtn), await tool.appendChild(prevBtn), await tool.appendChild(idxLabel), await tool.appendChild(nextBtn), await tool.appendChild(hitLabel);
    const compare = await H(e, "div", {
      style: "flex:1;min-height:0;display:flex;gap:8px;padding:8px 10px;overflow:hidden;"
    });
    const mkCol = async (title) => {
      const col = await H(e, "div", {
        style: "flex:1;min-width:0;display:flex;flex-direction:column;border:1px solid rgba(163,184,216,.16);border-radius:10px;overflow:hidden;background:rgba(0,0,0,.22);"
      });
      const head = await H(e, "div", {
        style: "flex:0 0 auto;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.06);font:700 11px Segoe UI,sans-serif;color:#c9d8ef;",
        text: title
      });
      const body = await H(e, "div", {
        style: "flex:1;min-height:0;overflow:auto;padding:8px;white-space:pre-wrap;word-break:break-word;",
        text: "…"
      });
      return await col.appendChild(head), await col.appendChild(body), { col, head, body };
    };
    const left = await mkCol("LEFT · DOM 선택");
    const right = await mkCol("RIGHT · API message[]");
    await compare.appendChild(left.col), await compare.appendChild(right.col);
    const logEl = await H(e, "div", {
      style: "flex:0 0 120px;overflow:auto;padding:8px 10px;border-top:1px solid rgba(255,255,255,.06);white-space:pre-wrap;color:#9aa8bf;font-size:10.5px;",
      text: "log…"
    });
    await r.appendChild(i), await r.appendChild(tool), await r.appendChild(compare), await r.appendChild(logEl), await o.appendChild(r);
    const hitRect = async (el, x, y) => {
      try {
        const d = await el.getBoundingClientRect();
        return x >= d.left && x <= d.right && y >= d.top && y <= d.bottom;
      } catch {
        return !1;
      }
    };
    const c = async () => {
      const sel = t.selectedMessage;
      let msgs = [];
      try {
        msgs = (await Za())?.messages || [];
      } catch {
        msgs = [];
      }
      if (!Number.isFinite(Number(t.debugCompareIndex))) {
        t.debugCompareIndex = Number.isFinite(Number(sel?.chatIndex)) ? Number(sel.chatIndex) : 0;
      }
      if (msgs.length) {
        t.debugCompareIndex = Math.max(0, Math.min(msgs.length - 1, Math.floor(Number(t.debugCompareIndex) || 0)));
      } else {
        t.debugCompareIndex = 0;
      }
      const api = msgs[t.debugCompareIndex] || null;
      const domText = String(sel?.text || "");
      const apiText = String(api?.text || "");
      const VC = globalThis.__INLAY_VIEWER_CORE__;
      const cmp = typeof VC?.describeDomApiCompare == "function"
        ? VC.describeDomApiCompare(domText, apiText)
        : { domChars: domText.length, apiChars: apiText.length, overlap: !1, apiInDom: !1, domInApi: !1, shortExact: !1 };
      const matched = Number.isFinite(Number(sel?.chatIndex)) && Number(sel.chatIndex) === Number(t.debugCompareIndex);
      typeof idxLabel.setTextContent == "function" && await idxLabel.setTextContent(`msg#${t.debugCompareIndex} / ${Math.max(0, msgs.length - 1)} (${msgs.length}개)`);
      typeof hitLabel.setTextContent == "function" && await hitLabel.setTextContent(
        `share=${cmp.shareScore ?? 0} overlap=${cmp.overlap ? "YES" : "no"} apiInDom=${cmp.apiInDom ? "Y" : "n"} short=${cmp.shortExact ? "Y" : "n"} · view${matched ? "=selected" : "≠selected"}`
      );
      typeof left.head.setTextContent == "function" && await left.head.setTextContent(
        `LEFT · DOM 선택 · chars=${cmp.domChars} role=${sel?.role || "-"} hash=${String(sel?.hash || "").slice(0, 12)} DOM#${sel?.domIndex ?? "-"}`
      );
      typeof right.head.setTextContent == "function" && await right.head.setTextContent(
        `RIGHT · API msg#${api?.index ?? t.debugCompareIndex} · chars=${cmp.apiChars} role=${api?.role || "-"} isUser=${api?.isUser ? "Y" : "n"} isChar=${api?.isChar ? "Y" : "n"}`
      );
      typeof left.body.setTextContent == "function" && await left.body.setTextContent(
        sel
          ? `session=${sel.sessionId || "-"}\nvia=${sel.matchMethod || "-"}\npreview=${sel.preview || "-"}\n----\n${domText || "(empty)"}`
          : "선택된 DOM 메시지 없음 — 채팅 말풍선을 클릭하세요"
      );
      typeof right.body.setTextContent == "function" && await right.body.setTextContent(
        api
          ? `index=${api.index}\nrole=${api.role || "-"}\ngenInfo=${api.generationInfo ? "yes" : "no"}\n----\n${apiText || "(empty)"}`
          : msgs.length ? "(empty slot)" : "Za() message[] 비어 있음"
      );
      const status = `${Ve()}\n======== LOG ========\n${Ye(18) || "(log empty)"}`;
      typeof logEl.setTextContent == "function" && await logEl.setTextContent(status);
    };
    let l = null;
    const p = () => {
      l || (l = setTimeout(() => {
        l = null, c().catch(() => {
        });
      }, 120));
    }, m = async (S) => {
      t.debugUiOpen = !!S;
      typeof r.setStyleAttribute == "function" && await r.setStyleAttribute(panelStyle()), t.debugUiOpen && await c();
    }, b = async (S) => {
      const E = S.clientX, j = S.clientY;
      if (await hitRect(a, E, j)) {
        await m(!t.debugUiOpen);
        return;
      }
      if (!t.debugUiOpen) return;
      try {
        const d = await r.getBoundingClientRect();
        if (E >= d.right - 40 && E <= d.right && j >= d.top && j <= d.top + 34) {
          await m(!1);
          return;
        }
      } catch {
      }
      if (await hitRect(syncBtn, E, j)) {
        t.debugCompareIndex = Number.isFinite(Number(t.selectedMessage?.chatIndex)) ? Number(t.selectedMessage.chatIndex) : 0;
        await c();
        return;
      }
      if (await hitRect(prevBtn, E, j)) {
        t.debugCompareIndex = Math.max(0, (Number(t.debugCompareIndex) || 0) - 1);
        await c();
        return;
      }
      if (await hitRect(nextBtn, E, j)) {
        t.debugCompareIndex = (Number(t.debugCompareIndex) || 0) + 1;
        await c();
        return;
      }
    }, C = await D("dbgPtr", () => e.addEventListener("pointerdown", b), null);
    t.debugUi = {
      doc: e,
      root: o,
      fab: a,
      panel: r,
      bodyEl: logEl,
      pointerId: C,
      refreshSoon: p,
      setOpen: m,
      paint: c
    }, t.debugUiTimer = setInterval(() => {
      c().catch(() => {
      });
    }, 1e3), await c();
  }
    async function qe(e) {
    for (const n of _a) {
      const o = await D("chatScope", () => e.querySelector(n), null);
      if (o)
        try {
          const a = await o.getBoundingClientRect();
          if (a && a.height > 200) return o;
        } catch {
        }
    }
    return Ee(e);
  }
  async function dt(e) {
    if (!e) return [];
    for (const n of $a) try {
      const o = await e.querySelectorAll(n), a = typeof k.unwarpSafeArray == "function" ? await k.unwarpSafeArray(o) : [];
      if (a?.length) return a;
    } catch {
    }
    return [];
  }
  async function De(e) {
    try {
      if (typeof e.getInnerHTML == "function") return w(ln(await e.getInnerHTML()), 1e5);
    } catch {
    }
    try {
      if (typeof e.textContent == "function") return w(await e.textContent(), 1e5);
    } catch {
    }
    return "";
  }
  async function Za() {
    const e = Number(await D("getCurrentCharacterIndex", () => k.getCurrentCharacterIndex?.(), -1)), n = Number(await D("getCurrentChatIndex", () => k.getCurrentChatIndex?.(), -1)), o = e >= 0 ? await D("getCharacterFromIndex", () => k.getCharacterFromIndex?.(e), null) : null, a = e >= 0 && n >= 0 ? await D("getChatFromIndex", () => k.getChatFromIndex?.(e, n), null) : null, r = w(o?.chaId || o?.id || o?.name || `char_${e}`), i = w(a?.id || a?.chatId || `chat_${n}`), s = w(o?.name || o?.charName || "", 200), c = w(a?.name || a?.chatName || a?.title || `Chat ${n}`, 200), l = `risu_${ye(`${r}|${i}`)}`, VC = globalThis.__INLAY_VIEWER_CORE__, p = (Array.isArray(a?.message) ? a.message : []).map((m, u) => {
      const b = typeof VC?.rawMessageRole == "function" ? VC.rawMessageRole(m) : w(m?.role || m?.type || "").toLowerCase();
      return {
        index: u,
        role: b,
        text: yt(m),
        generationInfo: m?.generationInfo ?? m?.generation_info ?? null,
        isChar: b === "char" || b === "assistant" || b === "bot",
        isUser: b === "user"
      };
    });
    return {
      charIndex: e,
      chatIndex: n,
      character: o,
      chat: a,
      characterId: r,
      chatId: i,
      characterName: s,
      chatName: c,
      sessionId: l,
      messages: p
    };
  }
  async function ja() {
    try {
      return (await Za()).messages;
    } catch {
      return [];
    }
  }
  async function Oa(e, n, o, a) {
    try {
      if (!e || typeof e.elementFromPoint != "function") return -1;
      let r = await e.elementFromPoint(n, o);
      for (let i = 0; r && i < 14; i += 1) {
        for (let s = 0; s < a.length; s += 1) if (a[s] === r) return s;
        try {
          r = typeof r.getParent == "function" ? await r.getParent() : null;
        } catch {
          r = null;
        }
      }
    } catch {
    }
    return -1;
  }
  async function Ra(e, n, o) {
    for (let a = 0; a < o.length; a += 1) {
      let r;
      try {
        r = await o[a].getBoundingClientRect();
      } catch {
        continue;
      }
      if (r && e >= r.left && e <= r.right && n >= r.top && n <= r.bottom)
        return a;
    }
    return -1;
  }
  function qa(e, n, o, domCount, opts = {}) {
    const VC = globalThis.__INLAY_VIEWER_CORE__;
    const count = Number.isFinite(Number(domCount)) ? Number(domCount) : (Array.isArray(n) ? n.length : 0);
    if (typeof VC?.resolveChatMessageMatch == "function") {
      return VC.resolveChatMessageMatch(e, n, o, count, opts || {});
    }
    // Fallback if viewer-core is unavailable: newest-first DOM → reverse API index.
    const msgs = Array.isArray(n) ? n : [];
    const roleOf = (m) => typeof VC?.rawMessageRole == "function" ? VC.rawMessageRole(m) : w(m?.role || m?.type || "").toLowerCase();
    const rev = msgs.length - 1 - o;
    if (msgs.length && rev >= 0 && rev < msgs.length) {
      const m = msgs[rev];
      return {
        chatIndex: m.index,
        text: m.text || e || "",
        role: roleOf(m),
        matchMethod: "reverse",
        score: 80
      };
    }
    if (msgs.length && o >= 0 && o < msgs.length) {
      return {
        chatIndex: msgs[o].index,
        text: msgs[o].text || e || "",
        role: roleOf(msgs[o]),
        matchMethod: "dom",
        score: 40
      };
    }
    return {
      chatIndex: o,
      text: e || "",
      role: "",
      matchMethod: "fallback",
      score: 0
    };
  }
  function isSelectedCharRole(role) {
    if (t.backendSettings?.card?.generate_all_roles) return !0;
    const VC = globalThis.__INLAY_VIEWER_CORE__;
    return typeof VC?.isCharMessageRole == "function" ? VC.isCharMessageRole(role) : role === "char" || role === "assistant" || role === "bot";
  }
  function linkedCards(e) {
    if (!e) return [];
    const VC = globalThis.__INLAY_VIEWER_CORE__;
    const scoped = (t.gallery || []).filter((r) => {
      if (e.sessionId && r.session_id && r.session_id !== e.sessionId) return !1;
      if (e.characterId && r.character_id && r.character_id !== e.characterId) return !1;
      if (e.chatId && r.chat_id && r.chat_id !== e.chatId) return !1;
      return !0;
    });
    if (typeof VC?.linkCardsForMessage == "function") {
      return Me(VC.linkCardsForMessage(scoped, e));
    }
    // Fallback: hash-only identity.
    const o = scoped.filter((r) => r.content_hash && e.hash && r.content_hash === e.hash);
    return o.length ? Me(o) : [];
  }
  function ke(e) {
    const VC = globalThis.__INLAY_VIEWER_CORE__;
    if (typeof VC?.galleryForMessage == "function") return VC.galleryForMessage(t.gallery || [], e, 8);
    const n = (t.gallery || []).filter((o) => (!e?.sessionId || !o.session_id || o.session_id === e.sessionId) && (!e?.characterId || !o.character_id || o.character_id === e.characterId) && (!e?.chatId || !o.chat_id || o.chat_id === e.chatId)), o = linkedCards(e), a = /* @__PURE__ */ new Set(), r = [];
    for (const i of o) i?.id && !a.has(String(i.id)) && (a.add(String(i.id)), r.push(i));
    const selectedLen = r.length;
    const i = [...n].sort((s, c) => Number(c.created_at || 0) - Number(s.created_at || 0) || Number(c.message_index || 0) - Number(s.message_index || 0));
    for (const s of i) {
      if (r.length - selectedLen >= 8) break;
      s?.id && !a.has(String(s.id)) && (a.add(String(s.id)), r.push(s));
    }
    return r;
  }
  async function Da(e, n, opts = {}) {
    const rawSource = String(opts.source || "click"), source = rawSource === "scroll" || rawSource === "text" || rawSource === "provisional" ? rawSource : "click";
    const o = n[e];
    if (!o) return !1;
    const a = await De(o);
    if (!a || a.length < 4)
      return y("warn", "select.reject", `DOM#${e} text too short`), !1;
    // Identity is the on-screen DOM text. API align only supplies role/chatIndex.
    // (Using matched API text here made new bubbles hash-equal to an old slot → "same" → no gen.)
    const s = w(a), c = ye(s);
    if ((source === "scroll" || source === "text" || source === "provisional") && t.selectedMessage && Number(t.selectedMessage.domIndex) === Number(e) && t.selectedMessage.selectSource === source && t.selectedMessage.hash === c) return !0;
    const r = await Za();
    let prevText, nextText;
    try {
      if (n[e + 1]) prevText = await De(n[e + 1]);
      if (e > 0 && n[e - 1]) nextText = await De(n[e - 1]);
    } catch {
    }
    const i = qa(a, r.messages, e, Array.isArray(n) ? n.length : 0, { prevText, nextText }), l = w(i.role || "");
    t.lastScope = {
      charIndex: r.charIndex,
      chatIndex: r.chatIndex,
      characterId: r.characterId,
      chatId: r.chatId,
      sessionId: r.sessionId,
      character: r.character,
      chat: r.chat,
      characterName: r.characterName,
      chatName: r.chatName,
      liveChar: !0,
      liveChat: !0
    };
    if (t.selectedMessage?.hash === c && t.selectedMessage?.sessionId === r.sessionId && Number(t.selectedMessage?.chatIndex) === Number(i.chatIndex) && w(t.selectedMessage?.role || "") === l) {
      const prevDom = Number(t.selectedMessage.domIndex), domChanged = !Number.isFinite(prevDom) || prevDom !== Number(e);
      t.selectedMessage.domIndex = e, t.selectedMessage.charSlot = r.charIndex, t.selectedMessage.chatSlot = r.chatIndex, t.selectedMessage.characterId = r.characterId, t.selectedMessage.chatId = r.chatId, t.selectedMessage.characterName = r.characterName, t.selectedMessage.chatName = r.chatName, t.selectedMessage.sessionId = r.sessionId, t.selectedMessage.role = l, t.selectedMessage.matchMethod = i.matchMethod || t.selectedMessage.matchMethod, t.selectedMessage.text = s, t.selectedMessage.preview = We(s, 56), t.selectedMessage.selectedAt = Date.now(), t.selectedMessage.selectSource = source, y("info", "select.za", `hash=${c.slice(0, 16)} session=${r.sessionId || "-"} msg#${i.chatIndex} role=${l || "-"} via=${i.matchMethod || "-"} chars=${(i.text || s || "").length} same`), y("info", `select.${source}`, `char[${r.charIndex}] ${r.characterName} / chat[${r.chatIndex}] ${r.chatName} / msg#${i.chatIndex} role=${l || "-"} via=${i.matchMethod} same${domChanged ? " · DOM reload" : ""}`);
      if (source !== "scroll") {
        try {
          await ce(r.sessionId);
        } catch {
        }
      }
      let linked = linkedCards(t.selectedMessage);
      if (t.selectedMessage.hasImage = linked.length > 0, t.selectedMessage.cardCount = linked.length, t.selectedMessage.paragraphsWithImages = [...new Set(linked.map((C) => C.paragraph))].sort((C, S) => Number(C) - Number(S)), linked.length && (t.lastImagedMessage = {
        hash: t.selectedMessage.hash,
        chatIndex: t.selectedMessage.chatIndex,
        messageIndex: t.selectedMessage.messageIndex,
        sessionId: t.selectedMessage.sessionId,
        domIndex: t.selectedMessage.domIndex
      }), domChanged) {
        y("info", "select.same", `msg#${i.chatIndex} DOM#${prevDom}→#${e} rebind`);
        if (source === "scroll") {
          // Only rebind pinTarget to this bubble when it owns images; else keep lastImaged pin.
          if (linked.length && t.overlayUi) {
            t.overlayUi.pinTarget = o, t.overlayUi._pinDomIndex = e;
            try {
              const doc = t.overlayUi.doc || t.hostDoc;
              const els = t._msgElsCache?.doc === doc ? t._msgElsCache.els : null;
              if (doc && els) rememberNearbyMsgDoms(doc, els, e);
            } catch {
            }
            // Cache-hit hop: reuse pooled thumbs immediately (no wait for place create).
            const hopCards = Me(linked);
            const hopped = assembleMarkersFromPool(hopCards);
            if (hopped?.length) {
              const prev = t.overlayUi.markers || [];
              const keep = new Set(hopped.map((m) => String(m.card?.id || "")));
              parkMarkersToPool(prev.filter((m) => !keep.has(String(m?.card?.id || ""))));
              t.overlayUi.markers = hopped;
              t.overlayUi._lastStickyThumbHtmlId = null;
              t.overlayUi._flashSeg = null;
              invalidateOverlayLayoutCache();
              scheduleStickySync(!0);
            }
          }
          linked.length ? scheduleOverlayPlace(40) : scheduleStickySync();
          await onSelectionChanged(linked.length ? "content" : "chrome");
        } else {
          Ce(), scheduleOverlayPlace(80), await onSelectionChanged("content");
        }
        linked = linkedCards(t.selectedMessage), t.selectedMessage.hasImage = linked.length > 0, t.selectedMessage.cardCount = linked.length;
      } else {
        if (source === "scroll") {
          if (linked.length && t.overlayUi) {
            t.overlayUi.pinTarget = o, t.overlayUi._pinDomIndex = e;
            try {
              const doc = t.overlayUi.doc || t.hostDoc;
              const els = t._msgElsCache?.doc === doc ? t._msgElsCache.els : null;
              if (doc && els) rememberNearbyMsgDoms(doc, els, e);
            } catch {
            }
          }
          scheduleStickySync();
          if (linked.length && !(t.overlayUi?.markers?.length)) scheduleOverlayPlace(40);
        } else {
          Ce();
          if (linked.length && !(t.overlayUi?.markers?.length)) scheduleOverlayPlace(80);
        }
      }
      if (linked.length) return !0;
      if (source === "scroll" || source === "provisional") return !0;
      if (source === "text") return !isSelectedCharRole(l) ? !0 : (y("info", "select.same", `msg#${i.chatIndex} noImage → retry`), await Ka(t.selectedMessage.text, t.selectedMessage.hash), !0);
      return !isSelectedCharRole(l) ? !0 : (y("info", "select.same", `msg#${i.chatIndex} noImage → retry`), await Ka(t.selectedMessage.text, t.selectedMessage.hash), !0);
    }
    const p = Xt(a || s), m = {
      domIndex: e,
      chatIndex: i.chatIndex,
      messageIndex: i.chatIndex,
      charSlot: r.charIndex,
      chatSlot: r.chatIndex,
      characterId: r.characterId,
      chatId: r.chatId,
      characterName: r.characterName,
      chatName: r.chatName,
      sessionId: r.sessionId,
      role: l,
      matchMethod: i.matchMethod || "fallback",
      text: s,
      hash: c,
      paragraphCount: p.length || 1,
      preview: We(s, 56),
      selectedAt: Date.now(),
      selectSource: source,
      hasImage: !1,
      cardCount: 0,
      paragraphsWithImages: [],
      matchMode: "pending"
    };
    let u = linkedCards(m);
    if (!u.length && source !== "scroll") {
      try {
        u = await maybeRebindAndLink(m, r);
      } catch {
      }
    }
    let b = u.length ? "hash" : "none";
    m.hasImage = u.length > 0, m.cardCount = u.length, m.paragraphsWithImages = [...new Set(u.map((C) => C.paragraph))].sort((C, S) => Number(C) - Number(S)), m.matchMode = b, t.selectedMessage = m, t.lastOverlayFocusHash = c, y("info", `select.${source}`, `char[${r.charIndex}] ${r.characterName} / chat[${r.chatIndex}] ${r.chatName} / msg#${m.chatIndex} role=${l || "-"} via=${m.matchMethod} img=${m.hasImage ? "Y" : "N"} cards=${m.cardCount}`), y("info", "select.za", `hash=${c.slice(0, 16)} session=${r.sessionId || "-"} msg#${m.chatIndex} role=${l || "-"} via=${m.matchMethod || "-"} chars=${(i.text || s || "").length}`), y("info", "select.message", `DOM#${e} msg#${m.chatIndex} hash=${c.slice(0, 8)} role=${l || "-"} chars=${(i.text || s || "").length} "${m.preview}"`);
    if (source !== "scroll") {
      try {
        await ce(r.sessionId, !0);
      } catch {
      }
    }
    u = linkedCards(t.selectedMessage);
    if (!u.length && source !== "scroll") {
      try {
        u = await maybeRebindAndLink(t.selectedMessage, r);
      } catch {
      }
    }
    t.selectedMessage.hasImage = u.length > 0, t.selectedMessage.cardCount = u.length, t.selectedMessage.paragraphsWithImages = [...new Set(u.map((C) => C.paragraph))].sort((C, S) => Number(C) - Number(S)), t.selectedMessage.matchMode = u.length ? "hash" : "none";
    if (u.length) {
      t.lastImagedMessage = {
        hash: t.selectedMessage.hash,
        chatIndex: t.selectedMessage.chatIndex,
        messageIndex: t.selectedMessage.messageIndex,
        sessionId: t.selectedMessage.sessionId,
        domIndex: t.selectedMessage.domIndex
      };
    } else if (source !== "scroll") {
      // No hash cards → do not keep another message's images as this selection.
      t.lastImagedMessage = null;
    }
    if (source === "scroll") {
      // Keep previous sticky markers when the new message has no images (avoids wipe + gallery thrash).
      if (u.length) {
        if (t.overlayUi) {
        t.overlayUi.pinTarget = o, t.overlayUi._pinDomIndex = e;
        try {
          const doc = t.overlayUi.doc || t.hostDoc;
          const els = t._msgElsCache?.doc === doc ? t._msgElsCache.els : null;
          if (doc && els) rememberNearbyMsgDoms(doc, els, e);
        } catch {
        }
      }
        scheduleOverlayPlace(40), await onSelectionChanged("content");
      } else scheduleStickySync(), await onSelectionChanged("chrome");
      return !0;
    }
    return await onSelectionChanged("content"), scheduleOverlayPlace(80), t.debugUi?.refreshSoon && t.debugUi.refreshSoon(), (source === "click" || source === "text") && await ensureMessageInView(o), source === "provisional" ? !0 : !isSelectedCharRole(l) ? (y("info", "select.user", "유저 메시지 — 자동 생성 안 함"), !0) : u.length ? (y("info", "select.hasImage", `cards=${u.length} · 재생성은 뷰어 버튼`), !0) : (y("info", "select.noImage", "해시 이미지 없음 → 태그부터 생성"), await Ka(t.selectedMessage.text, t.selectedMessage.hash), !0);
  }
  async function ensureMessageInView(el) {
    if (!el) return;
    try {
      const n = await el.getBoundingClientRect();
      if (!n) return;
      const o = typeof window < "u" && window.innerHeight || 800;
      if (n.top >= 72 && n.bottom <= o - 48) return;
      const a = await findScrollParent(el), r = n.top + n.height * 0.5 - o * 0.45;
      if (a) {
        const i = await getScrollTopSafe(a);
        if (await setScrollTopSafe(a, i + r)) return;
      }
      typeof window < "u" && window.scrollBy?.({ top: r, behavior: "auto" });
    } catch {
    }
  }
  async function Fa(e, n, o, opts = {}) {
    const a = await dt(await qe(e));
    if (!a.length)
      return y("warn", "select.fail", "no message elements"), !1;
    let r = await Oa(e, n, o, a);
    return r === -2 ? !1 : (r < 0 && (r = await Ra(n, o, a)), r < 0 ? (y("info", "select.miss", `x=${Math.round(n)} y=${Math.round(o)} msgs=${a.length}`), !1) : Da(r, a, {
      source: opts.source || "click"
    }));
  }
  function clickTrackEnabled() {
    return (t.backendSettings?.card || {}).click_message_track !== !1;
  }
  function messageSelectGesture() {
    return (t.backendSettings?.card || {}).message_select_gesture === "double" ? "double" : "single";
  }
  function messageSelectDetail() {
    return messageSelectGesture() === "double" ? 2 : 1;
  }
  function textDragSelectEnabled() {
    return (t.backendSettings?.card || {}).text_drag_select !== !1;
  }
  async function hasTextSelection(e) {
    try {
      const n = typeof e.getSelection == "function" ? await e.getSelection() : null, o = typeof n?.toString == "function" ? await n.toString() : String(n || "");
      return !!String(o || "").trim();
    } catch {
      return !1;
    }
  }
  async function excludedMessageTarget(e, n, o) {
    for (const candidate of [
      t.galleryUi?.panel,
      t.debugUi?.panel,
      t.debugUi?.fab,
      t.overlayUi?.pinned,
      t.overlayUi?.fullscreen
    ]) {
      try {
        if (candidate && await hitEl(candidate, n, o)) return !0;
      } catch {
      }
    }
    try {
      let a = await e.elementFromPoint(n, o);
      for (let r = 0; a && r < 12; r += 1) {
        try {
          if (String(await a.getAttribute?.("x-inlay-ignore") || "") === "true") return !0;
        } catch {
        }
        a = typeof a.getParent == "function" ? await a.getParent() : null;
      }
    } catch {
    }
    return !1;
  }
  function scrollTrackEnabled() {
    return (t.backendSettings?.card || {}).scroll_message_track !== !1;
  }
  async function getCachedMsgEls(e) {
    const n = t._msgElsCache;
    if (n && n.doc === e && Date.now() - n.at < 450 && Array.isArray(n.els) && n.els.length) {
      const hint = Number(t.overlayUi?._pinDomIndex ?? t.selectedMessage?.domIndex ?? t.lastImagedMessage?.domIndex);
      if (Number.isFinite(hint)) rememberNearbyMsgDoms(e, n.els, hint);
      return n.els;
    }
    const o = await dt(await qe(e));
    t._msgElsCache = {
      doc: e,
      at: Date.now(),
      els: o || []
    };
    const hint = Number(t.overlayUi?._pinDomIndex ?? t.selectedMessage?.domIndex ?? t.lastImagedMessage?.domIndex);
    if (Number.isFinite(hint)) rememberNearbyMsgDoms(e, t._msgElsCache.els, hint);
    return t._msgElsCache.els;
  }
  /** Prefer cursor-containing message; expand from last selection to avoid N SafeDOM rect reads. */
  async function pickMsgIndexNearPointer(els, anchorY, anchorX, vh) {
    const n = els?.length || 0;
    if (!n) return -1;
    const hint = Number(t.selectedMessage?.domIndex);
    const start = Number.isFinite(hint) ? Math.max(0, Math.min(n - 1, hint)) : Math.min(n - 1, Math.floor(n * 0.5));
    const rects = new Array(n);
    let contain = -1, containH = Infinity, best = -1, bestDist = Infinity;
    const consider = (i, p) => {
      if (!p || p.bottom <= 0 || p.top >= vh) return;
      const midY = (p.top + p.bottom) * 0.5;
      const midX = Number.isFinite(Number(p.left)) && Number.isFinite(Number(p.right)) ? (Number(p.left) + Number(p.right)) * 0.5 : null;
      const dist = midX != null && anchorX != null ? Math.hypot(midX - anchorX, midY - anchorY) : Math.abs(midY - anchorY);
      if (dist < bestDist) bestDist = dist, best = i;
      const inY = anchorY >= p.top && anchorY <= p.bottom;
      const inX = anchorX == null || !Number.isFinite(Number(p.left)) || !Number.isFinite(Number(p.right)) || anchorX >= Number(p.left) && anchorX <= Number(p.right);
      if (inY && inX) {
        const h = Math.max(1, p.bottom - p.top);
        if (h < containH) containH = h, contain = i;
      }
    };
    for (let d = 0; d < n; d += 1) {
      const idxs = d === 0 ? [start] : [start - d, start + d].filter((i) => i >= 0 && i < n);
      for (const i of idxs) {
        if (rects[i] !== void 0) continue;
        let p = null;
        try {
          p = await els[i].getBoundingClientRect();
        } catch {
          p = null;
        }
        rects[i] = p, consider(i, p);
      }
      if (contain >= 0) return contain;
      // After a small ring, if we already have a visible best and ring is outside cursor band, stop early.
      if (d >= 2 && best >= 0) {
        const bp = rects[best];
        if (bp && (anchorY < bp.top - 120 || anchorY > bp.bottom + 120)) break;
      }
    }
    if (contain >= 0) return contain;
    if (best >= 0) return best;
    const VC = globalThis.__INLAY_VIEWER_CORE__;
    for (let i = 0; i < n; i += 1) {
      if (rects[i] !== void 0) continue;
      try {
        rects[i] = await els[i].getBoundingClientRect();
      } catch {
        rects[i] = null;
      }
    }
    return typeof VC?.pickMessageIndexNearPoint == "function" ? VC.pickMessageIndexNearPoint(rects, anchorY, anchorX, vh) : best;
  }
  async function trackMessageByScroll() {
    if (!scrollTrackEnabled() || t.uiOpen || t._scrollTrackBusy) return;
    const e = t.overlayUi?.doc || await ue();
    if (!e) return;
    t._scrollTrackBusy = !0;
    try {
      const n = await getCachedMsgEls(e);
      if (!n.length) return;
      const o = typeof window < "u" && window.innerHeight || 800;
      const py = Number(t._pointerClientY), px = Number(t._pointerClientX);
      const anchorY = Number.isFinite(py) ? py : o * 0.5;
      const anchorX = Number.isFinite(px) ? px : null;
      const pick = await pickMsgIndexNearPointer(n, anchorY, anchorX, o);
      if (pick < 0) return;
      // Always re-enter Da — same DOM index can hold new text after a reply finishes.
      await Da(pick, n, { source: "scroll" });
    } finally {
      t._scrollTrackBusy = !1;
    }
  }
  function scheduleScrollTrack() {
    if (!scrollTrackEnabled() || t.uiOpen) return;
    if (!t._scrollSettle) {
      const VC = globalThis.__INLAY_VIEWER_CORE__, make = VC?.createScrollSettleTracker, settleMs = 55;
      t._scrollSettle = typeof make == "function" ? make({
        delayMs: settleMs,
        onSettle: () => {
          trackMessageByScroll().catch(() => {
          });
        }
      }) : {
        bump() {
          clearTimeout(t._scrollSettleTimer);
          t._scrollSettleTimer = setTimeout(() => {
            t._scrollSettleTimer = null, trackMessageByScroll().catch(() => {
            });
          }, settleMs);
        },
        settleNow() {
          clearTimeout(t._scrollSettleTimer), t._scrollSettleTimer = null, trackMessageByScroll().catch(() => {
          });
        },
        cancel() {
          clearTimeout(t._scrollSettleTimer), t._scrollSettleTimer = null;
        }
      };
    }
    t._scrollSettle.bump();
  }
  function settleScrollTrackNow() {
    if (!scrollTrackEnabled() || t.uiOpen) return;
    if (!t._scrollSettle) scheduleScrollTrack();
    t._scrollSettle?.settleNow?.();
  }
  function invalidateOverlayLayoutCache() {
    const e = t.overlayUi;
    e && (e.activeSegment = null, e._lastReading = null, e._segmentHidden = !1, e._lastThumbPct = null, e._lastInlineOn = null, e._lastOverlayX = null, e._lastOverlayY = null, e._lastMobileOn = null, e._lastCorner = null, e._lastMobilePinnedId = null, e._lastVpW = null, e._lastVpH = null, e._syncedViewerCardId = null, e._lastStickyThumbHtmlId = null, e._stickyThumbUserHidden = !1, e._stickyThumbHiddenId = "", e._lastStickyUserHidden = null);
  }
  async function Fe() {
    const e = t.overlayUi;
    if (e?.layer) {
      try {
        await e.layer.setInnerHTML("");
      } catch {
      }
      if (e.markers = [], e._stickyPool && e._stickyPool.clear(), e.pinTarget = null, e._pinDomIndex = null, e.edgeHint = null, invalidateOverlayLayoutCache(), typeof e.hidePreview == "function") try {
        await e.hidePreview();
      } catch {
      }
      else e.preview && typeof e.preview.setStyleAttribute == "function" && await e.preview.setStyleAttribute("position:fixed;display:none;z-index:99996;width:220px;pointer-events:none;");
    }
  }
  function stickyFocusMessage() {
    const VC = globalThis.__INLAY_VIEWER_CORE__;
    if (typeof VC?.galleryFocusMessage == "function") return VC.galleryFocusMessage(t.selectedMessage, t.lastImagedMessage, t.gallery);
    if (t.selectedMessage && linkedCards(t.selectedMessage).length) return t.selectedMessage;
    return t.lastImagedMessage || t.selectedMessage || null;
  }
  function stickyCardKey(cards) {
    return (cards || []).map((c) => String(c?.id || "")).filter(Boolean).sort().join("|");
  }
  function stickyMarkerKey(markers) {
    return (markers || []).map((m) => String(m?.card?.id || "")).filter(Boolean).sort().join("|");
  }

  const STICKY_POOL_CAP = 30;
  function stickyPool() {
    const e = t.overlayUi;
    if (!e) return null;
    if (!e._stickyPool) e._stickyPool = /* @__PURE__ */ new Map();
    return e._stickyPool;
  }
  function hideStickyMarker(m) {
    if (!m) return;
    try {
      if (m.el && typeof m.el.setStyleAttribute == "function") m.el.setStyleAttribute(ze(0, -9999, Pt, !1));
    } catch {
    }
    try {
      if (m.thumb && typeof m.thumb.setStyleAttribute == "function") m.thumb.setStyleAttribute("position:fixed;display:none;");
    } catch {
    }
  }
  function trimStickyPool() {
    const pool = stickyPool();
    if (!pool || pool.size <= STICKY_POOL_CAP) return;
    const active = new Set((t.overlayUi?.markers || []).map((m) => String(m?.card?.id || "")).filter(Boolean));
    for (const [id, m] of pool) {
      if (pool.size <= STICKY_POOL_CAP) break;
      if (active.has(id)) continue;
      pool.delete(id);
      removeStickyMarkerNodes([m]).catch(() => {
      });
    }
  }
  function parkMarkersToPool(markers) {
    const pool = stickyPool();
    if (!pool) return;
    for (const m of markers || []) {
      const id = String(m?.card?.id || "");
      if (!id || !m?.thumb) continue;
      hideStickyMarker(m);
      pool.set(id, m);
    }
    trimStickyPool();
  }
  function takePooledMarker(card, src) {
    const pool = stickyPool();
    const id = String(card?.id || "");
    if (!pool || !id) return null;
    const m = pool.get(id);
    if (!m?.thumb) return null;
    pool.delete(id);
    m.card = card;
    if (src && (!m._thumbSrc || m._thumbSrc !== src)) {
      m._thumbSrc = src;
      // Keep painted HTML if same bytes already in the node; else force one paint later.
      if (m._paintedSrc && m._paintedSrc !== src) m._paintedSrc = "", m._thumbHtmlId = "";
    }
    return m;
  }
  /** Assemble sticky markers from pool/current when every card already has a painted thumb. */
  function assembleMarkersFromPool(cards) {
    const e = t.overlayUi;
    if (!e || !(cards || []).length) return null;
    const pool = stickyPool();
    const byId = /* @__PURE__ */ new Map();
    for (const m of e.markers || []) {
      const id = String(m?.card?.id || "");
      if (id) byId.set(id, m);
    }
    if (pool) for (const [id, m] of pool) if (!byId.has(id)) byId.set(id, m);
    const slots = Math.max(1, cards.length);
    const ranked = (cards || []).map((card, ci) => ({
      card,
      ci,
      yPercent: Ot(card, ci, slots)
    })).sort((a, b) => a.yPercent - b.yPercent || a.ci - b.ci);
    const out = [];
    for (const row of ranked) {
      const id = String(row.card?.id || "");
      const m = byId.get(id);
      if (!m?.thumb || !m._thumbSrc) return null;
      m.card = row.card, m.yPercent = row.yPercent, m.paragraph = row.card?.paragraph, m.line = row.ci;
      out.push(m);
      if (pool) pool.delete(id);
    }
    return out;
  }
  async function prebuildStickyPool(ids) {
    const e = t.overlayUi, n = e?.doc || t.hostDoc;
    if (!e?.layer || !n || !(ids || []).length) return;
    const pool = stickyPool();
    if (!pool) return;
    const active = new Set((e.markers || []).map((m) => String(m?.card?.id || "")).filter(Boolean));
    for (const raw of ids) {
      const id = String(raw || "");
      if (!id || pool.has(id) || active.has(id)) continue;
      const card = (t.gallery || []).find((c) => String(c?.id) === id);
      if (!card) continue;
      let src = "";
      try {
        const fb = Ie(card);
        if (typeof fb == "string" && /^data:image\//i.test(fb)) src = fb;
      } catch {
      }
      if (!src) continue;
      try {
        const X = await H(n, "div", {
          style: "position:fixed;display:none;z-index:99970;",
          html: `<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block" />`
        });
        await e.layer.appendChild(X);
        const te = await H(n, "div", {
          style: ze(0, -9999, Pt, !1),
          html: "🖼"
        });
        await e.layer.appendChild(te);
        pool.set(id, {
          el: te,
          thumb: X,
          card,
          paragraph: card.paragraph,
          yPercent: 0,
          active: !1,
          edge: null,
          line: 0,
          hitPad: 12,
          _thumbSrc: src,
          _paintedSrc: src,
          _thumbHtmlId: id,
          _pinHtml: "🖼"
        });
      } catch {
      }
    }
    trimStickyPool();
  }

  async function removeStickyMarkerNodes(markers) {
    for (const m of markers || []) {
      for (const el of [m?.thumb, m?.el]) {
        if (!el) continue;
        try {
          if (typeof el.remove == "function") await el.remove();
          else if (el.parentNode && typeof el.parentNode.removeChild == "function") await el.parentNode.removeChild(el);
          else if (typeof el.setStyleAttribute == "function") await el.setStyleAttribute("position:fixed;display:none;");
        } catch {
        }
      }
    }
  }
  function ze(e, n, o, a) {
    return [
      "position:fixed",
      `left:${e}px`,
      `top:${n}px`,
      "z-index:99974",
      `width:${o}px`,
      `height:${o}px`,
      "border-radius:50%",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "font-size:11px",
      a ? "pointer-events:auto" : "pointer-events:none",
      a ? "opacity:1" : "opacity:0",
      "background:rgba(124,108,255,.94)",
      "color:#fff",
      "border:1px solid rgba(255,255,255,.22)",
      "box-shadow:0 2px 8px rgba(0,0,0,.35)"
    ].join(";");
  }
  function edgePosCss(box = {}) {
    return [
      box.left != null ? `left:${box.left}px` : "left:auto",
      box.right != null ? `right:${box.right}px` : "right:auto",
      box.top != null ? `top:${box.top}px` : "top:auto",
      box.bottom != null ? `bottom:${box.bottom}px` : "bottom:auto"
    ];
  }
  function zeEdge(edge, a) {
    const o = Math.max(1, Number(edge?.size) || Pt);
    return [
      "position:fixed",
      ...edgePosCss(edge),
      "z-index:99974",
      `width:${o}px`,
      `height:${o}px`,
      "border-radius:50%",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "font-size:11px",
      a ? "pointer-events:auto" : "pointer-events:none",
      a ? "opacity:1" : "opacity:0",
      "background:rgba(124,108,255,.94)",
      "color:#fff",
      "border:1px solid rgba(255,255,255,.22)",
      "box-shadow:0 2px 8px rgba(0,0,0,.35)"
    ].join(";");
  }
  function za(e, n, o) {
    return [
      "position:fixed",
      `left:${e}px`,
      `top:${n}px`,
      "z-index:99974",
      `width:${o}px`,
      `height:${o}px`,
      "border-radius:50%",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "font-size:8px",
      "pointer-events:auto",
      "opacity:1",
      "background:rgba(15,23,42,.92)",
      "color:#e2e8f0",
      "border:1px solid rgba(124,108,255,.5)",
      "box-shadow:0 2px 6px rgba(0,0,0,.3)"
    ].join(";");
  }
  function Ga() {
    return (t.backendSettings?.card || {}).overlay_hide_offscreen !== !1;
  }
  function scheduleOverlayPlace(delayMs = 100) {
    if (t.uiOpen || t._hostChromeBlocked) return;
    t._overlayPlaceTimer && clearTimeout(t._overlayPlaceTimer);
    t._overlayPlaceTimer = setTimeout(() => {
      t._overlayPlaceTimer = null;
      if (t.uiOpen || t._hostChromeBlocked) return;
      he().catch(() => {
      });
    }, Math.max(40, Number(delayMs) || 100));
  }
  async function onSelectionChanged(mode = "content") {
    if (t.uiOpen) return;
    const VC = globalThis.__INLAY_VIEWER_CORE__;
    const next = mode || "content";
    t._viewerPaintJob = VC?.mergeViewerPaintJob ? VC.mergeViewerPaintJob(t._viewerPaintJob, next) : next;
    if (t._viewerPaintScheduled) return;
    t._viewerPaintScheduled = !0;
    const run = async () => {
      t._viewerPaintScheduled = !1;
      const job = t._viewerPaintJob || "content";
      t._viewerPaintJob = null;
      if (t.uiOpen) return;
      if (t.galleryUi?.renderGal) await t.galleryUi.renderGal(job);
    };
    if (typeof queueMicrotask == "function") queueMicrotask(() => {
      run().catch(() => {
      });
    });
    else setTimeout(() => {
      run().catch(() => {
      });
    }, 0);
  }

  const NEARBY_DOM_RADIUS = 2;
  const NEARBY_DOM_TTL_MS = 2500;
  function rememberNearbyMsgDoms(doc, els, centerIndex, radius = NEARBY_DOM_RADIUS) {
    try {
      if (!doc || !Array.isArray(els) || !els.length) return;
      const VC = globalThis.__INLAY_VIEWER_CORE__;
      const win = typeof VC?.nearbyDomIndexWindow == "function"
        ? VC.nearbyDomIndexWindow(centerIndex, els.length, radius)
        : null;
      const r = Math.max(0, Number(radius) || NEARBY_DOM_RADIUS);
      const c = Math.max(0, Math.min(els.length - 1, Number(centerIndex) || 0));
      const lo = win ? win.lo : Math.max(0, c - r);
      const hi = win ? win.hi : Math.min(els.length - 1, c + r);
      const byIndex = /* @__PURE__ */ Object.create(null);
      for (let i = lo; i <= hi; i += 1) {
        if (els[i]) byIndex[i] = els[i];
      }
      t._nearbyMsgDomCache = {
        doc,
        at: Date.now(),
        center: c,
        radius: r,
        lo,
        hi,
        byIndex
      };
    } catch {
    }
  }
  function peekCachedMsgDom(doc, domIndex) {
    try {
      const cache = t._nearbyMsgDomCache;
      if (!cache || cache.doc !== doc) return null;
      if (Date.now() - cache.at > NEARBY_DOM_TTL_MS) return null;
      const idx = Number(domIndex);
      if (!Number.isFinite(idx) || idx < 0) return null;
      return cache.byIndex?.[idx] || null;
    } catch {
      return null;
    }
  }
  function isNearbyDomMove(prevIndex, nextIndex, radius = NEARBY_DOM_RADIUS) {
    const VC = globalThis.__INLAY_VIEWER_CORE__;
    if (typeof VC?.isNearbyDomIndex == "function") return VC.isNearbyDomIndex(prevIndex, nextIndex, radius);
    const a = Number(prevIndex), b = Number(nextIndex);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= (Number(radius) || NEARBY_DOM_RADIUS);
  }
  function warmStickyMarkerImages(cards, focus) {
    try {
      const N = globalThis.__INLAY_NATIVE__;
      const VC = globalThis.__INLAY_VIEWER_CORE__;
      const extra = (cards || []).map((c) => c?.id).filter(Boolean);
      // Current sticky markers + same-chat messages at focus ±2 (data-URL cache for snappy scroll).
      const focusMsg = focus || stickyFocusMessage() || t.selectedMessage || t.lastImagedMessage || null;
      let ids = extra;
      if (typeof VC?.nearbyMessageImageIds == "function") {
        ids = VC.nearbyMessageImageIds(t.gallery || [], focusMsg, 2, extra);
      } else if (!ids.length && focusMsg) {
        const idx = Number(focusMsg.messageIndex ?? focusMsg.message_index);
        const sessionId = String(focusMsg.sessionId || "");
        ids = (t.gallery || []).filter((c) => {
          if (!c?.id) return !1;
          if (sessionId && c.session_id && c.session_id !== sessionId) return !1;
          const mi = Number(c.message_index);
          return Number.isFinite(idx) && Number.isFinite(mi) && Math.abs(mi - idx) <= 2;
        }).map((c) => c.id);
      }
      ids = [...new Set((ids || []).filter(Boolean))];
      if (!ids.length) return;
      if (typeof N?.pinImageUrls == "function") N.pinImageUrls(ids);
      if (typeof N?.warmImages == "function") {
        N.warmImages(ids).then(() => {
          const e = t.overlayUi;
          if (e?.markers?.length) {
            for (const mk of e.markers) {
              try {
                const fresh = Ie(mk.card);
                if (typeof fresh == "string" && /^data:image\//i.test(fresh) && fresh !== mk._thumbSrc) mk._thumbSrc = fresh;
              } catch {
              }
            }
          }
          // Pre-paint nearby thumbs off-screen so message hops skip SafeDOM create+data URL inject.
          prebuildStickyPool(ids).catch(() => {
          });
        }).catch(() => {
        });
      } else {
        prebuildStickyPool(ids).catch(() => {
        });
      }
    } catch {
    }
  }
  function scheduleStickySync(forceFull = !1) {
    if (forceFull && t.overlayUi) t.overlayUi._stickyWantFull = !0;
    Ce();
  }
  /** Instant within-message image swap: estimate reading% from last pin rect + scrollY delta. */
  function stickyFlashOnScroll() {
    const e = t.overlayUi;
    if (t.uiOpen || !e?.markers?.length || !Nt()) return;
    const showStyle = e._stickyThumbShowStyle;
    if (!showStyle || !e._pinRectCache || e._pinRectAtScrollY == null) return;
    const scrollY = Number(e._liveScrollY);
    if (!Number.isFinite(scrollY)) return;
    const base = e._pinRectCache;
    const delta = scrollY - Number(e._pinRectAtScrollY);
    const est = {
      top: Number(base.top) - delta,
      bottom: Number(base.bottom) - delta,
      left: Number(base.left) || 0,
      right: Number(base.right) || 0,
      width: Number(base.width) || 0,
      height: Number(base.height) || 0
    };
    const r = viewerViewport().vh, i = 0.5;
    const VC = globalThis.__INLAY_VIEWER_CORE__;
    let c = typeof VC?.readingPercentInMessage == "function" ? VC.readingPercentInMessage(est, r, i) : na(est, r, i);
    if (c == null) c = typeof VC?.clampReadingPercent == "function" ? VC.clampReadingPercent(est, r, i) : cn(est, r, i);
    if (c == null || !Number.isFinite(Number(c))) return;
    const markerPcts = e.markers.map((T) => Number(T.yPercent) || 0);
    const l = typeof VC?.activeSegmentIndex == "function" ? VC.activeSegmentIndex(markerPcts, c) : dn(markerPcts, c);
    if (l < 0) return;
    if (l === e._flashSeg && e._flashReading != null && Math.abs(e._flashReading - c) < 0.5) return;
    const next = e.markers[l];
    if (!next?.thumb || !next._thumbSrc) return;
    const prevSeg = e._flashSeg != null ? e._flashSeg : e.activeSegment;
    const prev = Number.isFinite(prevSeg) && prevSeg >= 0 ? e.markers[prevSeg] : null;
    const hideStyle = "position:fixed;display:none;";
    const activeId = String(next.card?.id || "");
    const composeThumb = typeof VC?.composeStickyThumbHtml == "function" ? VC.composeStickyThumbHtml : (src0) => `<img src="${src0}" style="width:100%;height:100%;object-fit:cover;display:block" />`;
    const needsPaint = typeof VC?.stickyThumbNeedsHtmlPaint == "function"
      ? VC.stickyThumbNeedsHtmlPaint(next._paintedSrc, next._thumbSrc, next._thumbHtmlId, activeId)
      : next._thumbHtmlId !== activeId || next._paintedSrc !== next._thumbSrc;
    e._flashGen = (e._flashGen || 0) + 1;
    const flashGen = e._flashGen;
    e._flashSeg = l;
    e._flashReading = c;
    // Optimistic: claim active segment so a slow Ht does not briefly flash the old shot.
    e.activeSegment = l;
    e._lastReading = c;
    (async () => {
      try {
        if (flashGen !== e._flashGen) return;
        // Show/hide only when this marker already holds its image — avoid re-injecting MB data URLs.
        if (needsPaint && typeof next.thumb.setInnerHTML == "function") {
          await next.thumb.setInnerHTML(composeThumb(next._thumbSrc));
          if (flashGen !== e._flashGen) return;
          next._thumbHtmlId = activeId, next._paintedSrc = next._thumbSrc, e._lastStickyThumbHtmlId = activeId;
        }
        if (flashGen !== e._flashGen) return;
        await next.thumb.setStyleAttribute(showStyle);
        if (flashGen !== e._flashGen) return;
        if (prev?.thumb && prev !== next) await prev.thumb.setStyleAttribute(hideStyle);
      } catch {
      }
    })();
  }
  function Ce() {
    if (t.uiOpen) return;
    if (!t.overlayUi?.markers?.length) return;
    if (t.overlaySyncing) {
      t.overlaySyncPending = !0;
      return;
    }
    const wantFull = !!t.overlayUi._stickyWantFull;
    t.overlayUi._stickyWantFull = !1;
    t.overlaySyncing = !0, Ht({ light: !wantFull }).catch(() => {
    }).finally(() => {
      t.overlaySyncing = !1, t.overlaySyncPending && (t.overlaySyncPending = !1, Ce());
    });
  }
  async function fe(e, n, o, a = !1) {
    if (!e || typeof e.addEventListener != "function") return null;
    if (a) {
      const r = await D(`listenCap:${n}`, () => e.addEventListener(n, o, {
        capture: !0,
        passive: !0
      }), null);
      return r ?? D(`listenCapBool:${n}`, () => e.addEventListener(n, o, !0), null);
    }
    return D(`listen:${n}`, () => e.addEventListener(n, o), null);
  }
  async function de(e, n, o) {
    !e || o == null || typeof e.removeEventListener != "function" || (await D("rmListen", () => e.removeEventListener(n, o), null), await D("rmListenId", () => e.removeEventListener(o), null));
  }
  async function zt() {
    const e = t.overlayUi, n = e?.extraScrollBindings || [];
    for (const o of n) await de(o.el, o.type || "scroll", o.id);
    e && (e.extraScrollBindings = []);
  }
  async function Ha(e) {
    const n = t.overlayUi;
    if (!n?.onStickyScroll || !e) return;
    await zt();
    const o = [], a = /* @__PURE__ */ new Set();
    let r = e;
    for (let i = 0; r && i < 18; i += 1) {
      if (!a.has(r)) {
        a.add(r);
        for (const s of ["scroll", "scrollend"]) {
          const c = await fe(r, s, n.onStickyScroll, !0);
          c != null && o.push({
            el: r,
            id: c,
            type: s
          });
        }
      }
      try {
        r = typeof r.getParent == "function" ? await r.getParent() : null;
      } catch {
        r = null;
      }
    }
    n.extraScrollBindings = o, y("info", "overlay.scrollBind", `ancestors=${o.length}`);
  }
  async function Wa(e) {
    const n = t.overlayUi;
    n?.onStickyScroll && (e && (n.chatScrollEl !== e || n.chatScrollId == null) && (n.chatScrollEl && n.chatScrollId != null && await de(n.chatScrollEl, "scroll", n.chatScrollId), n.chatScrollEl = e, n.chatScrollId = await fe(e, "scroll", n.onStickyScroll, !0)), n.pinTarget && await Ha(n.pinTarget), Gt());
  }
  function Gt() {
    const e = t.overlayUi;
    !e || e.segmentWatchId != null || (e._scopeTick = 0,     e.segmentWatchId = setInterval(() => {
      const n = t.overlayUi;
      if (n && (n._scopeTick = (n._scopeTick || 0) + 1, n._scopeTick % 24 === 0 && !(t.jobsInFlight.size || (t.jobProgress && formatViewerJob(t.jobProgress)?.busy)) && Z().catch(() => {
      }), !!t.selectedMessage)) {
        const jobBusy = !!(t.jobsInFlight.size || (t.jobProgress && formatViewerJob(t.jobProgress)?.busy));
        if (t.selectedMessage.sessionId && t.lastScope?.sessionId && t.selectedMessage.sessionId !== t.lastScope.sessionId) {
          // Never drop the message link mid-generation.
          if (jobBusy || (t.selectedMessage.hash && t.jobsInFlight.has(t.selectedMessage.hash))) return;
          t.selectedMessage = null, t.lastImagedMessage = null, Fe().catch(() => {
          });
          return;
        }
        n.markers?.length && Ce();
      }
    }, 250));
  }
  function Va() {
    const e = t.overlayUi;
    e?.segmentWatchId != null && (clearInterval(e.segmentWatchId), e.segmentWatchId = null);
  }
  async function Ht(opts = {}) {
    const e = t.overlayUi;
    if (!e?.markers?.length) return;
    const light = !!opts.light && !!e.pinTarget && !!e._pinRectCache;
    // Full pass resolves pin ownership; light scroll pass skips that SafeDOM round-trip.
    if (!light && (t.selectedMessage || t.lastImagedMessage)) {
      const n = e.doc || await ue();
      if (n) {
        const pin = await resolveStickyPinDom(n);
        if (pin.el) e.pinTarget = pin.el, e._pinDomIndex = Number(pin.msg?.domIndex);
      }
    }
    const o = Pt, r = viewerViewport().vh, i = 0.5;
    let s = null;
    if (e.pinTarget) {
      try {
        s = await e.pinTarget.getBoundingClientRect();
        if (s) {
          e._pinRectCache = s;
          const y = Number(e._liveScrollY);
          e._pinRectAtScrollY = Number.isFinite(y) ? y : typeof window < "u" ? window.scrollY || window.pageYOffset || 0 : 0;
        }
      } catch {
        s = e._pinRectCache || null;
      }
    } else {
      s = e._pinRectCache || null;
    }
    const a = resolvePinLeftX(), j = resolvePinTopY(o), overlayXNow = getPinXPct(), overlayYNow = getPinYPct();
    const VC = globalThis.__INLAY_VIEWER_CORE__;
    let c;
    if (s) {
      c = typeof VC?.readingPercentInMessage == "function" ? VC.readingPercentInMessage(s, r, i) : na(s, r, i);
      if (c == null) c = typeof VC?.clampReadingPercent == "function" ? VC.clampReadingPercent(s, r, i) : cn(s, r, i);
    } else {
      // DOM missing: keep last reading / middle so sticky never blanks out.
      c = e._lastReading != null ? e._lastReading : 50;
    }
    const markerPcts = e.markers.map((T) => Number(T.yPercent) || 0);
    const l = typeof VC?.activeSegmentIndex == "function" ? VC.activeSegmentIndex(markerPcts, c) : dn(markerPcts, c);
    const p = Nt(), mobileOn = mobilePinOn(), m = La(), cornerNow = Ea();
    const activeIdNow = l >= 0 ? e.markers[l]?.card?.id || "" : "";
    // Offscreen hide only affects the always-on thumb — pin itself always stays.
    const hideThumbOffscreen = !!(s && Ga() && (typeof VC?.readingPercentInMessage == "function" ? VC.readingPercentInMessage(s, r, i) : na(s, r, i)) == null && !(Number(s.bottom) > 0 && Number(s.top) < r));
    const keepHidden = typeof VC?.shouldKeepStickyThumbHidden == "function" ? VC.shouldKeepStickyThumbHidden(!!e._stickyThumbUserHidden, e._stickyThumbHiddenId, activeIdNow) : !!(e._stickyThumbUserHidden && String(e._stickyThumbHiddenId || "") === String(activeIdNow || "") && activeIdNow);
    if (!keepHidden && e._stickyThumbUserHidden) e._stickyThumbUserHidden = !1, e._stickyThumbHiddenId = "";
    const vpW = typeof window < "u" && window.innerWidth || 1200, vpH = typeof window < "u" && window.innerHeight || 800;
    // Skip only when segment AND active card unchanged (tiny reading jitter).
    // Viewport size must be included — right/bottom corners were sticky-left px and went stale on resize.
    if (e.activeSegment === l && !e._segmentHidden && e._lastReading != null && Math.abs(e._lastReading - c) < 0.35 && e._lastThumbPct === m.pct && e._lastInlineOn === p && e._lastOverlayX === overlayXNow && e._lastOverlayY === overlayYNow && e._lastMobileOn === mobileOn && e._lastCorner === cornerNow && e._lastMobilePinnedId === activeIdNow && e._lastHideThumbOff === hideThumbOffscreen && e._lastStickyUserHidden === keepHidden && e._lastVpW === vpW && e._lastVpH === vpH) return;
    const prevSeg = e.activeSegment;
    e.activeSegment = l, e._lastReading = c, e._segmentHidden = !1, e._lastThumbPct = m.pct, e._lastInlineOn = p, e._lastOverlayX = overlayXNow, e._lastOverlayY = overlayYNow, e._lastMobileOn = mobileOn, e._lastCorner = cornerNow, e._lastHideThumbOff = hideThumbOffscreen, e._lastStickyUserHidden = keepHidden, e._lastVpW = vpW, e._lastVpH = vpH;
    const showStickyImg = p && !hideThumbOffscreen && !keepHidden, u = 6, b = 11, C = 4;
    let pinLeft = a, pinTop = j, thumbLeft = Math.max(4, a - m.w - u), thumbTop = j + o + u;
    let pinEdge = null, thumbEdge = null;
    if (mobileOn && p) {
      // Edge-anchored CSS (right/bottom) so window resize keeps the corner glue without waiting on layout.
      thumbEdge = typeof VC?.stickyCornerEdgeBox == "function" ? VC.stickyCornerEdgeBox(cornerNow, m, 16) : null;
      pinEdge = typeof VC?.stickyPinEdgeBox == "function" ? VC.stickyPinEdgeBox(cornerNow, m, o, 6, 16) : null;
      const box = typeof VC?.stickyCornerImageBox == "function" ? VC.stickyCornerImageBox(cornerNow, m, {
        width: vpW,
        height: vpH
      }, 16) : {
        left: Math.max(16, vpW - m.w - 16),
        top: Math.max(16, vpH - m.h - 16),
        w: m.w,
        h: m.h
      };
      const pinPos = typeof VC?.stickyPinOverImage == "function" ? VC.stickyPinOverImage(box, o, 6) : {
        left: Math.round(box.left + (box.w - o) / 2),
        top: box.top - 6
      };
      // Absolute coords kept for ▲/▼ mini-pin stacking relative to the active pin.
      pinLeft = pinPos.left, pinTop = pinPos.top, thumbLeft = box.left, thumbTop = box.top;
      if (!thumbEdge) thumbEdge = {
        w: m.w,
        h: m.h,
        top: String(cornerNow).includes("top") ? 16 : null,
        bottom: String(cornerNow).includes("bottom") ? 16 : null,
        left: String(cornerNow).includes("left") ? 16 : null,
        right: String(cornerNow).includes("right") ? 16 : null
      };
      if (!pinEdge) pinEdge = {
        size: o,
        top: pinTop,
        bottom: null,
        left: pinLeft,
        right: null
      };
    }
    const f = pinTop + o + C, x = Math.round(pinLeft + (o - b) / 2), I = l >= 0 ? l : 0, R = l >= 0 ? Math.max(0, e.markers.length - l - 1) : 0;
    let g = 0, F = 0;
    const activeCard = l >= 0 ? e.markers[l]?.card : null;
    e._lastMobilePinnedId = activeCard?.id || "";
    const thumbShowStyle = thumbEdge ? [
      "position:fixed",
      ...edgePosCss(thumbEdge),
      "z-index:99970",
      `width:${m.w}px`,
      `height:${m.h}px`,
      "border-radius:8px",
      "overflow:hidden",
      "pointer-events:auto",
      "display:block",
      "border:1px solid rgba(255,255,255,.16)",
      "box-shadow:0 4px 14px rgba(0,0,0,.35)",
      "background:#0b0f18"
    ].join(";") : [
      "position:fixed",
      `left:${thumbLeft}px`,
      `top:${thumbTop}px`,
      "z-index:99970",
      `width:${m.w}px`,
      `height:${m.h}px`,
      "border-radius:8px",
      "overflow:hidden",
      "pointer-events:auto",
      "display:block",
      "border:1px solid rgba(255,255,255,.16)",
      "box-shadow:0 4px 14px rgba(0,0,0,.35)",
      "background:#0b0f18"
    ].join(";");
    e._stickyThumbShowStyle = thumbShowStyle;
    const hideThumbStyle = "position:fixed;display:none;";
    const composeThumb = typeof VC?.composeStickyThumbHtml == "function" ? VC.composeStickyThumbHtml : (src) => `<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block" />`;

    // 1) Show active thumb (paint HTML only on cache miss) — never blank the slot.
    try {
      if (l >= 0 && e.markers[l]) {
        const v = e.markers[l];
        if (!v._thumbSrc) {
          try {
            const fb = Ie(v.card);
            if (typeof fb == "string" && /^data:image\//i.test(fb)) v._thumbSrc = fb;
          } catch {
          }
        }
        if (v.thumb) {
          if (showStickyImg) {
            const needHtml = typeof VC?.stickyThumbNeedsHtmlPaint == "function"
              ? VC.stickyThumbNeedsHtmlPaint(v._paintedSrc, v._thumbSrc, v._thumbHtmlId, activeIdNow)
              : v._thumbHtmlId !== activeIdNow || v._paintedSrc !== v._thumbSrc;
            if (needHtml && v._thumbSrc && typeof v.thumb.setInnerHTML == "function") {
              await v.thumb.setInnerHTML(composeThumb(v._thumbSrc));
              v._thumbHtmlId = activeIdNow, v._paintedSrc = v._thumbSrc, e._lastStickyThumbHtmlId = activeIdNow, e._flashSeg = l, e._flashReading = c;
            }
            await v.thumb.setStyleAttribute(thumbShowStyle);
          } else await v.thumb.setStyleAttribute(hideThumbStyle);
        }
        await v.el.setStyleAttribute(pinEdge ? zeEdge(pinEdge, !0) : ze(pinLeft, pinTop, o, !0));
        if (v._pinHtml !== "🖼" && typeof v.el.setInnerHTML == "function") {
          await v.el.setInnerHTML("🖼"), v._pinHtml = "🖼";
        }
      }
      // Retire previous only after the new image is already on screen.
      if (Number.isFinite(prevSeg) && prevSeg >= 0 && prevSeg !== l && e.markers[prevSeg]?.thumb) {
        await e.markers[prevSeg].thumb.setStyleAttribute(hideThumbStyle);
      }
    } catch {
    }

    // 2) Heavy / chrome after the image is already visible.
    const syncId = String(activeCard?.id || "");
    if (syncId && syncId !== String(e._syncedViewerCardId || "")) {
      e._syncedViewerCardId = syncId;
      const gui = t.galleryUi;
      if (gui && !t.uiOpen && typeof gui.syncToCardId == "function") {
        gui.syncToCardId(syncId).catch(() => {
        });
      }
    }
    // Keep legacy pinned layer hidden — mobile uses the same sticky thumb now.
    if (typeof e.hidePinned === "function") {
      Promise.resolve(e.hidePinned()).catch(() => {
      });
    }

    for (let T = 0; T < e.markers.length; T += 1) {
      const v = e.markers[T], X = T === l;
      v.active = X, v.mini = !X && l >= 0;
      if (X) continue;
      let te;
      l < 0 ? (te = -9999, v.mini = !1) : T < l ? (te = pinTop - (I - g) * 15, g += 1) : (te = f + F * 15, F += 1);
      try {
        if (te < 0 || l < 0) await v.el.setStyleAttribute(ze(pinLeft, -9999, o, !1));
        else {
          await v.el.setStyleAttribute(za(x, te, b));
          const arrow = T < l ? "▲" : "▼";
          if (v._pinHtml !== arrow && typeof v.el.setInnerHTML == "function") {
            await v.el.setInnerHTML(arrow), v._pinHtml = arrow;
          }
          if (typeof v.el.setAttribute == "function") await v.el.setAttribute("title", T < l ? `위에 이미지 · P${v.card?.paragraph ?? v.line} · ${Math.round(v.yPercent)}%` : `아래에 이미지 · P${v.card?.paragraph ?? v.line} · ${Math.round(v.yPercent)}%`);
        }
      } catch {
      }
      if (v.thumb) try {
        await v.thumb.setStyleAttribute(hideThumbStyle);
      } catch {
      }
    }
    t.debugInsight && (t.debugInsight.readingPct = c, t.debugInsight.activeSegment = l, t.debugInsight.abovePins = I, t.debugInsight.belowPins = R, t.debugInsight.markerPercents = markerPcts);
  }
  async function resolveMessageDom(e, msg) {
    const n = msg || null;
    if (!n || !e) return null;
    // ±2 DOM cache hit: skip list wait when we already remembered this bubble.
    if (n.domIndex >= 0) {
      const cached = peekCachedMsgDom(e, n.domIndex);
      if (cached) return cached;
    }
    const o = await getCachedMsgEls(e) || await dt(await qe(e));
    if (n.domIndex >= 0 && n.domIndex < (o || []).length) {
      rememberNearbyMsgDoms(e, o, n.domIndex);
      return o[n.domIndex];
    }
    for (let a = 0; a < (o || []).length; a += 1) {
      const r = await De(o[a]);
      if (r && (ye(r) === n.hash || ot(r, {
        assistant_preview: n.text,
        content_hash: n.hash
      }) >= 50))
        return n.domIndex = a, o[a];
    }
    return null;
  }
  async function Ge(e) {
    return resolveMessageDom(e, t.selectedMessage);
  }
  async function resolveStickyPinDom(e) {
    const focus = stickyFocusMessage();
    if (focus) {
      const el = await resolveMessageDom(e, focus);
      if (el) return { el, msg: focus };
    }
    if (t.selectedMessage) {
      const el = await resolveMessageDom(e, t.selectedMessage);
      if (el) return { el, msg: t.selectedMessage };
    }
    return { el: null, msg: focus || t.selectedMessage || null };
  }
  async function getScrollTopSafe(e) {
    if (!e) return 0;
    try {
      if (typeof e.getProperty == "function") {
        const n = await e.getProperty("scrollTop");
        if (n != null) return Number(n) || 0;
      }
    } catch {
    }
    try {
      if (typeof e.scrollTop == "number") return e.scrollTop;
      const n = await e.scrollTop;
      if (n != null) return Number(n) || 0;
    } catch {
    }
    return 0;
  }
  async function setScrollTopSafe(e, n) {
    if (!e) return !1;
    const o = Math.max(0, Number(n) || 0);
    try {
      if (typeof e.scrollTo == "function") return await e.scrollTo({
        top: o,
        behavior: "auto"
      }), !0;
    } catch {
    }
    try {
      if (typeof e.scrollTo == "function") return await e.scrollTo(0, o), !0;
    } catch {
    }
    try {
      if (typeof e.setProperty == "function") return await e.setProperty("scrollTop", o), !0;
    } catch {
    }
    try {
      return e.scrollTop = o, !0;
    } catch {
    }
    return !1;
  }
  async function getScrollLeftSafe(e) {
    if (!e) return 0;
    try {
      if (typeof e.getProperty == "function") {
        const n = await e.getProperty("scrollLeft");
        if (n != null) return Number(n) || 0;
      }
    } catch {
    }
    try {
      if (typeof e.scrollLeft == "number") return e.scrollLeft;
      const n = await e.scrollLeft;
      if (n != null) return Number(n) || 0;
    } catch {
    }
    return 0;
  }
  async function setScrollLeftSafe(e, n) {
    if (!e) return !1;
    const o = Math.max(0, Number(n) || 0);
    try {
      if (typeof e.scrollTo == "function") return await e.scrollTo({
        left: o,
        behavior: "auto"
      }), !0;
    } catch {
    }
    try {
      if (typeof e.scrollTo == "function") return await e.scrollTo(o, 0), !0;
    } catch {
    }
    try {
      if (typeof e.setProperty == "function") return await e.setProperty("scrollLeft", o), !0;
    } catch {
    }
    try {
      return e.scrollLeft = o, !0;
    } catch {
    }
    return !1;
  }
  async function findScrollParent(e) {
    let n = e;
    for (let o = 0; n && o < 24; o += 1) {
      try {
        let a = 0, r = 0;
        typeof n.getProperty == "function" && (a = Number(await n.getProperty("scrollHeight")) || 0, r = Number(await n.getProperty("clientHeight")) || 0);
        if (!(a > r + 8)) try {
          a = Number(n.scrollHeight) || a, r = Number(n.clientHeight) || r;
        } catch {
        }
        if (a > r + 8 && n !== e) return n;
      } catch {
      }
      try {
        n = typeof n.getParent == "function" ? await n.getParent() : null;
      } catch {
        n = null;
      }
    }
    return null;
  }
  function resolveScrollYPercent(e, n = -1) {
    const o = Number(e?.y_percent ?? e?.anchor_percent ?? e?.read_percent);
    if (Number.isFinite(o)) return Math.max(0, Math.min(100, o));
    const a = (t.overlayUi?.markers || []).find((c) => c.card?.id === e?.id), r = Number(a?.yPercent);
    if (Number.isFinite(r)) return Math.max(0, Math.min(100, r));
    const i = linkedCards(t.selectedMessage) || [], s = n >= 0 ? n : Math.max(0, i.findIndex((c) => c.id === e?.id)), c = Math.max(1, i.length || (t.overlayUi?.markers || []).length || 1);
    return Math.max(0, Math.min(100, Ot(e, s >= 0 ? s : 0, c)));
  }
  async function sleepMs(e) {
    await new Promise((n) => setTimeout(n, Math.max(0, Number(e) || 0)));
  }
  async function bindCardSourceMessage(e, n) {
    if (!e || !n) return !1;
    const o = await dt(await qe(n));
    if (!o.length) return !1;
    const a = await Za().catch(() => null);
    let r = -1;
    for (let i = 0; i < o.length; i += 1) {
      const s = await De(o[i]);
      if (!s) continue;
      const c = qa(s, a?.messages || [], i, o.length);
      if (e.content_hash && ye(c.text || s) === e.content_hash || Number.isFinite(Number(e.message_index)) && Number(c.chatIndex) === Number(e.message_index)) {
        r = i;
        break;
      }
    }
    // Use scroll source so Da does not auto-generate or treat this as a user click.
    return r >= 0 ? Da(r, o, { source: "scroll" }) : !1;
  }
  async function scrollIntoViewSafe(el, opts = {}) {
    if (!el) return !1;
    try {
      if (typeof el.scrollIntoView == "function") {
        await el.scrollIntoView({
          behavior: opts.behavior || "auto",
          block: opts.block || "center",
          inline: opts.inline || "nearest"
        });
        return !0;
      }
    } catch {
    }
    return !1;
  }
  async function pt(e) {
    const n = t.overlayUi?.doc || t.galleryUi?.doc || await ue();
    if (!n || !e) return;
    await bindCardSourceMessage(e, n);
    let o = await Ge(n);
    if (!o) {
      y("warn", "scroll.miss", "선택 메시지 DOM 없음");
      return;
    }
    const a = resolveScrollYPercent(e);
    // 1) Bring the message into view (same idea as lightboard scrollIntoView).
    await scrollIntoViewSafe(o, {
      behavior: "auto",
      block: "center"
    });
    await sleepMs(40);
    async function s() {
      o = await Ge(n) || o;
      const c = await o.getBoundingClientRect();
      if (!c || !(c.height > 1)) return {
        ok: !1,
        delta: 0
      };
      // Align the card's y_percent point to the middle of the scrollport.
      const targetY = c.top + Math.max(1, c.height) * (a / 100);
      const parents = [];
      const sp = await findScrollParent(o);
      if (sp) parents.push(sp);
      const chat = await qe(n);
      if (chat && (!sp || chat !== sp)) parents.push(chat);
      let l = 0, p = !1;
      for (const i of parents) {
        try {
          const m = await i.getBoundingClientRect();
          if (!(m && m.height > 40)) continue;
          const u = targetY - (m.top + m.height * 0.5), b = await getScrollTopSafe(i);
          l = u;
          if (Math.abs(u) < 1.5) {
            p = !0;
            break;
          }
          p = await setScrollTopSafe(i, b + u);
          if (!p && typeof i.scrollBy == "function") try {
            await i.scrollBy({
              top: u,
              behavior: "auto"
            }), p = !0;
          } catch {
          }
          if (p) break;
        } catch {
        }
      }
      if (!p && typeof window < "u") {
        const m = typeof window.innerHeight < "u" && window.innerHeight || 800, u = targetY - m * 0.5;
        l = u, window.scrollBy({
          top: u,
          behavior: "auto"
        }), p = !0;
      }
      return {
        ok: p,
        delta: l
      };
    }
    try {
      let c = await s();
      await sleepMs(50), c = await s(), await sleepMs(50), c = await s(), Ce(), scheduleOverlayPlace(60), y("info", "scroll.toCard", `P${e.paragraph ?? "?"} y=${Math.round(a)}% id=${String(e.id || "").slice(0, 8)} delta=${Math.round(c.delta || 0)}`);
      try {
        if (t.galleryUi?.status && typeof t.galleryUi.status.setTextContent == "function") await t.galleryUi.status.setTextContent(`메시지 ${Math.round(a)}% 위치로 이동`);
      } catch {
      }
    } catch (c) {
      y("warn", "scroll.fail", c?.message || c);
    }
  }
  async function Wt() {
    const e = t.overlayUi;
    if (e?.cancelMobilePress?.(), Va(), await Fe(), await zt(), e?.chatScrollEl && e?.chatScrollId != null && await de(e.chatScrollEl, "scroll", e.chatScrollId), e?.doc && (await de(e.doc, "scroll", e.scrollId), await de(e.doc, "scrollend", e.scrollEndId), await de(e.doc, "pointermove", e.moveId), await de(e.doc, "pointerdown", e.downId), await de(e.doc, "pointerup", e.upId), await de(e.doc, "pointercancel", e.cancelId), await de(e.doc, "keydown", e.keyId), await de(e.doc, "dblclick", e.dblId), await de(e.doc, "click", e.clickId)), e?.body && await de(e.body, "scroll", e.bodyScrollId), e?.winScrollBound && typeof window < "u" && e?.onStickyScroll) {
      try {
        window.removeEventListener("scroll", e.onStickyScroll, !0);
      } catch {
      }
      try {
        window.removeEventListener("scrollend", e.onScrollEnd || e.onStickyScroll, !0);
      } catch {
      }
      try {
        window.removeEventListener("wheel", e.onUserScrollStart || e.onStickyScroll, !0);
      } catch {
      }
      try {
        window.removeEventListener("resize", e.onStickyScroll);
      } catch {
      }
    }
    try {
      t._scrollSettle?.cancel?.();
    } catch {
    }
    t._scrollSettle = null;
    if (t.overlayScrollTimer && (clearTimeout(t.overlayScrollTimer), t.overlayScrollTimer = null), t.overlayRaf != null) {
      if (typeof cancelAnimationFrame == "function") try {
        cancelAnimationFrame(t.overlayRaf);
      } catch {
      }
      try {
        clearTimeout(t.overlayRaf);
      } catch {
      }
      t.overlayRaf = null;
    }
    await rt(Y), t.overlayUi = null;
  }
  async function Ya() {
    if (t.uiOpen) return;
    if (t.overlayUi?.root) {
      await he();
      return;
    }
    const e = await ue();
    if (!e) return;
    const n = await Ee(e);
    if (!n || typeof e.createElement != "function") return;
    const o = await H(e, "div", {
      className: Y,
      style: "position:fixed;left:0;top:0;width:0;height:0;z-index:99970;pointer-events:none;"
    });
    await n.appendChild(o);
    const a = await H(e, "div", { style: "position:fixed;left:0;top:0;width:0;height:0;z-index:99971;pointer-events:none;" });
    await o.appendChild(a);
    const r = await H(e, "div", { style: "position:fixed;display:none;z-index:99992;width:220px;pointer-events:none;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.16);box-shadow:0 16px 40px rgba(0,0,0,.5);background:#0b0f18;" });
    await o.appendChild(r);
    const pinned = await H(e, "div", { style: "position:fixed;display:none;z-index:99997;pointer-events:none;" }), fullscreen = await H(e, "div", { style: "position:fixed;inset:0;display:none;z-index:100001;pointer-events:none;background:rgba(0,0,0,.92);align-items:center;justify-content:center;padding:16px;box-sizing:border-box;" }), actionMenu = await H(e, "div", { style: "position:fixed;inset:0;display:none;z-index:100002;pointer-events:none;background:transparent;align-items:flex-end;justify-content:center;padding:16px;box-sizing:border-box;" }), pressFill = await H(e, "div", { style: "position:fixed;display:none;z-index:99973;pointer-events:none;overflow:hidden;border-radius:8px;" });
    await o.appendChild(pinned), await o.appendChild(fullscreen), await o.appendChild(actionMenu), await o.appendChild(pressFill);
    let pointerGesture = null, mobilePress = null, pinClick = null, actionCard = null, inspectOpen = !1, inspectGuardUntil = 0, pendingSheetHit = null, inspectZones = [], inspectSheetEl = null;
    const PRESS_MS = 420;
    const hidePinned = async () => {
      await pinned.setStyleAttribute("position:fixed;display:none;z-index:99997;pointer-events:none;");
    }, showPinned = async () => {
      await hidePinned();
    }, syncMobileAlways = async () => {
      await hidePinned();
    }, hideFullscreen = async () => {
      await fullscreen.setStyleAttribute("position:fixed;inset:0;display:none;z-index:100001;pointer-events:none;");
    }, hideActionMenu = async () => {
      // pointer-events:none when hidden — inset:0 + auto was able to steal viewer chip clicks.
      actionCard = null, inspectZones = [], inspectSheetEl = null, await actionMenu.setStyleAttribute("position:fixed;inset:0;display:none;z-index:100002;pointer-events:none;");
    }, hideInspect = async () => {
      inspectOpen = !1, pendingSheetHit = null, await hideActionMenu(), await hideFullscreen();
    }, hidePressFill = async () => {
      try {
        await pressFill.setInnerHTML("");
      } catch {
      }
      try {
        await pressFill.setStyleAttribute("position:fixed;display:none;z-index:99973;pointer-events:none;");
      } catch {
      }
    }, ensurePressFillAnim = async () => {
      if (t._nxPressFillAnim) return;
      try {
        const st = await H(e, "style", {
          text: "@keyframes nxPressFill{from{transform:scaleY(0)}to{transform:scaleY(1)}}"
        });
        await o.appendChild(st), t._nxPressFillAnim = !0;
      } catch {
      }
    }, showPressFill = async (thumb) => {
      if (!thumb) return;
      await ensurePressFillAnim();
      let rect = null;
      try {
        rect = await thumb.getBoundingClientRect();
      } catch {
        rect = null;
      }
      if (!rect) return;
      const L = Math.round(rect.left), T = Math.round(rect.top), W = Math.max(1, Math.round(rect.width || rect.right - rect.left)), Hh = Math.max(1, Math.round(rect.height || rect.bottom - rect.top));
      await pressFill.setStyleAttribute(`position:fixed;left:${L}px;top:${T}px;width:${W}px;height:${Hh}px;z-index:99971;pointer-events:none;overflow:hidden;border-radius:8px;display:block;background:transparent`);
      await pressFill.setInnerHTML(`<div style="position:absolute;left:0;right:0;bottom:0;height:100%;background:linear-gradient(180deg,rgba(124,108,255,.12),rgba(124,108,255,.42));transform:scaleY(0);transform-origin:bottom center;animation:nxPressFill ${PRESS_MS}ms linear forwards;pointer-events:none"></div>`);
    }, showFullscreen = async (f) => {
      await fullscreen.setInnerHTML(`<img src="${Ie(f)}" style="display:block;max-width:calc(100vw - 32px);max-height:calc(100dvh - 140px);width:auto;height:auto;object-fit:contain;background:transparent" alt="전체 화면 이미지">`), await fullscreen.setStyleAttribute("position:fixed;inset:0;display:flex;z-index:100001;pointer-events:none;background:rgba(0,0,0,.92);align-items:center;justify-content:center;padding:16px 16px 120px;box-sizing:border-box;");
    }, addInspectBtn = async (parent, label, act, style, charI = -1) => {
      const btn = await H(e, "button", {
        text: label,
        style
      });
      try {
        await btn.setAttribute("type", "button");
        await btn.setAttribute("data-nx-act", act);
        if (charI >= 0) await btn.setAttribute("data-nx-char-i", String(charI));
      } catch {
      }
      await parent.appendChild(btn);
      inspectZones.push({
        el: btn,
        act,
        charI
      });
      return btn;
    }, showStickyInspect = async (f) => {
      if (!f) return;
      await hidePressFill();
      actionCard = f, inspectOpen = !0, pendingSheetHit = null, inspectGuardUntil = Date.now() + 400, inspectZones = [], inspectSheetEl = null;
      await showFullscreen(f);
      try {
        await actionMenu.setInnerHTML("");
      } catch {
      }
      const chipStyle = "border:0;border-radius:999px;padding:7px 11px;font:700 11px Segoe UI,sans-serif;white-space:nowrap;touch-action:manipulation;pointer-events:auto";
      const actStyle = "border:0;border-radius:10px;padding:9px 14px;font:700 12px Segoe UI,sans-serif;white-space:nowrap;touch-action:manipulation;pointer-events:auto";
      const sheet = await H(e, "div", { style: "width:min(440px,100%);background:linear-gradient(165deg,#1a1f2e,#0c1018);border:1px solid rgba(255,255,255,.14);border-radius:18px;padding:12px;box-shadow:0 24px 60px rgba(0,0,0,.55);display:grid;gap:10px;pointer-events:auto;" });
      const chipRow = await H(e, "div", { style: "display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:center;pointer-events:auto;" });
      const actRow = await H(e, "div", { style: "display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;pointer-events:auto;" });
      const closeRow = await H(e, "div", { style: "display:flex;justify-content:center;pointer-events:auto;" });
      await addInspectBtn(chipRow, "base", "base", `${chipStyle};background:rgba(124,108,255,.22);color:#ddd6fe;border:1px solid rgba(124,108,255,.45)`);
      const chars = Array.isArray(f?.characters) ? f.characters : [];
      for (let i = 0; i < chars.length; i += 1) {
        const name = w(chars[i]?.name || "", 40);
        await addInspectBtn(chipRow, `c${i + 1}${name ? `·${name}` : ""}`, "char", `${chipStyle};background:rgba(255,255,255,.06);color:#e8eef8;border:1px solid rgba(255,255,255,.14)`, i);
      }
      await addInspectBtn(actRow, "태그", "retag", `${actStyle};background:rgba(15,118,110,.92);color:#fff`);
      await addInspectBtn(actRow, "재생성", "regen", `${actStyle};background:rgba(124,108,255,.92);color:#fff`);
      await addInspectBtn(actRow, "리롤", "reroll", `${actStyle};background:rgba(51,65,85,.95);color:#e8eef8;border:1px solid rgba(255,255,255,.14)`);
      await addInspectBtn(closeRow, "닫기", "close", `${actStyle};background:rgba(255,255,255,.06);color:#cbd5e1;border:1px solid rgba(255,255,255,.1);min-width:88px`);
      await sheet.appendChild(chipRow), await sheet.appendChild(actRow), await sheet.appendChild(closeRow);
      await actionMenu.appendChild(sheet);
      inspectSheetEl = sheet;
      await actionMenu.setStyleAttribute("position:fixed;inset:0;display:flex;z-index:100002;pointer-events:auto;background:transparent;align-items:flex-end;justify-content:center;padding:max(12px,env(safe-area-inset-bottom)) 12px 18px;box-sizing:border-box;");
    }, findActHit = async (x, I) => {
      for (const z of inspectZones) {
        if (!z?.el) continue;
        try {
          if (await hitEl(z.el, x, I)) return {
            act: z.act,
            charI: z.charI
          };
        } catch {
        }
      }
      if (inspectSheetEl) {
        try {
          if (await hitEl(inspectSheetEl, x, I)) return {
            act: "",
            charI: -1,
            inside: !0
          };
        } catch {
        }
      }
      return null;
    }, runInspectAction = async (act, card, charI = -1) => {
      if (!card || act === "close") {
        await hideInspect();
        return;
      }
      if (act === "base") {
        await hideInspect();
        try {
          await openCardTagEdit(card);
        } catch (err) {
          y("error", "sticky.base.fail", err?.message || err);
        }
        return;
      }
      if (act === "char") {
        await hideInspect();
        try {
          await ensureViewerRosterLoaded().catch(() => null);
          const raw = Array.isArray(card.characters) ? card.characters[charI] : null, name = w(raw?.name || "", 200);
          if (name) await Ua({
            name,
            prompt: w(raw?.prompt || "", 400),
            roster: Dt(name),
            index: charI
          });
          else await openCardTagEdit(card);
        } catch (err) {
          y("error", "sticky.char.fail", err?.message || err);
        }
        return;
      }
      if (act === "reroll") {
        await hideInspect();
        try {
          await withImageRerollToast("이미지 리롤 중…", async () => await K(`/v1/cards/${encodeURIComponent(card.id)}/reroll`, {
            method: "POST",
            body: {
              mode: "nai"
            }
          }, 18e4));
          const W = await Z({
            useOverride: !1
          }).catch(() => null);
          W?.sessionId && await ce(W.sessionId);
          try {
            await he();
          } catch {
          }
        } catch (err) {
          y("error", "sticky.reroll.fail", err?.message || err);
        }
        return;
      }
      if (act === "retag") {
        await hideInspect();
        try {
          const scope = await Z({
            useOverride: !1
          }).catch(() => null), text = w(t.selectedMessage?.text || card.assistant_preview || "", 5e4);
          if (!text || text.length < 8) {
            y("warn", "sticky.retag.skip", "메시지 텍스트 없음");
            return;
          }
          await Be(scope, text, !0);
        } catch (err) {
          y("error", "sticky.retag.fail", err?.message || err);
        }
        return;
      }
      if (act === "regen") {
        await hideInspect();
        try {
          const msg = t.selectedMessage, scope = await Z({
            useOverride: !1
          }).catch(() => null);
          if (!msg && !card) {
            y("warn", "sticky.regen.skip", "재생성할 메시지 없음");
            return;
          }
          const hash = msg?.hash || card.content_hash || "";
          const liveMsg = msg || { hash, sessionId: scope?.sessionId || card.session_id || "", chatIndex: card.message_index };
          if (hash) t.jobsInFlight.set(hash, Date.now());
          try {
            const targets = messageCardsByY(liveMsg);
            await withImageRerollToast(`메시지 이미지 전체 재생성 중… (0/${targets.length || "?"})`, async (report) => rerollMessageImagesLive(liveMsg, {
              scope,
              report,
              onShot: async () => {
                if (t.galleryUi?.renderGal) await t.galleryUi.renderGal();
              }
            }), { shotCount: Math.max(1, targets.length || 1) });
            scope?.sessionId && await ce(scope.sessionId, !0);
            try {
              await he();
            } catch {
            }
          } finally {
            if (hash) t.jobsInFlight.delete(hash);
          }
        } catch (err) {
          y("error", "sticky.regen.fail", err?.message || err);
        }
      }
    }, cancelMobilePress = () => {
      mobilePress?.timer && clearTimeout(mobilePress.timer), mobilePress = null;
      hidePressFill().catch(() => {
      });
    };
    const i = async (f, x, I) => {
      const R = t.overlayUi?.preview || r;
      if (!R) return;
      const id = String(f?.id || ""), g = Ie(f);
      if (t._hoverPreviewCardId !== id) {
        t._hoverPreviewCardId = id;
        await R.setInnerHTML(`<img src="${g}" style="width:100%;max-height:100%;object-fit:contain;display:block" />`);
      }
      t._hoverPreviewXY = {
        x,
        y: I
      };
      if (t._hoverPreviewRaf) return;
      const raf = typeof requestAnimationFrame == "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
      t._hoverPreviewRaf = raf(async () => {
        t._hoverPreviewRaf = 0;
        const xy = t._hoverPreviewXY;
        if (!xy || !hoverPreviewOn()) return;
        try {
          await R.setStyleAttribute(Ca(220, xy.x, xy.y));
        } catch {
        }
      });
    }, s = async () => {
      const f = t.overlayUi?.preview || r;
      t._hoverPreviewCardId = "", t._hoverPreviewXY = null;
      if (t._hoverPreviewRaf && typeof cancelAnimationFrame == "function") try {
        cancelAnimationFrame(t._hoverPreviewRaf);
      } catch {
      }
      t._hoverPreviewRaf = 0, f && await f.setStyleAttribute("position:fixed;display:none;z-index:99996;width:220px;pointer-events:none;");
    }, c = async (f, x, I) => {
      try {
        const R = await f.el.getBoundingClientRect(), g = Number(f.hitPad) || 8;
        return x >= R.left - g && x <= R.right + g && I >= R.top - g && I <= R.bottom + g;
      } catch {
        return !1;
      }
    }, l = async (f) => {
      if (typeof f?.clientX == "number") t._pointerClientX = f.clientX;
      if (typeof f?.clientY == "number") t._pointerClientY = f.clientY;
      if (t.uiOpen || t._hostChromeBlocked) return;
      if (pointerGesture && typeof f.clientX == "number" && typeof f.clientY == "number") {
        pointerGesture.movement = Math.max(pointerGesture.movement || 0, Math.hypot(f.clientX - pointerGesture.x, f.clientY - pointerGesture.y));
      }
      if (mobilePress && typeof f.clientX == "number" && typeof f.clientY == "number" && Math.hypot(f.clientX - mobilePress.x, f.clientY - mobilePress.y) > 8) cancelMobilePress();
      const x = t.overlayUi?.markers || [];
      if (!x.length || !hoverPreviewOn()) {
        await s();
        return;
      }
      const I = f.clientX, R = f.clientY;
      if (!(typeof I != "number" || typeof R != "number")) {
        for (const g of x.filter((F) => F.active || F.mini)) if (await c(g, I, R)) {
          await i(g.card, I, R);
          return;
        }
        await s();
      }
    }, p = async (f) => {
      if (typeof f?.clientX == "number") t._pointerClientX = f.clientX;
      if (typeof f?.clientY == "number") t._pointerClientY = f.clientY;
      if (t.uiOpen || t._hostChromeBlocked || t.charEditUi) return;
      const x = f.clientX, I = f.clientY;
      if (typeof x != "number" || typeof I != "number") return;
      // Middle-click message jump removed (never reliable on host SafeDOM).
      if (Number(f?.button) != null && Number(f.button) !== 0) return;
      if (mobilePress && f.pointerId != null && mobilePress.pointerId != null && f.pointerId !== mobilePress.pointerId) {
        cancelMobilePress();
        return;
      }
      if (inspectOpen && await hitEl(actionMenu, x, I)) {
        cancelMobilePress();
        if (Date.now() < inspectGuardUntil) {
          pendingSheetHit = {
            kind: "guard"
          };
          return;
        }
        try {
          const hit = await findActHit(x, I);
          if (hit?.act) {
            pendingSheetHit = {
              kind: "act",
              act: hit.act,
              charI: hit.charI
            };
            return;
          }
          if (hit?.inside) {
            pendingSheetHit = {
              kind: "inside"
            };
            return;
          }
        } catch {
        }
        pendingSheetHit = {
          kind: "outside"
        };
        return;
      }
      // Sticky always-image: short-tap hide / long-press fullscreen+sheet.
      if (Nt() && !inspectOpen) {
        const stickyMarkers = t.overlayUi?.markers || [];
        for (const g of stickyMarkers) {
          if (!g?.active || !g.thumb || t.overlayUi?._stickyThumbUserHidden) continue;
          if (!await hitEl(g.thumb, x, I)) continue;
          if (mobilePress) {
            cancelMobilePress();
            return;
          }
          const F = {
            x,
            y: I,
            card: g.card,
            source: "sticky-thumb",
            pointerId: f.pointerId,
            long: !1,
            timer: null,
            thumb: g.thumb
          };
          showPressFill(g.thumb).catch(() => {
          });
          F.timer = setTimeout(() => {
            if (mobilePress !== F) return;
            F.long = !0;
            showStickyInspect(F.card).catch(() => {
            });
          }, PRESS_MS), mobilePress = F;
          return;
        }
      }
      const R = t.overlayUi?.markers || [];
      for (const g of R) if (await c(g, x, I)) {
        pointerGesture = {
          x,
          y: I,
          movement: 0,
          marker: !0
        };
        // Sticky image hidden → pin short-tap revives it.
        if (Nt() && t.overlayUi?._stickyThumbUserHidden) {
          if (mobilePress) {
            cancelMobilePress();
            return;
          }
          const F = {
            x,
            y: I,
            card: g.card,
            source: "sticky-pin",
            pointerId: f.pointerId,
            long: !1,
            timer: null
          };
          F.timer = setTimeout(() => {
            if (mobilePress === F) F.long = !0;
          }, 420), mobilePress = F;
          return;
        }
        // Click sticky pin opens viewer.
        pinClick = {
          card: g.card,
          pointerId: f.pointerId
        };
        return;
      }
      if (await excludedMessageTarget(e, x, I)) {
        pointerGesture = null;
        return;
      }
      pointerGesture = {
        x,
        y: I,
        movement: 0,
        marker: !1,
        forClick: clickTrackEnabled(),
        forText: textDragSelectEnabled()
      };
    }, onClick = async (f) => {
      if (t.uiOpen || t._hostChromeBlocked) return;
      const x = f.clientX, I = f.clientY, R = t._lastPointerGesture || pointerGesture;
      t._lastPointerGesture = null, pointerGesture = null;
      if (!R || R.marker || !R.forClick || typeof x != "number" || typeof I != "number") return;
      const g = Math.max(R.movement || 0, Math.hypot(x - R.x, I - R.y));
      if (g > 8 || await excludedMessageTarget(e, x, I)) return;
      const gesture = messageSelectGesture(), detail = Number(f.detail || 1), VC = globalThis.__INLAY_VIEWER_CORE__, resolve = VC?.resolveClickSelectionAction;
      let action = "confirm";
      if (typeof resolve == "function") {
        const decision = resolve({
          gesture,
          detail,
          pendingDomIndex: t._pendingSelectDom,
          targetDomIndex: null
        });
        if (decision.action === "ignore") return;
        action = decision.action;
      } else if (gesture === "double") {
        if (detail === 1) action = "provisional";
        else if (detail !== 2) return;
      } else if (detail !== 1) return;
      const a = await dt(await qe(e));
      if (!a.length) return;
      let r = await Oa(e, x, I, a);
      if (r === -2) return;
      r < 0 && (r = await Ra(x, I, a));
      if (r < 0) return;
      if (action === "provisional") {
        t._pendingSelectDom = r, await Da(r, a, { source: "provisional" });
        return;
      }
      t._pendingSelectDom = null, await Da(r, a, { source: "click" });
    }, onPointerUp = async (f) => {
      if (t.uiOpen || t._hostChromeBlocked) {
        cancelMobilePress(), pinClick = null, pointerGesture = null, pendingSheetHit = null;
        return;
      }
      if (inspectOpen) {
        const hit = pendingSheetHit;
        pendingSheetHit = null;
        if (Date.now() < inspectGuardUntil || hit?.kind === "guard") return;
        if (hit?.kind === "act" && hit.act) {
          await runInspectAction(hit.act, actionCard, hit.charI);
          return;
        }
        if (hit?.kind === "outside") {
          await hideInspect();
          return;
        }
        // inside sheet / empty control: keep open
        if (hit?.kind === "inside" || hit?.inside || hit?.kind === "act") return;
      }
      if (pinClick) {
        const click = pinClick;
        pinClick = null;
        const card = click.card, F = Math.max(0, (t.gallery || []).findIndex((T) => T.id === card?.id));
        t.viewerIndex = F, t.galleryUi || await lt(), t.galleryUi && (t.galleryUi.index = F, typeof t.galleryUi.setOpen == "function" && await t.galleryUi.setOpen(!0)), y("info", "marker.click", `P${card?.paragraph} id=${(card?.id || "").slice(0, 8)} · middle-click to scroll`);
        return;
      }
      const gest = pointerGesture;
      pointerGesture = null;
      t._lastPointerGesture = gest;
      if (gest && !gest.marker && gest.forText) {
        const VC = globalThis.__INLAY_VIEWER_CORE__, check = VC?.shouldSelectMessageByTextDrag, hasSel = await hasTextSelection(e), ok = typeof check == "function" ? check({
          enabled: !0,
          movement: gest.movement || 0,
          hasSelection: hasSel,
          excludedTarget: !1
        }) : hasSel && (gest.movement || 0) > 8;
        if (ok) {
          const x = typeof f?.clientX == "number" ? f.clientX : gest.x, I = typeof f?.clientY == "number" ? f.clientY : gest.y;
          if (!(await excludedMessageTarget(e, x, I))) {
            t._lastPointerGesture = null, await Fa(e, x, I, { source: "text" });
            return;
          }
        }
      }
      const fPress = mobilePress;
      if (!fPress) return;
      fPress.timer && clearTimeout(fPress.timer), mobilePress = null;
      if (fPress.long) {
        await hidePressFill();
        return;
      }
      if (fPress.source === "sticky-thumb") {
        await hidePressFill();
        const ov = t.overlayUi;
        if (ov) ov._stickyThumbUserHidden = !0, ov._stickyThumbHiddenId = fPress.card?.id || "", ov._lastStickyUserHidden = null;
        try {
          await Ht();
        } catch {
        }
        y("info", "sticky.thumb.hide", String(fPress.card?.id || "").slice(0, 8));
        return;
      }
      if (fPress.source === "sticky-pin") {
        const ov = t.overlayUi;
        if (ov) ov._stickyThumbUserHidden = !1, ov._stickyThumbHiddenId = "", ov._lastStickyUserHidden = null;
        try {
          await Ht();
        } catch {
        }
        y("info", "sticky.thumb.revive", String(fPress.card?.id || "").slice(0, 8));
      }
    }, onPointerCancel = () => {
      cancelMobilePress(), pointerGesture = null, pinClick = null, pendingSheetHit = null;
    }, m = async () => {
      // Message scroll is middle-click now — ignore dblclick.
    }, u = () => {
      if (t.uiOpen) return;
      // Capture native scrollY synchronously — SafeDOM rects are too slow for sticky image swaps.
      try {
        if (typeof window < "u" && t.overlayUi) t.overlayUi._liveScrollY = window.scrollY || window.pageYOffset || 0;
      } catch {
      }
      stickyFlashOnScroll();
      // Scroll path: coalesce full sticky correct to 1 rAF; select only after short idle.
      scheduleStickySync(), scheduleScrollTrack();
    }, onScrollEnd = () => {
      if (t.uiOpen) return;
      try {
        if (typeof window < "u" && t.overlayUi) t.overlayUi._liveScrollY = window.scrollY || window.pageYOffset || 0;
      } catch {
      }
      // End of gesture: correct with a real pin rect (not just the estimate).
      scheduleStickySync(!0), settleScrollTrackNow();
    }, onUserScrollStart = u, b = await fe(n, "scroll", u, !0), C = await fe(e, "scroll", u, !0), S = await fe(e, "scrollend", onScrollEnd, !0);
    let E = !1;
    if (typeof window < "u") try {
      window.addEventListener("scroll", u, !0), window.addEventListener("scrollend", onScrollEnd, !0), window.addEventListener("wheel", onUserScrollStart, {
        capture: !0,
        passive: !0
      }), window.addEventListener("resize", u), E = !0;
    } catch {
      try {
        window.addEventListener("scroll", u), window.addEventListener("wheel", onUserScrollStart), window.addEventListener("resize", u), E = !0;
      } catch {
      }
    }
    const j = await fe(e, "pointermove", l), d = await fe(e, "pointerdown", p), U = null, clickId = await fe(e, "click", onClick), upId = await fe(e, "pointerup", onPointerUp), cancelId = await fe(e, "pointercancel", onPointerCancel), keyId = await fe(e, "keydown", async (f) => {
      if (f.key === "Escape" || f.code === "Escape") await hideInspect();
    });
    t.overlayUi = {
      doc: e,
      root: o,
      layer: a,
      preview: r,
      pinned,
      fullscreen,
      actionMenu,
      markers: [],
      scrollId: C,
      scrollEndId: S,
      bodyScrollId: b,
      moveId: j,
      downId: d,
      dblId: U,
      clickId,
      upId,
      cancelId,
      keyId,
      body: n,
      showPreview: i,
      hidePreview: s,
      showPinned,
      hidePinned,
      syncMobileAlways,
      pinTarget: null,
      edgeHint: null,
      _stickyThumbUserHidden: !1,
      _stickyThumbHiddenId: "",
      _lastStickyUserHidden: null,
      onStickyScroll: u,
      onScrollEnd,
      onUserScrollStart,
      cancelMobilePress,
      chatScrollEl: null,
      chatScrollId: null,
      extraScrollBindings: [],
      segmentWatchId: null,
      winScrollBound: E
    }, Gt(), y("info", "overlay.ready", "메시지 클릭 · 스크롤 구간"), await he();
  }
  async function Ka(e, n) {
    if (!e || e.length < 8 || t.jobsInFlight.has(n) || !(await ve()).enabled) return;
    if (ge(n).length) return;
    try {
      await le();
    } catch {
    }
    const o = t.backendSettings?.card || {};
    if (o.power === !1 || o.execute === "manual") return;
    const a = await Z({ useOverride: !1 }).catch(() => null);
    if (!a || a.charIndex < 0) return;
    const rebound = await maybeRebindAndLink({
      hash: n,
      text: e,
      characterId: t.selectedMessage?.characterId || a.characterId,
      chatId: t.selectedMessage?.chatId || a.chatId,
      sessionId: t.selectedMessage?.sessionId || a.sessionId,
      chatIndex: t.selectedMessage?.chatIndex ?? -1,
      messageIndex: t.selectedMessage?.chatIndex ?? -1,
      role: t.selectedMessage?.role || "char"
    }, a);
    if (rebound.length) return y("info", "overlay.generate.skip", `rebound hash=${n.slice(0, 8)} cards=${rebound.length}`);
    y("info", "overlay.generate", `hash=${n.slice(0, 8)} chars=${e.length} session=${(a.sessionId || "").slice(-8)}`), await Be(a, e, !1);
  }
  async function Ja() {
    if (t.uiOpen || t._hostChromeBlocked) return;
    const e = t.overlayUi;
    if (!e?.layer) return;
    const n = e.doc || await ue();
    if (!n) return;
    const o = await qe(n), i = Pt, s = [], l = t.selectedMessage, m = [];
    // Skip scanning every visible message — that was the main lag source.
    // Markers only need the currently selected message + its linked cards.
    const a = await getCachedMsgEls(n);
    if (l?.sessionId && t.lastScope?.sessionId && l.sessionId !== t.lastScope.sessionId) {
      t.selectedMessage = null, t.lastImagedMessage = null, await Fe(), t.debugInsight = {
        at: Date.now(),
        focus: null,
        messages: m,
        markers: [],
        lastPlace: "selection cleared (session changed)"
      }, t.debugUi?.refreshSoon && t.debugUi.refreshSoon(), y("info", "overlay.place", "세션 변경 · 선택 해제");
      return;
    }
    // No selection: keep existing sticky (do not wipe).
    if (!l) {
      if (e.markers?.length) {
        await Ht();
        y("info", "overlay.place", `keep sticky · no-selection markers=${e.markers.length}`);
        return;
      }
      t.debugInsight = {
        at: Date.now(),
        focus: null,
        messages: m,
        markers: [],
        lastPlace: "no-selection (click a message)"
      }, t.debugUi?.refreshSoon && t.debugUi.refreshSoon(), y("info", "overlay.place", "대기: 메시지 클릭 필요");
      return;
    }
    let u = null, b = null, C = l.text;
    if (l.domIndex >= 0 && l.domIndex < (a || []).length && (u = a[l.domIndex]), u || (u = await Ge(n)), u) try {
      b = await u.getBoundingClientRect();
    } catch {
    }
    // DOM missing: keep previous sticky if any.
    if (!u || !b) {
      if (e.markers?.length) {
        await Ht();
        y("warn", "overlay.place", `DOM#${l.domIndex} 없음 · sticky keep ${e.markers.length}`);
        return;
      }
      t.debugInsight = {
        at: Date.now(),
        focus: null,
        messages: m,
        markers: [],
        lastPlace: `selected DOM#${l.domIndex} missing`
      }, y("warn", "overlay.place", `선택 메시지 DOM#${l.domIndex} 없음`), t.debugUi?.refreshSoon && t.debugUi.refreshSoon();
      return;
    }
    try {
      const g = await De(u);
      g && (C = g);
    } catch {
    }
    const focus = stickyFocusMessage() || l;
    let S = linkedCards(focus), E = l.matchMode || "none";
    const liveLinked = linkedCards(l);
    ge(l.hash).length || liveLinked.length ? E = "hash" : S.length ? E = "lastImaged" : E = "none";
    const j = Xt(C || l.text), d = j.length ? j : [C || l.text || ""], U = Me(S), f = resolvePinLeftX(), x = Math.max(1, U.length || e.markers?.length || 1);
    // Reading% pin target = message that owns the sticky cards (focus), not empty selection.
    let pinEl = u, pinMsg = l;
    if (focus && (focus.hash !== l.hash || Number(focus.domIndex) !== Number(l.domIndex))) {
      pinMsg = focus;
      pinEl = null;
      if (focus.domIndex >= 0 && focus.domIndex < (a || []).length) pinEl = a[focus.domIndex];
      if (!pinEl) pinEl = await resolveMessageDom(n, focus);
    }
    e.pinTarget = pinEl || u, e._pinDomIndex = Number((pinEl ? pinMsg : l).domIndex), await Wa(o);
    // No images for focus: keep previous markers (never blank sticky).
    if (!U.length) {
      if (e.markers?.length) {
        l.hasImage = liveLinked.length > 0, l.cardCount = liveLinked.length, l.matchMode = E, t.selectedMessage = l;
        await Ht();
        y("info", "overlay.place", `keep sticky · no cards on focus · markers=${e.markers.length}`);
        return;
      }
      y("info", "overlay.place", "no cards yet · sticky idle");
      return;
    }
    // Same card set: refresh y% + pin target only (no wipe / no flicker).
    if (stickyCardKey(U) === stickyMarkerKey(e.markers) && e.markers.length) {
      const slots = Math.max(1, U.length);
      const byId = /* @__PURE__ */ new Map(U.map((c, idx) => [String(c.id), { card: c, ci: idx }]));
      for (const mk of e.markers) {
        const hit = byId.get(String(mk.card?.id));
        if (!hit) continue;
        mk.card = hit.card, mk.yPercent = Ot(hit.card, hit.ci, slots), mk.paragraph = hit.card?.paragraph, mk.line = hit.ci;
        try {
          const fresh = Ie(hit.card);
          if (typeof fresh == "string" && /^data:image\//i.test(fresh) && fresh !== mk._thumbSrc) mk._thumbSrc = fresh;
        } catch {
        }
      }
      e.markers.sort((A, B) => (Number(A.yPercent) || 0) - (Number(B.yPercent) || 0) || (Number(A.line) || 0) - (Number(B.line) || 0));
      l.hasImage = liveLinked.length > 0, l.cardCount = liveLinked.length, l.paragraphsWithImages = [...new Set(liveLinked.map((g) => g.paragraph))].sort((g, F) => Number(g) - Number(F)), l.matchMode = E, l.paragraphCount = d.length, t.selectedMessage = l;
      e._syncedViewerCardId = "";
      await Ht();
      warmStickyMarkerImages(U, focus || l);
      y("info", "overlay.place", `reuse sticky · DOM#${l.domIndex} markers=${e.markers.length} match=${E}`);
      return;
    }
    // Optimistic sticky swap: build nodes from sync cache / previous thumbs first,
    // warm bytes in the background, then refresh srcs (old sticky stays until Ht).
    const prevMarkers = e.markers || [];
    const srcById = /* @__PURE__ */ new Map();
    for (const card of U) {
      try {
        const fb = Ie(card);
        if (typeof fb == "string" && /^data:image\//i.test(fb)) srcById.set(String(card.id), fb);
      } catch {
      }
      if (!srcById.has(String(card.id))) {
        const old = prevMarkers.find((m) => String(m?.card?.id) === String(card.id));
        if (old?._thumbSrc) srcById.set(String(card.id), old._thumbSrc);
      }
    }
    const R = U.map((g, F) => ({
      card: g,
      ci: F,
      yPercent: Ot(g, F, x)
    })).sort((g, F) => g.yPercent - F.yPercent || g.ci - F.ci);
    for (let g = 0; g < R.length; g += 1) {
      const { card: F, ci: T, yPercent: v } = R[g];
      let src = srcById.get(String(F.id)) || "";
      if (!src) {
        try {
          const fb = Ie(F);
          if (typeof fb == "string" && /^data:image\//i.test(fb)) src = fb;
        } catch {
        }
      }
      // Prefer previous thumb src if cache miss — avoid empty flash.
      if (!src) {
        const old = prevMarkers.find((m) => String(m?.card?.id) === String(F.id));
        if (old?._thumbSrc) src = old._thumbSrc;
      }
      const pooled = takePooledMarker(F, src);
      if (pooled) {
        pooled.paragraph = F.paragraph, pooled.yPercent = v, pooled.line = T, pooled.active = !1, pooled.edge = null;
        if (src && !pooled._thumbSrc) pooled._thumbSrc = src, pooled._paintedSrc = src, pooled._thumbHtmlId = String(F.id || "");
        s.push(pooled);
        continue;
      }
      const X = await H(n, "div", {
        style: "position:fixed;display:none;z-index:99970;",
        html: src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block" />` : `<div style="width:100%;height:100%;background:#0b0f18"></div>`
      });
      await e.layer.appendChild(X);
      const te = await H(n, "div", {
        style: ze(f, -9999, i, !1),
        html: "🖼"
      });
      try {
        await te.setAttribute("data-inlay-role", "marker");
      } catch {
      }
      try {
        await te.setAttribute("x-inlay-role", "marker");
      } catch {
      }
      try {
        await te.setAttribute("title", `P${F.paragraph ?? T} · ${Math.round(v)}%`);
      } catch {
      }
      await e.layer.appendChild(te), s.push({
        el: te,
        thumb: X,
        card: F,
        paragraph: F.paragraph,
        yPercent: v,
        active: !1,
        edge: null,
        line: T,
        hitPad: 12,
        _thumbSrc: src || "",
        _paintedSrc: src || "",
        _thumbHtmlId: src ? String(F.id || "") : "",
        _pinHtml: "🖼"
      });
    }
    // Keep previous thumbs visible until Ht paints the new active image on top.
    e.markers = s;
    e.pinTarget = u;
    e._syncedViewerCardId = "";
    e._lastStickyThumbHtmlId = null;
    await Ht();
    warmStickyMarkerImages(U, focus || l);
    // Background warm: fill missing sticky thumbs without blocking the first paint.
    Promise.all(U.map(async (card) => {
      try {
        const src = await ensureStickyCardImage(card);
        if (!src) return;
        const mk = (e.markers || []).find((m) => String(m?.card?.id) === String(card.id));
        if (!mk) return;
        if (mk._thumbSrc !== src) {
          mk._thumbSrc = src;
          mk.card = card;
          if (mk._thumbHtmlId === String(card.id || "")) {
            mk._paintedSrc = "";
            mk._thumbHtmlId = "";
          }
        }
      } catch {
      }
    })).then(() => Ht()).catch(() => {
    });
    const keepIds = new Set(s.map((m) => String(m?.card?.id || "")).filter(Boolean));
    parkMarkersToPool(prevMarkers.filter((m) => !keepIds.has(String(m?.card?.id || ""))));
    l.hasImage = liveLinked.length > 0, l.cardCount = liveLinked.length, l.paragraphsWithImages = [...new Set(liveLinked.map((g) => g.paragraph))].sort((g, F) => Number(g) - Number(F)), l.matchMode = E, l.paragraphCount = d.length, t.selectedMessage = l, t.debugInsight = {
      at: Date.now(),
      focus: {
        domIndex: l.domIndex,
        chatIndex: l.chatIndex,
        hash: l.hash,
        hasImage: l.hasImage,
        cardCount: l.cardCount,
        paragraphsWithImages: l.paragraphsWithImages,
        matchMode: E,
        preview: l.preview
      },
      messages: m,
      markers: s.map((g) => ({
        paragraph: g.paragraph,
        line: g.line,
        id: g.card?.id,
        yPercent: g.yPercent,
        active: !!g.active,
        hash: g.card?.content_hash
      })),
      lastPlace: `DOM#${l.domIndex} slots=${x} x=${f} markers=${s.length} match=${E} mode=y% pin=segment active=${e.activeSegment ?? -1} y=[${R.map((g) => Math.round(g.yPercent)).join(",")}]`
    }, t.debugUi?.refreshSoon && t.debugUi.refreshSoon(), t.galleryUi?.renderGal && await t.galleryUi.renderGal(), y("info", "overlay.place", t.debugInsight.lastPlace);
  }
  async function he() {
    return Ia.run(Ja);
  }
  async function Vt() {
    try {
      await le();
    } catch {
    }
    const e = t.backendSettings?.card || {};
    e.floating_viewer === !1 && (await flushSettingsSave(), await pe({ card: {
      ...e,
      floating_viewer: !0,
      gallery_fab: !1
    } })), await lt(), t.galleryUi?.renderGal && await t.galleryUi.renderGal();
  }
  async function Xa() {
    await Wt();
  }
  async function Qa() {
    await ve();
    try {
      await le();
    } catch {
    }
    typeof k.registerSetting == "function" && await D("registerSetting", () => k.registerSetting("Inlay Nexus", At, "🖼️", "html", "inlay-nexus-settings"), null), await syncQuickSettingsButton((t.backendSettings?.card || {}).show_risu_settings_button !== !1), await Rt();
    const retryHostUi = async (e = 0) => {
      if (t.unloading || t.uiOpen) return;
      try {
        t.hostDoc = null, await le(), await it();
      } catch (n) {
        e >= 24 && Pe("host ui init", n);
      }
      const n = t.backendSettings?.card || {}, o = n.floating_viewer === !1 || !!t.galleryUi?.root, a = n.overlay_markers === !1 || !!t.overlayUi?.root;
      if (o && a || e >= 24 || t.unloading) return;
      t.startupRetryTimer && clearTimeout(t.startupRetryTimer), t.startupRetryTimer = setTimeout(() => {
        t.startupRetryTimer = null, retryHostUi(e + 1).catch(() => {
        });
      }, Math.min(1500, 120 + e * 80));
    };
    try {
      await retryHostUi();
    } catch (e) {
      Pe("host ui init", e);
    }
    startHostUiWatchdog();
    try {
      if ((typeof k.requestPluginPermission == "function" ? await k.requestPluginPermission("replacer") : !0) === !1) throw new Error("replacer permission denied");
      if (typeof k.addRisuReplacer != "function") throw new Error("addRisuReplacer unavailable");
      await k.addRisuReplacer("afterRequest", _t), t.replacerReady = !0;
    } catch (e) {
      t.replacerReady = !1, t.replacerError = z(e?.message || e), Pe("replacer init failed", e);
    }
    typeof k.onUnload == "function" && k.onUnload(async () => {
      t.unloading = !0, t.pollTimer && clearInterval(t.pollTimer), t.startupRetryTimer && clearTimeout(t.startupRetryTimer), t._pinBootTimer && clearTimeout(t._pinBootTimer), t._hostWatch && clearInterval(t._hostWatch), t._settingsWatch && clearInterval(t._settingsWatch), t.timersBySession.forEach((e) => clearTimeout(e)), await flushSettingsSave().catch(() => {
      }), await syncQuickSettingsButton(!1), await Rt(), await st(), await Xa(), await ct(), await D("removeAfter", () => k.removeRisuReplacer?.("afterRequest", _t), null);
    }), globalThis.INLAY_NEXUS_RUNTIME = t, y("info", "boot", `v${He}`), console.log(`[${$}] ready v${He}`);
  }
  await Qa();
}
console.log(`[${ea}] boot (${Zt})`);
await gn();

