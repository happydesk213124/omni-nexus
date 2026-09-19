/**
 * Vendor patch: models tab LLM → 4 role subtabs.
 * Loaded by vite.config.ts asserted replace.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vendor = fs.readFileSync(path.join(root, 'vendor/inlay-nexus-ui.js'), 'utf8').replace(/\r\n/g, '\n');

function mustSlice(label, fromNeedle, toNeedle, { fromInclusive = true, toInclusive = false } = {}) {
  const from = vendor.indexOf(fromNeedle);
  const to = vendor.indexOf(toNeedle, from + (fromInclusive ? fromNeedle.length : 0));
  if (from < 0 || to < 0 || to < from) throw new Error(`${label}: bounds not found`);
  const start = fromInclusive ? from : from + fromNeedle.length;
  const end = toInclusive ? to + toNeedle.length : to;
  return vendor.slice(start, end);
}

export const VENDOR_MODELS_LLM_NEEDLE = mustSlice(
  'models llm html',
  '    else if (t.uiTab === "models") {',
  '<div class="prompt-group-label">이미지 생성</div>',
);

export const VENDOR_MODELS_LLM_PATCH = `    else if (t.uiTab === "models") {
      const LH = globalThis.__INLAY_LLM__ || {};
      const roles = typeof LH.normalizeLlmRolesSettings == "function" ? LH.normalizeLlmRolesSettings(t.backendSettings?.llm_roles) : { autotag: { follow_main: !0 }, asset_char: { follow_main: !0 } };
      const tab = t.modelsLlmTab === "autotag" || t.modelsLlmTab === "asset_char" || t.modelsLlmTab === "curator" || t.modelsLlmTab === "comic" ? t.modelsLlmTab : "main";
      const imgBk = w(s.backend) === "comfy" ? "comfy" : "nai", U = imgBk === "comfy" ? !!s.comfy_configured || !!w(s.comfy_workflow_json) : !!(s.api_key_configured || s.api_keys_v5_configured || s.api_keys_v4_configured);
      const tabsHtml = typeof LH.renderLlmRoleTabsHtml == "function" ? LH.renderLlmRoleTabsHtml(tab) : "";
      const renderCard = typeof LH.renderLlmRoleCardHtml == "function" ? LH.renderLlmRoleCardHtml.bind(LH) : null;
      const mainCard = renderCard ? renderCard({ prefix: "nx-llm", title: "메인 태깅", settings: c, hidden: tab !== "main", testResultHtml: $t("llm") }) : "";
      const autoCard = renderCard ? renderCard({ prefix: "nx-llm-autotag", title: "오토태그", subtitle: "캐릭터 칩·모델 탭 비전 오토태그", allowFollowMain: !0, settings: roles.autotag, hidden: tab !== "autotag", testResultHtml: $t("llm-autotag") }) : "";
      const assetCard = renderCard ? renderCard({ prefix: "nx-llm-asset", title: "에셋캐릭", subtitle: "에셋 NAI 태그 prepass looks (char_looks)", allowFollowMain: !0, settings: roles.asset_char, hidden: tab !== "asset_char", testResultHtml: $t("llm-asset") }) : "";
      const comicCard = renderCard ? renderCard({prefix:"nx-llm-comic",title:"만화생성",allowFollowMain:!0,settings:roles.comic || {follow_main:!0},hidden:tab !== "comic",testResultHtml:$t("llm-comic")}) : "";
      u = \`
        <div class="prompt-toolbar">
          <div><strong>모델 설정</strong></div>
          <div class="toolbar-actions"><button id="nx-save-models">저장</button></div>
        </div>
        <div class="prompt-group-label">LLM</div>
        \${tabsHtml}
        \${mainCard}\${autoCard}\${assetCard}\${comicCard}
        
`;

export const VENDOR_OE_LLM_NEEDLE = `  function Oe() {
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
    if (ee("nx-llm-clear-sa")) e.clearServiceAccount = !0;`;

export const VENDOR_OE_LLM_PATCH = `  function Oe() {
    const LH = globalThis.__INLAY_LLM__ || {};
    const readers = {
      get: (id) => N(id),
      checked: (id) => ee(id),
      has: (id) => !!document.getElementById(id)
    };
    const readRole = typeof LH.readLlmRoleFromDom == "function"
      ? (prefix, allowFollow) => LH.readLlmRoleFromDom(readers, prefix, { allowFollowMain: !!allowFollow })
      : null;
    const e = readRole ? readRole("nx-llm", !1) : {
      source: N("nx-llm-source") || "custom",
      provider: N("nx-llm-provider"),
      model: N("nx-llm-model"),
      endpoint: N("nx-llm-endpoint"),
      temperature: Number(N("nx-llm-temp") || 0.4),
      max_tokens: Number(N("nx-llm-max") || 8e3),
      reasoning_effort: N("nx-llm-reasoning") || "default",
      vertex_region: N("nx-llm-vertex-region") || "us-central1",
      anthropic_version: N("nx-llm-anthropic-version") || "2023-06-01"
    };
    if (!readRole) {
      const n = N("nx-llm-key");
      n && (e.api_key = n);
      const sa = N("nx-llm-service-account");
      sa && (e.service_account_json = sa);
      if (ee("nx-llm-clear-sa")) e.clearServiceAccount = !0;
    }
    const llm_roles = {
      autotag: readRole ? readRole("nx-llm-autotag", !0) : { follow_main: !0 },
      asset_char: readRole ? readRole("nx-llm-asset", !0) : { follow_main: !0 },
      comic: readRole ? readRole("nx-llm-comic", !0) : {follow_main:!0}
    };`;

export const VENDOR_OE_RETURN_NEEDLE = `    return a && (o.api_key = a), {
      llm: e,
      nai: o
    };
  }`;

export const VENDOR_OE_RETURN_PATCH = `    return a && (o.api_key = a), {
      llm: e,
      llm_roles,
      nai: o
    };
  }`;

/** Role-tab + source/provider binds only (stops before nx-save-models). */
export const VENDOR_LLM_BIND_NEEDLE = mustSlice(
  'llm bind events',
  '    }), document.getElementById("nx-llm-source")?.addEventListener("change", async () => {',
  'document.getElementById("nx-save-models")?.addEventListener("click", async () => {',
);

/** Save + connection-test handlers. */
export const VENDOR_LLM_SAVE_TEST_NEEDLE = mustSlice(
  'llm save/test events',
  'document.getElementById("nx-save-models")?.addEventListener("click", async () => {',
  'document.getElementById("nx-img-backend-bar")?.addEventListener("click", async (ev) => {',
);

const mergeDraft = `try {
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
        t.backendSettings.llm_roles = { ...(t.backendSettings.llm_roles || {}) };
        for (const id of ["autotag", "asset_char", "comic"]) {
          const prev = t.backendSettings.llm_roles[id] || {};
          const next = (draft.llm_roles || {})[id] || {};
          t.backendSettings.llm_roles[id] = {
            ...prev,
            ...next,
            api_key: undefined,
            service_account_json: undefined,
            api_key_configured: prev.api_key_configured,
            service_account_configured: prev.service_account_configured
          };
        }
      } catch {
      }`;

// Comma-expression chain — wrap statements in an IIFE.
export const VENDOR_LLM_BIND_PATCH = `    }), (() => {
      document.getElementById("nx-llm-role-tabs")?.addEventListener("click", async (ev) => {
        const btn = ev?.target?.closest?.("[data-llm-role]");
        if (!btn) return;
        await flushSettingsSave();
        await pe(Oe());
        ${mergeDraft}
        t.modelsLlmTab = btn.getAttribute("data-llm-role") || "main";
        await P();
      });
      const persistLlmDraft = async () => {
        await flushSettingsSave();
        await pe(Oe());
        ${mergeDraft}
        await P();
      };
      for (const sel of ["#nx-llm-source", "#nx-llm-autotag-source", "#nx-llm-asset-source", "#nx-llm-comic-source"]) {
        document.querySelector(sel)?.addEventListener("change", persistLlmDraft);
      }
      const bindProvider = (prefix) => {
        document.getElementById(prefix + "-provider")?.addEventListener("change", async (ev) => {
          const LH = globalThis.__INLAY_LLM__ || {}, provider = String(ev?.target?.value || "custom"), endpointEl = document.getElementById(prefix + "-endpoint"), modelEl = document.getElementById(prefix + "-model"), regionEl = document.getElementById(prefix + "-vertex-region"), nextEndpoint = LH.defaultEndpointForProvider?.(provider, { region: regionEl?.value || "us-central1" }) || "", known = LH.shouldAutoReplaceEndpoint?.(endpointEl?.value);
          if (endpointEl && (known || !String(endpointEl.value || "").trim())) endpointEl.value = provider === "vertex" ? "" : nextEndpoint;
          if (modelEl && (!modelEl.value || ["openai/gpt-oss-20b:nitro", "gpt-4o-mini", "gemini-2.5-flash"].includes(modelEl.value))) {
            const ph = LH.llmModelPlaceholder?.(provider);
            if (ph) modelEl.placeholder = ph;
          }
          await persistLlmDraft();
        });
        document.getElementById(prefix + "-vertex-region")?.addEventListener("change", () => {
          const LH = globalThis.__INLAY_LLM__ || {}, provider = N(prefix + "-provider"), endpointEl = document.getElementById(prefix + "-endpoint"), region = N(prefix + "-vertex-region") || "us-central1";
          if (provider === "vertex" && endpointEl && LH.shouldAutoReplaceEndpoint?.(endpointEl.value)) {
            endpointEl.value = LH.defaultEndpointForProvider?.("vertex", { region }) || "";
          }
        });
      };
      for (const prefix of ["nx-llm", "nx-llm-autotag", "nx-llm-asset", "nx-llm-comic"]) bindProvider(prefix);
    })(), `;

export const VENDOR_LLM_SAVE_TEST_PATCH = `document.getElementById("nx-save-models")?.addEventListener("click", async () => {
      try {
        const draft = Oe(), a = draft.llm, r = draft.nai, roles = draft.llm_roles || {};
        const llmSource = a.source === "main" || a.source === "aux" ? a.source : "custom";
        a.source = llmSource;
        const LH = globalThis.__INLAY_LLM__ || {}, provider = LH.normalizeLlmProvider?.(a.provider) || a.provider;
        let llmErr = "";
        if (llmSource === "custom") {
          if (!w(a.model)) llmErr = "메인 태깅 LLM Model이 비어 있습니다.";
          else {
            const hasKey = !!(a.api_key || t.backendSettings?.llm?.api_key_configured);
            const hasSa = !!(a.service_account_json || t.backendSettings?.llm?.service_account_configured) && !a.clearServiceAccount;
            if (provider === "vertex" ? !hasKey && !hasSa : !hasKey) llmErr = provider === "vertex" ? "Vertex AI Service Account JSON(또는 access token)을 입력하세요." : "메인 태깅 LLM API key를 입력하세요. (NovelAI 키와 별개)";
          }
        }
        await flushSettingsSave();
        if (llmErr) {
          await pe({ nai: r }), t.uiMessage = { type: "error", text: "NAI 키는 저장됨. " + llmErr };
        } else {
          await pe({ llm: a, llm_roles: roles, nai: r }), t.uiMessage = { type: "success", text: "모델 설정 저장됨" };
        }
      } catch (a) {
        t.uiMessage = { type: "error", text: z(a.message || a) };
      }
      await P();
    }), (() => {
      const runLlmRoleTest = async (testKey, roleResolve) => {
        const a = document.getElementById("nx-test-" + testKey), r = document.getElementById("nx-test-result-" + testKey);
        a && (a.disabled = !0), r && (r.className = "test-result pending", r.textContent = "저장 후 테스트 중…");
        try {
          const draft = Oe();
          await flushSettingsSave(), await pe({ llm: draft.llm, llm_roles: draft.llm_roles, nai: draft.nai });
          const LH = globalThis.__INLAY_LLM__ || {};
          const resolved = typeof LH.resolveLlmRole == "function"
            ? LH.resolveLlmRole({ llm: draft.llm, llm_roles: draft.llm_roles }, roleResolve)
            : draft.llm;
          const c = await K("/v1/models/test", { method: "POST", body: { llm: resolved } });
          je(testKey, !!c?.ok, c?.message || (c?.ok ? "연결 성공" : "연결 실패")), t.uiMessage = {
            type: c?.ok ? "success" : "error",
            text: c?.ok ? "LLM 테스트 성공" : \`LLM 테스트 실패 · \${z(c?.message || "")}\`
          };
        } catch (err) {
          je(testKey, !1, err.message || err), t.uiMessage = {
            type: "error",
            text: \`LLM 테스트 실패 · \${z(err.message || err)}\`
          };
        } finally {
          a && (a.disabled = !1);
        }
        await P();
      };
      document.getElementById("nx-test-llm")?.addEventListener("click", async () => {
        await runLlmRoleTest("llm", "main");
      });
      document.getElementById("nx-test-llm-autotag")?.addEventListener("click", async () => {
        await runLlmRoleTest("llm-autotag", "autotag");
      });
      document.getElementById("nx-test-llm-asset")?.addEventListener("click", async () => {
        await runLlmRoleTest("llm-asset", "asset_char");
      });
      document.getElementById("nx-test-llm-comic")?.addEventListener("click", async () => { await runLlmRoleTest("llm-comic", "comic"); });
    })(), `;

export const VENDOR_IMG_BACKEND_DRAFT_NEEDLE = `        if (cur.llm) {
          delete cur.llm.api_key;
          delete cur.llm.service_account_json;
          t.backendSettings.llm = {
            ...(t.backendSettings.llm || {}),
            ...cur.llm,
            api_key_configured: t.backendSettings.llm?.api_key_configured,
            service_account_configured: t.backendSettings.llm?.service_account_configured
          };
        }`;

export const VENDOR_IMG_BACKEND_DRAFT_PATCH = `        if (cur.llm) {
          delete cur.llm.api_key;
          delete cur.llm.service_account_json;
          t.backendSettings.llm = {
            ...(t.backendSettings.llm || {}),
            ...cur.llm,
            api_key_configured: t.backendSettings.llm?.api_key_configured,
            service_account_configured: t.backendSettings.llm?.service_account_configured
          };
        }
        if (cur.llm_roles) {
          t.backendSettings.llm_roles = { ...(t.backendSettings.llm_roles || {}) };
          for (const id of ["autotag", "asset_char", "comic"]) {
            const prev = t.backendSettings.llm_roles[id] || {};
            const next = cur.llm_roles[id] || {};
            if (!next || typeof next !== "object") continue;
            delete next.api_key;
            delete next.service_account_json;
            t.backendSettings.llm_roles[id] = {
              ...prev,
              ...next,
              api_key_configured: prev.api_key_configured,
              service_account_configured: prev.service_account_configured
            };
          }
        }`;

export const VENDOR_BA_QUEUE_NEEDLE = `l && (i.llm = l.llm, i.nai = l.nai), Object.keys(i).length && queueSettingsSave(i);`;
export const VENDOR_BA_QUEUE_PATCH = `l && (i.llm = l.llm, i.llm_roles = l.llm_roles, i.nai = l.nai), Object.keys(i).length && queueSettingsSave(i);`;
